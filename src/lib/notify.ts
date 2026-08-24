import { ElMessage } from 'element-plus'

export const notify = {
  success(msg: string) {
    ElMessage.success(msg)
  },
  error(msg: string) {
    ElMessage.error(msg)
  },
  warning(msg: string) {
    ElMessage.warning(msg)
  },
  info(msg: string) {
    ElMessage.info(msg)
  }
}

/** 标准化 Supabase / 网络错误为中文提示 */
export function errText(e: any, fallback = '操作失败'): string {
  if (!e) return fallback
  if (typeof e === 'string') return e
  if (e?.message) return e.message
  if (e?.error_description) return e.error_description
  return fallback
}
