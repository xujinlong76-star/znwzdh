/**
 * 视频列表的游标分页（纯函数，零依赖）。
 *
 * 单独成文件而不是放在 route 里：route 会 import `next/server`，
 * 任何想在单测里验证分页语义的人都会被 Next 的运行时依赖拖下水
 * （实测 `next-auth` 的 `next/server` 子路径在 vitest 下解析失败）。
 */
import type { NavigationItem, NavigationSubItem } from '@/types/navigation'

/**
 * 游标分页：`offset` 在「边翻页边有新条目写入」时会导致重复/漏项
 * （插入一条，后面所有页整体后移一格）。游标锚在「最后一条的排序键」上，
 * 插入不影响已翻过的页。
 *
 * 排序键：`harvestedAt`（缺失按 0）降序，同值时按 id 升序兜底——必须有
 * 全序，否则同分数的条目在两次请求间可能换位。
 */
export interface VideoCursor {
  harvestedAt: number
  id: string
}

export function encodeVideoCursor(cursor: VideoCursor): string {
  return Buffer.from(`${cursor.harvestedAt}:${cursor.id}`, 'utf8').toString('base64url')
}

export function decodeVideoCursor(raw: string | null): VideoCursor | null {
  if (!raw) return null
  try {
    const text = Buffer.from(raw, 'base64url').toString('utf8')
    const sep = text.indexOf(':')
    if (sep < 0) return null
    const harvestedAt = Number(text.slice(0, sep))
    const id = text.slice(sep + 1)
    if (!Number.isFinite(harvestedAt) || !id) return null
    return { harvestedAt, id }
  } catch {
    return null
  }
}

/** 按游标取下一页；返回 nextCursor（null = 没有更多） */
export function pageCategoryByCursor(
  cat: NavigationItem,
  cursor: VideoCursor | null,
  limit: number,
): { category: NavigationItem; nextCursor: VideoCursor | null } {
  const sortKey = (item: NavigationSubItem) => item.videoConfig?.harvestedAt ?? 0
  const sorted = [...(cat.items || [])].sort((a, b) => {
    const diff = sortKey(b) - sortKey(a)
    return diff !== 0 ? diff : a.id.localeCompare(b.id)
  })

  const start = cursor
    ? sorted.findIndex(item => {
        const key = sortKey(item)
        return key < cursor.harvestedAt || (key === cursor.harvestedAt && item.id > cursor.id)
      })
    : 0
  const from = start < 0 ? sorted.length : start
  const slice = sorted.slice(from, from + limit)
  const last = slice[slice.length - 1]
  const hasMore = from + limit < sorted.length
  return {
    category: { ...cat, items: slice },
    nextCursor: hasMore && last ? { harvestedAt: sortKey(last), id: last.id } : null,
  }
}
