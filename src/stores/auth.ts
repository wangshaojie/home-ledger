import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { errText } from '@/lib/notify'
import { enableRemember30Days, disableRemember } from '@/lib/supabaseStorage'

/**
 * v1.1 登录体系
 *
 * 目标：密码为主，邮箱只用于验证（注册/改密/忘密）。
 *
 * 方法分层（auth.ts 内部）：
 *   - 登录态：signInWithPassword（主），verifyOtp（注册/登录验证后自动登录用）
 *   - 注册 / 验证：signUp、resendVerification、markEmailVerified
 *   - 改密：startPasswordReset / verifyPasswordResetCode / completePasswordReset
 *   - 会话：logout / wipeAllLocalData
 */
interface Profile {
  id: string
  email: string
  family_id: string | null
  display_name: string | null
  joined_at: string
  email_verified?: boolean
}

const PROFILE_CACHE_KEY = 'homeledger_profile_cache'

export const useAuthStore = defineStore('auth', () => {
  const initialized = ref(false)
  const session = ref<Session | null>(null)
  const user = ref<User | null>(null)
  const profile = ref<Profile | null>(loadCachedProfile())

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
    if (!user.value) return
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

  /**
   * 显式确保 profile 拉取（verifyOtp/signInWithPassword 之后用，路由跳转前 await 一次）
   * 解决 onAuthStateChange 异步回调与 LoginView 同步读 hasFamily 之间的竞态
   */
  async function ensureProfile(): Promise<Profile | null> {
    if (profile.value?.family_id) return profile.value
    await refreshProfile()
    return profile.value
  }

  /**
   * 邮箱+密码注册
   *
   * 流程：
   *   1. 调用 supabase.auth.signUp，Supabase 会发验证邮件
   *   2. signUp 不会自动登录（因为没 verified），返回的 session 是 null
   *   3. 引导用户去 /verify-email 输入 OTP
   *   4. verifyOtp 验证后自动登录
   *
   * 注意：必须先在 Supabase Auth 后台关掉"Auto Confirm Email"才会真发验证邮件。
   */
  async function signUp(email: string, password: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // 用户点邮件链接时的回调路径。verifyEmailView 会处理
        emailRedirectTo: typeof window !== 'undefined' ? window.location.origin + '/#/verify-email?type=signup' : undefined
      }
    })
    if (error) return { ok: false, message: errText(error, '注册失败') }
    if (data.session) {
      session.value = data.session
      user.value = data.user
    }
    return { ok: true, message: '验证邮件已发送到 ' + email + '，请查收（10 分钟内有效）' }
  }

  /**
   * 重新发送验证邮件
   * 复用 signInWithOtp（shouldCreateUser=false，已存在的账号也能发）
   */
  async function resendVerification(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }
    })
    if (error) return { ok: false, message: errText(error, '发送失败') }
    return { ok: true, message: '验证邮件已重新发送' }
  }

  /**
   * 标记邮箱已验证
   * 验证 OTP 成功后调用，更新 profiles.email_verified
   */
  async function markEmailVerified(): Promise<{ ok: boolean; message?: string }> {
    if (!user.value) return { ok: true }
    const { error } = await supabase
      .from('profiles')
      .update({ email_verified: true })
      .eq('id', user.value.id)
    if (error) {
      console.error('markEmailVerified error', error)
      return { ok: false, message: errText(error, '更新验证状态失败') }
    }
    if (profile.value) {
      profile.value.email_verified = true
      cacheProfile(profile.value)
    }
    return { ok: true }
  }

  async function verifyOtp(email: string, token: string) {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email'
    })
    if (error) return { ok: false, message: errText(error, '验证码无效或已过期') }
    session.value = data.session
    user.value = data.user
    await refreshProfile()
    enableRemember30Days()
    await markEmailVerified()
    return { ok: true, message: '登录成功' }
  }

  async function signInWithPassword(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      const code = (error as any).code || ''
      const status = (error as any).status
      if (code === 'email_not_confirmed' || status === 422) {
        return { ok: false, message: '请先完成邮箱验证后再登录', code: 'email_not_verified' as const, email }
      }
      if (code === 'invalid_credentials' || status === 400) {
        return { ok: false, message: '邮箱或密码错误', code: 'invalid_credentials' as const }
      }
      return { ok: false, message: errText(error, '登录失败') }
    }
    session.value = data.session
    user.value = data.user
    await refreshProfile()
    enableRemember30Days()
    // 兼容老用户：登录时如果 profiles.email_verified 没设过，自动标 true
    if (profile.value && profile.value.email_verified !== true) {
      await markEmailVerified()
    }
    return { ok: true, message: '登录成功' }
  }

  async function setPassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { ok: false, message: errText(error, '设置密码失败') }
    return { ok: true, message: '密码已更新' }
  }

  /**
   * 桌面端 OTP 改密码流程（不走 Supabase reauth，v3.x 有 bug）
   * 1. 渲染进程把当前 session access_token 通过 IPC 传给主进程
   * 2. 主进程用 token 调 Supabase RPC 拿 6 位 OTP
   * 3. 主进程拼 HTML + 调 Resend API 发邮件
   * 4. 用户在桌面端输入 OTP → 调 RPC verify_password_reset_code 拿 verify_token
   * 5. 用户输入新密码 → 调 RPC complete_password_reset 改密码 + revoke 所有 session
   * 6. 重新登录
   */
  async function startPasswordReset(): Promise<{ ok: boolean; message: string }> {
    if (!user.value?.email) return { ok: false, message: '未登录' }
    if (!window.electronAPI?.requestPasswordResetOtp) {
      return { ok: false, message: '当前环境不支持发送邮件（非 Electron）' }
    }

    const { data: sessData } = await supabase.auth.getSession()
    const accessToken = sessData.session?.access_token
    if (!accessToken) {
      return { ok: false, message: '会话已失效，请重新登录' }
    }

    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '') as string
    const supabaseAnonKey = (
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env.VITE_SUPABASE_ANON_KEY ||
      ''
    ) as string

    const result = await window.electronAPI.requestPasswordResetOtp({
      accessToken,
      supabaseUrl,
      supabaseAnonKey,
      email: user.value.email
    })
    if (!result.ok) {
      return { ok: false, message: '邮件发送失败：' + (result.message || '未知错误') }
    }
    return { ok: true, message: '验证码已发到邮箱' }
  }

  async function verifyPasswordResetCode(code: string): Promise<{ ok: boolean; message: string; verifyToken?: string }> {
    if (!user.value?.email) return { ok: false, message: '未登录' }
    const { data, error } = await supabase.rpc('verify_password_reset_code', {
      p_email: user.value.email,
      p_code: code
    })
    if (error) return { ok: false, message: errText(error, '验证码错误或已过期') }
    return { ok: true, message: '验证码正确', verifyToken: data as string }
  }

  async function completePasswordReset(verifyToken: string, newPassword: string): Promise<{ ok: boolean; message: string }> {
    const { data, error } = await supabase.rpc('complete_password_reset', {
      p_verify_token: verifyToken,
      p_new_password: newPassword
    })
    if (error) return { ok: false, message: errText(error, '改密码失败') }
    return { ok: true, message: data as string }
  }

  async function updateDisplayName(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return { ok: false, message: '显示名不能为空' }
    if (trimmed.length > 20) return { ok: false, message: '显示名不超过 20 字' }
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', user.value?.id || '')
    if (profileErr) return { ok: false, message: errText(profileErr, '更新失败') }
    await supabase.auth.updateUser({ data: { display_name: trimmed } })
    if (profile.value) {
      profile.value.display_name = trimmed
      cacheProfile(profile.value)
    }
    try {
      const { useFamilyStore } = await import('./family')
      await useFamilyStore().load()
    } catch {}
    return { ok: true, message: '已更新' }
  }

  async function createFamily(name: string) {
    const { data, error } = await supabase.rpc('create_family_with_defaults', {
      p_name: name
    })
    if (error) return { ok: false, message: errText(error, '创建家庭失败') }
    await refreshProfile()
    return { ok: true, message: '家庭创建成功', familyId: data as string }
  }

  async function joinFamilyByInvite(inviteCode: string) {
    const { error } = await supabase.rpc('join_family_by_invite', { p_invite: inviteCode })
    if (error) return { ok: false, message: errText(error, '加入失败') }
    await refreshProfile()
    return { ok: true, message: '加入成功' }
  }

  async function renameFamily(newName: string) {
    if (!profile.value?.family_id) return { ok: false, message: '未加入家庭' }
    const { error } = await supabase
      .from('families')
      .update({ name: newName })
      .eq('id', profile.value.family_id)
    if (error) return { ok: false, message: errText(error, '改名失败') }
    return { ok: true, message: '已更新' }
  }

  async function logout() {
    await supabase.auth.signOut()
    disableRemember()
    session.value = null
    user.value = null
    cacheProfile(null)
  }

  /**
   * 彻底清除本地所有数据（设置里"清除本地数据"按钮调用）
   * 包含：supabase session、30天免登录标记、profile 缓存、最近分类、业务 stores 内存
   * 不动：云端数据（账本/家庭/分类都在 Supabase）
   */
  async function wipeAllLocalData(): Promise<{ ok: boolean; message: string }> {
    try {
      try {
        await supabase.auth.signOut()
      } catch {}
      const keysToDelete: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('homeledger_')) keysToDelete.push(k)
      }
      for (const k of keysToDelete) {
        try { localStorage.removeItem(k) } catch {}
      }
      const sbKeys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('sb-')) sbKeys.push(k)
      }
      for (const k of sbKeys) {
        try { localStorage.removeItem(k) } catch {}
      }
      try {
        const { resetBusinessState } = await import('@/lib/resetBusinessState')
        resetBusinessState()
      } catch {}
      session.value = null
      user.value = null
      profile.value = null
      return { ok: true, message: '本地数据已清除' }
    } catch (e: any) {
      return { ok: false, message: '清除失败：' + (e?.message || '未知错误') }
    }
  }

  return {
    initialized,
    session,
    user,
    profile,
    isAuthenticated,
    hasFamily,
    init,
    refreshProfile,
    ensureProfile,
    signUp,
    resendVerification,
    markEmailVerified,
    verifyOtp,
    signInWithPassword,
    setPassword,
    startPasswordReset,
    verifyPasswordResetCode,
    completePasswordReset,
    updateDisplayName,
    createFamily,
    joinFamilyByInvite,
    renameFamily,
    logout,
    wipeAllLocalData
  }
})
