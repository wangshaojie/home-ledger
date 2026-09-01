import { app, BrowserWindow, shell, ipcMain } from 'electron'
import path from 'node:path'
import { loadMainProcessEnv } from './loadEnv'

// 主进程启动时加载不进 git 的 .env
loadMainProcessEnv()

// 生产模式默认不开 DevTools；dev 模式（VITE_DEV_SERVER_URL 存在）自动开
const OPEN_DEVTOOLS_IN_DEV = true
const FORCE_OPEN_DEVTOOLS = process.argv.includes('--open-devtools')

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const shouldOpenDevTools =
  (VITE_DEV_SERVER_URL && OPEN_DEVTOOLS_IN_DEV) || FORCE_OPEN_DEVTOOLS

// 单实例锁
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
  process.exit(0)
}

// Windows 任务栏/标题栏图标关联，需与 electron-builder 的 appId 一致
// （dev 模式进程是 electron.exe，图标仍为 Electron 默认图标，打包后生效）
app.setAppUserModelId('com.homeledger.app')

let mainWindow: BrowserWindow | null = null

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: '家庭记账',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f7',
    // dev 模式用项目里的 build/icon.ico（开发体验一致）
    // 生产模式不传——让 Windows 用主 exe 嵌入图标（electron-builder build.win.icon 嵌进去的）
    // 之前 __dirname 在 asar 里解析成 dist-electron/，../build/icon.ico 不存在，
    // 任务栏会 fallback 到 Electron 默认 logo（v1.2.3 修）
    icon: VITE_DEV_SERVER_URL
      ? path.join(__dirname, '..', 'build', 'icon.ico')
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  if (shouldOpenDevTools) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createMainWindow()
  // 自动更新仅在生产模式（无 VITE_DEV_SERVER_URL 且非 macOS App Store）启用
  if (!VITE_DEV_SERVER_URL && !process.env['PORTABLE_EXECUTABLE_DIR']) {
    setupAutoUpdater()
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ========================================
// IPC handlers
// ========================================

/**
 * 改密流程 IPC：渲染进程发"我要给某邮箱发改密 OTP"信号
 *
 * 主进程收到后：
 * 1. 用前端传来的 access_token + supabase anon key 直接 fetch Supabase PostgREST /rpc/request_password_reset
 *    （auth.uid() 由 access_token 决定，前端无法伪造别人的邮箱）
 * 2. 拿到 6 位 code（注意：⚠️ 此时 code 在主进程内存里，渲染进程拿不到）
 * 3. 拼 HTML 模板 + 调 Resend API 发邮件
 * 4. 返回 ok/err
 *
 * 设计上 code 永远不出主进程：避免攻击者通过 DevTools / Network 抓包获取
 */
ipcMain.handle(
  'password-reset:request',
  async (
    _event,
    args: {
      accessToken: string
      supabaseUrl: string
      supabaseAnonKey: string
      email: string
    }
  ) => {
    const resendKey = process.env['RESEND_API_KEY'] as string | undefined
    if (!resendKey) {
      return {
        ok: false,
        message: 'Resend API key 未配置。请在项目根目录 .env 加 RESEND_API_KEY=re_xxx（不要 VITE_ 前缀）'
      }
    }
    if (!args?.accessToken || !args?.supabaseUrl || !args?.supabaseAnonKey || !args?.email) {
      return { ok: false, message: '参数缺失' }
    }

    try {
      // 1. 调 Supabase RPC（用前端传来的 access_token 决定 auth.uid()）
      const rpcRes = await fetch(`${args.supabaseUrl}/rest/v1/rpc/request_password_reset`, {
        method: 'POST',
        headers: {
          apikey: args.supabaseAnonKey,
          Authorization: `Bearer ${args.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ p_email: args.email })
      })
      if (!rpcRes.ok) {
        const errBody = await rpcRes.text()
        return { ok: false, message: `生成验证码失败：${rpcRes.status} ${errBody.substring(0, 200)}` }
      }
      const rpcData = await rpcRes.json()
      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData
      const code: string | undefined = row?.rc_code
      if (!code) {
        return { ok: false, message: '生成验证码失败：返回数据格式异常' }
      }

      // 2. 拼 HTML（code 留在主进程，绝不回传给渲染进程）
      const html = `<h2 style="color:#0c4a6e;margin:0 0 16px;font-family:sans-serif">家庭记账</h2>
<p style="color:#374151;margin:0 0 12px;font-family:sans-serif">你的改密码验证码：</p>
<div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#f56c2c;background:#fff1ea;padding:16px 24px;border-radius:8px;text-align:center;font-family:monospace">${code}</div>
<p style="color:#6b7280;font-size:14px;margin-top:16px;font-family:sans-serif">
  验证码 5 分钟内有效。连续 5 次错误后失效。如非本人操作，请忽略此邮件。
</p>`

      // 3. 调 Resend API
      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: '家庭记账 <noreply@240730.xyz>',
          to: [args.email],
          subject: '家庭记账 - 改密码验证码',
          html
        })
      })
      if (!sendRes.ok) {
        const errBody = await sendRes.text()
        return { ok: false, message: `Resend ${sendRes.status}: ${errBody.substring(0, 200)}` }
      }
      const sendResult = (await sendRes.json()) as { id?: string }
      return { ok: true, id: sendResult.id }
    } catch (e: any) {
      return { ok: false, message: `网络错误：${e?.message || '未知'}` }
    }
  }
)

// ========================================
// 自动更新（electron-updater + GitHub Releases）
// 流程改为"事件推送到渲染进程"：更新弹窗/进度条都在应用内 UI 展示，
// 替代原来的主进程原生 dialog（点击更新后无任何反馈，体验差）。
// ========================================
let appUpdater: import('electron-updater').AppUpdater | null = null
let updateCheckInterval: NodeJS.Timeout | null = null
let isDownloading = false

/**
 * 懒加载 electron-updater 并缓存单例。
 * ⚠️ electron-updater 是 CJS 包, Vite 编译后的 `await import` 不会自动 interop
 * 解包, named import 拿到 undefined. 改用 `rawMod.default ?? rawMod` 兜底
 * 参考: https://github.com/electron-userland/electron-builder/issues/8115
 */
async function getUpdater(): Promise<import('electron-updater').AppUpdater> {
  if (appUpdater) return appUpdater
  const rawMod: unknown = await import('electron-updater')
  const mod = (rawMod as { default?: typeof import('electron-updater') }).default
    ?? (rawMod as typeof import('electron-updater'))
  appUpdater = mod.autoUpdater
  return appUpdater
}

/** 把更新事件推给渲染进程（窗口未就绪时丢弃，下次检查会再次触发） */
function sendUpdateEvent(payload: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:update-event', payload)
  }
}

async function setupAutoUpdater() {
  const autoUpdater = await getUpdater()

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null // 用默认 console 即可；要更详细可换 electron-log

  // 1) 启动后 3 秒首次检查
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[autoUpdater] checkForUpdates error:', err)
    })
  }, 3000)

  // 2) 每 4 小时轮询一次（下载期间跳过）
  updateCheckInterval = setInterval(
    () => {
      if (!isDownloading) {
        autoUpdater.checkForUpdates().catch((err) => {
          console.error('[autoUpdater] interval check error:', err)
        })
      }
    },
    4 * 60 * 60 * 1000
  )

  // 3) 发现新版本 → 推给渲染进程弹窗，由用户决定是否下载
  autoUpdater.on('update-available', (info) => {
    sendUpdateEvent({
      type: 'update-available',
      version: (info as { version?: string })?.version || ''
    })
  })

  // 4) 下载进度 → 推给渲染进程展示进度条
  autoUpdater.on('download-progress', (progress) => {
    sendUpdateEvent({
      type: 'download-progress',
      percent: Number((progress as { percent?: number })?.percent || 0),
      transferred: Number((progress as { transferred?: number })?.transferred || 0),
      total: Number((progress as { total?: number })?.total || 0),
      bytesPerSecond: Number((progress as { bytesPerSecond?: number })?.bytesPerSecond || 0)
    })
  })

  // 5) 下载完成 → 推给渲染进程询问是否立即重启
  autoUpdater.on('update-downloaded', (info) => {
    isDownloading = false
    sendUpdateEvent({
      type: 'update-downloaded',
      version: (info as { version?: string })?.version || ''
    })
  })

  // 6) 无更新 / 错误
  autoUpdater.on('update-not-available', () => {
    sendUpdateEvent({ type: 'update-not-available' })
  })
  autoUpdater.on('error', (err) => {
    isDownloading = false
    sendUpdateEvent({
      type: 'update-error',
      message: (err as Error)?.message || String(err)
    })
  })
}

// 渲染进程手动触发"检查更新"（设置页用）
ipcMain.handle('app:check-for-updates', async () => {
  if (VITE_DEV_SERVER_URL) {
    return { ok: false, message: '开发模式不检查更新' }
  }
  try {
    const autoUpdater = await getUpdater()
    const result = await autoUpdater.checkForUpdates()
    return {
      ok: true,
      currentVersion: app.getVersion(),
      available: !!result?.updateInfo,
      version: result?.updateInfo?.version
    }
  } catch (e: any) {
    return { ok: false, message: e?.message || '检查更新失败' }
  }
})

// 渲染进程"立即下载"（弹窗按钮触发；下载进度由 download-progress 事件驱动 UI）
ipcMain.handle('app:download-update', async () => {
  if (VITE_DEV_SERVER_URL) return { ok: false, message: '开发模式不支持下载更新' }
  if (isDownloading) return { ok: true, message: '已在下载中' }
  try {
    isDownloading = true
    const autoUpdater = await getUpdater()
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (e: any) {
    isDownloading = false
    sendUpdateEvent({ type: 'update-error', message: e?.message || '下载失败' })
    return { ok: false, message: e?.message || '下载失败' }
  }
})

// 渲染进程"立即重启并安装"
ipcMain.handle('app:quit-and-install', async () => {
  if (VITE_DEV_SERVER_URL) return { ok: false, message: '开发模式不支持' }
  const autoUpdater = await getUpdater()
  // isSilent=false 让 NSIS 安装器显示安装界面
  autoUpdater.quitAndInstall(false, false)
  return { ok: true }
})

app.on('will-quit', () => {
  if (updateCheckInterval) clearInterval(updateCheckInterval)
})
