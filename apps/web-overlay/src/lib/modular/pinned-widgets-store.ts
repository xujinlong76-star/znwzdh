'use client'

/**
 * 桌面角落固定微件存储（A3）：
 * 用户可从「🧩 小组件盒」中把最多 2 个常用微件钉在首页角落（可折叠为 36px 迷你条），
 * 存储键持久化在本机 localStorage，并由懒加载组件按需挂载（0 首屏体积）。
 */
import { useEffect, useState } from 'react'

export type WidgetType = string

export const PINNED_WIDGETS_STORAGE_KEY = 'navhub.pinnedCornerWidgets.v1'
export const PINNED_WIDGETS_EVENT = 'navhub:pinned-widgets-changed'
export const MAX_PINNED_CORNER_WIDGETS = 2

export interface PinnedCornerWidget {
  type: WidgetType
  collapsed: boolean
}

export interface KeyValueStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const KNOWN_WIDGET_TYPES = new Set<string>([
  'clock-pomodoro',
  'weather-clock',
  'markdown-notes',
  'speculative-terminal',
  'favorites-dock',
  'quick-search',
  'quick-tools',
  'trending-radar',
  'hyperbolic-radar',
  'system-metrics',
  'github-heatmap',
])

export function parsePinnedWidgets(raw: string | null): PinnedCornerWidget[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const result: PinnedCornerWidget[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const candidate = item as { type?: unknown; collapsed?: unknown }
      if (typeof candidate.type !== 'string' || !KNOWN_WIDGET_TYPES.has(candidate.type)) continue
      if (seen.has(candidate.type)) continue
      seen.add(candidate.type)
      result.push({
        type: candidate.type as WidgetType,
        collapsed: Boolean(candidate.collapsed),
      })
      if (result.length >= MAX_PINNED_CORNER_WIDGETS) break
    }
    return result
  } catch {
    // 损坏的旧快照安全回退为空数组，不阻断页面启动
    return []
  }
}

export function applyPinCornerWidget(
  current: PinnedCornerWidget[],
  type: WidgetType,
  maxItems = MAX_PINNED_CORNER_WIDGETS,
): PinnedCornerWidget[] {
  const existing = current.find((item) => item.type === type)
  if (existing) {
    return current.filter((item) => item.type !== type)
  }
  const next: PinnedCornerWidget[] = [...current, { type, collapsed: false }]
  return next.slice(-Math.max(1, maxItems))
}

export function applyTogglePinnedCollapse(
  current: PinnedCornerWidget[],
  type: WidgetType,
): PinnedCornerWidget[] {
  return current.map((item) =>
    item.type === type ? { ...item, collapsed: !item.collapsed } : item,
  )
}

export function loadPinnedCornerWidgets(storage?: KeyValueStorageLike): PinnedCornerWidget[] {
  const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
  if (!target) return []
  try {
    return parsePinnedWidgets(target.getItem(PINNED_WIDGETS_STORAGE_KEY))
  } catch {
    // 无痕或存储禁用时返回空列表
    return []
  }
}

export function savePinnedCornerWidgets(
  items: PinnedCornerWidget[],
  storage?: KeyValueStorageLike,
): PinnedCornerWidget[] {
  const normalized = items.slice(-MAX_PINNED_CORNER_WIDGETS)
  const target = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined)
  if (target) {
    try {
      target.setItem(PINNED_WIDGETS_STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      // 存储配额满时仅保留内存与本次会话反馈
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PINNED_WIDGETS_EVENT, { detail: normalized }))
  }
  return normalized
}

export function togglePinCornerWidget(type: WidgetType): PinnedCornerWidget[] {
  const next = applyPinCornerWidget(loadPinnedCornerWidgets(), type)
  return savePinnedCornerWidgets(next)
}

export function toggleCollapseCornerWidget(type: WidgetType): PinnedCornerWidget[] {
  const next = applyTogglePinnedCollapse(loadPinnedCornerWidgets(), type)
  return savePinnedCornerWidgets(next)
}

export function usePinnedCornerWidgets(): {
  mounted: boolean
  pinned: PinnedCornerWidget[]
  togglePin: (type: WidgetType) => void
  toggleCollapse: (type: WidgetType) => void
  unpin: (type: WidgetType) => void
} {
  const [mounted, setMounted] = useState(false)
  const [pinned, setPinned] = useState<PinnedCornerWidget[]>([])

  useEffect(() => {
    setMounted(true)
    setPinned(loadPinnedCornerWidgets())
    const handleSync = (event: Event) => {
      const detail = (event as CustomEvent<PinnedCornerWidget[]>).detail
      setPinned(Array.isArray(detail) ? detail : loadPinnedCornerWidgets())
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PINNED_WIDGETS_STORAGE_KEY) {
        setPinned(loadPinnedCornerWidgets())
      }
    }
    window.addEventListener(PINNED_WIDGETS_EVENT, handleSync)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(PINNED_WIDGETS_EVENT, handleSync)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  return {
    mounted,
    pinned,
    togglePin: (type: WidgetType) => {
      setPinned(togglePinCornerWidget(type))
    },
    toggleCollapse: (type: WidgetType) => {
      setPinned(toggleCollapseCornerWidget(type))
    },
    unpin: (type: WidgetType) => {
      const next = loadPinnedCornerWidgets().filter((item) => item.type !== type)
      setPinned(savePinnedCornerWidgets(next))
    },
  }
}
