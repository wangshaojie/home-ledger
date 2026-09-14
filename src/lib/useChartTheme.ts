import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useThemeStore } from '@/stores/theme'

/**
 * v2026-09-14 图表配色用的"真实主题"
 *
 * 为什么不能直接读 themeStore.mode:
 *   theme store 在创建时会立刻 applyToDom(),但那一刻 .app-shell(AppLayout) 还没挂载,
 *   querySelector 拿不到节点 → 浅色主题的 data-theme 属性没打上;
 *   之后只有在"用户切主题"时 watch 才会补写。于是会出现
 *   "store.mode=light 但界面还是暗色"的错位,图表按 light 配色画 → 深色文字叠深色底,看不清。
 *
 * 所以这里两个信号都听:
 *   1) themeStore.mode —— 单数据源,切主题一定触发重算(响应式)
 *   2) DOM .app-shell[data-theme] —— 用户实际看到的真相,用 MutationObserver 兜底
 * 判定优先级:DOM 存在时以 DOM 为准,否则回落 store。
 *
 * 用法:const { isLight } = useChartTheme(),在 computed 里读 isLight.value
 */
export function useChartTheme() {
  const themeStore = useThemeStore()
  const domTick = ref(0)
  let observer: MutationObserver | null = null

  onMounted(() => {
    const shell = document.querySelector('.app-shell')
    if (shell && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        domTick.value++
      })
      observer.observe(shell, { attributes: true, attributeFilter: ['data-theme'] })
    }
  })
  onUnmounted(() => {
    observer?.disconnect()
    observer = null
  })

  const isLight = computed(() => {
    // 两个依赖都"碰"一下,任一方变化都重算
    void themeStore.mode
    void domTick.value
    if (typeof document === 'undefined') return themeStore.mode === 'light'
    const shell = document.querySelector('.app-shell')
    if (!shell) return themeStore.mode === 'light'
    return shell.getAttribute('data-theme') === 'light'
  })

  // 给 vue-echarts 的 THEME_KEY 用(echarts 内置注册了 light / dark 两套主题,
  // 未显式设色的部分会跟着它走;显式设的颜色优先级更高)
  const themeName = computed<'light' | 'dark'>(() => (isLight.value ? 'light' : 'dark'))

  return { isLight, themeName }
}
