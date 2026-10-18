'use client'

/**
 * 多选批量操作的选中态（可从组件拆出的全部选择逻辑）。
 *
 * 从 `navigation-content.tsx` 抽出：原来「可见站点收集 → 选中剪枝 →
 * 多选开关 → 单选切换 → 全选」五段逻辑混在 1225 行的组件里，
 * 组件只负责把 hook 返回值接到卡片与操作坞上。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  clearSelected,
  pickSelectedSites,
  pruneSelected,
  selectAllIds,
  toggleSelected,
} from '@/lib/selection'
import type { BatchSiteItem } from '@/lib/batch-operations'

/** 最小分类形状：能遍历出 items / subCategories 即可 */
export interface SelectionCategoryLike {
  id: string
  items?: unknown[]
  subCategories?: Array<{ items?: unknown[] }>
}

function toSite(raw: unknown): BatchSiteItem | null {
  const item = raw as { id?: string; title?: string; href?: string; description?: string; icon?: string }
  if (!item?.id || !item.href) return null
  return {
    id: item.id,
    title: item.title as string,
    href: item.href,
    description: item.description,
    icon: item.icon,
  }
}

export function useSiteSelection(
  sortedCategories: SelectionCategoryLike[],
  collapsedCategoryIds: string[],
) {
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  /** 当前**真实可见**的站点（跳过已折叠分类、按 id 去重）：全选与选中剪枝都以它为准 */
  const visibleSites = useMemo(() => {
    const seen = new Set<string>()
    const out: BatchSiteItem[] = []
    for (const category of sortedCategories) {
      if (collapsedCategoryIds.includes(category.id)) continue
      for (const item of (category.items as unknown[]) || []) {
        const site = toSite(item)
        if (!site || seen.has(site.id)) continue
        seen.add(site.id)
        out.push(site)
      }
      for (const sub of category.subCategories || []) {
        for (const item of (sub.items as unknown[]) || []) {
          const site = toSite(item)
          if (!site || seen.has(site.id)) continue
          seen.add(site.id)
          out.push(site)
        }
      }
    }
    return out
  }, [sortedCategories, collapsedCategoryIds])

  /** 选中的站点数据（顺序 = 用户选择的先后），交给批量操作坞 */
  const selectedSites = useMemo(
    () => pickSelectedSites(selectedIds, visibleSites),
    [selectedIds, visibleSites],
  )

  /** 列表变化（切换工作台 / 折叠分类 / 隐藏分类）后，丢掉已经看不见的选中项 */
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = pruneSelected(prev, visibleSites.map((s) => s.id))
      return next.length === prev.length ? prev : next
    })
  }, [visibleSites])

  /** 清空选中（退出多选 / 批量完成后由组件调用——组件不再需要接触原始 setter） */
  const clearSelection = () => {
    setSelectedIds(clearSelected())
  }

  const toggleSelectMode = () => {
    if (selectionMode) clearSelection()
    setSelectionMode(!selectionMode)
  }

  const toggleSelectOne = (siteId: string) => {
    setSelectedIds((prev) => toggleSelected(prev, siteId))
  }

  const selectAllVisible = () => {
    setSelectedIds(selectAllIds(visibleSites.map((s) => s.id)))
  }

  return {
    selectionMode,
    selectedIds,
    selectedSites,
    visibleSites,
    clearSelection,
    toggleSelectMode,
    toggleSelectOne,
    selectAllVisible,
  }
}
