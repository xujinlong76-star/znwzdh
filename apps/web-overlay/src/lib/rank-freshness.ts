/**
 * 榜单时效分级（2026-11-21）。
 *
 * ## 为什么需要分级
 *
 * 页面标题写"今日热榜"，状态栏却显示"热度分 4 天前 重算"，两者放在一起
 * 是强认知违和——用户会以为看到的是今天的实时热度，实际数据已停了四天。
 * 更糟的是旧实现用中性灰展示，没有任何视觉警示。
 *
 * 分级策略（对齐全站"诚实度"原则）：
 *   fresh   < 6h   中性灰，正常更新节奏
 *   aging   6-24h  轻量提示（amber 描边）
 *   stale   > 24h  温和琥珀色胶囊，明确写"已超过 X 天未更新"
 *   unknown 无记录 不显示、不编造
 */

export type FreshnessLevel = 'fresh' | 'aging' | 'stale' | 'unknown'

/** 6 小时：正常更新节奏的上限 */
export const FRESH_MAX_MS = 6 * 3600 * 1000
/** 24 小时：超过就与"今日热榜"名实不符 */
export const AGING_MAX_MS = 24 * 3600 * 1000

/** 根据重算时间戳判定时效等级。null/非法值 → unknown。 */
export function freshnessLevel(
  recomputedAt: number | null | undefined,
  now: number = Date.now(),
): FreshnessLevel {
  if (recomputedAt == null || !Number.isFinite(recomputedAt)) return 'unknown'
  const age = now - recomputedAt
  // 未来时间戳（时钟漂移）按最新处理，不报负天数
  if (age < FRESH_MAX_MS) return 'fresh'
  if (age < AGING_MAX_MS) return 'aging'
  return 'stale'
}

/**
 * 时效文案。
 *
 * 注意 stale 档刻意写"已超过 X 天未更新"而不是"X 天前更新"——
 * 后者听起来只是时间描述，前者明确传达"数据可能已过期"。
 */
export function freshnessLabel(
  level: FreshnessLevel,
  recomputedAt: number | null | undefined,
  now: number = Date.now(),
): string {
  if (recomputedAt == null) return ''
  const ageMs = Math.max(0, now - recomputedAt)
  const hours = Math.floor(ageMs / 3600000)
  const days = Math.floor(ageMs / 86400000)
  if (level === 'fresh') {
    if (hours < 1) return '热度分刚刚更新'
    return `热度分 ${hours} 小时前更新`
  }
  if (level === 'aging') {
    if (hours < 24) return `热度分 ${hours} 小时前更新`
    return '热度分 1 天前更新'
  }
  return days >= 1 ? `重算时间戳已超过 ${days} 天未更新` : '重算时间戳已超过 24 小时未更新'
}

/** 状态胶囊的样式类：按等级给不同视觉权重（亮/暗双主题各一套）。 */
export function freshnessClass(level: FreshnessLevel): string {
  const base =
    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors'
  if (level === 'fresh') return `${base} border-border/60 bg-background/60 text-muted-foreground`
  if (level === 'aging')
    return `${base} border-amber-500/30 bg-amber-500/[0.06] text-amber-700 dark:text-amber-400`
  if (level === 'stale')
    return `${base} border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 font-medium`
  return `${base} border-border/60 bg-background/60 text-muted-foreground`
}
