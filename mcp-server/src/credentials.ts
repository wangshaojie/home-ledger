// token 存储层
// 优先 keytar(Windows Credential Manager / macOS Keychain / libsecret)
// 降级:加密文件 + 0600 权限(Linux/无 GUI 环境)
//
// 设计:每个 device 一个 entry,key = device_id(由 issue_mcp_token 返回)
// value = { token, device_name, scopes, expires_at }
// 这样用户从桌面端"吊销"后,本机 entry 也对得上,方便清理

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// keytar 是 native module,可能装不上——动态 import 失败就降级
let keytar: typeof import('keytar') | null = null;
try {
  keytar = await import('keytar');
} catch (e) {
  process.stderr.write(`[home-ledger-mcp] keytar 不可用,降级到加密文件存储 (${(e as Error).message})\n`);
}

export interface StoredToken {
  device_id: string;
  device_name: string;
  token: string;
  scopes: string[];
  expires_at: string; // ISO 8601
  created_at: string;
}

const FALLBACK_DIR = join(homedir(), '.home-ledger-mcp');
const FALLBACK_FILE = join(FALLBACK_DIR, 'credentials.enc');
const FALLBACK_META = join(FALLBACK_DIR, 'meta.json');

// 加密文件的密钥来源:机器指纹(不完美,但比明文好)
function deriveKey(): Buffer {
  const machineId = `${homedir()}-${process.platform}-${process.arch}`;
  const salt = 'home-ledger-mcp-v1';
  return scryptSync(machineId, salt, 32);
}

// ===========================
// keytar 路径
// ===========================
async function saveKeytar(device: StoredToken): Promise<void> {
  if (!keytar) throw new Error('keytar 不可用');
  await keytar.setPassword(configServiceName(), device.device_id, JSON.stringify(device));
}

async function loadKeytar(deviceId: string): Promise<StoredToken | null> {
  if (!keytar) return null;
  const raw = await keytar.getPassword(configServiceName(), deviceId);
  return raw ? (JSON.parse(raw) as StoredToken) : null;
}

async function listKeytar(): Promise<StoredToken[]> {
  if (!keytar) return [];
  const creds = await keytar.findCredentials(configServiceName());
  return creds
    .filter((c) => c.account !== '__fallback_marker__')
    .map((c) => JSON.parse(c.password) as StoredToken);
}

async function deleteKeytar(deviceId: string): Promise<boolean> {
  if (!keytar) return false;
  return keytar.deletePassword(configServiceName(), deviceId);
}

function configServiceName(): string {
  return 'home-ledger-mcp';
}

// ===========================
// 加密文件降级路径
// ===========================
function ensureFallbackDir(): void {
  if (!existsSync(FALLBACK_DIR)) {
    mkdirSync(FALLBACK_DIR, { recursive: true, mode: 0o700 });
  }
}

function loadFallbackMap(): Record<string, StoredToken> {
  if (!existsSync(FALLBACK_FILE)) return {};
  try {
    const key = deriveKey();
    const iv = Buffer.from(JSON.parse(readFileSync(FALLBACK_META, 'utf8')).iv, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    const encTag = Buffer.from(JSON.parse(readFileSync(FALLBACK_META, 'utf8')).tag, 'hex');
    const enc = readFileSync(FALLBACK_FILE);
    decipher.setAuthTag(encTag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch (e) {
    process.stderr.write(`[home-ledger-mcp] 加密文件读取失败,清空重置 (${(e as Error).message})\n`);
    try {
      unlinkSync(FALLBACK_FILE);
      unlinkSync(FALLBACK_META);
    } catch {}
    return {};
  }
}

function saveFallbackMap(map: Record<string, StoredToken>): void {
  ensureFallbackDir();
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(map), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  writeFileSync(FALLBACK_FILE, enc, { mode: 0o600 });
  writeFileSync(
    FALLBACK_META,
    JSON.stringify({ iv: iv.toString('hex'), tag: tag.toString('hex') }),
    { mode: 0o600 },
  );
}

async function saveFallback(device: StoredToken): Promise<void> {
  const map = loadFallbackMap();
  map[device.device_id] = device;
  saveFallbackMap(map);
}

async function loadFallback(deviceId: string): Promise<StoredToken | null> {
  return loadFallbackMap()[deviceId] ?? null;
}

async function listFallback(): Promise<StoredToken[]> {
  return Object.values(loadFallbackMap());
}

async function deleteFallback(deviceId: string): Promise<boolean> {
  const map = loadFallbackMap();
  if (!(deviceId in map)) return false;
  delete map[deviceId];
  saveFallbackMap(map);
  return true;
}

// ===========================
// 公开 API:自动选 keytar / 文件
// ===========================
export async function saveToken(device: StoredToken): Promise<void> {
  if (keytar) return saveKeytar(device);
  return saveFallback(device);
}

export async function loadToken(deviceId: string): Promise<StoredToken | null> {
  if (keytar) return loadKeytar(deviceId);
  return loadFallback(deviceId);
}

export async function listTokens(): Promise<StoredToken[]> {
  if (keytar) return listKeytar();
  return listFallback();
}

export async function deleteToken(deviceId: string): Promise<boolean> {
  if (keytar) return deleteKeytar(deviceId);
  return deleteFallback(deviceId);
}

// 找到第一个未过期的 token(单设备场景)
export async function getActiveToken(): Promise<StoredToken | null> {
  const all = await listTokens();
  const now = Date.now();
  for (const t of all) {
    if (new Date(t.expires_at).getTime() > now) {
      return t;
    }
  }
  return null;
}
