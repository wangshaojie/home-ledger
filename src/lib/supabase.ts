import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseStorage } from './supabaseStorage'

const url = import.meta.env.VITE_SUPABASE_URL || ''
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const isSupabaseConfigured = !!url && !!key

/**
 * Supabase 客户端
 * - 没配置 env 时返回 null，业务代码要走 mock 兜底
 * - 配置了直接用 anon key（前端直连）
 * - RLS 已经在数据库层做权限校验，不需要在客户端再判
 * - storage 用自定义 supabaseStorage：包装一层"30 天免登录"过期检查
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: supabaseStorage
      }
    })
  : null
