'use client'
/**
 * 收藏同步状态徽标（2026-11-21）。
 *
 * 六态胶囊，高度 24px（h-6），放在 /favorites 标题右侧。
 * 设计原则：常态克制低饱和，仅冲突/失败态提亮；宽度用 tabular-nums + transition
 * 平滑，避免「本地已存」→「同步中...」时把旁边按钮推着跳。
 *
 * 所有视觉与文案都来自 lib/favorites-sync 的纯函数——
 * 组件不含状态判断逻辑，保证与卡片微点、冲突抽屉共享同一份真相。
 */
import { AlertTriangle, Check, CloudOff, Lock, RefreshCw } from 'lucide-react'
import {
  badgeLabel,
  badgeVisual,
  describeSyncError,
  type SyncEngineSnapshot,
} from '@/lib/favorites-sync'

export interface FavoritesSyncBadgeProps {
  snapshot: SyncEngineSnapshot
  onLogin?: () => void
  onOpenConflicts?: () => void
  onRetry?: () => void
  onRelogin?: () => void
  onExportSnapshot?: () => void
}

export function FavoritesSyncBadge({
  snapshot,
  onLogin,
  onOpenConflicts,
  onRetry,
  onRelogin,
  onExportSnapshot,
}: FavoritesSyncBadgeProps) {
  const { badgeState, pendingCount, conflicts, error } = snapshot
  const vis = badgeVisual(badgeState)
  const label = badgeLabel(badgeState, pendingCount, conflicts.length)

  const Icon =
    badgeState === 'local_only'
      ? Lock
      : badgeState === 'syncing'
        ? RefreshCw
        : badgeState === 'conflict' || badgeState === 'error'
          ? AlertTriangle
          : badgeState === 'local_saved'
            ? CloudOff
            : Check

  const handleClick = () => {
    if (badgeState === 'local_only' && onLogin) return onLogin()
    if (badgeState === 'conflict' && onOpenConflicts) return onOpenConflicts()
    if (badgeState === 'error') {
      if (error?.kind === 'auth_expired' && onRelogin) return onRelogin()
      if (error && describeSyncError(error.kind, snapshot.isOnline).action === 'export_snapshot') {
        return onExportSnapshot?.()
      }
      return onRetry?.()
    }
    if (badgeState === 'local_saved' && snapshot.isOnline && onRetry) return onRetry()
  }

  const isClickable =
    (badgeState === 'local_only' && Boolean(onLogin)) ||
    (badgeState === 'conflict' && Boolean(onOpenConflicts)) ||
    (badgeState === 'error' && Boolean(onRetry ?? onRelogin ?? onExportSnapshot)) ||
    (badgeState === 'local_saved' && snapshot.isOnline && Boolean(onRetry))

  const content = (
    <>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${vis.dot}`} aria-hidden />
      <Icon
        className={`h-3 w-3 shrink-0 ${badgeState === 'syncing' ? 'animate-spin' : ''}`}
        aria-hidden
      />
      <span className="tabular-nums transition-all duration-200">{label}</span>
    </>
  )

  const cls = `inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11px] transition-colors ${vis.container} ${
    isClickable
      ? 'cursor-pointer hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      : ''
  }`

  return isClickable ? (
    <button type="button" onClick={handleClick} className={cls} aria-live="polite">
      {content}
    </button>
  ) : (
    <span className={cls} aria-live="polite">
      {content}
    </span>
  )
}
