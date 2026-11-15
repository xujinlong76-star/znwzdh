'use client'

/**
 * 冬眠行（收藏页底部冬眠区专用）。
 *
 * 复用 TriageInboxRow 的结构：一行只做「打开 + 唤醒」——标题本身就是链接
 * （点开即唤醒：调用方记一次本机打开 + 移出手动冬眠集合，再放行默认跳转），
 * 其余是一个唤醒按钮。按钮 44px 触达（min-h-11），与 TriageInboxRow 同款。
 *
 * 冬眠区用紧凑行而不用收藏卡片：冬眠是长尾清单，扫一眼标题就能判断，
 * 卡片的操作区（备注 / 标签 / 快捷链接 / 移夹）在冬眠区用不上；想改备注
 * 回正常列表改，唤醒后卡片就回来了。
 *
 * 文案铁律：只写本机记录（「收藏 N 天了，本机没记录到打开」），
 * 不写「你忘了 / 你没看」。
 */

import { Moon, Sun } from 'lucide-react'
import { safeHref } from '@/lib/safe-url'
import { hibernationBadgeLabel } from '@/lib/favorites-hibernation'
import type { LocalFavorite } from '@/hooks/useFavorites'
import { SiteFavicon } from '@/components/site-favicon'

export interface HibernationRowProps {
  item: LocalFavorite
  /** 'manual' = 用户手动冬眠（徽标不带天数）；'auto' = 超过阈值自动冬眠 */
  reason: 'manual' | 'auto'
  /** 距上次记录到的打开（或收藏当天）的天数（按本机记录算） */
  daysSinceOpen: number
  /** 诚实说明（调用方用 describeHibernation 算好）：手动 / 自动两种措辞 */
  description: string
  /** 点标题打开时触发：调用方唤醒（记一次打开），再放行默认跳转 */
  onReopen: (siteId: string) => void
  /** 点「唤醒」按钮时触发：调用方唤醒（记一次打开），条目回到正常列表 */
  onWake: (siteId: string) => void
}

export function HibernationRow({ item, reason, daysSinceOpen, description, onReopen, onWake }: HibernationRowProps) {
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
        <p className="mt-1 text-xs text-muted-foreground" title={description}>
          <span className="mr-1.5 inline-flex rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-400">
            <Moon className="mr-1 h-3 w-3" aria-hidden />
            {hibernationBadgeLabel(reason, daysSinceOpen)}
          </span>
          {description}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
        <button
          type="button"
          onClick={() => onWake(item.siteId)}
          aria-label={`唤醒 ${item.title}`}
          title="唤醒：回到正常列表（同时记一次打开）"
          className="inline-flex min-h-11 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <Sun className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">唤醒</span>
        </button>
      </div>
    </li>
  )
}
