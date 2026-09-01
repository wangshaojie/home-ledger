import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { errText } from '@/lib/notify'
import { rangeStartIso, type RangeKey } from '@/lib/dateRange'
import { useAuthStore } from './auth'

export interface Expense {
  id: string
  family_id: string
  creator_id: string
  member_id: string
  payer_id: string
  category_id: string
  account_id: string | null
  amount: number
  spent_at: string
  note: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  // v2026-09-01 多人分摊：同组子记录共享同一 group_id，为 NULL 表示普通单条
  group_id: string | null
  // 关联表 join 出来的可选字段
  // v1.1: member 指向 family_members（不再指向 profiles）
  member?: { id: string; name: string; type: 'adult' | 'child' | 'pet' } | null
  payer?: { id: string; name: string; type: 'adult' | 'child' | 'pet' } | null
  category?: { id: string; name: string; icon: string } | null
  account?: { id: string; name: string; icon: string } | null
}

export interface FilterState {
  range: RangeKey
  categoryIds: string[]
  memberIds: string[]
  minAmount?: number
  maxAmount?: number
}

export const useExpenseStore = defineStore('expense', () => {
  const items = ref<Expense[]>([])
  // 数据版本号：load 成功、记账/分摊/删除等任何 items 内容变化时自增。
  // 供依赖 items 内容的组件（如成员统计面板）监听，避免只监听数组引用
  // 漏掉 unshift 这类原地修改（引用不变）。
  const revision = ref(0)
  const loading = ref(false)
  const filter = ref<FilterState>({
    range: 'today',
    categoryIds: [],
    memberIds: [],
    minAmount: undefined,
    maxAmount: undefined
  })

  const filteredExpenses = computed(() => {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(startOfDay.getTime() - 86400000)
    const weekAgo = new Date(now.getTime() - 7 * 86400000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    return items.value
      .filter((e) => {
        const d = new Date(e.spent_at)
        if (filter.value.range === 'today' && d < startOfDay) return false
        if (filter.value.range === 'yesterday' && (d < yesterday || d >= startOfDay)) return false
        if (filter.value.range === 'week' && d < weekAgo) return false
        if (filter.value.range === '30d' && d < thirtyDaysAgo) return false
        if (filter.value.range === 'month' && d < monthStart) return false
        if (filter.value.categoryIds.length && !filter.value.categoryIds.includes(e.category_id)) return false
        if (filter.value.memberIds.length && !filter.value.memberIds.includes(e.member_id)) return false
        if (filter.value.minAmount != null && e.amount < filter.value.minAmount) return false
        if (filter.value.maxAmount != null && e.amount > filter.value.maxAmount) return false
        return true
      })
      .sort((a, b) => new Date(b.spent_at).getTime() - new Date(a.spent_at).getTime())
  })

  const totalAmount = computed(() =>
    filteredExpenses.value.reduce((s, e) => s + Number(e.amount), 0)
  )

  const todayTotal = ref(0)
  const monthTotal = ref(0)
  const yearTotal = ref(0)

  // 竞态保护：load / loadTotals 各持一个单调递增序号，
  // 请求返回时若序号已过期则丢弃结果，避免慢的旧请求覆盖新结果
  let loadSeq = 0
  let totalsSeq = 0

  /**
   * 固定口径统计（今日/本月/本年）走数据库 RPC 聚合，不再依赖 items。
   * items 现在只含当前筛选范围的数据，无法再支撑年/月口径；
   * 且该项目的 PostgREST 不支持 select=sum(amount) 聚合语法（PGRST200），
   * 所以用 get_family_totals RPC 在数据库端求和。
   */
  async function loadTotals() {
    const seq = ++totalsSeq
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) {
      todayTotal.value = 0
      monthTotal.value = 0
      yearTotal.value = 0
      return
    }
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString()
    try {
      const { data, error } = await supabase.rpc('get_family_totals', {
        p_today: startOfToday,
        p_month: startOfMonth,
        p_year: startOfYear
      })
      if (seq !== totalsSeq) return // 过期请求丢弃
      if (error) {
        console.error('get_family_totals error', error)
        return
      }
      const d = data as { today?: number; month?: number; year?: number } | null
      todayTotal.value = Number(d?.today || 0)
      monthTotal.value = Number(d?.month || 0)
      yearTotal.value = Number(d?.year || 0)
    } catch (e) {
      console.error('loadTotals error', e)
    }
  }

  /**
   * v1.1 成员支出统计 - 按 creator 维度聚合
   * 注意:expenses.creator_id 是 profile.id（v1.0 旧设计,SQL 层未改）,
   *       返回的 memberId 实际上是 profile.id。调用方（MemberStatsPanel）
   *       需要用 familyStore.members 把 profile.id 翻译成 family_member.id
   * @param startDate ISO 字符串；传 null 表示无时间下限（全部历史）
   * @param extraFilter 可选,跟 HomeView 列表筛选一致(categoryIds/memberIds/amount 范围)
   */
  async function aggregateByCreator(
    startDate: string | null,
    extraFilter?: {
      categoryIds?: string[]
      memberIds?: string[]
      minAmount?: number
      maxAmount?: number
    }
  ): Promise<{ memberId: string; total: number }[]> {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) return []
    let q = supabase
      .from('expenses')
      .select('creator_id, amount')
      .eq('family_id', fid)
      .is('deleted_at', null)
    if (startDate) q = q.gte('spent_at', startDate)
    if (extraFilter?.categoryIds?.length) q = q.in('category_id', extraFilter.categoryIds)
    if (extraFilter?.memberIds?.length) q = q.in('member_id', extraFilter.memberIds)
    if (extraFilter?.minAmount != null) q = q.gte('amount', extraFilter.minAmount)
    if (extraFilter?.maxAmount != null) q = q.lte('amount', extraFilter.maxAmount)
    const { data, error } = await q
    if (error) {
      console.error('aggregateByCreator error', error)
      return []
    }
    const map = new Map<string, number>()
    for (const row of data || []) {
      map.set(row.creator_id, (map.get(row.creator_id) || 0) + Number(row.amount))
    }
    return Array.from(map.entries())
      .map(([memberId, total]) => ({ memberId, total }))
      .sort((a, b) => b.total - a.total)
  }

  /**
   * v1.2.5 成员支出统计 - 按 payer 维度聚合
   * expenses.payer_id 直接指向 family_members（不是 profile），所以返回的 memberId
   * 就是 family_member.id，调用方不需要再翻译。相对 aggregateByCreator 的区别：
   *  - creator: 谁录的（profile，登录用户，家人共用账号时都算同一个人）
   *  - payer:   谁掏的钱（family_member，每个家庭成员独立统计）
   * 适合"按付款人"展示——能区分夫妻各自付了多少。
   */
  async function aggregateByPayer(
    startDate: string | null,
    extraFilter?: {
      categoryIds?: string[]
      memberIds?: string[]
      minAmount?: number
      maxAmount?: number
    }
  ): Promise<{ memberId: string; total: number }[]> {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) return []
    let q = supabase
      .from('expenses')
      .select('payer_id, amount')
      .eq('family_id', fid)
      .is('deleted_at', null)
      .not('payer_id', 'is', null)
    if (startDate) q = q.gte('spent_at', startDate)
    if (extraFilter?.categoryIds?.length) q = q.in('category_id', extraFilter.categoryIds)
    if (extraFilter?.memberIds?.length) q = q.in('member_id', extraFilter.memberIds)
    if (extraFilter?.minAmount != null) q = q.gte('amount', extraFilter.minAmount)
    if (extraFilter?.maxAmount != null) q = q.lte('amount', extraFilter.maxAmount)
    const { data, error } = await q
    if (error) {
      console.error('aggregateByPayer error', error)
      return []
    }
    const map = new Map<string, number>()
    for (const row of data || []) {
      const key = row.payer_id as string
      if (!key) continue
      map.set(key, (map.get(key) || 0) + Number(row.amount))
    }
    return Array.from(map.entries())
      .map(([memberId, total]) => ({ memberId, total }))
      .sort((a, b) => b.total - a.total)
  }

  /**
   * v1.1 成员支出统计 - 按 member 维度聚合
   */
  async function aggregateByMember(
    startDate: string | null,
    extraFilter?: {
      categoryIds?: string[]
      memberIds?: string[]
      minAmount?: number
      maxAmount?: number
    }
  ): Promise<{ memberId: string; total: number }[]> {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) return []
    let q = supabase
      .from('expenses')
      .select('member_id, amount')
      .eq('family_id', fid)
      .is('deleted_at', null)
    if (startDate) q = q.gte('spent_at', startDate)
    if (extraFilter?.categoryIds?.length) q = q.in('category_id', extraFilter.categoryIds)
    if (extraFilter?.memberIds?.length) q = q.in('member_id', extraFilter.memberIds)
    if (extraFilter?.minAmount != null) q = q.gte('amount', extraFilter.minAmount)
    if (extraFilter?.maxAmount != null) q = q.lte('amount', extraFilter.maxAmount)
    const { data, error } = await q
    if (error) {
      console.error('aggregateByMember error', error)
      return []
    }
    const map = new Map<string, number>()
    for (const row of data || []) {
      map.set(row.member_id, (map.get(row.member_id) || 0) + Number(row.amount))
    }
    return Array.from(map.entries())
      .map(([memberId, total]) => ({ memberId, total }))
      .sort((a, b) => b.total - a.total)
  }

  /** 按支付账户聚合累计支出（全量、不受筛选时间范围影响）——账户管理页使用 */
  async function aggregateByAccount(): Promise<Map<string, number>> {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    const map = new Map<string, number>()
    if (!fid) return map
    const { data, error } = await supabase
      .from('expenses')
      .select('account_id, amount')
      .eq('family_id', fid)
      .is('deleted_at', null)
    if (error) {
      console.error('aggregateByAccount error', error)
      return map
    }
    for (const row of data || []) {
      const key = row.account_id || ''
      map.set(key, (map.get(key) || 0) + Number(row.amount))
    }
    return map
  }

  async function load() {
    const seq = ++loadSeq
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) {
      items.value = []
      return
    }
    loading.value = true

    // 筛选下沉到 SQL：只拉当前 filter 范围内的数据（不再全量 + limit(2000) 隐性截断）
    let q = supabase
      .from('expenses')
      .select(`
        *,
        member:member_id ( id, name, type ),
        payer:payer_id ( id, name, type ),
        category:category_id ( id, name, icon ),
        account:account_id ( id, name, icon )
      `)
      .eq('family_id', fid)
      .is('deleted_at', null)
    const f = filter.value
    const since = rangeStartIso(f.range)
    if (since) q = q.gte('spent_at', since)
    if (f.range === 'yesterday') q = q.lt('spent_at', rangeStartIso('today')!)
    if (f.categoryIds.length) q = q.in('category_id', f.categoryIds)
    if (f.memberIds.length) q = q.in('member_id', f.memberIds)
    if (f.minAmount != null) q = q.gte('amount', f.minAmount)
    if (f.maxAmount != null) q = q.lte('amount', f.maxAmount)

    try {
      const { data, error } = await q.order('spent_at', { ascending: false })
      if (seq !== loadSeq) return // 过期请求丢弃（防抖只合并连续点击，防不了乱序）
      if (error) {
        console.error('load expenses error', error)
        return
      }
      items.value = (data || []) as Expense[]
      revision.value++
    } catch (e) {
      console.error('load expenses error', e)
    } finally {
      if (seq === loadSeq) loading.value = false
    }
    if (seq === loadSeq) await loadTotals()
  }

  async function add(payload: {
    amount: number
    categoryId: string
    accountId: string
    memberId: string
    payerId: string
    spentAt: string
    note: string
  }) {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    const uid = auth.user?.id || auth.profile?.id
    if (!fid || !uid) return { ok: false, message: '未登录' }
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        family_id: fid,
        creator_id: uid,
        member_id: payload.memberId,
        payer_id: payload.payerId,
        category_id: payload.categoryId,
        account_id: payload.accountId,
        amount: payload.amount,
        spent_at: payload.spentAt,
        note: payload.note
      })
      .select(`
        *,
        member:member_id ( id, name, type ),
        payer:payer_id ( id, name, type ),
        category:category_id ( id, name, icon ),
        account:account_id ( id, name, icon )
      `)
      .single()
    if (error) return { ok: false, message: errText(error, '记账失败') }
    items.value.unshift(data as Expense)
    revision.value++
    void loadTotals()
    return { ok: true, message: '记账成功' }
  }

  async function update(id: string, patch: Partial<{
    amount: number
    categoryId: string
    accountId: string
    memberId: string
    payerId: string
    spentAt: string
    note: string
  }>) {
    const updateObj: any = {}
    if (patch.amount !== undefined) updateObj.amount = patch.amount
    if (patch.categoryId !== undefined) updateObj.category_id = patch.categoryId
    if (patch.accountId !== undefined) updateObj.account_id = patch.accountId
    if (patch.memberId !== undefined) updateObj.member_id = patch.memberId
    if (patch.payerId !== undefined) updateObj.payer_id = patch.payerId
    if (patch.spentAt !== undefined) updateObj.spent_at = patch.spentAt
    if (patch.note !== undefined) updateObj.note = patch.note
    const { error } = await supabase.from('expenses').update(updateObj).eq('id', id)
    if (error) return { ok: false, message: errText(error, '更新失败') }
    // 本地也更新
    await load()
    return { ok: true, message: '已更新' }
  }

  /**
   * v2026-09-01 多人分摊（方案 C）
   * 一笔总费用按成员拆成多条子记录，共享同一个 group_id，方便整组删除
   * 分摊金额由调用方算好（均分/自定义），这里只负责批量插入
   */
  async function addShared(payload: {
    splits: { memberId: string; amount: number }[]
    payerId: string
    categoryId: string
    accountId: string
    spentAt: string
    note: string
  }) {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    const uid = auth.user?.id || auth.profile?.id
    if (!fid || !uid) return { ok: false, message: '未登录' }
    const groupId = crypto.randomUUID()
    const rows = payload.splits.map((s) => ({
      family_id: fid,
      creator_id: uid,
      member_id: s.memberId,
      payer_id: payload.payerId,
      category_id: payload.categoryId,
      account_id: payload.accountId,
      amount: s.amount,
      spent_at: payload.spentAt,
      note: payload.note,
      group_id: groupId
    }))
    const { data, error } = await supabase
      .from('expenses')
      .insert(rows)
      .select(`
        *,
        member:member_id ( id, name, type ),
        payer:payer_id ( id, name, type ),
        category:category_id ( id, name, icon ),
        account:account_id ( id, name, icon )
      `)
    if (error) return { ok: false, message: errText(error, '记账失败') }
    items.value = [...(data as Expense[]), ...items.value]
    revision.value++
    void loadTotals()
    return { ok: true, message: '记账成功' }
  }

  async function remove(id: string) {
    const target = items.value.find((e) => e.id === id)
    const groupId = target?.group_id || null
    const stamp = new Date().toISOString()
    // 软删：更新 deleted_at；分摊记录整组一起删
    const q = supabase.from('expenses').update({ deleted_at: stamp })
    if (groupId) q.eq('group_id', groupId).is('deleted_at', null)
    else q.eq('id', id)
    const { error } = await q
    if (error) return { ok: false, message: errText(error, '删除失败') }
    items.value = groupId
      ? items.value.filter((e) => e.group_id !== groupId)
      : items.value.filter((e) => e.id !== id)
    revision.value++
    void loadTotals()
    return { ok: true, message: groupId ? '已删除整组' : '已删除' }
  }

  // 筛选条件变化 → 自动按 SQL 重新拉取（防抖：连续勾选只打一次请求）
  let filterTimer: ReturnType<typeof setTimeout> | null = null
  watch(
    filter,
    () => {
      if (filterTimer) clearTimeout(filterTimer)
      filterTimer = setTimeout(() => {
        void load()
      }, 250)
    },
    { deep: true }
  )

  function reset() {
    loadSeq++ // 让所有挂起的 load/loadTotals 请求失效
    totalsSeq++
    items.value = []
    revision.value++
    todayTotal.value = 0
    monthTotal.value = 0
    yearTotal.value = 0
    filter.value = {
      range: 'today',
      categoryIds: [],
      memberIds: [],
      minAmount: undefined,
      maxAmount: undefined
    }
  }

  return {
    items,
    revision,
    loading,
    filter,
    filteredExpenses,
    totalAmount,
    todayTotal,
    monthTotal,
    yearTotal,
    // v1.1 成员统计
    aggregateByCreator,
    aggregateByPayer,
    aggregateByMember,
    aggregateByAccount,
    load,
    add,
    addShared,
    update,
    remove,
    reset
  }
})
