/**
 * 分类拓扑编排、置顶与隐藏算法 (Topology & Pinning)。
 *
 * 纯函数：输入分类数组/ID 列表，输出新的顺序或新的置顶/隐藏集合，
 * 全程不修改入参（排序前先浅拷贝）。
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
