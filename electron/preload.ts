import { contextBridge, ipcRenderer } from 'electron'

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
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates')
})
