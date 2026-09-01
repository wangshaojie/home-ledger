/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_RESEND_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** 主进程推送的更新事件（与 electron/preload.ts 保持一致） */
type UpdateEventPayload =
  | { type: 'update-available'; version: string }
  | { type: 'download-progress'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { type: 'update-downloaded'; version: string }
  | { type: 'update-not-available' }
  | { type: 'update-error'; message: string }

interface ElectronAPI {
  platform: NodeJS.Platform
  version: string
  /**
   * 触发改密 OTP 流程（主进程内部完成 OTP 生成 + 邮件发送，渲染进程拿不到 code）
   */
  requestPasswordResetOtp: (args: {
    accessToken: string
    supabaseUrl: string
    supabaseAnonKey: string
    email: string
  }) => Promise<{ ok: boolean; id?: string; message?: string }>
  /** 手动触发检查更新（返回最新版本信息） */
  checkForUpdates: () => Promise<{
    ok: boolean
    currentVersion?: string
    available?: boolean
    version?: string
    message?: string
  }>
  /** 开始下载更新（后台下载，进度通过 onUpdateEvent 推送） */
  downloadUpdate: () => Promise<{ ok: boolean; message?: string }>
  /** 立即重启并安装已下载的更新 */
  quitAndInstall: () => Promise<{ ok: boolean; message?: string }>
  /** 订阅更新事件，返回取消订阅函数 */
  onUpdateEvent: (callback: (payload: UpdateEventPayload) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
