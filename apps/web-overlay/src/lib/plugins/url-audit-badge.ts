/**
 * 详情页 URL 体检徽标的纯展示逻辑（无 React 依赖，可直接单测）。
 *
 * 拆出来的理由：这两个函数决定「用户看到的百分比和颜色」，
 * 阈值错了不会报错、只会误导人，必须能用纯函数测试锁住。
 */

/** 可达率 → 徽标文案与配色；null 视为未知（不拿 0 冒充全挂） */
export function reachabilityTone(rate: number | null | undefined): {
  label: string
  className: string
} {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    return { label: '可达性未知', className: 'border-border/60 text-muted-foreground' }
  }
  // 防御性夹紧：后端算的是 0..1，若历史数据出现 1.5 也不能渲染成 150%
  const safe = Math.min(1, Math.max(0, rate))
  const pct = Math.round(safe * 100)
  if (safe >= 0.95) {
    return { label: `${pct}% 可达`, className: 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5' }
  }
  if (safe >= 0.8) {
    return { label: `${pct}% 可达`, className: 'text-amber-600 dark:text-amber-400 border-amber-500/30 bg-amber-500/5' }
  }
  return { label: `${pct}% 可达`, className: 'text-destructive border-destructive/30 bg-destructive/5' }
}

/** 时间戳 → 「3 天前」这类短相对时间；未来时间与非法值都按「刚刚」处理 */
export function relativeTime(from: number, now = Date.now()): string {
  const diff = now - from
  if (!Number.isFinite(diff) || diff < 60_000) return '刚刚'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
}
