import { ref, watch, onUnmounted } from 'vue'

/**
 * 数字滚动过渡：source 返回值变化时，display 从当前值平滑过渡到新值（ease-out cubic）。
 * 用于统计卡片等数值瞬间跳变时增加动画，避免切换生硬。
 * 用法：const total = useAnimatedNumber(() => store.totalAmount)
 */
export function useAnimatedNumber(source: () => number, duration = 450) {
  const display = ref(0)
  let raf = 0

  watch(
    source,
    (end) => {
      cancelAnimationFrame(raf)
      const start = display.value
      if (end === start) return
      const t0 = performance.now()
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / duration)
        const eased = 1 - Math.pow(1 - p, 3) // ease-out cubic
        display.value = start + (end - start) * eased
        if (p < 1) raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    },
    { immediate: true }
  )

  onUnmounted(() => cancelAnimationFrame(raf))

  return display
}
