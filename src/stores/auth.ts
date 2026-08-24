import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { errText } from '@/lib/notify'

interface Profile {
  id: string
  email: string
  family_id: string | null
  display_name: string | null
  joined_at: string
}

const PROFILE_CACHE_KEY = 'homeledger_profile_cache'

export const useAuthStore = defineStore('auth', () => {
  const initialized = ref(false)
  const session = ref<Session | null>(null)
  const user = ref<User | null>(null)
  const profile = ref<Profile | null>(loadCachedProfile())
  const pendingOtpEmail = ref<string | null>(null)

  const isAuthenticated = computed(() => !!session.value && !!user.value)
  const hasFamily = computed(() => !!profile.value?.family_id)

  function loadCachedProfile(): Profile | null {
    try {
      const raw = localStorage.getItem(PROFILE_CACHE_KEY)
      return raw ? (JSON.parse(raw) as Profile) : null
    } catch {
      return null
    }
  }

  function cacheProfile(p: Profile | null) {
    profile.value = p
    if (p) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p))
    else localStorage.removeItem(PROFILE_CACHE_KEY)
  }

  async function init() {
    if (initialized.value) return
    initialized.value = true

    if (!isSupabaseConfigured || !supabase) {
      // 原型模式：保留旧 localStorage 行为（仅本机演示用）
      const raw = localStorage.getItem('homeledger_auth_legacy')
      if (raw) {
        try {
          const legacy = JSON.parse(raw)
          if (legacy?.email) {
            profile.value = {
              id: 'legacy_' + legacy.email,
              email: legacy.email,
              family_id: legacy.familyId || null,
              display_name: legacy.email.split('@')[0],
              joined_at: new Date().toISOString()
            }
          }
        } catch {}
      }
      return
    }

    const { data } = await supabase.auth.getSession()
    if (data.session) {
      session.value = data.session
      user.value = data.session.user
      await refreshProfile()
    }

    // 监听登录态变化
    supabase.auth.onAuthStateChange(async (_event, newSession) => {
      session.value = newSession
      user.value = newSession?.user || null
      if (newSession?.user) {
        await refreshProfile()
      } else {
        cacheProfile(null)
      }
    })
  }

  async function refreshProfile() {
    if (!supabase || !user.value) return
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.value.id)
      .single()
    if (error) {
      console.error('refreshProfile error', error)
      return
    }
    cacheProfile(data as Profile)
  }

  async function sendOtp(email: string) {
    if (!isSupabaseConfigured || !supabase) {
      return { ok: true, message: '原型模式：任何邮箱 + 验证码 888888 即可通过' }
    }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true
      }
    })
    if (error) return { ok: false, message: errText(error, '发送验证码失败') }
    pendingOtpEmail.value = email
    return { ok: true, message: '验证码已发送，请查收邮箱' }
  }

  async function verifyOtp(email: string, token: string) {
    if (!isSupabaseConfigured || !supabase) {
      // 原型模式
      if (token !== '888888') return { ok: false, message: '验证码错误（提示：原型用 888888）' }
      const legacy = { email, familyId: profile.value?.family_id || null, familyName: '' }
      localStorage.setItem('homeledger_auth_legacy', JSON.stringify(legacy))
      profile.value = {
        id: 'legacy_' + email,
        email,
        family_id: legacy.familyId,
        display_name: email.split('@')[0],
        joined_at: new Date().toISOString()
      }
      return { ok: true, message: '登录成功' }
    }
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email'
    })
    if (error) return { ok: false, message: errText(error, '验证码无效或已过期') }
    session.value = data.session
    user.value = data.user
    await refreshProfile()
    return { ok: true, message: '登录成功' }
  }

  async function signInWithPassword(email: string, password: string) {
    if (!isSupabaseConfigured || !supabase) {
      if (password !== '888888') return { ok: false, message: '密码错误（提示：原型用 888888）' }
      const legacy = { email, familyId: profile.value?.family_id || null, familyName: '' }
      localStorage.setItem('homeledger_auth_legacy', JSON.stringify(legacy))
      profile.value = {
        id: 'legacy_' + email,
        email,
        family_id: legacy.familyId,
        display_name: email.split('@')[0],
        joined_at: new Date().toISOString()
      }
      return { ok: true, message: '登录成功' }
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { ok: false, message: errText(error, '登录失败') }
    session.value = data.session
    user.value = data.user
    await refreshProfile()
    return { ok: true, message: '登录成功' }
  }

  async function setPassword(newPassword: string) {
    if (!supabase) return { ok: false, message: '原型阶段不支持' }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { ok: false, message: errText(error, '设置密码失败') }
    return { ok: true, message: '密码已更新' }
  }

  /**
   * 发起"重新认证"邮件（reauthentication 类型）
   * Supabase Auth 内置：会触发 mailer_templates_reauthentication_content 模板
   * 6 位 OTP 通过 Resend SMTP 发到用户邮箱
   */
  async function sendReauthOtp(): Promise<{ ok: boolean; message: string }> {
    if (!supabase) return { ok: false, message: '原型阶段不支持' }
    if (!user.value?.email) return { ok: false, message: '未登录' }
    const { error } = await supabase.auth.reauthenticate()
    if (error) return { ok: false, message: errText(error, '发送验证码失败') }
    return { ok: true, message: '验证码已发送，请查收邮箱' }
  }

  /**
   * 验证 reauthentication OTP
   * 通过后 supabase-js 内部会标记当前 session 为"已二次验证"
   * 然后才能调 updateUser({ password })
   */
  async function verifyReauthOtp(token: string): Promise<{ ok: boolean; message: string }> {
    if (!supabase) return { ok: false, message: '原型阶段不支持' }
    if (!user.value?.email) return { ok: false, message: '未登录' }
    const { error } = await supabase.auth.verifyOtp({
      email: user.value.email,
      token,
      type: 'reauthentication'
    })
    if (error) return { ok: false, message: errText(error, '验证码错误或已过期') }
    return { ok: true, message: '身份验证通过' }
  }

  async function updateDisplayName(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, message: '显示名不能为空' }
    if (trimmed.length > 20) return { ok: false, message: '显示名不超过 20 字' }
    if (!supabase) {
      // 原型模式
      if (profile.value) {
        profile.value.display_name = trimmed
        cacheProfile(profile.value)
      }
      return { ok: true, message: '已更新（原型）' }
    }
    // 同步更新 profiles.display_name
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', user.value?.id || '')
    if (profileErr) return { ok: false, message: errText(profileErr, '更新失败') }
    // 也写到 user_metadata 兜底
    await supabase.auth.updateUser({ data: { display_name: trimmed } })
    if (profile.value) {
      profile.value.display_name = trimmed
      cacheProfile(profile.value)
    }
    // 重载家庭成员列表，让"消费成员"下拉也更新
    try {
      const { useFamilyStore } = await import('./family')
      await useFamilyStore().load()
    } catch {}
    return { ok: true, message: '已更新' }
  }

  async function createFamily(name: string) {
    if (!supabase) {
      // 原型模式：纯前端
      const fid = 'fam_' + Math.random().toString(36).slice(2, 10)
      if (profile.value) {
        profile.value.family_id = fid
        cacheProfile(profile.value)
      }
      const legacy = {
        email: profile.value?.email || '',
        familyId: fid,
        familyName: name
      }
      localStorage.setItem('homeledger_auth_legacy', JSON.stringify(legacy))
      return { ok: true, message: '家庭创建成功（原型）' }
    }
    const { data, error } = await supabase.rpc('create_family_with_defaults', {
      p_name: name
    })
    if (error) return { ok: false, message: errText(error, '创建家庭失败') }
    await refreshProfile()
    return { ok: true, message: '家庭创建成功', familyId: data as string }
  }

  async function joinFamilyByInvite(inviteCode: string) {
    if (!supabase) return { ok: false, message: '原型阶段不支持邀请码加入' }
    const { error } = await supabase.rpc('join_family_by_invite', { p_invite: inviteCode })
    if (error) return { ok: false, message: errText(error, '加入失败') }
    await refreshProfile()
    return { ok: true, message: '加入成功' }
  }

  async function renameFamily(newName: string) {
    if (!supabase || !profile.value?.family_id) {
      if (profile.value) {
        // 原型
        const legacyRaw = localStorage.getItem('homeledger_auth_legacy')
        if (legacyRaw) {
          const legacy = JSON.parse(legacyRaw)
          legacy.familyName = newName
          localStorage.setItem('homeledger_auth_legacy', JSON.stringify(legacy))
        }
        return { ok: true, message: '已更新（原型）' }
      }
      return { ok: false, message: '未加入家庭' }
    }
    const { error } = await supabase
      .from('families')
      .update({ name: newName })
      .eq('id', profile.value.family_id)
    if (error) return { ok: false, message: errText(error, '改名失败') }
    return { ok: true, message: '已更新' }
  }

  async function logout() {
    if (supabase) {
      await supabase.auth.signOut()
    } else {
      localStorage.removeItem('homeledger_auth_legacy')
    }
    session.value = null
    user.value = null
    cacheProfile(null)
  }

  return {
    initialized,
    session,
    user,
    profile,
    pendingOtpEmail,
    isAuthenticated,
    hasFamily,
    init,
    refreshProfile,
    sendOtp,
    verifyOtp,
    signInWithPassword,
    setPassword,
    sendReauthOtp,
    verifyReauthOtp,
    updateDisplayName,
    createFamily,
    joinFamilyByInvite,
    renameFamily,
    logout
  }
})
