'use client'

/**
 * 追剧清单页：在追的剧 + 观看进度 + 更新提醒。
 *
 * 与收藏页的分工（文案与功能都守这条线）：
 *  - 收藏页存「站点」，是以后可能会去的入口仓库；
 *  - 这里记「剧」，是正在追的进度账本：看到第几集、按你标注的节奏到更新日提醒。
 *
 * 提醒的诚实边界：站内没有平台排播数据，节奏是用户自己标注的。待看区只说
 * 「按你标注的节奏，今天是更新日」；节奏未标注的剧只进「去看看」区，
 * 永远不写「已更新」。本期提醒只在站内（本页待看区），不做站外推送。
 * 例外（U-D3）：服务端每天为可查的剧查一次最新集数，有基线的行显示
 * 「已更至第 X 集」；X 大于“看到第几集”时贴「有新集」角标——这两个数
 * 都是服务端实查的，不是排播推断。无基线时只对 featured 里可查的剧写
 * 「未查到最新集数」，其余行不写。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Bell,
  BellOff,
  Check,
  Clapperboard,
  ExternalLink,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { CenterPageHeader } from '@/components/user-center/center-page-header'
import { WatchlistFields, type WatchDraft } from '@/components/watchlist-add-button'
import {
  readWatchlistSyncStatus,
  syncWatchlistToCloud,
  useWatchlist,
  type WatchlistCloudSyncResult,
  type WatchlistSyncStatus,
} from '@/hooks/useWatchlist'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import { useDramaCheckStates } from '@/hooks/useDramaCheckStates'
import { featuredDramaKey, loadDramaFeatured } from '@/lib/drama-featured'
import {
  hasNewEpisodes,
  latestEpisodeText,
  type DramaCheckState,
} from '@/lib/drama-watch-stats'
import { collectDramaSites, type DramaSite } from '@/lib/drama-sites'
import { safeHref } from '@/lib/safe-url'
import {
  cadenceLabel,
  isReservedEntry,
  isReservedPremiereDue,
  partitionWatchlist,
  type WatchCadence,
  type WatchEntry,
} from '@/lib/watchlist'
import { buildWeekSchedule, formatWeekDay, mondayOfWeek } from '@/lib/watch-week'
import {
  describeAnonymousWatchlistNote,
  describeWatchlistSyncBanner,
  shouldOfferWatchlistRetry,
  type WatchSyncBannerInput,
} from '@/lib/watchlist-sync-copy'

/* ------------------------------ 集数步进 ------------------------------ */

function EpisodeStepper({ entry, onSet }: { entry: WatchEntry; onSet: (episode: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  // U-230 残留：非法输入的行内反馈。本页无 toast 基建，行内文案与出错的行
  // 一一对应；拒绝后不抢焦点（提交发生在 blur 时，抢焦点会打断切行操作）。
  const [error, setError] = useState<string | null>(null)
  const shown = draft ?? String(entry.episode)
  const commit = () => {
    if (draft === null) return
    // U-230：空值/空白直接恢复原值、不调 onSet——Number('') === 0，
    // 失焦/回车会把集数静默清零，下游 setEpisode 又把 0 当合法值写盘。
    if (draft.trim() === '') {
      setError(null)
      setDraft(null)
      return
    }
    const raw = Number(draft)
    // 非数字（如程序化传入的 'abc'）：拒绝，不调 onSet、不动原值。
    if (!Number.isFinite(raw)) {
      setError('请输入数字')
      setDraft(null)
      return
    }
    const n = Math.trunc(raw)
    // 负数拒绝：下游 setEpisode 会把负数 clamp 成 0 写盘，一次手误就把
    // 整部剧的进度静默归零；这里拦住，onSet 零调用、原值不变。
    if (n < 0) {
      setError(`集数不能为负数，已恢复为第 ${entry.episode} 集`)
      setDraft(null)
      return
    }
    // 超上限截断并明示：max 属性拦不住手输，下游会静默截断到 100000。
    if (n > 100000) {
      setError('最多 100000 集，已记为 100000 集')
      setDraft(null)
      onSet(100000)
      return
    }
    // 小数保留取整（Math.trunc，常规整数输入语义，与改前一致，不另提示）。
    setError(null)
    setDraft(null)
    onSet(n)
  }
  return (
    <span className="inline-flex flex-col items-start">
      <span className="inline-flex items-center gap-1" aria-label={`《${entry.title}》看到第几集`}>
      <button
        type="button"
        aria-label="少一集"
        onClick={() => onSet(entry.episode - 1)}
        disabled={entry.episode <= 0}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-300 text-zinc-600 transition-colors hover:border-rose-400 hover:text-rose-700 dark:hover:text-rose-400 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
      >
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </button>
      <input
        type="number"
        min={0}
        max={100000}
        inputMode="numeric"
        aria-label="集数"
        value={shown}
        onChange={(e) => {
          setDraft(e.target.value)
          setError(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className="w-14 rounded-lg border border-zinc-300 bg-transparent px-1 py-1 text-center text-sm outline-none focus:border-rose-500 dark:border-zinc-700"
      />
      <button
        type="button"
        aria-label="多一集"
        onClick={() => onSet(entry.episode + 1)}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-300 text-zinc-600 transition-colors hover:border-rose-400 hover:text-rose-700 dark:hover:text-rose-400 dark:border-zinc-700 dark:text-zinc-300"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
      </span>
      {error !== null && (
        <p role="alert" className="mt-1 text-xs text-destructive-text">
          {error}
        </p>
      )}
    </span>
  )
}

/* ------------------------------ 节奏改选 ------------------------------ */

/** 行内改节奏的 select 值：单日周更编成 weekly-<day>；多日周更单列一项（选中它 = 不改） */
function cadenceSelectValue(cadence: WatchCadence): string {
  switch (cadence.kind) {
    case 'daily':
      return 'daily'
    case 'finished':
      return 'finished'
    case 'unknown':
      return 'unknown'
    case 'weekly':
      return cadence.weekdays.length === 1 ? `weekly-${cadence.weekdays[0]}` : 'weekly-multi'
  }
}

function cadenceFromSelectValue(value: string, current: WatchCadence): WatchCadence {
  if (value === 'daily') return { kind: 'daily' }
  if (value === 'finished') return { kind: 'finished' }
  if (value === 'unknown') return { kind: 'unknown' }
  if (value === 'weekly-multi') return current
  if (value.startsWith('weekly-')) {
    const day = Number(value.slice('weekly-'.length))
    if (Number.isInteger(day) && day >= 0 && day <= 6) return { kind: 'weekly', weekdays: [day] }
  }
  return current
}

const WEEKDAY_OPTIONS = [
  { day: 1, label: '每周一更新' },
  { day: 2, label: '每周二更新' },
  { day: 3, label: '每周三更新' },
  { day: 4, label: '每周四更新' },
  { day: 5, label: '每周五更新' },
  { day: 6, label: '每周六更新' },
  { day: 0, label: '每周日更新' },
] as const

/* ------------------------------ 条目行 ------------------------------ */

function EntryRow({
  entry,
  watchlist,
  checkState,
  checkable,
}: {
  entry: WatchEntry
  watchlist: ReturnType<typeof useWatchlist>
  /** 服务端新集检查状态（无基线为 undefined）。 */
  checkState: DramaCheckState | undefined
  /** 该剧是否在 featured 里且可查（无基线时才写“未查到最新集数”）。 */
  checkable: boolean
}) {
  const latestText = latestEpisodeText(checkState)
  const showUnknown = latestText === null && checkable
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          《{entry.title}》
          {entry.priority === 'high' && (
            <span className="ml-2 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-400">
              想先看
            </span>
          )}
          {hasNewEpisodes(entry, checkState) && (
            <span className="ml-2 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-400">
              有新集
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          在{entry.platformTitle}看 · {cadenceLabel(entry.cadence)}
          {!entry.remind && ' · 提醒已关'}
          {latestText ? ` · ${latestText}` : ''}
          {showUnknown ? ' · 未查到最新集数' : ''}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">看到第</span>
        <EpisodeStepper entry={entry} onSet={(n) => watchlist.setEpisode(entry.key, n)} />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">集</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`cadence-${entry.key}`}>
          改《{entry.title}》的更新节奏
        </label>
        <select
          id={`cadence-${entry.key}`}
          value={cadenceSelectValue(entry.cadence)}
          onChange={(e) =>
            watchlist.update(entry.key, { cadence: cadenceFromSelectValue(e.target.value, entry.cadence) })
          }
          className="rounded-lg border border-zinc-300 bg-transparent px-2 py-1.5 text-xs outline-none focus:border-rose-500 dark:border-zinc-700"
        >
          <option value="unknown">节奏未标注</option>
          <option value="daily">每天更新</option>
          {WEEKDAY_OPTIONS.map((o) => (
            <option key={o.day} value={`weekly-${o.day}`}>
              {o.label}
            </option>
          ))}
          {entry.cadence.kind === 'weekly' && entry.cadence.weekdays.length > 1 && (
            <option value="weekly-multi">{cadenceLabel(entry.cadence)}</option>
          )}
          <option value="finished">已完结</option>
        </select>
        <button
          type="button"
          onClick={() => watchlist.update(entry.key, { remind: !entry.remind })}
          aria-pressed={entry.remind}
          title={entry.remind ? '关掉这部剧的更新提醒' : '打开这部剧的更新提醒'}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 transition-colors hover:border-rose-400 hover:text-rose-700 dark:hover:text-rose-400 dark:border-zinc-700 dark:text-zinc-300"
        >
          {entry.remind ? <Bell className="h-3.5 w-3.5" aria-hidden /> : <BellOff className="h-3.5 w-3.5" aria-hidden />}
          {entry.remind ? '提醒开' : '提醒关'}
        </button>
        <a
          href={safeHref(entry.playUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          去{entry.platformTitle}首页搜 <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
        <button
          type="button"
          onClick={() => watchlist.remove(entry.key)}
          aria-label={`把《${entry.title}》移出追剧清单`}
          title="移出追剧清单"
          className="inline-flex items-center justify-center rounded-full border border-zinc-300 p-1.5 text-zinc-500 transition-colors hover:border-red-400 hover:text-red-500 dark:border-zinc-700 dark:text-zinc-400"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </li>
  )
}

/* ------------------------------ 预约行 ------------------------------ */

/**
 * 预约态行（U-377）：开播日历上预约的、无平台的剧。
 *  - 没有播放页：不画“去平台搜”入口，只写「平台待确认」；
 *  - 没有集数步进与节奏改选：还没开播，没进度可记、没节奏可标；
 *  - 开播日到了也不消失：文案改成「已到开播日 · 平台待确认」，等人来补平台。
 */
function ReservedRow({ entry, now, watchlist }: { entry: WatchEntry; now: Date; watchlist: ReturnType<typeof useWatchlist> }) {
  const premiereDue = isReservedPremiereDue(entry, now)
  const premiereLabel = !entry.premiereDate
    ? '开播日待定（榜单只给了月份）'
    : premiereDue
      ? `已到开播日 · 平台待确认`
      : `预计 ${Number(entry.premiereDate.slice(5, 7))}月${Number(entry.premiereDate.slice(8, 10))}日开播`
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20 sm:flex-row sm:items-center sm:gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">
          《{entry.title}》
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            平台待确认
          </span>
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {premiereLabel} · 档期为平台预计，以官方为准
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          开播后在平台确认了播出入口，再回来补平台
        </span>
        <button
          type="button"
          onClick={() => watchlist.remove(entry.key)}
          aria-label={`取消预约《${entry.title}》`}
          title="取消预约"
          className="inline-flex items-center justify-center rounded-full border border-zinc-300 p-1.5 text-zinc-500 transition-colors hover:border-red-400 hover:text-red-500 dark:border-zinc-700 dark:text-zinc-400"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </li>
  )
}

/* ------------------------------ 页面 ------------------------------ */

/** 水合前的固定时刻：服务端与首渲共用同一值；此时 entries 为空，不渲染任何
 * 日期派生内容，故取值不影响输出。`now` 真值只在水合完成后才设置（见下），
 * 避免服务端与客户端恰好跨过午夜零点时周表翻天。 */
const FALLBACK_NOW = new Date(0)

export default function WatchlistPage() {
  const watchlist = useWatchlist()
  const identityReady = useIdentityReady()
  const checkStates = useDramaCheckStates()
  // featured 里可查的剧（check.kind !== "none"）：无基线时才写“未查到最新集数”。
  const checkableFeaturedKeys = useMemo(
    () =>
      new Set(
        loadDramaFeatured()
          .dramas.filter((d) => d.check.kind !== "none")
          .map((d) => featuredDramaKey(d)),
      ),
    [],
  )
  const [banner, setBanner] = useState<WatchSyncBannerInput | null>(null)
  const [lastSync, setLastSync] = useState<WatchlistSyncStatus | null>(null)
  const [platforms, setPlatforms] = useState<DramaSite[]>([])
  const [addPlatformId, setAddPlatformId] = useState('')
  const [addTitle, setAddTitle] = useState('')
  const [addFields, setAddFields] = useState<Omit<WatchDraft, 'title'>>({
    episode: 0,
    cadence: { kind: 'unknown' },
    priority: 'normal',
  })
  const [now, setNow] = useState<Date | null>(null)
  const syncingRef = useRef(false)
  const syncedForRef = useRef<string | null>(null)

  const isAnonymous =
    identityReady.ready && (!identityReady.identity || identityReady.identity.startsWith('anon-'))

  const runSync = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    setBanner({ syncing: true })
    try {
      const result: WatchlistCloudSyncResult = await syncWatchlistToCloud()
      if (result.ok && result.nextItems) {
        watchlist.replaceAll(result.nextItems)
      }
      setBanner(
        result.ok
          ? {
              ok: true,
              pushed: result.pushed,
              // U-460：横幅按 applied 说成功数、按 skipped 报被覆盖数，
              // 再不许拿 pushed 冒充「已合并」。
              applied: result.applied,
              skipped: result.skipped,
              remoteRemoved: result.remoteRemoved,
            }
          : { ok: false, error: result.error, retryable: result.retryable },
      )
    } finally {
      syncingRef.current = false
      // 同步写回的 localStorage 状态要同步进 state，否则「上次同步」行不刷新
      setLastSync(readWatchlistSyncStatus())
    }
    // replaceAll 身份随 hook 快照变化，纳入依赖会重复触发同步；同步只由下方 effect 用 ref 守卫触发一次
  }, [])

  // 登录身份就绪后同步一次；身份变化（登录/退出）后重新同步
  useEffect(() => {
    if (!watchlist.ready || !identityReady.ready) return
    const identity = identityReady.identity
    if (!identity || identity.startsWith('anon-')) return
    if (syncedForRef.current === identity) return
    syncedForRef.current = identity
    void runSync()
  }, [watchlist.ready, identityReady.ready, identityReady.identity, runSync])

  // 水合完成后才取本地同步状态与当前时刻：首渲必须与服务端一致。
  // 渲染期直接读 localStorage 会在水合中途凭空多出一行「上次同步」，
  // 与服务端 HTML 对不上 → Hydration failed；`now` 同理只在水合后取真值。
  useEffect(() => {
    if (!watchlist.ready) return
    setNow((prev) => prev ?? new Date())
    setLastSync(readWatchlistSyncStatus())
  }, [watchlist.ready])

  // 平台选项与首页影院同源（/api/home/navigation 的短剧分类，broken 已剔除）
  useEffect(() => {
    let cancelled = false
    fetch('/api/home/navigation')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const sites = collectDramaSites(data.navigationItems)
        setPlatforms(sites)
        setAddPlatformId((prev) => prev || sites[0]?.id || '')
      })
      .catch(() => {
        // 平台选项只是添加表单的候选来源：拉不到就保持空列表，
        // 追剧清单的查看与同步不依赖它，失败对用户无感知损失，故吞掉
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 跨天后待看区要按新的一天重算：每分钟轻量刷新一次判定时刻
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const effectiveNow = now ?? FALLBACK_NOW
  const parts = useMemo(() => partitionWatchlist(watchlist.entries, effectiveNow), [watchlist.entries, effectiveNow])
  const schedule = useMemo(
    () => buildWeekSchedule(watchlist.entries, mondayOfWeek(effectiveNow), effectiveNow),
    [watchlist.entries, effectiveNow],
  )
  const hasScheduled =
    schedule.daily.length > 0 || schedule.days.some((day) => day.entries.length > 0)
  const bannerView = describeWatchlistSyncBanner(banner)

  const submitAdd = () => {
    const platform = platforms.find((p) => p.id === addPlatformId)
    if (!platform || !addTitle.trim()) return
    const entry = watchlist.add(
      { siteId: platform.id, title: platform.title, href: platform.href },
      { title: addTitle, episode: addFields.episode, cadence: addFields.cadence, priority: addFields.priority },
    )
    if (entry) {
      setAddTitle('')
      setAddFields({ episode: 0, cadence: { kind: 'unknown' }, priority: 'normal' })
      setNow(new Date())
    }
  }

  return (
    <>
      <Container as="main" id="main-content" className="py-6">
        <CenterPageHeader
          title="追剧清单"
          icon={Clapperboard}
          eyebrow="用户中心 · 内容与收藏"
          description={
            <>
              记着你在追哪几部剧、看到第几集，按你标注的更新节奏到日子提醒你。
              和<Link href="/favorites" className="mx-1 underline underline-offset-2">收藏</Link>
              不一样：收藏是先存着，追剧是正在进行时。
            </>
          }
          back={{ href: '/me', label: '返回用户中心' }}
        />

        {watchlist.storageBlocked && (
          <div className="mt-4 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" role="alert">
            <p>{watchlist.storageBlocked}</p>
            <button
              type="button"
              className="mt-2 rounded-full border border-red-300 px-3 py-1.5 text-xs font-medium dark:border-red-800"
              onClick={() => {
                const { backedUp } = watchlist.resetLocal()
                window.alert(backedUp ? '原数据已备份到隔离键，清单已重置。' : '原数据未能备份（存储空间可能已满），清单已重置。')
              }}
            >
              备份原数据并重置
            </button>
          </div>
        )}

        {isAnonymous && !watchlist.storageBlocked && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="note">
            <p className="min-w-0 flex-1">{describeAnonymousWatchlistNote()}</p>
            <a
              href="/auth/signin?callbackUrl=/me/watchlist"
              className="shrink-0 rounded-full bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800"
            >
              登录同步追剧清单
            </a>
          </div>
        )}

        {!isAnonymous && bannerView.tone !== 'hidden' && (
          <div
            className={`mt-4 flex flex-wrap items-center gap-3 rounded-2xl border p-4 text-sm ${
              bannerView.tone === 'error'
                ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
                : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300'
            }`}
            role="status"
          >
            <p className="min-w-0 flex-1">{bannerView.text}</p>
            {shouldOfferWatchlistRetry(banner) && (
              <button
                type="button"
                onClick={() => void runSync()}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-current px-3 py-1.5 text-xs font-medium"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> 重试同步
              </button>
            )}
          </div>
        )}
        {!isAnonymous && bannerView.tone === 'hidden' && lastSync?.ok && (
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            上次同步：{new Date(lastSync.at).toLocaleString(undefined, { timeZone: 'Asia/Shanghai' })}
            <button type="button" onClick={() => void runSync()} className="ml-2 underline underline-offset-2">
              重新同步
            </button>
          </p>
        )}

        {/* 本周追剧表：静态周视图，只排用户已标注的节奏，不推断平台是否更新。
            清单为空时整段不渲染；只有未标注的剧时只显示「还没排进来」区，不画空表。
            只有预约态时也不画表——预约的剧没节奏可排，它在下面的预约区。 */}
        {watchlist.entries.some((e) => !isReservedEntry(e)) && (
          <section aria-label="本周追剧表" className="mt-6">
            <h2 className="text-base font-bold">本周追剧表</h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              按你标注的节奏排的表，扫一眼就知道这周哪天看哪部。
            </p>

            {hasScheduled && (
              <>
                {schedule.daily.length > 0 && (
                  <div className="mt-3 rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">每天更新</p>
                    <ul className="mt-2 space-y-1.5">
                      {schedule.daily.map((entry) => (
                        <li key={entry.key} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate font-medium">《{entry.title}》</span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            在{entry.platformTitle}看
                          </span>
                          <a
                            href={safeHref(entry.playUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                          >
                            去{entry.platformTitle}首页搜 <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3 flex flex-col gap-2 md:grid md:grid-cols-7">
                  {schedule.days.map((day) => (
                    <div
                      key={day.dateKey}
                      className={`rounded-2xl border p-3 ${
                        day.isToday
                          ? 'border-rose-300 bg-rose-50 max-md:order-first dark:border-rose-900 dark:bg-rose-950/30'
                          : day.isPast
                            ? 'border-zinc-200 opacity-60 dark:border-zinc-800'
                            : 'border-zinc-200 dark:border-zinc-800'
                      }`}
                    >
                      <p className="text-xs font-semibold">
                        {formatWeekDay(day.date)}
                        {day.isToday && (
                          <span className="ml-1.5 rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-medium text-white">
                            今天
                          </span>
                        )}
                      </p>
                      {day.entries.length >= 3 && (
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          {day.entries.length} 部撞车，先看想先看的
                        </p>
                      )}
                      {day.entries.length === 0 ? (
                        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">没有安排</p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {day.entries.map((entry) => (
                            <li key={entry.key} className="text-sm">
                              <span className="block truncate font-medium">《{entry.title}》</span>
                              <span className="mt-0.5 flex flex-col items-start gap-1">
                                <span className="w-full min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400">
                                  {entry.platformTitle}
                                </span>
                                <a
                                  href={safeHref(entry.playUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={`去${entry.platformTitle}首页搜《${entry.title}》`}
                                  className="inline-flex w-full min-w-0 items-center gap-1 rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                                >
                                  <span className="min-w-0 truncate">去{entry.platformTitle}搜</span> <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                                </a>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  平台临时改档时可能不准，以平台为准。提醒只在站内待看区，到点不会手机推送。
                </p>
                {schedule.days[6].entries.length === 0 && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    周日这格空着，正好补之前漏掉的集。
                  </p>
                )}
              </>
            )}

            {schedule.unscheduled.length > 0 && (
              <div className="mt-3">
                <h3 className="text-sm font-bold">还没排进来（{schedule.unscheduled.length}）</h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  这几部没标注更新节奏，排不进来——去平台看排播，回来标一下。
                </p>
                <div className="mt-2 space-y-2">
                  {schedule.unscheduled.map((entry) => (
                    <div key={entry.key}>
                      <a
                        href={`#cadence-${entry.key}`}
                        className="text-xs text-rose-700 underline underline-offset-2 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-400"
                      >
                        为《{entry.title}》标注更新节奏 ↓
                      </a>
                      <ul className="mt-1 space-y-2">
                        <EntryRow key={entry.key} entry={entry} watchlist={watchlist} checkState={checkStates.byKey.get(entry.key)} checkable={checkableFeaturedKeys.has(entry.key)} />
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* 待看区：只收「节奏已知 + 今天是更新日 + 今天还没看」的剧 */}
        {parts.due.length > 0 && (
          <section aria-label="今天有更新" className="mt-6 rounded-3xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/30">
            <h2 className="flex items-center gap-2 text-base font-bold text-rose-700 dark:text-rose-300">
              <Sparkles className="h-5 w-5" aria-hidden />
              今天该看新一集了（{parts.due.length}）
            </h2>
            <p className="mt-1 text-xs text-rose-700 dark:text-rose-300/70">
              按你标注的更新节奏，今天是这几部的更新日。平台临时改档时可能不准，以平台为准。
            </p>
            <ul className="mt-3 space-y-2">
              {parts.due.map((entry) => (
                <li
                  key={entry.key}
                  className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-3 shadow-sm dark:bg-zinc-900"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">《{entry.title}》</p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      在{entry.platformTitle}看到第 {entry.episode} 集 · {cadenceLabel(entry.cadence)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => watchlist.dismissToday(entry.key)}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 transition-colors hover:border-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-400 dark:border-zinc-700 dark:text-zinc-300"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden /> 今天已看
                  </button>
                  <a
                    href={safeHref(entry.playUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-700"
                  >
                    去{entry.platformTitle}首页搜 <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 去看看区：节奏未标注，只给诚实入口，永远不说「已更新」 */}
        {parts.check.length > 0 && (
          <section aria-label="去看看有没有更新" className="mt-6">
            <h2 className="text-base font-bold">顺手去看看（{parts.check.length}）</h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              这几部没标注更新节奏，我们不知道更没更新 —— 想看时点过去瞧一眼，顺手把进度记回来。
            </p>
            <ul className="mt-3 space-y-2">
              {parts.check.map((entry) => (
                <EntryRow key={entry.key} entry={entry} watchlist={watchlist} checkState={checkStates.byKey.get(entry.key)} checkable={checkableFeaturedKeys.has(entry.key)} />
              ))}
            </ul>
          </section>
        )}

        {/* 预约区：开播日历上预约的、无平台的剧。独立分组，不进待看/去看看/
            在追/已完结；开播日到了也留在这里，只改文案，不静默消失。 */}
        {parts.reserved.length > 0 && (
          <section aria-label="已预约的剧" className="mt-6">
            <h2 className="text-base font-bold">已预约 · 等开播（{parts.reserved.length}）</h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              从开播日历预约的剧：榜单没给平台信息，先按剧名占着位，不指向任何平台入口。
              到了开播日简报会提醒你；开播后平台确认了，再回来补播出入口。
            </p>
            <ul className="mt-3 space-y-2">
              {parts.reserved.map((entry) => (
                <ReservedRow key={entry.key} entry={entry} now={effectiveNow} watchlist={watchlist} />
              ))}
            </ul>
          </section>
        )}

        {/* 添加表单 */}
        <section aria-label="添加在追的剧" className="mt-6 rounded-3xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-base font-bold">添加在追的剧</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="watch-add-platform" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                在哪个平台看
              </label>
              <select
                id="watch-add-platform"
                value={addPlatformId}
                onChange={(e) => setAddPlatformId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-rose-500 dark:border-zinc-700"
              >
                {platforms.length === 0 && <option value="">平台加载中…</option>}
                {platforms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="watch-add-title" className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                剧名（必填）
              </label>
              <input
                id="watch-add-title"
                type="text"
                value={addTitle}
                maxLength={80}
                onChange={(e) => setAddTitle(e.target.value)}
                placeholder="比如：我叫赵甲第"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-rose-500 dark:border-zinc-700"
              />
            </div>
          </div>
          <div className="mt-3">
            <WatchlistFields draft={addFields} onChange={setAddFields} idPrefix="watch-page-add" />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={submitAdd}
              disabled={!addTitle.trim() || !addPlatformId || Boolean(watchlist.storageBlocked)}
              className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
            >
              加入追剧清单
            </button>
          </div>
        </section>

        {/* 在追列表 */}
        {parts.active.length > 0 && (
          <section aria-label="在追的剧" className="mt-6">
            <h2 className="text-base font-bold">在追（{parts.active.length}）</h2>
            <ul className="mt-3 space-y-2">
              {parts.active.map((entry) => (
                <EntryRow key={entry.key} entry={entry} watchlist={watchlist} checkState={checkStates.byKey.get(entry.key)} checkable={checkableFeaturedKeys.has(entry.key)} />
              ))}
            </ul>
          </section>
        )}

        {parts.finished.length > 0 && (
          <section aria-label="已完结" className="mt-6">
            <h2 className="text-base font-bold">已完结 · 慢慢补（{parts.finished.length}）</h2>
            <ul className="mt-3 space-y-2">
              {parts.finished.map((entry) => (
                <EntryRow key={entry.key} entry={entry} watchlist={watchlist} checkState={checkStates.byKey.get(entry.key)} checkable={checkableFeaturedKeys.has(entry.key)} />
              ))}
            </ul>
          </section>
        )}

        {watchlist.ready && watchlist.entries.length === 0 && !watchlist.storageBlocked && (
          <div className="mt-8 rounded-3xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
            <Clapperboard className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" aria-hidden />
            <p className="mt-3 text-sm font-medium">还没在追的剧</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              在上面的表单里加上第一部，或者去短剧专区逛逛——平台卡片上的「追剧」按钮也能直接加。
              加进来之后，看到第几集随手记，到更新日这里会提醒你。
            </p>
            <Link
              href="/category/duanju"
              className="mt-4 inline-flex items-center gap-1 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
            >
              去短剧专区
            </Link>
          </div>
        )}
      </Container>
      <Footer />
    </>
  )
}
