'use client'
/**
 * 收藏卡片的同步微点（2026-11-21）。
 *
 * 反打扰原则：不要因为 1 条收藏冲突就锁死整个 /favorites 页面。
 * 正常的收藏依然可照常搜索、点击、编辑——只在卡片右上角显示一颗 6px 微点：
 *   待同步 → 蓝灰点（Tooltip：已存本机，待同步）
 *   冲突   → 琥珀点 + 浅琥珀细边框，点击可定位到抽屉里的对应冲突项
 *
 * 判定走 cardSyncDot()，与 Header 徽标共享同一份 SyncEngineSnapshot，
 * 保证「顶部说已同步、卡片还挂红点」这类 UI 撕裂不会发生。
 */
import { cardConflictRing, cardDotClass, cardSyncDot, type SyncEngineSnapshot } from '@/lib/favorites-sync'

export interface FavoriteSyncDotProps {
  snapshot: Pick<SyncEngineSnapshot, 'dirtyItemIds' | 'conflictItemIds'>
  itemId: string
  /** 冲突态点击：定位到抽屉里的对应项 */
  onLocateConflict?: (itemId: string) => void
  className?: string
}

export function FavoriteSyncDot({ snapshot, itemId, onLocateConflict, className = '' }: FavoriteSyncDotProps) {
  const dot = cardSyncDot(snapshot, itemId)
  if (dot === 'none') return null

  const title = dot === 'conflict' ? '存在冲突，点击查看' : '已存本机，待同步'
  const base = `h-1.5 w-1.5 shrink-0 rounded-full ${cardDotClass(dot)} ${className}`

  if (dot === 'conflict' && onLocateConflict) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          onLocateConflict(itemId)
        }}
        title={title}
        aria-label={title}
        className={`${base} cursor-pointer ring-1 ring-amber-500/40 transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      />
    )
  }

  return <span className={base} title={title} aria-label={title} role="status" />
}

/** 冲突卡片的外框强调（浅琥珀细边框，让问题条目在列表里可扫到） */
export function favoriteSyncRing(snapshot: Pick<SyncEngineSnapshot, 'conflictItemIds'>, itemId: string): string {
  return cardConflictRing(snapshot.conflictItemIds.has(itemId) ? 'conflict' : 'none')
}
