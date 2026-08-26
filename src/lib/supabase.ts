import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseStorage } from './supabaseStorage'

/**
 * Supabase 客户端（v1.1 移除原型模式后）
 *
 * 必填环境变量（写在 .env.local，不入 git）：
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY  （新版 Supabase Dashboard 的 publishable key）
 *   或  VITE_SUPABASE_ANON_KEY      （旧版 Supabase 的 anon key，兼容）
 *
 * 缺一即抛错，main.ts 会捕获并显示引导页（不是白屏）。
 */
const url = (import.meta.env.VITE_SUPABASE_URL || '').trim()
const key = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  ''
).trim()

if (!url || !key) {
  throw new Error(
    '[HomeLedger] 未配置 Supabase。请在项目根目录创建 .env.local，' +
      '填入 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY 后重启 dev。' +
      '（旧版 Supabase 兼容 VITE_SUPABASE_ANON_KEY）'
  )
}

export const supabase: SupabaseClient = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: supabaseStorage
  }
})


