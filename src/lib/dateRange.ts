/**
 * 时间范围（range）的公共定义与换算
 * 唯一来源：expense store 的 SQL 查询、前端过滤、成员统计图表都从这里取值，
 * 避免三处各自实现导致口径漂移。
 *
 * v2026-09-07 新增 'custom' + customStart/customEnd：
 * 任意日期段（如"国庆 10.1-10.7"、"10-15 ~ 11-20"），独立于预设 radio。
 * 区间约定：[start, end)，含起不含止。
 */

export type RangeKey = 'all' | 'today' | 'yesterday' | 'week' | 'month' | '30d' | 'custom'

/**
 * 把时间范围翻译成 SQL 时间下界（本地时区）
 * 'all' 返回 null 表示不限时间
 * 'custom' 模式:需要先调 rangeStartEnd() 拿到完整 {start, end},
 *              这里返回 start(下界),调用方再单独用 endExclusive(上界)拼到 SQL
 */
export function rangeStartIso(
  range: RangeKey,
  customStart?: string | null,
  customEnd?: string | null
): string | null {
  if (range === 'custom') {
    return customStart ? new Date(customStart).toISOString() : null
  }
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

/**
 * v2026-09-07 自定义区间的上界(不含)
 * null 表示不限上界
 * SQL 用法: q = q.lt('spent_at', endExclusive)
 */
export function rangeEndExclusive(
  range: RangeKey,
  customStart?: string | null,
  customEnd?: string | null
): string | null {
  if (range === 'custom') {
    if (!customEnd) return null
    // el-date-picker daterange 给的是本地 00:00:00,为了"含当天"语义,
    // 把上界加一天,这样"10.1 ~ 10.7"会包含 10.7 全天的账
    const d = new Date(customEnd)
    return new Date(d.getTime() + 86400000).toISOString()
  }
  if (range === 'yesterday') {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return startOfDay.toISOString()
  }
  return null
}

/**
 * 把自定义区间的 [start, end) 翻译成"YYYY-MM-DD ~ YYYY-MM-DD"显示文案
 * 没选完整则返回空串
 */
export function customRangeLabel(customStart: string | null, customEnd: string | null): string {
  if (!customStart || !customEnd) return ''
  const fmt = (s: string) => {
    const d = new Date(s)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return `${fmt(customStart)} ~ ${fmt(customEnd)}`
}
