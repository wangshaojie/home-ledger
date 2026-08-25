import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron/simple'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    vue(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'electron-updater']
            }
          }
          // ⚠️ 不要用 define 把 VITE_* 注入到主进程！
          // 之前踩过坑：把 VITE_RESEND_API_KEY 通过 define 字面量写进 bundle，
          // 任何人拿到 dist-electron/main.js 都能用 key 发邮件。
          // 改密流程的 Resend key 走主进程 process.env + 不进 git 的 .env
          // （参考 electron/main.ts 顶部 dotenv 加载）。
        }
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    strictPort: false
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
