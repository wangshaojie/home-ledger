// Supabase RPC 调用层
// 全部走 anon key + token 鉴权(SECURITY DEFINER 函数)
// 不直接连表——所有读写都过 RPC,触发器/审计/限流都生效

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { resolveConfig } from './config.js';

let client: SupabaseClient | null = null;

export async function getClient(): Promise<SupabaseClient> {
  if (client) return client;
  const cfg = await resolveConfig();
  client = createClient(cfg.supabase_url, cfg.supabase_anon_key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// ===========================
// 1. issue_mcp_token(只用于 login 子命令)
// 走 authenticated 角色的 supabase client 调
// 必须用户先在浏览器登录拿到 access_token,这里只是"包装"
// 实际:用户在 Vercel 激活页登录后,前端直接调 issue_mcp_token
//       然后把 token 复制给 MCP server
// 所以 MCP server 这边不做 issue,只做 verify
// ===========================

// ===========================
// 2. verify_mcp_token
//    用 anon key 调(因为 SECURITY DEFINER 不依赖 auth.uid())
//    返回 user_id / scopes / device_id / device_name
// ===========================
export interface VerifyResult {
  user_id: string;
  scopes: string[];
  device_id: string;
  device_name: string;
}

export async function verifyToken(token: string): Promise<VerifyResult> {
  const c = await getClient();
  const { data, error } = await c.rpc('verify_mcp_token', { p_token: token });
  if (error) {
    throw new Error(`token 验证失败: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error('token 验证失败: 返回空结果');
  }
  const row = data[0] as VerifyResult;
  if (!row.user_id) {
    throw new Error('token 验证失败: 缺少 user_id');
  }
  return row;
}

// ===========================
// 3. mcp_add_expense
// ===========================
export interface AddExpenseArgs {
  amount: number;
  note?: string;
  category_id?: string;
  account_id?: string;
  spent_at?: string; // YYYY-MM-DD
}

export interface AddExpenseResult {
  expense_id: string;
  family_id: string;
  creator_id: string;
  amount: number;
  spent_at: string;
}

export async function addExpense(
  token: string,
  args: AddExpenseArgs,
  deviceFingerprint?: string,
): Promise<AddExpenseResult> {
  const c = await getClient();
  const { data, error } = await c.rpc('mcp_add_expense', {
    p_token: token,
    p_amount: args.amount,
    p_note: args.note ?? null,
    p_category_id: args.category_id ?? null,
    p_account_id: args.account_id ?? null,
    p_spent_at: args.spent_at ?? null,
    p_device_fingerprint: deviceFingerprint ?? null,
  });
  if (error) {
    throw new Error(`记账失败: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error('记账失败: 返回空结果');
  }
  return data[0] as AddExpenseResult;
}

// ===========================
// 4. mcp_list_recent
// ===========================
export interface ListRecentItem {
  expense_id: string;
  amount: number;
  note: string;
  category_id: string;
  category_name: string;
  account_id: string;
  account_name: string;
  spent_at: string;
  creator_id: string;
  creator_name: string;
}

export async function listRecent(token: string, limit = 10): Promise<ListRecentItem[]> {
  const c = await getClient();
  const { data, error } = await c.rpc('mcp_list_recent', {
    p_token: token,
    p_limit: limit,
  });
  if (error) {
    throw new Error(`查询失败: ${error.message}`);
  }
  return (data ?? []) as ListRecentItem[];
}

// ===========================
// 5. mcp_delete_expense
// ===========================
export async function deleteExpense(token: string, expenseId: string): Promise<void> {
  const c = await getClient();
  const { error } = await c.rpc('mcp_delete_expense', {
    p_token: token,
    p_expense_id: expenseId,
  });
  if (error) {
    throw new Error(`删除失败: ${error.message}`);
  }
}
