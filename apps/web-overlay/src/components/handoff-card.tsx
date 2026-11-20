'use client'

/**
 * 跨设备接力卡（Batch 3 第 9 项，C 组；客户端岛）。
 *
 * 模式照 HomeBriefStrip / DailyFocus 的「挂载后读数」：服务端不吐用户数据，
 * 挂载前不渲染（返回 null，不占位、不放假数据），挂载后读本机播放历史，再与
 * props 传进来的云端数据合并，挑出最新的一条未完成进度渲染成一卡。
 * （正名，U-61：本站没有真正的 SSR 骨架壳——所谓「壳」就是 null；DailyFocus
 * 自 U-61 起挂载前改渲染静态骨架，本组件仍是 return null，不照抄骨架模式。）
 *
 * 数据插口（云端接线在 HandoffCardWithCloud 外壳里完成，本组件不自己写 CRDT 同步调用）：
 *  - cloudProgress / visits / watchlist：外壳接线后以 props 传入；
 *  - cloudStatus：外壳接线后传入（'loading' 时不渲染占位，'error' 时整块
 *    不渲染）；不传时视为只有本机数据可读（'ready'）。
 *  - isLoggedIn：不传时组件自己用 useIdentityReady 判定。
 *
 * 诚实纪律：
 *  - 无进度 / 未登录且无本机进度 / 云端拉取失败时整块不渲染（返回 null，
 *    不占位、不放假数据）。
 *  - 未登录时不请求云端（本组件根本不发任何云端请求）；但本机有未看完的
 *    进度时，给「登录后可跨设备继续」的引导而不是静默失效——登录后首次
 *    同步会把本机断点上传（设计 §3.4），这句引导是真实承诺。
 *  - 卡上只写相对时间，不写设备名（没有可靠来源，不编造）。
 *  - 不读 `lastOpenedAt`（本机-only，不碰）。
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Clock3, Globe, Play, Tv, X } from 'lucide-react'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import { SiteFavicon } from '@/components/site-favicon'
import { safeHref } from '@/lib/safe-url'
import {
  adaptLocalPlayback,
  handoffDetailLine,
  handoffPrimaryLabel,
  handoffVideoHref,
  selectHandoffItems,
  type HandoffItem,
  type HandoffVideoProgress,
  type HandoffVisit,
  type HandoffWatchlistEntry,
} from '@/lib/handoff'
import {
  getPlaybackHistory,
  removePlaybackItem,
  type PlaybackHistoryItem,
} from '@/lib/video-playback-storage'

/** CRDT client id 的 sessionStorage 键（与 use-crdt-roaming 同一个，不新建 id）。 */
const CRDT_CLIENT_ID_KEY = 'navhub_crdt_client_id'

export type HandoffCloudStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface HandoffCardProps {
  /** 云端视频进度（D 组接线后传入；未传 = 只有本机数据） */
  cloudProgress?: HandoffVideoProgress[]
  /** 最近打开（D 组接线后传入） */
  visits?: HandoffVisit[]
  /** 追剧清单（D 组接线后传入；调用方先滤掉已完结条目） */
  watchlist?: HandoffWatchlistEntry[]
  /** 云端取数状态（D 组接线后传入）；不传视为 'ready' */
  cloudStatus?: HandoffCloudStatus
  /** 是否已登录；不传时组件自己判定 */
  isLoggedIn?: boolean
  /** 在 /me/history 内复用时不展示「还有 N 条」回链（已经在该页了） */
  showMoreLink?: boolean
  onDismiss?: (item: HandoffItem) => void
  onClear?: (item: HandoffItem) => void
}

function readDeviceId(): string {
  try {
    let cid = window.sessionStorage.getItem(CRDT_CLIENT_ID_KEY)
    if (!cid) {
      cid = 'client_' + Math.random().toString(36).slice(2, 9)
      window.sessionStorage.setItem(CRDT_CLIENT_ID_KEY, cid)
    }
    return cid
  } catch {
    return 'client_anonymous'
  }
}

function dismissKey(item: HandoffItem): string {
  return `${item.kind}:${item.id}:${item.updatedAt}`
}

function itemIcon(item: HandoffItem) {
  if (item.kind === 'video') {
    if (item.cover) {
      return (
        <img
          src={item.cover}
          alt=""
          loading="lazy"
          className="h-14 w-14 shrink-0 rounded-lg object-cover"
        />
      )
    }
    return (
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Play className="h-6 w-6" aria-hidden />
      </span>
    )
  }
  if (item.kind === 'visit' && (item.icon || item.url)) {
    return (
      <SiteFavicon
        title={item.title}
        url={item.url}
        icon={item.icon}
        className="h-14 w-14 shrink-0 rounded-lg"
      />
    )
  }
  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
      {item.kind === 'watchlist' ? (
        <Tv className="h-6 w-6" aria-hidden />
      ) : (
        <Globe className="h-6 w-6" aria-hidden />
      )}
    </span>
  )
}

export function HandoffCard({
  cloudProgress,
  visits,
  watchlist,
  cloudStatus = 'ready',
  isLoggedIn: isLoggedInProp,
  showMoreLink = true,
  onDismiss,
  onClear,
}: HandoffCardProps) {
  const identityReady = useIdentityReady()
  const [localHistory, setLocalHistory] = useState<PlaybackHistoryItem[] | null>(null)
  const [deviceId, setDeviceId] = useState('')
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    setLocalHistory(getPlaybackHistory())
    setDeviceId(readDeviceId())
  }, [])

  const isLoggedIn =
    isLoggedInProp ?? (identityReady.ready && !identityReady.isAnonymous && !!identityReady.identity)

  const selection = useMemo(() => {
    if (localHistory === null) return null
    const local = localHistory.map((item) => adaptLocalPlayback(item, deviceId))
    return selectHandoffItems({ localProgress: local, cloudProgress, visits, watchlist })
  }, [localHistory, deviceId, cloudProgress, visits, watchlist])

  // 挂载前 / 身份未就绪前不渲染：避免 SSR 壳与本机数据 hydration 对不上。
  if (localHistory === null || !identityReady.ready) return null

  const visibleItems = (selection?.items ?? []).filter((item) => !dismissed.has(dismissKey(item)))
  const current = visibleItems[0] ?? null
  const remaining = Math.max(0, visibleItems.length - 1)

  // 未登录：不请求云端（本组件根本不发云端请求）。本机有未看完的进度时给
  // 登录引导而不是静默失效；本机也没有进度时整块不渲染。
  if (!isLoggedIn) {
    if (!current) return null
    return (
      <section
        aria-label="跨设备接力"
        className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-dashed bg-card px-4 py-3 sm:px-5">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <Clock3 className="h-4 w-4 text-primary" aria-hidden />
            跨设备接力
          </span>
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            在这台设备上看到一半的「{current.title}」，登录后换设备也能继续。
          </p>
          <Link
            href="/auth/signin"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            登录后可跨设备继续 <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>
    )
  }

  // 已登录：云端还在拉取 / 拉取失败时整块不渲染（不占位、不放假数据）。
  if (cloudStatus === 'idle' || cloudStatus === 'loading' || cloudStatus === 'error') return null
  if (!current) return null

  const dismiss = () => {
    setDismissed((prev) => new Set(prev).add(dismissKey(current)))
    onDismiss?.(current)
  }

  const clear = () => {
    // 视频类：删本机播放记录；云端记录的删除由调用方经 onClear 补发
    // （见 HandoffCardWithCloud），这里只清本机。
    // 站点 / 追剧类没有本机可删的记录，退化为忽略。
    if (current.kind === 'video') {
      removePlaybackItem(current.id)
      setLocalHistory((prev) => (prev ?? []).filter((h) => h.videoId !== current.id))
    } else {
      setDismissed((prev) => new Set(prev).add(dismissKey(current)))
    }
    onClear?.(current)
  }

  const primaryHref =
    current.kind === 'video'
      ? handoffVideoHref(current)
      : current.kind === 'visit'
        ? safeHref(current.url)
        : '/me/watchlist'
  const primaryIsExternal = current.kind === 'visit'

  return (
    <section aria-label="跨设备接力" className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5">
      <div className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3 sm:px-5">
        {itemIcon(current)}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={current.title}>
            {current.title}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {handoffDetailLine(current)}
            {current.kind === 'video' && current.author ? ` · ${current.author}` : null}
          </p>
          {remaining > 0 && showMoreLink ? (
            <Link
              href="/me/history"
              className="mt-0.5 inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
            >
              还有 {remaining} 条 <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
          {primaryIsExternal ? (
            <a
              href={primaryHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {handoffPrimaryLabel(current)}
            </a>
          ) : (
            <Link
              href={primaryHref}
              className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {handoffPrimaryLabel(current)}
            </Link>
          )}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={dismiss}
              className="inline-flex min-h-9 items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> 忽略
            </button>
            <button
              type="button"
              onClick={clear}
              className="inline-flex min-h-9 items-center rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              清除
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
