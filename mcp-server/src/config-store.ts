// 配置文件存储(supabase URL + anon key,不像 token 那么敏感但也不该进 env)
// 跟 credentials 一样:keytar 优先,加密文件降级
// 存: ~/.home-ledger-mcp/config.enc

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

let keytar: typeof import('keytar') | null = null;
try {
  keytar = await import('keytar');
} catch {
  // 降级
}

const SERVICE = 'home-ledger-mcp';
const ACCOUNT = '__config__';

const FALLBACK_DIR = join(homedir(), '.home-ledger-mcp');
const FALLBACK_FILE = join(FALLBACK_DIR, 'config.enc');

function deriveKey(): Buffer {
  const machineId = `${homedir()}-${process.platform}-${process.arch}`;
  return scryptSync(machineId, 'home-ledger-mcp-config-v1', 32);
}

function ensureDir(): void {
  if (!existsSync(FALLBACK_DIR)) {
    mkdirSync(FALLBACK_DIR, { recursive: true, mode: 0o700 });
  }
}

function encrypt(obj: unknown): Buffer {
  ensureDir();
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

function decrypt<T = unknown>(buf: Buffer): T {
  const key = deriveKey();
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

export interface StoredConfig {
  supabase_url: string;
  supabase_anon_key: string;
}

export async function saveConfig(cfg: StoredConfig): Promise<void> {
  if (keytar) {
    await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(cfg));
    return;
  }
  ensureDir();
  writeFileSync(FALLBACK_FILE, encrypt(cfg), { mode: 0o600 });
}

export async function loadConfig(): Promise<StoredConfig | null> {
  if (keytar) {
    const raw = await keytar.getPassword(SERVICE, ACCOUNT);
    return raw ? (JSON.parse(raw) as StoredConfig) : null;
  }
  if (!existsSync(FALLBACK_FILE)) return null;
  try {
    return decrypt<StoredConfig>(readFileSync(FALLBACK_FILE));
  } catch {
    return null;
  }
}

export async function deleteConfig(): Promise<void> {
  if (keytar) {
    await keytar.deletePassword(SERVICE, ACCOUNT);
    return;
  }
  if (existsSync(FALLBACK_FILE)) {
    const { unlinkSync } = await import('node:fs');
    unlinkSync(FALLBACK_FILE);
  }
}
