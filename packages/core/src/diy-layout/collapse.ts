/**
 * 分类手风琴折叠状态算法 (Accordion Collapse)。
 */

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
