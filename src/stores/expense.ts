import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { errText } from '@/lib/notify'
import { useAuthStore } from './auth'

export interface Expense {
  id: string
  family_id: string
  creator_id: string
  member_id: string
  category_id: string
  account_id: string | null
  amount: number
  spent_at: string
  note: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  // 关联表 join 出来的可选字段
  member?: { id: string; email: string; display_name: string | null } | null
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

// 原型模式假数据
function buildMockExpenses(familyId: string): Expense[] {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const list: Expense[] = []
  const titles = [
    '超市买菜','滴滴打车','午餐外卖','水电费','电影票','咖啡',
    '买菜水果','公交卡充值','牙膏纸巾','感冒药','理发','生日礼物',
    '健身房月卡','衣服','聚餐','奶茶','快递费','话费充值','宠物粮','牙膏'
  ]
  for (let i = 0; i < titles.length; i++) {
    const d = new Date(now - i * 0.6 * day - Math.random() * day)
    list.push({
      id: 'e' + (i + 1),
      family_id: familyId,
      creator_id: 'm1',
      member_id: ['m1','m2','m3'][i % 3],
      category_id: 'c' + ((i % 10) + 1),
      account_id: 'a' + ((i % 5) + 1),
      amount: Math.round((Math.random() * 200 + 8) * 100) / 100,
      spent_at: d.toISOString(),
      note: titles[i],
      created_at: d.toISOString(),
      updated_at: d.toISOString(),
      deleted_at: null
    })
  }
  return list
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
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    return items.value
      .filter((e) => {
        const d = new Date(e.spent_at)
        if (filter.value.range === 'today' && d < startOfDay) return false
        if (filter.value.range === 'yesterday' && (d < yesterday || d >= startOfDay)) return false
        if (filter.value.range === 'week' && d < weekAgo) return false
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

  async function load() {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) {
      items.value = []
      return
    }
    if (!isSupabaseConfigured || !supabase) {
      items.value = buildMockExpenses(fid)
      return
    }
    loading.value = true
    const { data, error } = await supabase
      .from('expenses')
      .select(`
        *,
        member:member_id ( id, email, display_name ),
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
    spentAt: string
    note: string
  }) {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    const uid = auth.user?.id || auth.profile?.id
    if (!fid || !uid) return { ok: false, message: '未登录' }
    if (!supabase) {
      // 原型
      const newE: Expense = {
        id: 'e' + Date.now(),
        family_id: fid,
        creator_id: uid,
        member_id: payload.memberId,
        category_id: payload.categoryId,
        account_id: payload.accountId,
        amount: payload.amount,
        spent_at: payload.spentAt,
        note: payload.note,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null
      }
      items.value.unshift(newE)
      return { ok: true, message: '记账成功（原型）' }
    }
    const { data, error } = await supabase
      .from('expenses')
      .insert({
        family_id: fid,
        creator_id: uid,
        member_id: payload.memberId,
        category_id: payload.categoryId,
        account_id: payload.accountId,
        amount: payload.amount,
        spent_at: payload.spentAt,
        note: payload.note
      })
      .select(`
        *,
        member:member_id ( id, email, display_name ),
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
    spentAt: string
    note: string
  }>) {
    if (!supabase) {
      const i = items.value.findIndex((e) => e.id === id)
      if (i >= 0) {
        const e = items.value[i]
        items.value[i] = {
          ...e,
          amount: patch.amount ?? e.amount,
          category_id: patch.categoryId ?? e.category_id,
          account_id: patch.accountId ?? e.account_id,
          member_id: patch.memberId ?? e.member_id,
          spent_at: patch.spentAt ?? e.spent_at,
          note: patch.note ?? e.note,
          updated_at: new Date().toISOString()
        }
      }
      return { ok: true, message: '已更新（原型）' }
    }
    const updateObj: any = {}
    if (patch.amount !== undefined) updateObj.amount = patch.amount
    if (patch.categoryId !== undefined) updateObj.category_id = patch.categoryId
    if (patch.accountId !== undefined) updateObj.account_id = patch.accountId
    if (patch.memberId !== undefined) updateObj.member_id = patch.memberId
    if (patch.spentAt !== undefined) updateObj.spent_at = patch.spentAt
    if (patch.note !== undefined) updateObj.note = patch.note
    const { error } = await supabase.from('expenses').update(updateObj).eq('id', id)
    if (error) return { ok: false, message: errText(error, '更新失败') }
    // 本地也更新
    await load()
    return { ok: true, message: '已更新' }
  }

  async function remove(id: string) {
    if (!supabase) {
      items.value = items.value.filter((e) => e.id !== id)
      return { ok: true, message: '已删除（原型）' }
    }
    // 软删：更新 deleted_at
    const { error } = await supabase
      .from('expenses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return { ok: false, message: errText(error, '删除失败') }
    items.value = items.value.filter((e) => e.id !== id)
    return { ok: true, message: '已删除' }
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
    load,
    add,
    update,
    remove,
    reset
  }
})
