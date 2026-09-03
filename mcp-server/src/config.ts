// 配置常量 + 环境变量
// 优先级: env > 持久化 config 文件 > 错误提示用户运行 login

import { loadConfig, type StoredConfig } from './config-store.js';

let cached: StoredConfig | null = null;

export async function resolveConfig(): Promise<StoredConfig> {
  // 1. 优先 env
  const envUrl = process.env.HOME_LEDGER_SUPABASE_URL;
  const envKey = process.env.HOME_LEDGER_SUPABASE_ANON_KEY;
  if (envUrl && envKey) {
    return { supabase_url: envUrl, supabase_anon_key: envKey };
  }

  // 2. 持久化配置
  if (!cached) {
    cached = await loadConfig();
  }
  if (cached) return cached;

  // 3. 都没有,提示
  throw new Error(
    '未配置 Supabase 连接信息。请:\n' +
      '  1) 设置环境变量 HOME_LEDGER_SUPABASE_URL 和 HOME_LEDGER_SUPABASE_ANON_KEY\n' +
      '  2) 或运行 `home-ledger-mcp config set --url <url> --key <anon_key>` 保存到本地\n' +
      '  3) 或运行 `home-ledger-mcp login` 进入配置流程。',
  );
}

// 同步版本,给已 require 过的地方用(从 cache 读)
export function getCachedConfig(): StoredConfig | null {
  return cached;
}

export function requireConfigSync(): { supabaseUrl: string; supabaseAnonKey: string } {
  const envUrl = process.env.HOME_LEDGER_SUPABASE_URL;
  const envKey = process.env.HOME_LEDGER_SUPABASE_ANON_KEY;
  if (envUrl && envKey) {
    return { supabaseUrl: envUrl, supabaseAnonKey: envKey };
  }
  if (cached) {
    return { supabaseUrl: cached.supabase_url, supabaseAnonKey: cached.supabase_anon_key };
  }
  throw new Error(
    '未配置 Supabase 连接信息。请运行 `home-ledger-mcp config set --url <url> --key <key>`,或设置环境变量。',
  );
}
