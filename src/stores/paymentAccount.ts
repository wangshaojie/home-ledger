import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { errText } from '@/lib/notify'
import { useAuthStore } from './auth'

export interface PaymentAccount {
  id: string
  family_id: string
  name: string
  icon: string
  is_default: boolean
  sort_order: number
  created_at: string
}

export const usePaymentAccountStore = defineStore('paymentAccount', () => {
  const items = ref<PaymentAccount[]>([])
  const loading = ref(false)

  async function load() {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) {
      items.value = []
      return
    }
    loading.value = true
    const { data, error } = await supabase
      .from('payment_accounts')
      .select('*')
      .eq('family_id', fid)
      .order('sort_order', { ascending: true })
    loading.value = false
    if (error) {
      console.error('load payment_accounts error', error)
      return
    }
    items.value = (data || []) as PaymentAccount[]
  }

  async function add(name: string, icon: string) {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) return { ok: false, message: '未加入家庭' }
    // 排到现有账户之后，避免新账户因 sort_order=0 跑到最前面
    const maxSort = items.value.reduce((m, a) => Math.max(m, a.sort_order), 0)
    const { data, error } = await supabase
      .from('payment_accounts')
      .insert({ family_id: fid, name, icon, is_default: false, sort_order: maxSort + 1 })
      .select()
      .single()
    if (error) return { ok: false, message: errText(error, '添加失败') }
    items.value.push(data as PaymentAccount)
    return { ok: true, message: '已添加' }
  }

  async function update(id: string, name: string, icon: string) {
    const { error } = await supabase
      .from('payment_accounts')
      .update({ name, icon })
      .eq('id', id)
    if (error) return { ok: false, message: errText(error, '更新失败') }
    const i = items.value.findIndex((a) => a.id === id)
    if (i >= 0) items.value[i] = { ...items.value[i], name, icon }
    return { ok: true, message: '已更新' }
  }

  async function remove(id: string) {
    const { error } = await supabase.from('payment_accounts').delete().eq('id', id)
    if (error) return { ok: false, message: errText(error, '删除失败') }
    items.value = items.value.filter((a) => a.id !== id)
    return { ok: true, message: '已删除' }
  }

  function reset() {
    items.value = []
  }

  /**
   * v2026-09-01 拖拽排序：只重排自定义账户（系统账户固定在最前且不可改），
   * 按新的相对顺序从 100 起重新编号 sort_order 并批量写回数据库
   */
  /**
   * v2026-09-01 拖拽排序（含系统默认账户）：
   * 按新顺序从 10 起每 10 一档重新编号 sort_order。
   * 逐条 update 仅改 sort_order 列——不能 upsert，否则系统账户会走 INSERT 路径
   * 被 insert 策略（is_default = false）拒绝
   */
  async function reorder(ids: string[]) {
    const orderMap = new Map<string, number>(ids.map((id, i) => [id, 10 + i * 10]))
    items.value = items.value
      .slice()
      .sort((a, b) => (orderMap.get(a.id) ?? a.sort_order) - (orderMap.get(b.id) ?? b.sort_order))
      .map((a) => ({ ...a, sort_order: orderMap.get(a.id) ?? a.sort_order }))
    const results = await Promise.all(
      items.value.map(
        async (a) =>
          (await supabase.from('payment_accounts').update({ sort_order: a.sort_order }).eq('id', a.id))
            .error
      )
    )
    const err = results.find(Boolean)
    if (err) return { ok: false, message: errText(err, '排序保存失败') }
    return { ok: true, message: '排序已保存' }
  }

  return { items, loading, load, add, update, remove, reorder, reset }
})
