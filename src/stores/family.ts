import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import type { DbFamilyMember } from '@/types/db'

export type FamilyMember = DbFamilyMember

export interface Family {
  id: string
  name: string
  created_by: string
  created_at: string
  invite_code: string
}

/**
 * v1.1 family store 重构
 *
 * `members` 之前是 `profiles WHERE family_id = X`（只能拿到有 Supabase auth user 的成人）
 * 现在是 `family_members WHERE family_id = X`（含 adult/child/pet 三类）
 */
export const useFamilyStore = defineStore('family', () => {
  const family = ref<Family | null>(null)
  const members = ref<FamilyMember[]>([])
  const loading = ref(false)

  const inviteCode = computed(() => family.value?.invite_code || '')

  /**
   * 加载家庭信息 + 成员列表
   * family 来自 families 表；members 来自 family_members 表
   */
  async function load() {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) {
      family.value = null
      members.value = []
      return
    }
    loading.value = true
    const [{ data: fam, error: e1 }, { data: mems, error: e2 }] = await Promise.all([
      supabase.from('families').select('*').eq('id', fid).single(),
      supabase
        .from('family_members')
        .select('*')
        .eq('family_id', fid)
        .order('type', { ascending: true })  // adult 在前
        .order('created_at', { ascending: true })
    ])
    loading.value = false
    if (e1) {
      console.error('load family error', e1)
      // 不要直接 return —— 成员列表也要填
    } else {
      family.value = fam as Family
    }
    if (!e2) members.value = (mems || []) as FamilyMember[]
  }

  /**
   * 添加 child / pet 成员
   * 注意：adult 成员不能在这里加，adult 必须通过邀请码注册流程（v2026-08-25 trigger 自动建）
   */
  async function addMember(name: string, type: 'child' | 'pet'): Promise<{ ok: boolean; message?: string }> {
    const auth = useAuthStore()
    const fid = auth.profile?.family_id
    if (!fid) return { ok: false, message: '未加入家庭' }
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, message: '请输入名字' }
    if (trimmed.length > 20) return { ok: false, message: '名字不超过 20 字' }
    const { data, error } = await supabase
      .from('family_members')
      .insert({ family_id: fid, name: trimmed, type, linked_profile_id: null })
      .select()
      .single()
    if (error) {
      if (error.code === '23505') {
        return { ok: false, message: '该家庭已有同名同类型的成员' }
      }
      return { ok: false, message: error.message }
    }
    // 用不可变更新,确保触发 Vue 响应式（ref 数组的 push 在某些场景下不触发）
    members.value = [...members.value, data as FamilyMember]
    return { ok: true, message: '已添加' }
  }

  /**
   * 重命名成员
   */
  async function renameMember(id: string, newName: string): Promise<{ ok: boolean; message?: string }> {
    const trimmed = newName.trim()
    if (!trimmed) return { ok: false, message: '请输入名字' }
    if (trimmed.length > 20) return { ok: false, message: '名字不超过 20 字' }
    const { error } = await supabase
      .from('family_members')
      .update({ name: trimmed })
      .eq('id', id)
    if (error) {
      if (error.code === '23505') {
        return { ok: false, message: '该家庭已有同名同类型的成员' }
      }
      return { ok: false, message: error.message }
    }
    const i = members.value.findIndex((m) => m.id === id)
    if (i >= 0) {
      // 不可变更新,触发响应式
      members.value = members.value.map((m) => (m.id === id ? { ...m, name: trimmed } : m))
    }
    return { ok: true, message: '已更新' }
  }

  /**
   * 删除成员
   * - 有 linked_profile_id 的 adult 不能直接删（要他自己先离开家庭）
   * - 删除 child/pet 自由
   */
  async function removeMember(id: string): Promise<{ ok: boolean; message?: string }> {
    const target = members.value.find((m) => m.id === id)
    if (target?.linked_profile_id) {
      return { ok: false, message: '已关联账号的成员请自行离开家庭后删除' }
    }
    const { error } = await supabase.from('family_members').delete().eq('id', id)
    if (error) return { ok: false, message: error.message }
    members.value = members.value.filter((m) => m.id !== id)
    return { ok: true, message: '已删除' }
  }

  function reset() {
    family.value = null
    members.value = []
  }

  return { family, members, inviteCode, loading, load, addMember, renameMember, removeMember, reset }
})
