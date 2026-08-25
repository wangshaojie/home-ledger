import type { SupportedStorage } from '@supabase/supabase-js'

/**
 * 30 天免登录 localStorage 适配器
 *
 * 原理：
 * - supabase 默认 `persistSession: true`，session 写到 `sb-<ref>-auth-token` key
 * - 默认有效期由 JWT(1h) + refresh_token(30d) 决定；refresh_token 30 天
 * - 我们加一个全局 `homeledger_session_expires_at` 标记：
 *   - 标记 > 0：30 天免登录开启，session 有效
 *   - 标记 <= 0 或不存在：要求重新登录
 * - 每次读取 session 时检查这个标记，过期就当未登录
 * - 关闭"30 天免登录"时清掉这个标记
 *
 * 用户主动点"清除本地数据"或卸载应用时，supabase auth signOut + removeItem
 * 会自然把这个标记一并清掉（因为 homeledger_ 前缀统一被 wipeAllLocalData 处理）
 */
const REMEMBER_DAYS = 30
const EXPIRY_KEY = 'homeledger_session_expires_at'

function getExpiresAt(): number {
  try {
    const v = localStorage.getItem(EXPIRY_KEY)
    return v ? Number(v) : 0
  } catch {
    return 0
  }
}

function setExpiresAt(): void {
  try {
    const exp = Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000
    localStorage.setItem(EXPIRY_KEY, String(exp))
  } catch {}
}

function clearExpiresAt(): void {
  try {
    localStorage.removeItem(EXPIRY_KEY)
  } catch {}
}

export function isRememberExpired(): boolean {
  const exp = getExpiresAt()
  if (!exp) return true
  return Date.now() > exp
}

export function enableRemember30Days(): void {
  setExpiresAt()
}

export function disableRemember(): void {
  clearExpiresAt()
}

export const supabaseStorage: SupportedStorage = {
  getItem(key: string): string | null {
    if (isRememberExpired()) {
      // 30 天到期：session 视为失效
      return null
    }
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {}
  },
  removeItem(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {}
  }
}
