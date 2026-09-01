/**
 * 时间范围（range）的公共定义与换算
 * 唯一来源：expense store 的 SQL 查询、前端过滤、成员统计图表都从这里取值，
 * 避免三处各自实现导致口径漂移。
 */

export type RangeKey = 'all' | 'today' | 'yesterday' | 'week' | 'month' | '30d'

/**
 * 把时间范围翻译成 SQL 时间下界（本地时区）
 * 'all' 返回 null 表示不限时间
 */
export function rangeStartIso(range: RangeKey): string | null {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (range) {
    case 'today':
      return startOfDay.toISOString()
    case 'yesterday':
      return new Date(startOfDay.getTime() - 86400000).toISOString()
    case 'week':
      return new Date(now.getTime() - 7 * 86400000).toISOString()
    case '30d':
      return new Date(now.getTime() - 30 * 86400000).toISOString()
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    case 'all':
      return null
  }
}
