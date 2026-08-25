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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
