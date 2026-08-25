/**
 * 分类最近使用记录（前端 localStorage，per-family）
 * 不动 Supabase schema，纯 UI 增强。
 *
 * - 每个 family 独立一份 key
 * - 最多保留 5 个 id
 * - 重复选同分类会自动移到队首
 */

const KEY_PREFIX = 'home-ledger:recent-categories:'
const MAX = 5

function getKey(familyId: string): string {
  return KEY_PREFIX + familyId
}

export function getRecentCategoryIds(familyId: string | null | undefined): string[] {
  if (!familyId) return []
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(getKey(familyId))
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is string => typeof x === 'string').slice(0, MAX)
  } catch {
    return []
  }
}

export function markCategoryUsed(familyId: string | null | undefined, categoryId: string) {
  if (!familyId || !categoryId) return
  if (typeof localStorage === 'undefined') return
  try {
    const current = getRecentCategoryIds(familyId)
    const next = [categoryId, ...current.filter((id) => id !== categoryId)].slice(0, MAX)
    localStorage.setItem(getKey(familyId), JSON.stringify(next))
  } catch {
    // localStorage 写入失败时静默忽略（隐私模式 / 配额耗尽）
  }
}

export function clearRecentCategories(familyId: string | null | undefined) {
  if (!familyId) return
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(getKey(familyId))
  } catch {}
}
