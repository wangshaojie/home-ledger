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
    const { data, error } = await supabase
      .from('payment_accounts')
      .insert({ family_id: fid, name, icon, is_default: false })
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

  return { items, loading, load, add, update, remove, reset }
})
