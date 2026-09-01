import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { errText } from '@/lib/notify'
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
  range: 'all' | 'today' | 'yesterday' | 'week' | 'month' | '30d'
  categoryIds: string[]
  memberIds: string[]
  minAmount?: number
  maxAmount?: number
}

export const useExpenseStore = defineStore('expense', () => {
  const items = ref<Expense[]>([])
  const loading = ref(false)
  const filter = ref<FilterState>({
    range: 'all',
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

  const todayTotal = computed(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    return items.value
      .filter((e) => new Date(e.spent_at) >= start)
      .reduce((s, e) => s + Number(e.amount), 0)
  })
  const monthTotal = computed(() => {
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0)
    return items.value
      .filter((e) => new Date(e.spent_at) >= start)
      .reduce((s, e) => s + Number(e.amount), 0)
  })
  const yearTotal = computed(() => {
    const start = new Date(); start.setMonth(0, 1); start.setHours(0, 0, 0, 0)
    return items.value
      .filter((e) => new Date(e.spent_at) >= start)
      .reduce((s, e) => s + Number(e.amount), 0)
  })

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

  async function load() {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) {
      items.value = []
      return
    }
    loading.value = true
    const { data, error } = await supabase
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
      .order('spent_at', { ascending: false })
      .limit(2000)
    loading.value = false
    if (error) {
      console.error('load expenses error', error)
      return
    }
    items.value = (data || []) as Expense[]
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
    return { ok: true, message: groupId ? '已删除整组' : '已删除' }
  }

  function reset() {
    items.value = []
    filter.value = {
      range: 'all',
      categoryIds: [],
      memberIds: [],
      minAmount: undefined,
      maxAmount: undefined
    }
  }

  return {
    items,
    loading,
    filter,
    filteredExpenses,
    totalAmount,
    todayTotal,
    monthTotal,
    yearTotal,
    // v1.1 成员统计
    aggregateByCreator,
    aggregateByMember,
    load,
    add,
    addShared,
    update,
    remove,
    reset
  }
})
