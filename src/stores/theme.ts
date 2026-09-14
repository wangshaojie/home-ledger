import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeMode = 'dark' | 'light'

const STORAGE_KEY = 'home-ledger.theme'

function readStored(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'dark'
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' ? 'light' : 'dark'
}

function applyToDom(mode: ThemeMode) {
  if (typeof document === 'undefined') return
  // 切到浅色时,主 app 容器加 [data-theme="light"]; 登录/空白页 .dark-page 走自己的深色不动
  const appShell = document.querySelector('.app-shell')
  if (appShell) {
    if (mode === 'light') appShell.setAttribute('data-theme', 'light')
    else appShell.removeAttribute('data-theme')
  }
  // html 顶层也加一个,影响 body 等继承变量
  document.documentElement.setAttribute('data-app-theme', mode)
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readStored())

  // 立即同步到 DOM(防止首次渲染闪烁)
  applyToDom(mode.value)

  function toggle() {
    mode.value = mode.value === 'dark' ? 'light' : 'dark'
  }
  function setMode(v: ThemeMode) {
    mode.value = v
  }

  // 状态变化时持久化 + 同步 DOM
  watch(mode, (v) => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, v)
    }
    applyToDom(v)
  })

  /**
   * v2026-09-14 供 AppLayout 挂载后调用:
   * store 创建时的那次 applyToDom() 跑在 .app-shell 挂载之前(DOM 里还没有节点),
   * 浅色主题的 data-theme 会漏掉 → 界面暗色、图表按浅色配色画的错位。
   * 这里补写一次,保证 DOM 与 store 始终一致。
   */
  function syncDom() {
    applyToDom(mode.value)
  }

  return { mode, toggle, setMode, syncDom }
})
