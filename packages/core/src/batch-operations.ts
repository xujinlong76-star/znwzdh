/**
 * 多选批量操作纯算法引擎 (Multi-Selection Batch Operations Engine)
 * 纯算法实现，0 DOM 依赖，跨 Node.js 和浏览器通用。
 *
 * 支持功能：
 * 1. 批量分类内卡片置顶 / 取消置顶
 * 2. 批量移动卡片至目标自定义分类
 * 3. 批量删除选中卡片
 * 4. 批量导出选中卡片为 Markdown 链接列表
 * 5. 批量导出选中卡片为 OneTab 格式纯文本
 */

export interface BatchSiteItem {
  id: string
  title: string
  href: string
  description?: string
  icon?: string
}

export interface BatchCategoryHolder {
  id: string
  title: string
  items: BatchSiteItem[]
}

/**
 * 1. 批量设置分类内站点的置顶状态
 */
export function batchSetPinnedSitesInCategory(
  pinnedMap: Record<string, string[]>,
  categoryId: string,
  siteIds: string[],
  action: 'pin' | 'unpin' | 'toggle'
): Record<string, string[]> {
  const currentPinned = [...(pinnedMap[categoryId] || [])]
  const targetIds = Array.from(new Set(siteIds.filter(Boolean)))

  let nextPinned: string[]

  if (action === 'pin') {
    // 保持已置顶的原序，把未置顶的追加或前置
    const newItems = targetIds.filter((id) => !currentPinned.includes(id))
    nextPinned = [...currentPinned, ...newItems]
  } else if (action === 'unpin') {
    nextPinned = currentPinned.filter((id) => !targetIds.includes(id))
  } else {
    // toggle：如果全在里面则全取消，否则全置顶
    const allPinned = targetIds.every((id) => currentPinned.includes(id))
    if (allPinned) {
      nextPinned = currentPinned.filter((id) => !targetIds.includes(id))
    } else {
      const newItems = targetIds.filter((id) => !currentPinned.includes(id))
      nextPinned = [...currentPinned, ...newItems]
    }
  }

  return {
    ...pinnedMap,
    [categoryId]: nextPinned,
  }
}

/**
 * 2. 批量将卡片从多个自建分类移入目标分类
 */
export function batchMoveSitesBetweenCustomCategories<T extends BatchCategoryHolder>(
  categories: T[],
  siteIds: string[],
  targetCategoryId: string
): {
  categories: T[]
  movedCount: number
} {
  const targetIdSet = new Set(siteIds)
  const movedItems: BatchSiteItem[] = []

  // 1. 搜集并从原分类移出
  const filteredCats = categories.map((cat) => {
    if (cat.id === targetCategoryId) return cat // 目标分类稍后统一注入
    const remaining: BatchSiteItem[] = []
    for (const item of cat.items) {
      if (targetIdSet.has(item.id)) {
        movedItems.push(item)
      } else {
        remaining.push(item)
      }
    }
    return {
      ...cat,
      items: remaining,
    }
  })

  if (movedItems.length === 0) {
    return { categories, movedCount: 0 }
  }

  // 2. 注入目标分类 (防重)
  const finalCats = filteredCats.map((cat) => {
    if (cat.id !== targetCategoryId) return cat
    const existingIds = new Set(cat.items.map((i) => i.id))
    const existingHrefs = new Set(cat.items.map((i) => i.href))

    const newToAdd: BatchSiteItem[] = []
    for (const item of movedItems) {
      if (!existingIds.has(item.id) && !existingHrefs.has(item.href)) {
        newToAdd.push(item)
      }
    }

    return {
      ...cat,
      items: [...cat.items, ...newToAdd],
    }
  })

  return {
    categories: finalCats as T[],
    movedCount: movedItems.length,
  }
}

/**
 * 3. 批量从自建分类中删除选定卡片
 */
export function batchDeleteSitesFromCustomCategories<T extends BatchCategoryHolder>(
  categories: T[],
  siteIds: string[]
): {
  categories: T[]
  deletedCount: number
} {
  const targetIdSet = new Set(siteIds)
  let deletedCount = 0

  const nextCats = categories.map((cat) => {
    const remaining: BatchSiteItem[] = []
    for (const item of cat.items) {
      if (targetIdSet.has(item.id)) {
        deletedCount++
      } else {
        remaining.push(item)
      }
    }
    return {
      ...cat,
      items: remaining,
    }
  })

  return {
    categories: nextCats as T[],
    deletedCount,
  }
}

/**
 * 4. 批量导出所选卡片为标准 Markdown 链接列表
 */
export function batchExportSitesToMarkdown(
  sites: BatchSiteItem[],
  options: { categoryTitle?: string } = {}
): string {
  const { categoryTitle = '选中的书签合集' } = options
  const lines: string[] = [`# ${categoryTitle}`, '']

  for (const site of sites) {
    const desc = site.description ? ` - ${site.description.replace(/\r?\n/g, ' ')}` : ''
    lines.push(`- [${site.title}](${site.href})${desc}`)
  }

  return lines.join('\n')
}

/**
 * 5. 批量导出所选卡片为 OneTab 格式纯文本
 */
export function batchExportSitesToOneTab(sites: BatchSiteItem[]): string {
  return sites
    .map((s) => `${s.href} | ${s.title}`)
    .join('\n')
}
