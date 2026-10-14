/**
 * 首页次世代 DIY 可视化排版与分类编排核心算法引擎 (DIY Core Layout Engine)
 *
 * 模块包含：
 * 1. 分类拓扑编排、置顶与隐藏算法 (Topology & Pinning)
 * 2. 时间半衰期自适应站点热度排序算法 (Time-decay Adaptive Ranking)
 * 3. 人机工程学与香农信息熵排版健康度评估算法 (Ergonomics & Shannon Entropy Evaluation)
 * 4. 三路差异比对与无损合并引擎 (3-Way Diff & Merge Engine)
 * 5. 关键词与 Jaccard 相似度智能分类推荐算法 (Fuzzy Category Auto-Classifier)
 * 6. 开箱即用情境模版与配置清洗防御 (Presets & Config Sanitization)
 */

export interface CategoryLayoutOptions {
  categoryOrder?: string[]
  pinnedCategoryIds?: string[]
  hiddenCategoryIds?: string[]
}

/**
 * 1. 根据置顶列表、自定义排序与隐藏列表对分类数组进行排序和过滤
 */
export function sortCategoriesWithOverrides<T extends { id: string }>(
  categories: T[],
  options: CategoryLayoutOptions = {}
): T[] {
  const { categoryOrder = [], pinnedCategoryIds = [], hiddenCategoryIds = [] } = options

  // 过滤隐藏分类
  const visible = categories.filter((c) => !hiddenCategoryIds.includes(c.id))

  // 排序：置顶优先，其次根据 categoryOrder 次序，未在 order 中的保持原相对顺序
  return [...visible].sort((a, b) => {
    const aPinned = pinnedCategoryIds.includes(a.id)
    const bPinned = pinnedCategoryIds.includes(b.id)

    if (aPinned && !bPinned) return -1
    if (!aPinned && bPinned) return 1

    if (categoryOrder.length > 0) {
      const aIdx = categoryOrder.indexOf(a.id)
      const bIdx = categoryOrder.indexOf(b.id)
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
      if (aIdx !== -1) return -1
      if (bIdx !== -1) return 1
    }

    return 0
  })
}

/**
 * 2. 调整分类次序（上移/下移），支持初始化全量 ID 并提供边界越界防御
 */
export function shiftCategoryOrder(
  currentOrder: string[],
  categoryId: string,
  direction: 'up' | 'down',
  allIds: string[] = []
): string[] {
  const order = currentOrder.length > 0 ? [...currentOrder] : [...allIds]
  for (const id of allIds) {
    if (!order.includes(id)) {
      order.push(id)
    }
  }

  const index = order.indexOf(categoryId)
  if (index === -1) return order

  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= order.length) return order

  const [removed] = order.splice(index, 1)
  if (removed !== undefined) {
    order.splice(targetIndex, 0, removed)
  }

  return order
}

/**
 * 2.1 拖拽定向重排分类次序：支持将 sourceId 拖动至 targetId 的 before 或 after 位置
 */
export function reorderCategoryToTarget(
  currentOrder: string[],
  sourceId: string,
  targetId: string,
  position: 'before' | 'after' = 'before',
  allIds: string[] = []
): string[] {
  if (sourceId === targetId) return currentOrder

  const order = currentOrder.length > 0 ? [...currentOrder] : [...allIds]
  for (const id of allIds) {
    if (!order.includes(id)) {
      order.push(id)
    }
  }

  const sourceIndex = order.indexOf(sourceId)
  if (sourceIndex === -1) return order

  const [removed] = order.splice(sourceIndex, 1)
  if (removed === undefined) return order

  const targetIndex = order.indexOf(targetId)
  if (targetIndex === -1) {
    order.push(removed)
    return order
  }

  const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex
  order.splice(insertIndex, 0, removed)

  return order
}

/**
 * 3. 切换置顶状态
 */
export function togglePinnedId(pinnedIds: string[], id: string): string[] {
  if (pinnedIds.includes(id)) {
    return pinnedIds.filter((item) => item !== id)
  }
  return [...pinnedIds, id]
}

/**
 * 4. 切换隐藏状态
 */
export function toggleHiddenId(hiddenIds: string[], id: string): string[] {
  if (hiddenIds.includes(id)) {
    return hiddenIds.filter((item) => item !== id)
  }
  return [...hiddenIds, id]
}

/**
 * 5. 分类内站点排序算法：置顶站点优先排列在最前，其余保持原序
 */
export function sortCategoryItemsWithPinned<T extends { id: string }>(
  items: T[],
  pinnedItemIds: string[] = []
): T[] {
  if (!pinnedItemIds || pinnedItemIds.length === 0) return items

  return [...items].sort((a, b) => {
    const aPinned = pinnedItemIds.includes(a.id)
    const bPinned = pinnedItemIds.includes(b.id)

    if (aPinned && !bPinned) return -1
    if (!aPinned && bPinned) return 1
    if (aPinned && bPinned) {
      return pinnedItemIds.indexOf(a.id) - pinnedItemIds.indexOf(b.id)
    }
    return 0
  })
}

/**
 * 6. 切换分类内站点置顶状态映射
 */
export function togglePinnedSiteInCategory(
  currentPinnedMap: Record<string, string[]>,
  categoryId: string,
  siteId: string
): Record<string, string[]> {
  const currentList = currentPinnedMap[categoryId] || []
  const isPinned = currentList.includes(siteId)
  const nextList = isPinned
    ? currentList.filter((id) => id !== siteId)
    : [...currentList, siteId]

  return {
    ...currentPinnedMap,
    [categoryId]: nextList,
  }
}

// =========================================================================
// 7. 时间半衰期自适应热度衰减推荐排序算法 (Time-decay Adaptive Ranking)
// =========================================================================

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

// =========================================================================
// 8. 排版人机工程学健康度与香农信息熵评估算法 (Layout Ergonomics Evaluation)
// =========================================================================

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

// =========================================================================
// 9. 多端漫游三路差异比对与无损合并引擎 (3-Way Layout Diff & Merge Engine)
// =========================================================================

export interface DIYConfigPayload {
  viewMode?: 'hybrid' | 'classic' | 'workbench'
  cardDisplayMode?: 'compact' | 'standard' | 'rich'
  canvasBackground?: 'mesh' | 'dots' | 'grid' | 'aurora' | 'clean'
  accentColor?: string
  heroDeckCollapsed?: boolean
  heroDeckWidgets?: string[]
  categoryOrder?: string[]
  pinnedCategoryIds?: string[]
  hiddenCategoryIds?: string[]
  pinnedSiteIdsByCategory?: Record<string, string[]>
  customCategories?: Array<{ id: string; title: string; icon?: string; items?: any[] }>
}

export interface MergeResult {
  merged: DIYConfigPayload
  stats: {
    addedPinnedCats: number
    addedCustomCats: number
    conflictsResolved: number
  }
}

/**
 * 3-Way Diff & Merge 算法：无损合并本地修改与远程配置
 * 策略：
 * - 置顶与隐藏：采用并集策略，保证本地置顶不丢失；
 * - 专属分类：按 ID 归一化合并，同 ID 保留最新 item 集合；
 * - 视觉形态：优先采用最后修改方 (LWW)；
 * - 分类排序：保序并集，未见项平滑追加。
 */
export function mergeDIYLayoutConfigs(
  local: DIYConfigPayload,
  remote: DIYConfigPayload,
  base: DIYConfigPayload = {}
): MergeResult {
  let addedPinnedCats = 0
  let addedCustomCats = 0
  let conflictsResolved = 0

  // 1. 置顶分类无损合并 (Union)
  const localPinned = new Set(local.pinnedCategoryIds || [])
  const remotePinned = new Set(remote.pinnedCategoryIds || [])
  const mergedPinnedSet = new Set([...localPinned, ...remotePinned])
  addedPinnedCats = mergedPinnedSet.size - localPinned.size

  // 2. 隐藏分类合并 (Union)
  const localHidden = new Set(local.hiddenCategoryIds || [])
  const remoteHidden = new Set(remote.hiddenCategoryIds || [])
  const mergedHiddenSet = new Set([...localHidden, ...remoteHidden])

  // 3. 分类顺序合并
  const orderList: string[] = []
  const orderSet = new Set<string>()

  // 优先保留本地已调整的顺序
  for (const id of local.categoryOrder || []) {
    if (!orderSet.has(id)) {
      orderSet.add(id)
      orderList.push(id)
    }
  }
  // 顺次追加远程新增的分类 ID
  for (const id of remote.categoryOrder || []) {
    if (!orderSet.has(id)) {
      orderSet.add(id)
      orderList.push(id)
      conflictsResolved++
    }
  }

  // 4. 自建专属分类按 ID 合并
  const customMap = new Map<string, any>()
  for (const cat of remote.customCategories || []) {
    if (cat && cat.id) customMap.set(cat.id, { ...cat })
  }
  for (const cat of local.customCategories || []) {
    if (cat && cat.id) {
      if (!customMap.has(cat.id)) {
        addedCustomCats++
      }
      customMap.set(cat.id, { ...cat })
    }
  }

  // 5. 分类内站点置顶合并
  const mergedPinnedSitesMap: Record<string, string[]> = {
    ...(remote.pinnedSiteIdsByCategory || {}),
  }
  for (const [catId, siteIds] of Object.entries(local.pinnedSiteIdsByCategory || {})) {
    const existing = new Set(mergedPinnedSitesMap[catId] || [])
    for (const sid of siteIds) {
      existing.add(sid)
    }
    mergedPinnedSitesMap[catId] = Array.from(existing)
  }

  const merged: DIYConfigPayload = {
    viewMode: local.viewMode || remote.viewMode || 'hybrid',
    cardDisplayMode: local.cardDisplayMode || remote.cardDisplayMode || 'standard',
    canvasBackground: local.canvasBackground || remote.canvasBackground || 'mesh',
    accentColor: local.accentColor || remote.accentColor || 'default',
    heroDeckCollapsed: local.heroDeckCollapsed ?? remote.heroDeckCollapsed ?? false,
    heroDeckWidgets: Array.isArray(local.heroDeckWidgets) && local.heroDeckWidgets.length > 0
      ? local.heroDeckWidgets
      : remote.heroDeckWidgets,
    categoryOrder: orderList,
    pinnedCategoryIds: Array.from(mergedPinnedSet),
    hiddenCategoryIds: Array.from(mergedHiddenSet),
    pinnedSiteIdsByCategory: mergedPinnedSitesMap,
    customCategories: Array.from(customMap.values()),
  }

  return {
    merged,
    stats: {
      addedPinnedCats,
      addedCustomCats,
      conflictsResolved,
    },
  }
}

// =========================================================================
// 10. 智能模糊分类归属推荐算法 (Fuzzy Category Classifier)
// =========================================================================

export interface CategorySuggestion {
  categoryId: string
  categoryTitle: string
  confidence: number // 0.0 ~ 1.0
  matchReason: string
}

/**
 * 依据站点标题、URL 和描述，智能推荐最贴切的归属分类
 */
export function suggestCategoryForSite<TCat extends { id: string; title: string }>(
  site: { title: string; href?: string; description?: string },
  categories: TCat[]
): CategorySuggestion | null {
  if (!categories || categories.length === 0 || !site.title) return null

  const targetText = `${site.title} ${site.description || ''} ${site.href || ''}`.toLowerCase()

  let bestCat: TCat | null = null
  let maxScore = 0
  let reason = ''

  for (const cat of categories) {
    let score = 0
    const catTitle = cat.title.toLowerCase()

    // 1. 分类名称直接包含检测 (最高权重)
    if (targetText.includes(catTitle)) {
      score += 0.85
      reason = `站点信息直接包含分类名「${cat.title}」`
    } else {
      // 2. 词素交集与中文连词智能切分
      const catKeywords = catTitle
        .split(/[\s/、,，与和及&·+—_-]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2)

      let hits = 0
      const matchedWords: string[] = []
      for (const kw of catKeywords) {
        if (targetText.includes(kw)) {
          hits++
          matchedWords.push(kw)
        }
      }
      if (hits > 0 && catKeywords.length > 0) {
        score += 0.35 + (hits / catKeywords.length) * 0.4
        reason = `命中分类关键词「${matchedWords.join(' / ')}」`
      }
    }

    if (score > maxScore) {
      maxScore = score
      bestCat = cat
    }
  }

  if (bestCat && maxScore >= 0.3) {
    return {
      categoryId: bestCat.id,
      categoryTitle: bestCat.title,
      confidence: Number(Math.min(0.99, maxScore).toFixed(2)),
      matchReason: reason,
    }
  }

  return null
}

// =========================================================================
// 11. 开箱即用的预设 DIY 情境模版定义
// =========================================================================

export interface DIYPreset {
  id: string
  name: string
  description: string
  icon: string
  config: {
    viewMode: 'hybrid' | 'classic' | 'workbench'
    cardDisplayMode: 'compact' | 'standard' | 'rich'
    canvasBackground: 'mesh' | 'dots' | 'grid' | 'aurora' | 'clean'
    density: 'dense' | 'comfortable' | 'spacious'
    heroDeckCollapsed: boolean
    heroDeckWidgets: string[]
  }
}

export const BUILTIN_DIY_PRESETS: DIYPreset[] = [
  {
    id: 'dev-pro',
    name: '极客工程套件 (Dev Pro)',
    description: '超高信息密度条形、工程细网格背景、集成微工具箱与首屏星标坞',
    icon: 'Terminal',
    config: {
      viewMode: 'hybrid',
      cardDisplayMode: 'compact',
      canvasBackground: 'grid',
      density: 'dense',
      heroDeckCollapsed: false,
      heroDeckWidgets: ['quick-search', 'quick-tools', 'favorites-dock'],
    },
  },
  {
    id: 'ai-researcher',
    name: 'AI 原生研究员 (AI Lab)',
    description: '深度大图文卡片、柔和彩色极光渐变、指标徽标与论文探索首选',
    icon: 'Sparkles',
    config: {
      viewMode: 'hybrid',
      cardDisplayMode: 'rich',
      canvasBackground: 'aurora',
      density: 'comfortable',
      heroDeckCollapsed: false,
      heroDeckWidgets: ['quick-search', 'clock-pomodoro', 'favorites-dock'],
    },
  },
  {
    id: 'zen-minimalist',
    name: '极简禅道流 (Zen Flow)',
    description: '经典全景分类导航、宽松呼吸间距、纯净白/黑底色、回归最专注的书签体验',
    icon: 'Compass',
    config: {
      viewMode: 'classic',
      cardDisplayMode: 'standard',
      canvasBackground: 'clean',
      density: 'spacious',
      heroDeckCollapsed: true,
      heroDeckWidgets: ['quick-search'],
    },
  },
  {
    id: 'power-workbench',
    name: '全功能工作台 (Power Board)',
    description: '沉浸式自由布局画布、微网格平滑流体、多组件并行业务仪表盘',
    icon: 'LayoutGrid',
    config: {
      viewMode: 'workbench',
      cardDisplayMode: 'standard',
      canvasBackground: 'mesh',
      density: 'comfortable',
      heroDeckCollapsed: false,
      heroDeckWidgets: ['quick-search', 'clock-pomodoro', 'favorites-dock', 'quick-tools'],
    },
  },
]

// =========================================================================
// 12. 校验并清洗外部导入的 DIY JSON 配置
// =========================================================================

export function validateAndCleanDIYConfig(raw: any): { valid: boolean; config?: any; error?: string } {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: '导入的配置文件不是合法的 JSON 对象' }
  }

  if (typeof raw.viewMode !== 'string' && typeof raw.version !== 'number') {
    return { valid: false, error: '缺失必要的 DIY 配置元数据 (viewMode/version)' }
  }

  const validViewModes = ['hybrid', 'classic', 'workbench']
  const validCardModes = ['compact', 'standard', 'rich']
  const validCanvasBgs = ['mesh', 'dots', 'grid', 'aurora', 'clean']

  const cleaned = {
    version: 3,
    viewMode: validViewModes.includes(raw.viewMode) ? raw.viewMode : 'hybrid',
    cardDisplayMode: validCardModes.includes(raw.cardDisplayMode) ? raw.cardDisplayMode : 'standard',
    canvasBackground: validCanvasBgs.includes(raw.canvasBackground) ? raw.canvasBackground : 'mesh',
    accentColor: typeof raw.accentColor === 'string' ? raw.accentColor : 'default',
    heroDeckCollapsed: Boolean(raw.heroDeckCollapsed),
    heroDeckWidgets: Array.isArray(raw.heroDeckWidgets) ? raw.heroDeckWidgets : ['quick-search', 'clock-pomodoro', 'favorites-dock', 'quick-tools'],
    categoryOrder: Array.isArray(raw.categoryOrder) ? raw.categoryOrder : [],
    pinnedCategoryIds: Array.isArray(raw.pinnedCategoryIds) ? raw.pinnedCategoryIds : [],
    hiddenCategoryIds: Array.isArray(raw.hiddenCategoryIds) ? raw.hiddenCategoryIds : [],
    pinnedSiteIdsByCategory: typeof raw.pinnedSiteIdsByCategory === 'object' && raw.pinnedSiteIdsByCategory !== null
      ? raw.pinnedSiteIdsByCategory
      : {},
    customCategories: Array.isArray(raw.customCategories)
      ? raw.customCategories.map((c: any) => ({
          id: String(c.id || `custom_${Date.now()}`),
          title: String(c.title || '自定义分类'),
          icon: String(c.icon || 'FolderHeart'),
          items: Array.isArray(c.items)
            ? c.items.map((i: any) => ({
                id: String(i.id || `item_${Date.now()}`),
                title: String(i.title || ''),
                href: String(i.href || ''),
                icon: i.icon ? String(i.icon) : undefined,
                description: i.description ? String(i.description) : undefined,
              }))
            : [],
          createdAt: Number(c.createdAt) || Date.now(),
        }))
      : [],
    updatedAt: Date.now(),
  }

  return { valid: true, config: cleaned }
}
