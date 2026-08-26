# DevTools 诊断：确认 supabase session 状态

打开 HomeLedger（dev 模式）→ F12 → Console → 粘贴下面整段回车：

```javascript
;(async () => {
  const m = await import('/src/lib/supabase.ts')
  const sb = m.supabase
  const { data: sessData } = await sb.auth.getSession()
  const { data: userData } = await sb.auth.getUser()
  console.log('=== SESSION ===')
  console.log(JSON.stringify({
    hasSession: !!sessData.session,
    userId: sessData.session?.user?.id,
    email: sessData.session?.user?.email,
    role: sessData.session?.user?.role,
    expiresAt: sessData.session?.expires_at,
    expiresIn: sessData.session?.expires_at ? Math.round((sessData.session.expires_at * 1000 - Date.now()) / 1000 / 60) + 'min' : null,
    accessTokenPrefix: sessData.session?.access_token?.slice(0, 50),
  }, null, 2))
  console.log('=== USER ===')
  console.log(JSON.stringify({
    hasUser: !!userData.user,
    userId: userData.user?.id,
    role: userData.user?.role,
  }, null, 2))
  console.log('=== LOCALSTORAGE ===')
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    const v = localStorage.getItem(k)
    console.log(k, '→', v ? v.slice(0, 60) + (v.length > 60 ? '...' : '') : '(empty)')
  }
  return 'done'
})()
```

把 console 里 `=== SESSION ===`、`=== USER ===`、`=== LOCALSTORAGE ===` 下面所有内容贴给我。

**期望看到**：

- `hasSession: true`
- `userId`: 某个非空 uuid（你的 user id）
- `role: "authenticated"`
- `expiresIn`: 正数（分钟数）
- `accessTokenPrefix`: 以 `eyJ` 开头
- localStorage 里有 `sb-xxx-auth-token`（有几百字符）和 `homeledger_session_expires_at`（一个时间戳）
- localStorage 里有 `homeledger_profile_cache`（你的 profile JSON）

**如果 hasSession: false 或 userId: null**：
- session 没加载到，supabase client 全是 anon → RLS 必然过不去
- 重新登录一次

**如果 hasSession: true 但 PATCH 还是 42501**：
- 那是 RLS 还有别的问题
- 进一步看 Network 那条 PATCH 的 Request Headers 里 Authorization 完整值（不止前 50 字符），看是不是 user-jwt
