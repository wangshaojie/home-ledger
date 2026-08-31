/**
 * 30 天免登录 · 标记工具
 *
 * 背景：
 * - v1.1.0 之前用自定义 `supabaseStorage` 适配器在 `getItem` 里拦截 session 读，
 *   但这破坏了 supabase-js v2.45+ 的 autoRefreshToken 链，导致 access_token
 *   1 小时过期后冷启动 → 整条 refresh 链断 → 登录态掉。
 * - v1.1.9 改为：supabase 用默认 localStorage 行为（让它自己 refresh_token 续期），
 *   30 天免登录的"开关"完全在 `auth.init()` 入口手动判断，标记过期就 signOut。
 *
 * 这里只保留 3 个工具函数：
 *   - isRememberExpired()    检查标记是否过期
 *   - enableRemember30Days()  登录成功后写标记（30 天后过期）
 *   - disableRemember()       主动关闭免登录 / 登出时清标记
 *
 * 标记 key：homeledger_session_expires_at（毫秒时间戳）
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
