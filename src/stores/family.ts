import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { errText } from '@/lib/notify'
import { useAuthStore } from './auth'

export interface FamilyMember {
  id: string
  email: string
  display_name: string | null
  joined_at: string
}

export interface Family {
  id: string
  name: string
  created_by: string
  created_at: string
  invite_code: string
}

export const useFamilyStore = defineStore('family', () => {
  const family = ref<Family | null>(null)
  const members = ref<FamilyMember[]>([])
  const loading = ref(false)

  const inviteCode = computed(() => family.value?.invite_code || '')

  async function load() {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) {
      family.value = null
      members.value = []
      return
    }
    if (!isSupabaseConfigured || !supabase) {
      // 原型模式：构造假数据
      family.value = {
        id: fid,
        name: '温馨之家（原型）',
        created_by: 'm1',
        created_at: new Date().toISOString(),
        invite_code: 'DEMO12'
      }
      members.value = [
        { id: 'm1', email: auth.profile?.email || 'me@home.local', display_name: '我', joined_at: new Date().toISOString() },
        { id: 'm2', email: 'spouse@home.local', display_name: '家人A', joined_at: new Date().toISOString() },
        { id: 'm3', email: 'kid@home.local', display_name: '家人B', joined_at: new Date().toISOString() }
      ]
      return
    }
    loading.value = true
    const [{ data: fam, error: e1 }, { data: profs, error: e2 }] = await Promise.all([
      supabase.from('families').select('*').eq('id', fid).single(),
      supabase
        .from('profiles')
        .select('id, email, display_name, joined_at')
        .eq('family_id', fid)
        .order('joined_at', { ascending: true })
    ])
    loading.value = false
    if (e1) {
      console.error('load family error', e1)
      return
    }
    family.value = fam as Family
    if (!e2) members.value = (profs || []) as FamilyMember[]
  }

  function reset() {
    family.value = null
    members.value = []
  }

  return { family, members, inviteCode, loading, load, reset }
})
