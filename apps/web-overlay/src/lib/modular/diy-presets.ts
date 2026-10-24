/**
 * 首页次世代 DIY 可视化排版与分类编排纯算法 (Web 客户端运行时)
 */

export interface CategoryLayoutOptions {
  categoryOrder?: string[]
  pinnedCategoryIds?: string[]
  hiddenCategoryIds?: string[]
}

/**
 * 1. 分类拓扑重排与置顶优先过滤
 */
export function sortCategoriesWithOverrides<T extends { id: string }>(
  categories: T[],
  options: CategoryLayoutOptions = {}
): T[] {
  const { categoryOrder = [], pinnedCategoryIds = [], hiddenCategoryIds = [] } = options

  const visible = categories.filter((c) => !hiddenCategoryIds.includes(c.id))

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
 * 2. 调整分类次序（上移/下移）
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
 * 3. 分类内站点排序算法：置顶站点优先排列在最前，其余保持原序
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
 * 4. 切换指定分类内某站点的置顶状态
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

/**
 * 5. 时间半衰期自适应热度衰减推荐排序算法
 */
export interface AdaptiveRankingOptions {
  pinnedItemIds?: string[]
  now?: number
  halfLifeDays?: number
  visitStats?: Record<string, { count: number; lastVisitedAt?: number }>
}

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
      score += 10000 - pinnedItemIds.indexOf(item.id) * 10
    }

    const stat = visitStats[item.id]
    if (stat) {
      const dt = Math.max(0, now - (stat.lastVisitedAt || now))
      const recencyFactor = Math.exp(-lambda * dt)
      score += stat.count * 10 * recencyFactor
    }

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

/**
 * 6. 人机工程学与香农信息熵排版健康度评估算法
 */
export interface LayoutHealthReport {
  score: number
  level: 'excellent' | 'good' | 'fair' | 'poor'
  shannonEntropy: number
  normalizedEntropy: number
  totalCategories: number
  visibleCategories: number
  hiddenCategories: number
  pinnedCategories: number
  totalSites: number
  emptyCategoriesCount: number
  overloadedCategoriesCount: number
  suggestions: string[]
}

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

  let score = 100
  score -= emptyCategoriesCount * 8
  score -= overloadedCategoriesCount * 5

  if (normalizedEntropy < 0.5 && visibleCategories > 2) {
    score -= Math.round((0.5 - normalizedEntropy) * 30)
    suggestions.push('各分类站点数量分布显著倾斜，建议合理归类')
  }

  if (visibleCategories === 0) {
    score = 0
    suggestions.push('当前所有分类均已被隐藏，首页处于空白状态')
  } else if (visibleCategories > 25) {
    score -= (visibleCategories - 25) * 2
    suggestions.push('可见分类过多（>25 个），建议隐藏不常用分类以降低认知负荷')
  }

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

/**
 * 7. 3-Way 差异比对与无损合并引擎
 */
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

export function mergeDIYLayoutConfigs(
  local: DIYConfigPayload,
  remote: DIYConfigPayload
) {
  const localPinned = new Set(local.pinnedCategoryIds || [])
  const remotePinned = new Set(remote.pinnedCategoryIds || [])
  const mergedPinnedSet = new Set([...localPinned, ...remotePinned])

  const localHidden = new Set(local.hiddenCategoryIds || [])
  const remoteHidden = new Set(remote.hiddenCategoryIds || [])
  const mergedHiddenSet = new Set([...localHidden, ...remoteHidden])

  const orderList: string[] = []
  const orderSet = new Set<string>()

  for (const id of local.categoryOrder || []) {
    if (!orderSet.has(id)) {
      orderSet.add(id)
      orderList.push(id)
    }
  }
  for (const id of remote.categoryOrder || []) {
    if (!orderSet.has(id)) {
      orderSet.add(id)
      orderList.push(id)
    }
  }

  const customMap = new Map<string, any>()
  for (const cat of remote.customCategories || []) {
    if (cat && cat.id) customMap.set(cat.id, { ...cat })
  }
  for (const cat of local.customCategories || []) {
    if (cat && cat.id) customMap.set(cat.id, { ...cat })
  }

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

  return {
    merged: {
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
    },
  }
}

/**
 * 8. 关键词重合度分类推荐（**本地启发式，不是 AI**）
 *
 * 这里唯一的判据是「分类名/分词是否出现在标题+描述+URL 里」，没有模型、没有语料。
 * 因此 confidence 的口径是**重合度得分**，上限 0.85：曾经用 `Math.min(0.99, …)`
 * 配合界面上的「AI 推荐分类（99% 匹配）」，把一个字符串包含判断包装成模型置信度，
 * 用户会以为后端真的做了语义理解，从而不再核对就采纳错误的归类。
 */
export interface CategorySuggestion {
  categoryId: string
  categoryTitle: string
  /** 关键词重合度得分（0.3~0.85），不是概率 */
  confidence: number
  matchReason: string
  /** 判定来源：目前是纯关键词启发式，未来接真模型时这里会是 'llm' */
  method: 'keyword'
}

/** 启发式得分的天花板：字符串包含判断永远不该自称 100% */
const KEYWORD_SCORE_CEILING = 0.85

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

    if (targetText.includes(catTitle)) {
      score += 0.85
      reason = `站点信息直接包含分类名「${cat.title}」`
    } else {
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
      confidence: Number(Math.min(KEYWORD_SCORE_CEILING, maxScore).toFixed(2)),
      matchReason: reason,
      method: 'keyword',
    }
  }

  return null
}

/**
 * 9. 开箱即用的预设情境模版定义
 */
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

/**
 * 10. 校验并清洗外部导入的 DIY JSON 配置
 *
 * 安全说明：该配置可来自 URL hash / 导入文件 / localStorage，属不可信输入。
 * customWallpaperUrl 会直接进入 style={{ backgroundImage: `url(...)` }}，
 * customCategories[].items[].href 会进入 <Link href>，必须白名单校验否则即 XSS/CSS 注入。
 */
const SAFE_WALLPAPER_RE = /^(https?:\/\/[^'"()\s]+|\/[^'"()\s]*|data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/i
const SAFE_HREF_RE = /^(https?:\/\/[^'"()\s<>]+|\/[^'"()\s<>]*|#[^'"()\s<>]*|\.\/[^'"()\s<>]*|\.\.\/[^'"()\s<>]*)$/i
const SAFE_ID_RE = /^[A-Za-z0-9_\-:.]{1,128}$/

function cleanWallpaperUrl(v: unknown): string {
  if (typeof v !== 'string') return ''
  const s = v.trim().slice(0, 2048)
  if (!s) return ''
  return SAFE_WALLPAPER_RE.test(s) ? s : ''
}

/** 壁纸 URL 是否可安全用于 style backgroundImage（供渲染层复用） */
export function isSafeWallpaperUrl(v: unknown): boolean {
  if (typeof v !== 'string' || !v.trim()) return false
  return SAFE_WALLPAPER_RE.test(v.trim().slice(0, 2048))
}

/** 站点 href 是否可安全渲染（供表单/拖拽入口复用） */
export function isSafeSiteHref(v: unknown): boolean {
  if (typeof v !== 'string' || !v.trim()) return false
  return SAFE_HREF_RE.test(v.trim().slice(0, 2048))
}

function cleanSiteHref(v: unknown): string {
  if (typeof v !== 'string') return ''
  const s = v.trim().slice(0, 2048)
  if (!s) return ''
  return SAFE_HREF_RE.test(s) ? s : ''
}

/** 这些键即使能通过 SAFE_ID_RE，也绝不能当作普通 id 写进结果对象（否则改到原型链上） */
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isSafeIdKey(k: string): boolean {
  return !UNSAFE_OBJECT_KEYS.has(k) && SAFE_ID_RE.test(k)
}

/**
 * 清洗台账：白名单与上限本来就会吃掉内容，重点是「吃掉多少、为什么」必须能被调用方说出来。
 * 以前的实现只返回 {valid, config}，导入方于是只能写「已全量还原」——这是假话。
 */
export interface DropLedger {
  dropped: number
  notes: string[]
  claim(count: number, note: string): void
  note(text: string): void
}

function createDropLedger(): DropLedger {
  return {
    dropped: 0,
    notes: [],
    claim(count: number, note: string) {
      if (!(count > 0)) return
      this.dropped += count
      this.notes.push(note)
    },
    note(text: string) {
      this.notes.push(text)
    },
  }
}

function cleanIdList(v: unknown, ledger: DropLedger, label: string, max = 500): string[] {
  if (!Array.isArray(v)) return []
  const kept = v.filter((x): x is string => typeof x === 'string' && isSafeIdKey(x))
  const invalid = v.length - kept.length
  ledger.claim(invalid, `${label}：${invalid} 个 id 不在白名单，已丢弃`)
  const out = kept.slice(0, max)
  const overflow = kept.length - out.length
  ledger.claim(overflow, `${label}：超出 ${max} 个上限，截断 ${overflow} 个`)
  return out
}

function cleanOverrides(v: unknown, ledger: DropLedger, max = 500): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const entries = Object.entries(v as Record<string, unknown>)
  const out: Record<string, string> = {}
  for (const [k, val] of entries) {
    if (Object.keys(out).length >= max) break
    if (typeof val !== 'string') continue
    if (!isSafeIdKey(k) || !isSafeIdKey(val)) continue
    out[k] = val
  }
  const accepted = entries.filter(
    ([k, val]) => typeof val === 'string' && isSafeIdKey(k) && isSafeIdKey(val as string),
  ).length
  ledger.claim(entries.length - accepted, `站点分类重映射：${entries.length - accepted} 条键值不在白名单，已丢弃`)
  const overflow = Math.max(0, accepted - max)
  ledger.claim(overflow, `站点分类重映射：超出 ${max} 条上限，截断 ${overflow} 条`)
  return out
}

/**
 * 校验并清洗外部导入的 DIY 配置。
 *
 * 返回带台账：dropped = 被丢弃/截断的用户内容条数，notes = 逐条人话原因。
 * 导入方必须在界面里把这两项说出来，不许再宣称「全量还原」。
 */
export interface DIYSanitizeResult {
  valid: boolean
  config?: any
  error?: string
  dropped: number
  notes: string[]
}

export function validateAndCleanDIYConfig(raw: any): DIYSanitizeResult {
  const ledger = createDropLedger()
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: '导入的配置文件不是合法的 JSON 对象', dropped: 0, notes: ledger.notes }
  }

  if (typeof raw.viewMode !== 'string' && typeof raw.version !== 'number') {
    return { valid: false, error: '缺失必要的 DIY 配置元数据 (viewMode/version)', dropped: 0, notes: ledger.notes }
  }

  const validViewModes = ['hybrid', 'classic', 'workbench']
  const validCardModes = ['compact', 'standard', 'rich']
  const validCanvasBgs = ['mesh', 'dots', 'grid', 'aurora', 'clean']

  // 枚举回退不是「丢条目」，但用户选的模式被换掉了，同样得说
  if (typeof raw.viewMode === 'string' && !validViewModes.includes(raw.viewMode)) {
    ledger.note(`视图模式「${String(raw.viewMode).slice(0, 32)}」不在支持列表，已回退 hybrid`)
  }
  if (raw.cardDisplayMode != null && !validCardModes.includes(raw.cardDisplayMode)) {
    ledger.note(`卡片样式「${String(raw.cardDisplayMode).slice(0, 32)}」不在支持列表，已回退 standard`)
  }
  if (raw.canvasBackground != null && !validCanvasBgs.includes(raw.canvasBackground)) {
    ledger.note(`画布背景「${String(raw.canvasBackground).slice(0, 32)}」不在支持列表，已回退 mesh`)
  }

  const heroDeckWidgets = (() => {
    if (!Array.isArray(raw.heroDeckWidgets)) return ['quick-search', 'clock-pomodoro', 'favorites-dock', 'quick-tools']
    const kept = (raw.heroDeckWidgets as unknown[]).filter((w): w is string => typeof w === 'string' && isSafeIdKey(w))
    const invalid = raw.heroDeckWidgets.length - kept.length
    ledger.claim(invalid, `首屏小组件：${invalid} 个 id 不在白名单，已丢弃`)
    const out = kept.slice(0, 32)
    const overflow = kept.length - out.length
    ledger.claim(overflow, `首屏小组件：超出 32 个上限，截断 ${overflow} 个`)
    return out
  })()

  const pinnedSiteIdsByCategory = (() => {
    if (typeof raw.pinnedSiteIdsByCategory !== 'object' || raw.pinnedSiteIdsByCategory === null || Array.isArray(raw.pinnedSiteIdsByCategory)) return {}
    const entries = Object.entries(raw.pinnedSiteIdsByCategory as Record<string, unknown>)
    const out: Record<string, string[]> = {}
    let droppedIds = 0
    let skippedKeys = 0
    for (const [k, v] of entries) {
      if (!isSafeIdKey(k) || !Array.isArray(v)) {
        skippedKeys += 1
        continue
      }
      const kept = (v as unknown[]).filter((x): x is string => typeof x === 'string' && isSafeIdKey(x))
      droppedIds += v.length - kept.length
      const capped = kept.slice(0, 500)
      droppedIds += kept.length - capped.length
      out[k] = capped
    }
    ledger.claim(skippedKeys, `分类置顶：${skippedKeys} 个分类键非法，已丢弃`)
    ledger.claim(droppedIds, `分类置顶：${droppedIds} 个站点 id 非法或超出 500 上限，已丢弃`)
    return out
  })()

  const wallpaperRaw = (raw as any).customWallpaperUrl ?? (raw as any).wp
  const customWallpaperUrl = cleanWallpaperUrl(wallpaperRaw)
  if (!customWallpaperUrl && typeof wallpaperRaw === 'string' && wallpaperRaw.trim()) {
    ledger.claim(1, '自定义壁纸：地址不在 http/https/相对路径/data:image 白名单，已忽略')
  }

  const customCategories = Array.isArray(raw.customCategories)
    ? (() => {
        const list = raw.customCategories as any[]
        const kept = list.slice(0, 100)
        ledger.claim(list.length - kept.length, `自定义分类：超出 100 个上限，截断 ${list.length - kept.length} 个`)
        const usedIds = new Set<string>()
        return kept.map((c: any) => {
          const rawItems = Array.isArray(c?.items) ? (c.items as any[]) : []
          let unsafeItems = 0
          const mapped = rawItems
            .map((i: any) => {
              const href = cleanSiteHref(i?.href)
              // 非法 href 直接丢弃该站点（不收录 javascript:/data:text/html 等）
              if (!href) {
                unsafeItems += 1
                return null
              }
              return {
                id: i && isSafeIdKey(String(i.id || '')) ? String(i.id) : `item_${Date.now()}`,
                title: String(i.title || '').slice(0, 128),
                href,
                icon: i.icon ? String(i.icon).slice(0, 512) : undefined,
                description: i.description ? String(i.description).slice(0, 512) : undefined,
              }
            })
            .filter(Boolean)
          ledger.claim(unsafeItems, `自定义分类站点：${unsafeItems} 条链接协议不安全，已丢弃`)
          const capped = mapped.slice(0, 500)
          ledger.claim(mapped.length - capped.length, `自定义分类站点：单个分类超出 500 条上限，截断 ${mapped.length - capped.length} 条`)
          const rawId = c && isSafeIdKey(String(c.id || '')) ? String(c.id) : ''
          const fallbackId = `custom_${Date.now()}_${usedIds.size}`
          const id = rawId && !usedIds.has(rawId) ? rawId : fallbackId
          usedIds.add(id)
          return {
            id,
            title: String(c?.title || '自定义分类').slice(0, 64),
            icon: String(c?.icon || 'FolderHeart').slice(0, 64),
            items: capped,
            createdAt: Number(c?.createdAt) || Date.now(),
          }
        })
      })()
    : []

  const cleaned = {
    version: 3,
    viewMode: validViewModes.includes(raw.viewMode) ? raw.viewMode : 'hybrid',
    cardDisplayMode: validCardModes.includes(raw.cardDisplayMode) ? raw.cardDisplayMode : 'standard',
    canvasBackground: validCanvasBgs.includes(raw.canvasBackground) ? raw.canvasBackground : 'mesh',
    accentColor: typeof raw.accentColor === 'string' ? raw.accentColor : 'default',
    heroDeckCollapsed: Boolean(raw.heroDeckCollapsed),
    heroDeckWidgets,
    enableAdaptiveRanking: Boolean(raw.enableAdaptiveRanking),
    enableTemporalRanking: Boolean(raw.enableTemporalRanking),
    enableKeyboardNav: raw.enableKeyboardNav !== false,
    categoryOrder: cleanIdList(raw.categoryOrder, ledger, '分类顺序'),
    pinnedCategoryIds: cleanIdList(raw.pinnedCategoryIds, ledger, '置顶分类'),
    hiddenCategoryIds: cleanIdList(raw.hiddenCategoryIds, ledger, '隐藏分类'),
    collapsedCategoryIds: cleanIdList(raw.collapsedCategoryIds, ledger, '折叠分类'),
    pinnedSiteIdsByCategory,
    // 跨分类重映射：键值均为内部 id，白名单外直接丢弃（防原型污染与非法注入）
    siteCategoryOverrides: cleanOverrides((raw as any).siteCategoryOverrides, ledger),
    // 自定义壁纸：仅 http/https、/ 开头相对路径、data:image/(png|jpeg|webp);base64,，否则置空不渲染
    customWallpaperUrl,
    glassmorphismBlur: typeof raw.glassmorphismBlur === 'number' || typeof (raw as any).gb === 'number'
      ? Math.min(30, Math.max(0, Number(typeof raw.glassmorphismBlur === 'number' ? raw.glassmorphismBlur : (raw as any).gb)))
      : 12,
    cardOpacity: typeof raw.cardOpacity === 'number' || typeof (raw as any).co_op === 'number'
      ? Math.min(1, Math.max(0.2, Number(typeof raw.cardOpacity === 'number' ? raw.cardOpacity : (raw as any).co_op)))
      : 0.9,
    customCategories,
    updatedAt: Date.now(),
  }

  return { valid: true, config: cleaned, dropped: ledger.dropped, notes: ledger.notes }
}

// =========================================================================
// 11. 撤销/重做时间旅行栈算法 (Time-Travel Undo/Redo Engine)
// =========================================================================

export interface LayoutHistoryState<T> {
  past: T[]
  present: T
  future: T[]
}

export function createLayoutHistory<T>(initial: T): LayoutHistoryState<T> {
  return {
    past: [],
    present: initial,
    future: [],
  }
}

export function pushLayoutHistory<T>(
  history: LayoutHistoryState<T>,
  nextState: T,
  maxDepth = 25
): LayoutHistoryState<T> {
  if (JSON.stringify(history.present) === JSON.stringify(nextState)) {
    return history
  }

  const newPast = [...history.past, history.present]
  if (newPast.length > maxDepth) {
    newPast.shift()
  }

  return {
    past: newPast,
    present: nextState,
    future: [],
  }
}

export function undoLayoutHistory<T>(history: LayoutHistoryState<T>): LayoutHistoryState<T> {
  if (history.past.length === 0) return history

  const previous = history.past[history.past.length - 1]!
  const newPast = history.past.slice(0, -1)

  return {
    past: newPast,
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redoLayoutHistory<T>(history: LayoutHistoryState<T>): LayoutHistoryState<T> {
  if (history.future.length === 0) return history

  const next = history.future[0]!
  const newFuture = history.future.slice(1)

  return {
    past: [...history.past, history.present],
    present: next,
    future: newFuture,
  }
}

// =========================================================================
// 12. 分类手风琴折叠状态与手风琴算法 (Accordion Collapse Algorithms)
// =========================================================================

export function toggleCollapsedCategory(collapsedIds: string[], id: string): string[] {
  if (collapsedIds.includes(id)) {
    return collapsedIds.filter((item) => item !== id)
  }
  return [...collapsedIds, id]
}

export function collapseAllCategories(allCategoryIds: string[]): string[] {
  return Array.from(new Set(allCategoryIds))
}

export function expandAllCategories(): string[] {
  return []
}
