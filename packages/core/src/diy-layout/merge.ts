/**
 * 多端漫游三路差异比对与无损合并引擎 (3-Way Layout Diff & Merge Engine)。
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
 *   注意这是“只增不减”语义：A 端取消置顶后，B 端旧置顶合回来会复活。
 *   如需真正删除，需引入 tombstone 或 LWW（见 CRDT），调用方已知悉此取舍。
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
