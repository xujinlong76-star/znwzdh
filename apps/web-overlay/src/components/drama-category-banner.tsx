'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Bell, Clapperboard, Film, Sparkles, Tv } from 'lucide-react'
import { useWatchlist } from '@/hooks/useWatchlist'
import { partitionWatchlist } from '@/lib/watchlist'

interface DramaPoster {
  key: string
  title: string
  data: string
}

interface DramaMediaPayload {
  posters?: DramaPoster[]
}

export interface DramaCategoryBannerProps {
  totalSites: number
  freeCount: number
  platformCount: number
}

/**
 * 短剧专区顶部横幅：取代通用的「技术视频库」导流条，给出剧场视觉海报、
 * 基于用户真实追剧清单的提醒状态，以及看剧 / 做剧场景直达。
 */
export function DramaCategoryBanner({
  totalSites,
  freeCount,
  platformCount,
}: DramaCategoryBannerProps) {
  const { ready, entries } = useWatchlist()
  const [posters, setPosters] = useState<DramaPoster[]>([])

  useEffect(() => {
    let active = true
    fetch('/drama-media.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: DramaMediaPayload | null) => {
        if (!active || !payload?.posters) return
        setPosters(payload.posters.slice(0, 4))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const parts = ready ? partitionWatchlist(entries, new Date()) : null
  const dueCount = parts?.due.length ?? 0
  const checkCount = parts?.check.length ?? 0
  const totalWatching = entries.length

  return (
    <section
      aria-label="短剧专区导览"
      className="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-gradient-to-br from-zinc-950 via-zinc-900 to-amber-950/85 text-zinc-50 p-4 sm:p-5 shadow-sm"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-12 w-56 h-56 rounded-full bg-amber-400/10 blur-3xl"
      />
      <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-200 font-medium">
              <Clapperboard className="w-3 h-3" aria-hidden="true" />
              短剧专区
            </span>
            <span className="text-zinc-300 tabular-nums">
              已收录 {totalSites} 个短剧入口
              {freeCount > 0 ? ` · 畅看免流/免费向 ${freeCount} 个` : ''}
              {platformCount > 0 ? ` · 平台/制作生态 ${platformCount} 个` : ''}
            </span>
          </div>

          <p className="text-xs sm:text-[13px] text-zinc-200 leading-relaxed">
            支持一键跳转官网、按「畅看短剧 / 平台短剧」快速筛选，也可在下方任意平台卡片点击
            <strong className="font-medium text-amber-200">「追剧」</strong>
            记录看到第几集与更新节奏；本机/云端清单自动按你标注的节奏提醒。
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
            <Link
              href="/me/watchlist"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 text-zinc-950 font-medium hover:bg-amber-300 transition-colors"
            >
              <Bell className="w-3.5 h-3.5" aria-hidden="true" />
              {ready ? (
                dueCount > 0 ? (
                  <span>今日待看 {dueCount} 部 · 去追剧清单</span>
                ) : totalWatching > 0 ? (
                  <span>
                    在追 {totalWatching} 部
                    {checkCount > 0 ? `（${checkCount} 部可查更新）` : ''}
                  </span>
                ) : (
                  <span>我的追剧清单</span>
                )
              ) : (
                <span>我的追剧清单</span>
              )}
            </Link>
            <Link
              href="/scenes/watch-drama"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-zinc-100 transition-colors"
            >
              <Tv className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
              <span>追剧攻略</span>
            </Link>
            <Link
              href="/scenes/make-drama"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-zinc-100 transition-colors"
            >
              <Film className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
              <span>AI 短剧创作</span>
            </Link>
            <Link
              href="/scenes/make-manga-drama"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/15 text-zinc-100 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
              <span>漫剧制作</span>
            </Link>
            <Link
              href="/brief"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 transition-colors"
            >
              <span>今日简报</span>
            </Link>
          </div>
        </div>

        {posters.length > 0 && (
          <div className="hidden sm:flex items-center gap-2 shrink-0" aria-hidden="true">
            {posters.map((poster) => (
              <div
                key={poster.key}
                className="w-12 h-20 rounded-lg overflow-hidden border border-white/15 bg-zinc-900 shadow-md"
                title={poster.title}
              >
                <img
                  src={poster.data}
                  alt={poster.title}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
