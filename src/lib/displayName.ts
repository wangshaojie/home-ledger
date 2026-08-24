/**
 * 统一处理"显示名"：空 / 不可见字符 / 全是 replacement char 视为无效
 * 无效时回退到邮箱前缀
 */
export function displayNameOf(
  m: { display_name?: string | null; email?: string } | null | undefined
): string {
  if (!m) return '-'
  const raw = m.display_name || ''
  // trim 后空 / 含  (U+FFFD, "replacement character" 表明编码出错) → fallback
  const cleaned = raw.replace(/\uFFFD/g, '').trim()
  if (cleaned) return cleaned
  if (m.email) return m.email.split('@')[0]
  return '-'
}
