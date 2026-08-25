import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 主进程专用：加载不进 git 的 .env 文件到 process.env
 * 避免走 Vite define 把 secret 字面量写进 dist-electron/main.js
 *
 * - 不依赖 dotenv，纯 fs 手 parse
 * - 支持 # 注释、空行、引号包裹
 * - 不覆盖已存在的 process.env（让系统级 env 优先）
 * - 与 .gitignore 中的 .env 配合，文件不进 git
 */
export function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf-8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    // 去掉行尾注释（仅当不在引号内时）
    // 简单实现：去掉 " #" 之后的字符
    const hashIdx = val.search(/\s+#/)
    if (hashIdx >= 0) val = val.slice(0, hashIdx).trim()
    // 去引号
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = val
    }
  }
}

/**
 * 从项目根目录加载主进程专属的 .env（与 Vite 用的同名 .env 共存，
 * 但本 loader 只读不写不导出，绝不会进 Vite bundle）
 *
 * 兼容 CJS（__dirname 存在）和 ESM（用 import.meta.url + fileURLToPath）
 * Vite/esbuild 编译 main.ts 时可能输出 ESM，必须两种都支持
 */
export function loadMainProcessEnv(): void {
  // ESM: __dirname 不存在；CJS: 存在。两种都要兼容
  const here: string = (() => {
    try {
      // CJS 路径
      // @ts-ignore
      if (typeof __dirname !== 'undefined') return __dirname as string
    } catch {}
    // ESM 路径
    return path.dirname(fileURLToPath(import.meta.url))
  })()

  // 主进程编译后 here 是 dist-electron/，.env 在项目根
  // 这里写 `..` 一次就够（开发时 here=project root 时也能 fallthrough 到 cwd）
  const candidates = [
    path.join(here, '..', '.env'),            // dist-electron/main.js → project root
    path.join(here, '..', '..', '.env'),       // 兜底：再上一级
    path.join(process.cwd(), '.env')           // 最后兜底：cwd
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      loadEnvFile(p)
      return
    }
  }
}
