'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bookmark, Clock, CloudOff, Play } from 'lucide-react'
import { describeOfflineBanner, RECONNECTED_NOTICE_MS } from '@/lib/offline-banner'
import {
  OFFLINE_SNAPSHOT_SECTION_LIMIT,
  matchesOfflineTitle,
  readOfflineSnapshot,
  type OfflineSnapshot,
} from '@/lib/offline-shell'
import { SiteFavicon } from '@/components/site-favicon'

/**
 * /offline 页的本机快照分区（Batch 3 第 8 项 P0 · B2）。
 *
 * 在 OfflineRecentList（最近访问）之上加两个分区：
 *   - 「收藏（本机）」：本机收藏前 10 条，超了引导去 /favorites
 *   - 「稍后再看 / 续播」：续播断点在前、稍后再看元数据在后，共前 10 条，
 *     超了引导去 /videos
 *
 * 诚实口径：外站链接断网点不开，按钮置灰并注明「联网后打开」；
 * 续播走站内 /videos/player 路由，可点。文案只说「稍后再看 / 续播」，
 * 不承诺下载与离线播放——稍后再看只有标题等元数据在本地。
 *
 * `query` 由 /offline 页的标题过滤框传入：只过滤本机快照的标题，
 * 不调 /api/search。查询非空且某分区无匹配时，该分区明说没有匹配
 * 的本机内容，不谎报「还没有收藏 / 记录」。
 */
export function OfflineSnapshotSections({ query = '' }: { query?: string }) {
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null)
  const [online, setOnline] = useState(true)
  const [justReconnected, setJustReconnected] = useState(false)
  const [fromPath, setFromPath] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void readOfflineSnapshot().then((snap) => {
      if (alive) setSnapshot(snap)
    })
    // SW 回退时带上的原路径（/offline?from=/tags/xxx）：只做展示，不自动跳转
    try {
      const from = new URLSearchParams(window.location.search).get('from')
      if (from && from.startsWith('/')) setFromPath(from)
    } catch {
      // 读不到查询串时不展示，不阻断快照
    }
    const updateOnline = () => {
      const isOnline = navigator.onLine
      setOnline(isOnline)
      if (isOnline) {
        setJustReconnected(true)
        window.setTimeout(() => setJustReconnected(false), RECONNECTED_NOTICE_MS)
      } else {
        setJustReconnected(false)
      }
    }
    setOnline(navigator.onLine)
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      alive = false
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [])

  const banner = describeOfflineBanner(online, justReconnected)
  const favorites = snapshot?.favorites
  const favoriteItems = favorites?.items ?? []
  const filtering = query.trim() !== ''
  const shownFavorites = favoriteItems
    .filter((f) => matchesOfflineTitle(f.title, query))
    .slice(0, OFFLINE_SNAPSHOT_SECTION_LIMIT)
  const resume = snapshot?.resume ?? []
  const offlineVideos = snapshot?.offlineVideos ?? []
  // 续播在前（有明确断点）、稍后再看元数据在后，共取前 10 条
  const watchLaterRows: Array<
    | { kind: 'resume'; key: string; title: string; videoId: string; progressPercent: number }
    | { kind: 'saved'; key: string; title: string; href: string }
  > = [
    ...resume.map((r) => ({
      kind: 'resume' as const,
      key: `resume:${r.videoId}`,
      title: r.title,
      videoId: r.videoId,
      progressPercent: r.progressPercent,
    })),
    ...offlineVideos
      .filter((v) => !resume.some((r) => r.videoId === v.id))
      .map((v) => ({
        kind: 'saved' as const,
        key: `saved:${v.id}`,
        title: v.title,
        href: v.href,
      })),
  ]
    .filter((row) => matchesOfflineTitle(row.title, query))
    .slice(0, OFFLINE_SNAPSHOT_SECTION_LIMIT)
  const watchLaterTotal = resume.length + offlineVideos.length

  return (
    <div className="mt-6 space-y-6">
      {/* 顶部诚实状态：复用 describeOfflineBanner 的口径 */}
      {banner.visible && (
        <p
          role="status"
          className="rounded-xl border border-border/70 bg-card p-3 text-xs leading-relaxed text-muted-foreground"
        >
          <span className="font-semibold text-foreground">{banner.title}</span>
          <span>：{banner.hint}</span>
          {fromPath && (
            <span className="mt-1 block">
              原本想打开：<code className="font-mono text-foreground">{fromPath}</code>
              （离线，仅展示本站快照）
            </span>
          )}
        </p>
      )}

      {/* 收藏（本机） */}
      <section aria-labelledby="offline-favorites-heading">
        <div className="flex items-center justify-between">
          <h2 id="offline-favorites-heading" className="flex items-center gap-2 text-sm font-bold">
            <Bookmark className="h-4 w-4 text-amber-500" />
            收藏（本机）
          </h2>
          {favoriteItems.length > OFFLINE_SNAPSHOT_SECTION_LIMIT && (
            <Link href="/favorites" className="text-xs text-primary hover:underline">
              去收藏页查看全部（{favoriteItems.length} 条）
            </Link>
          )}
        </div>
        {snapshot === null ? (
          <p className="mt-3 text-xs text-muted-foreground">正在读取本机快照…</p>
        ) : favorites?.corrupt ? (
          <p className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-relaxed text-muted-foreground">
            本地收藏数据读不出来（可能写入中断，或被其他程序改写）。为避免覆盖掉原数据，
            这里暂不展示收藏——原数据仍在浏览器里，可去「我的 &gt; 数据」先备份再重置。
          </p>
        ) : shownFavorites.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {filtering
              ? `没有标题包含「${query.trim()}」的本机收藏。`
              : '还没有本机收藏。联网时收藏任意站点，这里就会留下入口。'}
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {shownFavorites.map((f) => (
              <li
                key={f.siteId}
                className="flex items-center gap-3 rounded-xl border border-border/70 glass-surface p-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-muted/60 p-1">
                  <SiteFavicon
                    title={f.title}
                    url={f.href}
                    icon={f.icon ?? undefined}
                    className="h-full w-full rounded object-contain"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{f.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{f.href}</span>
                </span>
                <button
                  type="button"
                  disabled
                  title="外站链接需联网后打开"
                  className="shrink-0 rounded-md border border-border/60 bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground cursor-not-allowed"
                >
                  联网后打开
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 稍后再看 / 续播 */}
      <section aria-labelledby="offline-watch-later-heading">
        <div className="flex items-center justify-between">
          <h2 id="offline-watch-later-heading" className="flex items-center gap-2 text-sm font-bold">
            <Clock className="h-4 w-4 text-sky-500" />
            稍后再看 / 续播
          </h2>
          {watchLaterTotal > OFFLINE_SNAPSHOT_SECTION_LIMIT && (
            <Link href="/videos" className="text-xs text-primary hover:underline">
              去视频页查看全部（{watchLaterTotal} 条）
            </Link>
          )}
        </div>
        {snapshot === null ? (
          <p className="mt-3 text-xs text-muted-foreground">正在读取本机快照…</p>
        ) : watchLaterRows.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {filtering
              ? `没有标题包含「${query.trim()}」的本机稍后再看或续播记录。`
              : '还没有稍后再看或续播记录。稍后再看只保存标题等元数据，视频本身需联网后打开。'}
          </p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {watchLaterRows.map((row) =>
              row.kind === 'resume' ? (
                <li
                  key={row.key}
                  className="flex items-center gap-3 rounded-xl border border-border/70 glass-surface p-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/60">
                    <Play className="h-4 w-4 text-sky-500" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      续播 · 已看 {row.progressPercent}%
                    </span>
                  </span>
                  <Link
                    href={`/videos/player?id=${encodeURIComponent(row.videoId)}`}
                    className="shrink-0 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary hover:bg-primary/20"
                  >
                    继续看
                  </Link>
                </li>
              ) : (
                <li
                  key={row.key}
                  className="flex items-center gap-3 rounded-xl border border-border/70 glass-surface p-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/60">
                    <CloudOff className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{row.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.href}</span>
                  </span>
                  <button
                    type="button"
                    disabled
                    title="外站视频需联网后打开"
                    className="shrink-0 rounded-md border border-border/60 bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground cursor-not-allowed"
                  >
                    联网后打开
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
        {watchLaterRows.length > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            稍后再看只保存了标题等元数据，视频本身需联网后打开。
          </p>
        )}
      </section>
    </div>
  )
}
