/**
 * 统一处理"显示名"：空 / 不可见字符 / 全是 replacement char 视为无效
 * 无效时回退到邮箱前缀
 *
 * 兼容两种来源：
 * - profile（user 表）：{ display_name, email }
 * - family_member（v1.1 新增的表）：{ name, ... }
 */
export function displayNameOf(
  m:
    | { display_name?: string | null; name?: string | null; email?: string }
    | null
    | undefined
): string {
  if (!m) return '-'
  // 优先用 display_name（profile），其次用 name（family_member）
  const raw = (m.display_name || m.name || '') as string
  // trim 后空 / 含  (U+FFFD, "replacement character" 表明编码出错) → fallback
  const cleaned = raw.replace(/\uFFFD/g, '').trim()
  if (cleaned) return cleaned
  if (m.email) return m.email.split('@')[0]
  return '-'
}
