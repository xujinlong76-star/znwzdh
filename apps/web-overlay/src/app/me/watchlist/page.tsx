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
} from '@/hooks/useWatchlist'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import { collectDramaSites, type DramaSite } from '@/lib/drama-sites'
import { safeHref } from '@/lib/safe-url'
import {
  cadenceLabel,
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
  const shown = draft ?? String(entry.episode)
  const commit = () => {
    if (draft === null) return
    const n = Math.trunc(Number(draft))
    setDraft(null)
    if (Number.isFinite(n)) onSet(n)
  }
  return (
    <span className="inline-flex items-center gap-1" aria-label={`《${entry.title}》看到第几集`}>
      <button
        type="button"
        aria-label="少一集"
        onClick={() => onSet(entry.episode - 1)}
        disabled={entry.episode <= 0}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-300 text-zinc-600 transition-colors hover:border-rose-400 hover:text-rose-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
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
        onChange={(e) => setDraft(e.target.value)}
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
        className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-300 text-zinc-600 transition-colors hover:border-rose-400 hover:text-rose-600 dark:border-zinc-700 dark:text-zinc-300"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
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
}: {
  entry: WatchEntry
  watchlist: ReturnType<typeof useWatchlist>
}) {
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
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          在{entry.platformTitle}看 · {cadenceLabel(entry.cadence)}
          {!entry.remind && ' · 提醒已关'}
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
          className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 transition-colors hover:border-rose-400 hover:text-rose-600 dark:border-zinc-700 dark:text-zinc-300"
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
          去看 <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
        <button
          type="button"
          onClick={() => watchlist.remove(entry.key)}
          aria-label={`把《${entry.title}》移出追剧清单`}
          title="移出追剧清单"
          className="inline-flex items-center justify-center rounded-full border border-zinc-300 p-1.5 text-zinc-400 transition-colors hover:border-red-400 hover:text-red-500 dark:border-zinc-700"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </li>
  )
}

/* ------------------------------ 页面 ------------------------------ */

export default function WatchlistPage() {
  const watchlist = useWatchlist()
  const identityReady = useIdentityReady()
  const [banner, setBanner] = useState<WatchSyncBannerInput | null>(null)
  const [platforms, setPlatforms] = useState<DramaSite[]>([])
  const [addPlatformId, setAddPlatformId] = useState('')
  const [addTitle, setAddTitle] = useState('')
  const [addFields, setAddFields] = useState<Omit<WatchDraft, 'title'>>({
    episode: 0,
    cadence: { kind: 'unknown' },
    priority: 'normal',
  })
  const [now, setNow] = useState(() => new Date())
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
          ? { ok: true, pushed: result.pushed, remoteRemoved: result.remoteRemoved }
          : { ok: false, error: result.error, retryable: result.retryable },
      )
    } finally {
      syncingRef.current = false
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

  const parts = useMemo(() => partitionWatchlist(watchlist.entries, now), [watchlist.entries, now])
  const schedule = useMemo(
    () => buildWeekSchedule(watchlist.entries, mondayOfWeek(now), now),
    [watchlist.entries, now],
  )
  const hasScheduled =
    schedule.daily.length > 0 || schedule.days.some((day) => day.entries.length > 0)
  const bannerView = describeWatchlistSyncBanner(banner)
  const lastSync = readWatchlistSyncStatus()

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
              className="shrink-0 rounded-full bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-500"
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
          <p className="mt-3 text-xs text-zinc-400">
            上次同步：{new Date(lastSync.at).toLocaleString()}
            <button type="button" onClick={() => void runSync()} className="ml-2 underline underline-offset-2">
              重新同步
            </button>
          </p>
        )}

        {/* 本周追剧表：静态周视图，只排用户已标注的节奏，不推断平台是否更新。
            清单为空时整段不渲染；只有未标注的剧时只显示「还没排进来」区，不画空表。 */}
        {watchlist.entries.length > 0 && (
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
                            去看 <ExternalLink className="h-3.5 w-3.5" aria-hidden />
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
                      {day.entries.length === 0 ? (
                        <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">没有安排</p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {day.entries.map((entry) => (
                            <li key={entry.key} className="text-sm">
                              <span className="block truncate font-medium">《{entry.title}》</span>
                              <span className="mt-0.5 flex items-center justify-between gap-2">
                                <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                  {entry.platformTitle}
                                </span>
                                <a
                                  href={safeHref(entry.playUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                                >
                                  去看 <ExternalLink className="h-3 w-3" aria-hidden />
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
                        className="text-xs text-rose-600 underline underline-offset-2 hover:text-rose-500 dark:text-rose-400"
                      >
                        为《{entry.title}》标注更新节奏 ↓
                      </a>
                      <ul className="mt-1 space-y-2">
                        <EntryRow key={entry.key} entry={entry} watchlist={watchlist} />
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
            <p className="mt-1 text-xs text-rose-600/80 dark:text-rose-300/70">
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
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 transition-colors hover:border-emerald-400 hover:text-emerald-600 dark:border-zinc-700 dark:text-zinc-300"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden /> 今天已看
                  </button>
                  <a
                    href={safeHref(entry.playUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-500"
                  >
                    去看新一集 <ExternalLink className="h-3.5 w-3.5" aria-hidden />
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
                <EntryRow key={entry.key} entry={entry} watchlist={watchlist} />
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
              className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-50"
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
                <EntryRow key={entry.key} entry={entry} watchlist={watchlist} />
              ))}
            </ul>
          </section>
        )}

        {parts.finished.length > 0 && (
          <section aria-label="已完结" className="mt-6">
            <h2 className="text-base font-bold">已完结 · 慢慢补（{parts.finished.length}）</h2>
            <ul className="mt-3 space-y-2">
              {parts.finished.map((entry) => (
                <EntryRow key={entry.key} entry={entry} watchlist={watchlist} />
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
