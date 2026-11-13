'use client'

/**
 * 重温条目行（/brief 今日重温岛与 /favorites/stale 共用）。
 *
 * 一行只做三件事：一键重开（新标签打开，并记一次本机打开时间，
 * 让它从「好久没打开」里消失）、归档、删除。重开是主行动——
 * 整个功能的意义就是「点一下就回到那个收藏」，所以标题本身就是链接，
 * 不再另设一个「打开」按钮。
 */

import { Archive, Trash2 } from 'lucide-react'
import { safeHref } from '@/lib/safe-url'
import { describeResurfaced, staleBadgeLabel, type ResurfacedFavorite } from '@/lib/resurface'
import { SiteFavicon } from '@/components/site-favicon'

export interface ResurfaceRowProps {
  item: ResurfacedFavorite
  /** 点标题重开时触发：调用方记一次打开时间（recordOpened），再放行默认跳转 */
  onReopen: (siteId: string) => void
  /** 归档：调用方把条目移进归档柜并从活跃收藏移除 */
  onArchive: (item: ResurfacedFavorite) => void
  /** 删除：仅在分拣视图（/favorites/stale）出现，简报岛不放删数据的按钮 */
  onDelete?: (item: ResurfacedFavorite) => void
}

export function ResurfaceRow({ item, onReopen, onArchive, onDelete }: ResurfaceRowProps) {
  return (
    <li className="flex items-start gap-3 rounded-xl border bg-card p-3">
      <div className="h-10 w-10 shrink-0 rounded-lg border border-border/50 bg-muted/50 p-1.5">
        <SiteFavicon title={item.title} url={item.href} icon={item.icon} className="h-full w-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        <a
          href={safeHref(item.href)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onReopen(item.siteId)}
          className="block truncate text-sm font-semibold hover:text-primary"
        >
          {item.title}
        </a>
        {item.description ? (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.description}</p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground" title={describeResurfaced(item)}>
          <span className="mr-1.5 inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            {staleBadgeLabel(item.daysSinceOpen)}
          </span>
          {describeResurfaced(item)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
        <button
          type="button"
          onClick={() => onArchive(item)}
          aria-label={`归档 ${item.title}`}
          title="归档（从收藏移走，可恢复）"
          className="inline-flex min-h-11 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <Archive className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">归档</span>
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={() => onDelete(item)}
            aria-label={`删除 ${item.title}`}
            title="删除收藏"
            className="inline-flex min-h-11 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-destructive-text"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">删除</span>
          </button>
        ) : null}
      </div>
    </li>
  )
}
