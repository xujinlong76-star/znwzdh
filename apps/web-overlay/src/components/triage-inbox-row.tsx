'use client'

/**
 * 待读行（待读箱 / 已读视图与 /brief 待读岛共用）。
 *
 * 复用 ResurfaceRow 的结构：一行只做「打开 + 流转」——
 * 标题本身就是链接（点开即记一次本机打开，inbox → read），
 * 其余是流转按钮：续期（仅待读箱）、值得留（晋升永久库）、移出（进已移出区）。
 * 按钮 44px 触达（min-h-11），与 ResurfaceRow 同款。
 *
 * 文案铁律：只写剩余时间（「还剩 X 小时/天」），不写「你忘了 / 你没看」。
 */

import { Clock, Inbox, Star } from 'lucide-react'
import { safeHref } from '@/lib/safe-url'
import { describeTriage, triageBadgeLabel, triageMsLeft, DAY_MS, type TriageSettings } from '@/lib/favorites-triage'
import type { LocalFavorite } from '@/hooks/useFavorites'
import { SiteFavicon } from '@/components/site-favicon'

export interface TriageInboxRowProps {
  item: LocalFavorite
  settings: TriageSettings
  /** 渲染时刻（调用方传 Date.now()）：剩余时间现算，不读真实时钟 */
  now: number
  /** 点标题打开时触发：调用方记一次打开时间（recordOpened），再放行默认跳转 */
  onReopen: (siteId: string) => void
  /** 待读箱内续期：调用方把 triageAt 置回 now */
  onRenew: (siteId: string) => void
  /** 晋升永久库：调用方把条目置为 permanent */
  onPromote: (siteId: string) => void
  /** 移出：调用方把条目移进已移出区并从活跃收藏移除 */
  onShelve: (siteId: string) => void
}

export function TriageInboxRow({ item, settings, now, onReopen, onRenew, onPromote, onShelve }: TriageInboxRowProps) {
  const isInbox = item.triageStatus === 'inbox'
  const msLeft = triageMsLeft(item, settings, now)
  const badge = triageBadgeLabel(msLeft)
  // 快到期（剩余 ≤ 24h，含已到期）标红：快到期行与普通待读行
  // 视觉上必须区分，否则「快到期」只存在于计数里。
  // 阈值与 selectInboxDueSoon 的 24h 上限一致；下限不设 >0，已到期行同样标红。
  const dueSoon = msLeft !== null && msLeft <= DAY_MS
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
        <p className="mt-1 text-xs text-muted-foreground" title={describeTriage(item, settings, now)}>
          {badge ? (
            <span
              className={`mr-1.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                dueSoon
                  ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
                  : 'bg-sky-500/10 text-sky-700 dark:text-sky-400'
              }`}
            >
              {isInbox ? '待读' : '已读'} · {badge}
            </span>
          ) : null}
          {describeTriage(item, settings, now)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
        {isInbox ? (
          <button
            type="button"
            onClick={() => onRenew(item.siteId)}
            aria-label={`续期 ${item.title}`}
            title="续期：重新获得完整待读时间"
            className="inline-flex min-h-11 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <Clock className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">续期</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onPromote(item.siteId)}
          aria-label={`把 ${item.title} 留进永久库`}
          title="值得留：晋升到永久库，不再倒计时"
          className="inline-flex min-h-11 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <Star className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">值得留</span>
        </button>
        <button
          type="button"
          onClick={() => onShelve(item.siteId)}
          aria-label={`移出 ${item.title}`}
          title="移出：从待读流转移走，可在「已移出」里找回"
          className="inline-flex min-h-11 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <Inbox className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">移出</span>
        </button>
      </div>
    </li>
  )
}
