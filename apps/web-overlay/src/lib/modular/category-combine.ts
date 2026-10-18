/**
 * 分类合并与排序（纯函数，可单测）。
 *
 * 从 `navigation-content.tsx` 抽出两段 useMemo：
 *  1. `customCategoriesToNavigation`：用户自建分类 → 导航树的形状
 *  2. `combineAndSortCategories`：自建分类 + 上游导航 → 归类重映射 →
 *     隐藏过滤 → 置顶/手工排序
 *
 * 原来这段逻辑内联在组件里约 90 行，含「跨分类归类重映射」这类容易写错的
 * 双阶段 map；抽成纯函数后可用普通数据直接验证。
 */

/** 自建分类（来自 use-home-diy 的 localStorage 结构） */
export interface CustomCategoryLike {
  id: string
  title: string
  icon?: string
  items?: Array<{
    id: string
    title: string
    href: string
    icon?: string
    description?: string
  }>
}

/** 导航树节点（上游分类 / 自建分类统一后的最小形状） */
export interface CategoryNode {
  id: string
  title: string
  icon?: string
  isCustom?: boolean
  items: unknown[]
  subCategories: unknown[]
}

/** 用户自建分类 → 导航分类形状 */
export function customCategoriesToNavigation(custom: CustomCategoryLike[]): CategoryNode[] {
  return custom.map((c) => ({
    id: c.id,
    title: c.title,
    icon: c.icon,
    isCustom: true,
    items: (c.items || []).map((i) => ({
      id: i.id,
      title: i.title,
      href: i.href,
      icon: i.icon,
      description: i.description,
    })),
    subCategories: [],
  }))
}

export interface CombineArgs {
  /** 自建分类（已转成导航形状） */
  custom: CategoryNode[]
  /** 上游导航分类 */
  navigation: CategoryNode[]
  /** 站点 → 分类的归类重映射（用户在卡片上「移动到」后的覆盖） */
  siteCategoryOverrides?: Record<string, string>
  /** 被隐藏的分类 id */
  hiddenCategoryIds?: string[]
  /** 置顶的分类 id */
  pinnedCategoryIds?: string[]
  /** 手工排序结果（分类 id 数组） */
  categoryOrder?: string[]
}

export interface CategoryView {
  /** 全部分类 id（含隐藏，供计数/统计用） */
  allCategoryIds: string[]
  /** id → 标题 */
  categoryTitleMap: Record<string, string>
  /** 最终渲染顺序的分类 */
  sortedCategories: CategoryNode[]
}

/**
 * 合并 + 归类重映射 + 隐藏过滤 + 排序。
 *
 * 归类重映射是双阶段 map：先把「被移走的项」从原分类摘下并计入目标分类，
 * 再把收到的项并回目标分类。单阶段 map 会漏掉后面才处理的分类。
 */
export function combineAndSortCategories(args: CombineArgs): CategoryView {
  const {
    custom,
    navigation,
    siteCategoryOverrides,
    hiddenCategoryIds = [],
    pinnedCategoryIds = [],
    categoryOrder = [],
  } = args

  const combined: CategoryNode[] = [...custom, ...navigation]

  const categoryTitleMap: Record<string, string> = {}
  const allCategoryIds: string[] = []
  for (const cat of combined) {
    categoryTitleMap[cat.id] = cat.title
    allCategoryIds.push(cat.id)
  }

  // 1. 跨分类归类重映射
  let processedCombined = combined
  if (siteCategoryOverrides && Object.keys(siteCategoryOverrides).length > 0) {
    const movedMap: Record<string, unknown[]> = {}
    processedCombined = combined.map((cat) => {
      const catItems = Array.isArray(cat.items) ? (cat.items as unknown[]) : []
      const remaining = catItems.filter((item) => {
        const targetId = siteCategoryOverrides[(item as { id: string }).id]
        if (targetId && targetId !== cat.id) {
          if (!movedMap[targetId]) movedMap[targetId] = []
          movedMap[targetId]!.push(item)
          return false
        }
        return true
      })
      return { ...cat, items: remaining }
    }).map((cat) => {
      const incoming = movedMap[cat.id] || []
      const currentItems = Array.isArray(cat.items) ? (cat.items as unknown[]) : []
      return incoming.length > 0 ? { ...cat, items: [...currentItems, ...incoming] } : cat
    })
  }

  // 2. 隐藏过滤
  const visible = processedCombined.filter((c) => !hiddenCategoryIds.includes(c.id))

  // 3. 排序：置顶分类优先，其余按 categoryOrder，其次保留原序
  const sorted = [...visible].sort((a, b) => {
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

  return { allCategoryIds, categoryTitleMap, sortedCategories: sorted }
}
