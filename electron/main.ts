import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
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
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
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
// ========================================
let updateCheckInterval: NodeJS.Timeout | null = null
let isDownloading = false

async function setupAutoUpdater() {
  // ⚠️ v2026-08-25: electron-updater 是 CJS 包, Vite 编译后的 `await import` 不会自动
  // interop 解包, named import 拿到 undefined. 改用 `rawMod.default ?? rawMod` 兜底
  // 用 unknown 过渡避免类型污染, 否则 AppUpdater 事件回调参数会退化成 any 触发 TS7006
  // 参考: https://github.com/electron-userland/electron-builder/issues/8115
  const rawMod: unknown = await import('electron-updater')
  const mod = (rawMod as { default?: typeof import('electron-updater') }).default
    ?? (rawMod as typeof import('electron-updater'))
  const { autoUpdater } = mod

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  // 中文日志
  autoUpdater.logger = null // 用默认 console 即可；要更详细可换 electron-log

  // 1) 启动后 3 秒首次检查
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[autoUpdater] checkForUpdates error:', err)
    })
  }, 3000)

  // 2) 每 4 小时轮询一次
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

  // 3) 发现新版本 → 弹窗让用户决定
  autoUpdater.on('update-available', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 v${info.version}`,
      detail: '是否立即下载新版本？\n下载完成后会再次询问是否立即重启应用。',
      buttons: ['立即下载', '稍后再说'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (response === 0) {
      isDownloading = true
      autoUpdater.downloadUpdate().catch((err) => {
        isDownloading = false
        console.error('[autoUpdater] download error:', err)
        dialog.showErrorBox('下载失败', `新版本下载失败：${err?.message || err}\n请稍后重试或前往官网手动下载。`)
      })
    }
  })

  // 4) 下载进度（写到主进程 console，不打扰用户）
  autoUpdater.on('download-progress', (progress) => {
    console.log(
      `[autoUpdater] 下载中 ${(progress.percent).toFixed(1)}% (${(progress.transferred / 1024 / 1024).toFixed(1)}/${(progress.total / 1024 / 1024).toFixed(1)} MB)`
    )
  })

  // 5) 下载完成 → 弹窗询问是否立即重启
  autoUpdater.on('update-downloaded', async (info) => {
    isDownloading = false
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '更新已就绪',
      message: `v${info.version} 已下载完成`,
      detail: '是否立即重启应用以完成更新？\n选择"稍后"将在下次启动时自动安装。',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (response === 0) {
      // isSilent=false 让 NSIS 安装器显示安装界面
      autoUpdater.quitAndInstall(false, false)
    }
  })

  // 6) 没有更新 / 错误
  autoUpdater.on('update-not-available', () => {
    console.log('[autoUpdater] 已是最新版本')
  })
  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater] error:', err)
  })
}

// 渲染进程手动触发"检查更新"
ipcMain.handle('app:check-for-updates', async () => {
  if (VITE_DEV_SERVER_URL) {
    return { ok: false, message: '开发模式不检查更新' }
  }
  try {
    // ⚠️ CJS interop: 拿 default 兜底（参考 setupAutoUpdater 同款修法）
    const rawMod: unknown = await import('electron-updater')
    const mod = (rawMod as { default?: typeof import('electron-updater') }).default
      ?? (rawMod as typeof import('electron-updater'))
    const { autoUpdater } = mod
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

app.on('will-quit', () => {
  if (updateCheckInterval) clearInterval(updateCheckInterval)
})
