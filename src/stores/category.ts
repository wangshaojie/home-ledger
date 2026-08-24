import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { errText } from '@/lib/notify'
import { useAuthStore } from './auth'

export interface Category {
  id: string
  family_id: string
  name: string
  icon: string
  is_default: boolean
  sort_order: number
  created_at: string
}

const DEFAULT_FALLBACK: Omit<Category, 'family_id' | 'created_at'>[] = [
  { id: 'c1', name: '餐饮', icon: '🍚', is_default: true, sort_order: 10 },
  { id: 'c2', name: '商超购物', icon: '🛒', is_default: true, sort_order: 20 },
  { id: 'c3', name: '水电燃气', icon: '💡', is_default: true, sort_order: 30 },
  { id: 'c4', name: '交通出行', icon: '🚗', is_default: true, sort_order: 40 },
  { id: 'c5', name: '居家日用', icon: '🏠', is_default: true, sort_order: 50 },
  { id: 'c6', name: '医疗健康', icon: '💊', is_default: true, sort_order: 60 },
  { id: 'c7', name: '服饰美妆', icon: '👕', is_default: true, sort_order: 70 },
  { id: 'c8', name: '休闲娱乐', icon: '🎮', is_default: true, sort_order: 80 },
  { id: 'c9', name: '人情往来', icon: '🎁', is_default: true, sort_order: 90 },
  { id: 'c10', name: '其他', icon: '📦', is_default: true, sort_order: 100 }
]

export const useCategoryStore = defineStore('category', () => {
  const items = ref<Category[]>([])
  const loading = ref(false)

  async function load() {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) {
      items.value = []
      return
    }
    if (!isSupabaseConfigured || !supabase) {
      // 原型模式
      items.value = DEFAULT_FALLBACK.map((c) => ({
        ...c,
        family_id: fid,
        created_at: new Date().toISOString()
      }))
      return
    }
    loading.value = true
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('family_id', fid)
      .order('sort_order', { ascending: true })
    loading.value = false
    if (error) {
      console.error('load categories error', error)
      return
    }
    items.value = (data || []) as Category[]
  }

  async function add(name: string, icon: string) {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) return { ok: false, message: '未加入家庭' }
    if (!supabase) {
      // 原型
      const newC: Category = {
        id: 'c' + Date.now(),
        family_id: fid,
        name,
        icon,
        is_default: false,
        sort_order: items.value.length * 10 + 10,
        created_at: new Date().toISOString()
      }
      items.value.push(newC)
      return { ok: true, message: '已添加（原型）' }
    }
    const { data, error } = await supabase
      .from('categories')
      .insert({ family_id: fid, name, icon, is_default: false })
      .select()
      .single()
    if (error) return { ok: false, message: errText(error, '添加失败') }
    items.value.push(data as Category)
    return { ok: true, message: '已添加' }
  }

  async function remove(id: string) {
    if (!supabase) {
      items.value = items.value.filter((c) => c.id !== id)
      return { ok: true, message: '已删除（原型）' }
    }
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) return { ok: false, message: errText(error, '删除失败') }
    items.value = items.value.filter((c) => c.id !== id)
    return { ok: true, message: '已删除' }
  }

  function reset() {
    items.value = []
  }

  return { items, loading, load, add, remove, reset }
})
