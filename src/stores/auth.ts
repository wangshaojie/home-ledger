import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { errText } from '@/lib/notify'
import { enableRemember30Days, disableRemember } from '@/lib/supabaseStorage'

/**
 * v2026-08-25 登录体系重构
 *
 * 目标：密码为主，邮箱只用于验证（注册/改密/忘密）。
 *
 * 方法分层（auth.ts 内部）：
 *   - 登录态：signInWithPassword（主），verifyOtp（注册/登录验证后自动登录用）
 *   - 注册 / 验证：signUp、resendVerification、markEmailVerified
 *   - 改密：startPasswordReset / verifyPasswordResetCode / completePasswordReset（沿用）
 *   - 会话：logout / wipeAllLocalData（沿用）
 */
interface Profile {
  id: string
  email: string
  family_id: string | null
  display_name: string | null
  joined_at: string
  email_verified?: boolean // v2026-08-25 新加：是否完成邮箱验证
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
   * v2026-08-25 新加：邮箱+密码注册
   *
   * 流程：
   *   1. 调用 supabase.auth.signUp，Supabase 会发验证邮件
   *   2. signUp 不会自动登录（因为没 verified），返回的 session 是 null
   *   3. 引导用户去 /verify-email 输入 OTP（这一步通过 resendVerification 拿到）
   *   4. verifyOtp 验证后自动登录
   *
   * 注意：必须先在 Supabase Auth 后台关掉"Auto Confirm Email"才会真发验证邮件。
   */
  async function signUp(email: string, password: string) {
    if (!isSupabaseConfigured || !supabase) {
      // 原型模式：直接进 onboarding，假装已经验证过
      const fid = 'fam_' + Math.random().toString(36).slice(2, 10)
      profile.value = {
        id: 'legacy_' + email,
        email,
        family_id: null,
        display_name: email.split('@')[0],
        joined_at: new Date().toISOString(),
        email_verified: true
      }
      return { ok: true, message: '注册成功（原型）' }
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // 用户点邮件链接时的回调路径。verifyEmailView 会处理
        emailRedirectTo: typeof window !== 'undefined' ? window.location.origin + '/#/verify-email?type=signup' : undefined
      }
    })
    if (error) return { ok: false, message: errText(error, '注册失败') }
    // signUp 成功，但 session 可能为 null（要邮箱验证后才有 session）
    if (data.session) {
      session.value = data.session
      user.value = data.user
    }
    return { ok: true, message: '验证邮件已发送到 ' + email + '，请查收（10 分钟内有效）' }
  }

  /**
   * v2026-08-25 新加：重新发送验证邮件
   * 复用 signInWithOtp（shouldCreateUser=false，已存在的账号也能发）
   */
  async function resendVerification(email: string) {
    if (!isSupabaseConfigured || !supabase) {
      return { ok: true, message: '原型模式：不需要验证' }
    }
    // signInWithOtp 不会创建新账号，对已存在账号同样能发验证邮件
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }
    })
    if (error) return { ok: false, message: errText(error, '发送失败') }
    return { ok: true, message: '验证邮件已重新发送' }
  }

  /**
   * v2026-08-25 新加：标记邮箱已验证
   * 验证 OTP 成功后调用，更新 profiles.email_verified
   */
  async function markEmailVerified(): Promise<{ ok: boolean; message?: string }> {
    if (!supabase || !user.value) return { ok: true }
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
    enableRemember30Days()
    // v2026-08-25 验证 OTP 成功 = 邮箱已验证
    await markEmailVerified()
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
    if (error) {
      // v2026-08-25 错误码细分：邮箱未验证 vs 密码错 vs 用户不存在
      const code = (error as any).code || ''
      const status = (error as any).status
      if (code === 'email_not_confirmed' || status === 422) {
        return { ok: false, message: '请先完成邮箱验证后再登录', code: 'email_not_verified' as const, email }
      }
      if (code === 'invalid_credentials' || status === 400) {
        // 不区分用户不存在 / 密码错，防枚举
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
    if (!supabase) return { ok: false, message: '原型阶段不支持' }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { ok: false, message: errText(error, '设置密码失败') }
    return { ok: true, message: '密码已更新' }
  }

  /**
   * 桌面端 OTP 改密码流程（不走 Supabase reauth，v3.x 有 bug）
   * v2026-08-25 重构：OTP 永不出主进程（之前前端拿 code 有风险）
   *
   * 1. 渲染进程把当前 session access_token 通过 IPC 传给主进程
   * 2. 主进程用 token 调 Supabase RPC 拿 6 位 OTP（auth.uid() 由 token 决定，前端无法伪造）
   * 3. 主进程拼 HTML + 调 Resend API 发邮件
   * 4. 用户在桌面端输入 OTP → 调 RPC verify_password_reset_code 拿 verify_token
   * 5. 用户输入新密码 → 调 RPC complete_password_reset 改密码 + revoke 所有 session
   * 6. 重新登录
   */
  async function startPasswordReset(): Promise<{ ok: boolean; message: string }> {
    if (!supabase) return { ok: false, message: '原型阶段不支持' }
    if (!user.value?.email) return { ok: false, message: '未登录' }
    if (!window.electronAPI?.requestPasswordResetOtp) {
      return { ok: false, message: '当前环境不支持发送邮件（非 Electron）' }
    }

    // 拿当前 session 的 access_token 给主进程用（access_token 设计上对前端可见，安全）
    const { data: sessData } = await supabase.auth.getSession()
    const accessToken = sessData.session?.access_token
    if (!accessToken) {
      return { ok: false, message: '会话已失效，请重新登录' }
    }

    // 拿 supabase url + anon key 传给主进程（这些本来就是公开的）
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '') as string
    const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '') as string

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
    if (!supabase) return { ok: false, message: '原型阶段不支持' }
    if (!user.value?.email) return { ok: false, message: '未登录' }
    const { data, error } = await supabase.rpc('verify_password_reset_code', {
      p_email: user.value.email,
      p_code: code
    })
    if (error) return { ok: false, message: errText(error, '验证码错误或已过期') }
    return { ok: true, message: '验证码正确', verifyToken: data as string }
  }

  async function completePasswordReset(verifyToken: string, newPassword: string): Promise<{ ok: boolean; message: string }> {
    if (!supabase) return { ok: false, message: '原型阶段不支持' }
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
      // 1. 退出 supabase 会话（会清 sb-<ref>-auth-token）
      if (supabase) {
        try {
          await supabase.auth.signOut()
        } catch {}
      }
      // 2. 清所有 homeledger_ 前缀的 localStorage（profile cache / 30天标记 / 最近分类 / 旧 auth_legacy）
      const keysToDelete: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('homeledger_')) keysToDelete.push(k)
      }
      for (const k of keysToDelete) {
        try { localStorage.removeItem(k) } catch {}
      }
      // 3. 兜底：清 supabase 自己的 key（sb- 前缀）— signOut 没清干净时
      const sbKeys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('sb-')) sbKeys.push(k)
      }
      for (const k of sbKeys) {
        try { localStorage.removeItem(k) } catch {}
      }
      // 4. 清业务 store 内存（family/category/account/expense/ui 全部 reset）
      try {
        const { resetBusinessState } = await import('@/lib/resetBusinessState')
        resetBusinessState()
      } catch {}
      // 5. 清 auth store 自身
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
    // 注册 / 验证（v2026-08-25 新加）
    signUp,
    resendVerification,
    markEmailVerified,
    // 登录
    verifyOtp,
    signInWithPassword,
    // 改密
    setPassword,
    startPasswordReset,
    verifyPasswordResetCode,
    completePasswordReset,
    // 账号 / 家庭
    updateDisplayName,
    createFamily,
    joinFamilyByInvite,
    renameFamily,
    logout,
    wipeAllLocalData
  }
})
