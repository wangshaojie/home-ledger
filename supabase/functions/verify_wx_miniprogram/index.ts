/**
 * verify_wx_miniprogram
 *
 * 微信小程序登录 Edge Function（Deno / Supabase Edge Runtime）
 *
 * 部署：supabase functions deploy verify_wx_miniprogram
 * 环境变量（Supabase Dashboard → Edge Functions → Secrets）：
 *   SUPABASE_URL              自动注入
 *   SUPABASE_SERVICE_ROLE_KEY 自动注入
 *   SUPABASE_ANON_KEY         自动注入
 *   WX_APPID                  微信小程序 AppID
 *   WX_SECRET                 微信小程序 AppSecret
 *   CLIENT_SHARED_SECRET      与小程序端 VITE_CLIENT_SHARED_SECRET 一致
 *
 * 签名约定（与小程序端 src/utils/wx.ts 一致）：
 *   login:            sha256(code|timestamp|SECRET)
 *   bind_existing:    sha256(code|email|timestamp|SECRET)
 *   signup_new:       sha256(code|email|timestamp|SECRET)
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const WX_APPID = Deno.env.get('WX_APPID') ?? ''
const WX_SECRET = Deno.env.get('WX_SECRET') ?? ''
const SHARED_SECRET = Deno.env.get('CLIENT_SHARED_SECRET') ?? ''

const MAX_TS_SKEW = 5 * 60 * 1000 // 时间戳容差 5 分钟

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const pub = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

type WxAction = 'login' | 'bind_existing' | 'signup_new'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 微信 jscode2session：用 wx.login 的 code 换 openid */
async function code2Session(
  code: string
): Promise<{ openid?: string; errcode?: number; errmsg?: string }> {
  const url =
    `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_APPID}` +
    `&secret=${WX_SECRET}&js_code=${code}&grant_type=authorization_code`
  const res = await fetch(url)
  return res.json()
}

/** 用 magiclink 交换 session（返回可用的 access_token / refresh_token） */
async function exchangeSession(email: string): Promise<{
  access_token: string
  refresh_token: string
  expires_in: number
  user: { id: string; email: string }
}> {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(linkErr?.message ?? 'generateLink failed')
  }
  const { data, error } = await pub.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
    email,
  })
  if (error || !data.session || !data.user) {
    throw new Error(error?.message ?? 'verifyOtp failed')
  }
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in ?? 3600,
    user: { id: data.user.id, email: data.user.email ?? email },
  }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed', code: 'method' }, 405)
  }
  if (!WX_APPID || !WX_SECRET) {
    return json({ ok: false, error: '服务端未配置 WX_APPID/WX_SECRET', code: 'config' })
  }
  if (!SHARED_SECRET) {
    return json({ ok: false, error: '服务端未配置 CLIENT_SHARED_SECRET', code: 'config' })
  }

  let body: {
    action?: string
    code?: string
    email?: string
    password?: string
    signature?: string
    timestamp?: number
  }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid json', code: 'bad_request' }, 400)
  }

  const { action, code, email, password, signature, timestamp } = body

  // 1) 防重放：时间戳容差
  if (typeof timestamp !== 'number' || Math.abs(Date.now() - timestamp) > MAX_TS_SKEW) {
    return json({ ok: false, error: '请求已过期，请重试', code: 'expired' })
  }
  // 2) 防伪造：共享 secret 签名
  const parts = action === 'login' ? [code, timestamp] : [code, email, timestamp]
  const expectSig = await sha256Hex(parts.join('|') + '|' + SHARED_SECRET)
  if (!signature || signature !== expectSig) {
    return json({ ok: false, error: '签名校验失败', code: 'bad_signature' })
  }

  try {
    // 3) 微信 code2Session
    if (!code) return json({ ok: false, error: '缺少 wx code', code: 'bad_input' })
    const wx = await code2Session(code)
    if (wx.errcode || !wx.openid) {
      return json({ ok: false, error: wx.errmsg ?? '微信登录失败', code: 'wx_failed' })
    }
    const openid = wx.openid

    // 4) 按 action 处理
    if (action === 'login') {
      const { data: bind } = await admin
        .from('wx_miniprogram_bindings')
        .select('user_id')
        .eq('app_id', WX_APPID)
        .eq('openid', openid)
        .maybeSingle()
      if (!bind) {
        return json({
          ok: false,
          error: '该微信尚未绑定账号，请先用邮箱登录或注册',
          code: 'not_bound',
        })
      }
      const { data: prof } = await admin
        .from('profiles')
        .select('email')
        .eq('id', bind.user_id)
        .maybeSingle()
      if (!prof) {
        return json({ ok: false, error: '绑定账号不存在', code: 'no_user' })
      }
      const session = await exchangeSession(prof.email)
      return json({
        ok: true,
        ...session,
        binding: { app_id: WX_APPID, openid, bound_at: new Date().toISOString(), is_new: false },
      })
    }

    if (action === 'bind_existing') {
      if (!email || !password) {
        return json({ ok: false, error: '绑定需要邮箱和密码', code: 'bad_input' })
      }
      // 必须校验邮箱密码，防止仅凭邮箱即可绑定劫持账号
      const { error: pwdErr } = await pub.auth.signInWithPassword({ email, password })
      if (pwdErr) {
        return json({ ok: false, error: '邮箱或密码错误', code: 'bad_credentials' })
      }
      const { data: prof } = await admin
        .from('profiles')
        .select('id, email')
        .eq('email', email)
        .maybeSingle()
      if (!prof) {
        return json({ ok: false, error: '该邮箱未注册，请先注册', code: 'no_account' })
      }
      const { data: existing } = await admin
        .from('wx_miniprogram_bindings')
        .select('id')
        .eq('app_id', WX_APPID)
        .eq('openid', openid)
        .maybeSingle()
      if (existing) {
        return json({ ok: false, error: '该微信已绑定过账号', code: 'already_bound' })
      }
      const { error: insErr } = await admin
        .from('wx_miniprogram_bindings')
        .insert({ user_id: prof.id, app_id: WX_APPID, openid })
      if (insErr) {
        return json({ ok: false, error: insErr.message, code: 'insert_failed' })
      }
      const session = await exchangeSession(prof.email)
      return json({
        ok: true,
        ...session,
        binding: { app_id: WX_APPID, openid, bound_at: new Date().toISOString(), is_new: false },
      })
    }

    if (action === 'signup_new') {
      if (!email || !password || password.length < 6) {
        return json({ ok: false, error: '邮箱或密码不合法（密码至少 6 位）', code: 'bad_input' })
      }
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (createErr) {
        if (createErr.message.toLowerCase().includes('already')) {
          return json({ ok: false, error: '该邮箱已注册，请用邮箱登录', code: 'exists' })
        }
        return json({ ok: false, error: createErr.message, code: 'create_failed' })
      }
      const { error: insErr } = await admin
        .from('wx_miniprogram_bindings')
        .insert({ user_id: created.user.id, app_id: WX_APPID, openid })
      if (insErr) {
        return json({ ok: false, error: insErr.message, code: 'insert_failed' })
      }
      const session = await exchangeSession(email)
      return json({
        ok: true,
        ...session,
        binding: { app_id: WX_APPID, openid, bound_at: new Date().toISOString(), is_new: true },
      })
    }

    return json({ ok: false, error: 'unknown action', code: 'bad_action' }, 400)
  } catch (e) {
    return json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      code: 'server_error',
    })
  }
})
