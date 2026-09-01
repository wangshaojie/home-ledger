import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// 与 env.d.ts 的 UpdateEventPayload 保持一致
// （preload 的 tsconfig 不含 env.d.ts，需本地定义一份）
export type UpdateEventPayload =
  | { type: 'update-available'; version: string }
  | { type: 'download-progress'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { type: 'update-downloaded'; version: string }
  | { type: 'update-not-available' }
  | { type: 'update-error'; message: string }

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron,
  /**
   * 改密流程：主进程一站式处理（生成 OTP + 发邮件），渲染进程拿不到 code
   * - accessToken: 当前 Supabase session 的 access_token（前端用 supabase.auth.getSession() 拿）
   * - supabaseUrl: VITE_SUPABASE_URL
   * - supabaseAnonKey: VITE_SUPABASE_ANON_KEY
   * - email: 改密目标邮箱
   */
  requestPasswordResetOtp: (args: {
    accessToken: string
    supabaseUrl: string
    supabaseAnonKey: string
    email: string
  }) => ipcRenderer.invoke('password-reset:request', args),
  /** 手动触发检查更新（设置页"检查更新"按钮调用） */
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  /** 开始下载更新（后台下载，进度通过 onUpdateEvent 的 download-progress 推送） */
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  /** 立即重启并安装已下载的更新 */
  quitAndInstall: () => ipcRenderer.invoke('app:quit-and-install'),
  /**
   * 订阅更新事件（update-available / download-progress / update-downloaded / error）。
   * 返回取消订阅函数，组件卸载时调用避免泄漏。
   */
  onUpdateEvent: (callback: (payload: UpdateEventPayload) => void) => {
    const listener = (_e: IpcRendererEvent, payload: UpdateEventPayload) => callback(payload)
    ipcRenderer.on('app:update-event', listener)
    return () => ipcRenderer.removeListener('app:update-event', listener)
  }
})
