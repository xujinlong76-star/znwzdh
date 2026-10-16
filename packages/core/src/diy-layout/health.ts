/**
 * 排版人机工程学健康度与香农信息熵评估算法 (Layout Ergonomics Evaluation)。
 */
import type { CategoryLayoutOptions } from './ordering.ts'

export interface LayoutHealthReport {
  score: number // 0 ~ 100 分
  level: 'excellent' | 'good' | 'fair' | 'poor'
  shannonEntropy: number // 香农信息熵 (衡量分类容量均衡度)
  normalizedEntropy: number // 0.0 ~ 1.0
  totalCategories: number
  visibleCategories: number
  hiddenCategories: number
  pinnedCategories: number
  totalSites: number
  emptyCategoriesCount: number
  overloadedCategoriesCount: number
  suggestions: string[]
}

/**
 * 评估当前排版方案的人机工程学健康度与信息架构质量
 */
export function evaluateLayoutErgonomics<
  TCat extends { id: string; title: string; items?: any[]; subCategories?: any[] }
>(categories: TCat[], options: CategoryLayoutOptions = {}): LayoutHealthReport {
  const { pinnedCategoryIds = [], hiddenCategoryIds = [] } = options

  const visibleCats = categories.filter((c) => !hiddenCategoryIds.includes(c.id))
  const totalCategories = categories.length
  const visibleCategories = visibleCats.length
  const hiddenCategories = hiddenCategoryIds.length
  const pinnedCategories = pinnedCategoryIds.length

  const suggestions: string[] = []
  let totalSites = 0
  const categoryCounts: { id: string; title: string; count: number }[] = []

  for (const cat of visibleCats) {
    const directCount = Array.isArray(cat.items) ? cat.items.length : 0
    const subCount = Array.isArray(cat.subCategories)
      ? cat.subCategories.reduce((acc, sub) => acc + (Array.isArray(sub.items) ? sub.items.length : 0), 0)
      : 0
    const count = directCount + subCount
    totalSites += count
    categoryCounts.push({ id: cat.id, title: cat.title, count })
  }

  // 1. 空分类与超载分类检测
  let emptyCategoriesCount = 0
  let overloadedCategoriesCount = 0

  for (const c of categoryCounts) {
    if (c.count === 0) {
      emptyCategoriesCount++
      suggestions.push(`分类「${c.title}」暂无站点收录，建议在排版工坊中隐藏以保持页面整洁`)
    } else if (c.count > 30) {
      overloadedCategoriesCount++
      suggestions.push(`分类「${c.title}」收录 ${c.count} 个站点，建议拆分子分类或开启紧凑条形模式`)
    }
  }

  // 2. 香农信息熵计算 (衡量站点分布离散均匀度)
  let shannonEntropy = 0
  let normalizedEntropy = 1.0

  if (totalSites > 0 && visibleCategories > 1) {
    for (const c of categoryCounts) {
      if (c.count > 0) {
        const p = c.count / totalSites
        shannonEntropy -= p * Math.log2(p)
      }
    }
    const maxEntropy = Math.log2(visibleCategories)
    normalizedEntropy = maxEntropy > 0 ? Number((shannonEntropy / maxEntropy).toFixed(3)) : 1.0
  }

  // 3. 综合打分计算 (基准 100 分)
  let score = 100

  // 惩罚项：空分类过多每个扣 8 分
  score -= emptyCategoriesCount * 8

  // 惩罚项：超载分类每个扣 5 分
  score -= overloadedCategoriesCount * 5

  // 惩罚项：分布极度不均衡 (normalizedEntropy < 0.5) 扣分
  if (normalizedEntropy < 0.5 && visibleCategories > 2) {
    score -= Math.round((0.5 - normalizedEntropy) * 30)
    suggestions.push('各分类站点数量分布显著倾斜，建议合理归类')
  }

  // 惩罚项：可见分类数量过少或过多
  if (visibleCategories === 0) {
    score = 0
    suggestions.push('当前所有分类均已被隐藏，首页处于空白状态')
  } else if (visibleCategories > 25) {
    score -= (visibleCategories - 25) * 2
    suggestions.push('可见分类过多（>25 个），建议隐藏不常用分类以降低认知负荷')
  }

  // 奖励项：置顶常用分类
  if (pinnedCategories >= 1 && pinnedCategories <= 5) {
    score = Math.min(100, score + 4)
  }

  score = Math.max(0, Math.min(100, score))

  let level: 'excellent' | 'good' | 'fair' | 'poor' = 'poor'
  if (score >= 85) level = 'excellent'
  else if (score >= 70) level = 'good'
  else if (score >= 50) level = 'fair'

  if (suggestions.length === 0) {
    suggestions.push('当前排版信息架构极佳，分类分布均衡，视觉负荷健康。')
  }

  return {
    score,
    level,
    shannonEntropy: Number(shannonEntropy.toFixed(3)),
    normalizedEntropy,
    totalCategories,
    visibleCategories,
    hiddenCategories,
    pinnedCategories,
    totalSites,
    emptyCategoriesCount,
    overloadedCategoriesCount,
    suggestions,
  }
}
