/**
 * 时间半衰期自适应站点热度排序算法 (Time-decay Adaptive Ranking)。
 *
 * 公式：Score = (isPinned ? 10000 : 0) + visitCount * 10 * e^(-lambda * dt) + starBonus + trendScore * 5
 */

export interface AdaptiveRankingOptions {
  pinnedItemIds?: string[]
  now?: number
  halfLifeDays?: number // 默认 7 天半衰期
  visitStats?: Record<string, { count: number; lastVisitedAt?: number }>
}

/**
 * 基于物理半衰期与质量因子的自适应动态卡片排序算法
 * 公式：Score = (isPinned ? 10000 : 0) + visitCount * 10 * e^(-lambda * dt) + starBonus + trendScore * 5
 */
export function computeAdaptiveSiteRanking<
  T extends {
    id: string
    liveMetrics?: { githubStars?: number }
    trendScore?: number
  }
>(items: T[], options: AdaptiveRankingOptions = {}): T[] {
  const {
    pinnedItemIds = [],
    now = Date.now(),
    halfLifeDays = 7,
    visitStats = {},
  } = options

  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000
  const lambda = Math.LN2 / halfLifeMs

  const computeItemScore = (item: T): number => {
    let score = 0
    const isPinned = pinnedItemIds.includes(item.id)
    if (isPinned) {
      // 显式置顶保证最高优先级，置顶项内部根据置顶次序排序
      score += 10000 - pinnedItemIds.indexOf(item.id) * 10
    }

    const stat = visitStats[item.id]
    if (stat) {
      const dt = Math.max(0, now - (stat.lastVisitedAt || now))
      const recencyFactor = Math.exp(-lambda * dt)
      score += stat.count * 10 * recencyFactor
    }

    // GitHub Stars 质量微加权 (每 1000 star 加 0.5 分，最高 15 分)
    if (item.liveMetrics?.githubStars) {
      score += Math.min(15, (item.liveMetrics.githubStars / 1000) * 0.5)
    }

    if (item.trendScore) {
      score += item.trendScore * 5
    }

    return score
  }

  return [...items].sort((a, b) => {
    const scoreA = computeItemScore(a)
    const scoreB = computeItemScore(b)
    if (scoreA !== scoreB) {
      return scoreB - scoreA
    }
    return 0
  })
}
