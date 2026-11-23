'use client'

/**
 * 简报页的「常去却未收藏」岛（客户端岛，BriefResurface 的同款做法）。
 *
 * 为什么必须是岛：/brief 是服务端渲染的中枢缓存页，看不到本机收藏；
 * 建议的原料（本机离线最近访问快照，含 count）只存在用户自己的浏览器里。
 * SSR 壳里不出现任何用户数据（brief-page.test.ts 的红线），岛在挂载后现算。
 *
 * 为什么在 /brief 再露一次：21:22 轮 W3 候选 6 只在 /favorites 落了这块建议
 * 区；/favorites 是低频页，只逛简报不逛收藏页的用户永远看不到。/brief 是
 * 每天一份的回访钩子，同一建议在用户每天必经之地再露一次，触达才成立。
 * 反向是上面的「今日重温」（已收藏却 90 天没打开 → 重温），这里是正向
 * （常点却没收藏 → 一键收藏），两岛并排、同口径（按本机记录算）。
 *
 * 零新数据源、零新依赖、零新增请求：纯函数复用
 * lib/frequent-unfavorited.ts 的 selectFrequentUnfavoritedVisits（门槛
 * count ≥ 3 与速览坞置顶同一口径、上限 3 条），一键收藏复用
 * useFavorites().toggle。无建议时安静消失，不拿空盒子占版面。
 * 登录用户另一设备的高频点击不进榜，文案因此写“按本机记录算”
 * （与 /favorites 建议区、stale 横幅同口径），不谎称跨设备准确。
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Star } from 'lucide-react'
import { SiteFavicon } from '@/components/site-favicon'
import { useFavorites } from '@/hooks/useFavorites'
import {
  FREQUENT_UNFAVORITED_LIMIT,
  selectFrequentUnfavoritedVisits,
} from '@/lib/frequent-unfavorited'
import {
  OFFLINE_RECENT_LIMIT,
  readOfflineVisits,
  recordOfflineVisit,
  type RecentVisit,
} from '@/lib/offline-recent'
import { safeHref } from '@/lib/safe-url'

export default function BriefFrequentUnfavorited() {
  const favorites = useFavorites()
  // 频率信号只取本机快照——useMergedVisits 的合并 visits 无 count，
  // 与 /favorites 建议区同款：另读一次 readOfflineVisits（与 stale 计算
  // 并行，不阻塞简报正文；读失败 → 空区不渲染）。
  const [localVisits, setLocalVisits] = useState<RecentVisit[]>([])
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    let alive = true
    readOfflineVisits(OFFLINE_RECENT_LIMIT)
      .then((list) => {
        if (alive) setLocalVisits(list)
      })
      .catch(() => {
        // 本地读取失败保持空区不渲染，不阻断简报本身
      })
    return () => {
      alive = false
    }
  }, [])

  const picks = useMemo(() => {
    if (dismissed || localVisits.length === 0) return []
    return selectFrequentUnfavoritedVisits(
      localVisits,
      new Set(favorites.items.map((f) => f.siteId)),
      FREQUENT_UNFAVORITED_LIMIT,
    )
  }, [localVisits, favorites.items, dismissed])

  // 收藏未就绪前不渲染：items 为空时算出的建议可能含已收藏站，闪一下
  // 再消失比不出现更坏；与 BriefResurface 的 favorites.ready 门同款。
  if (!favorites.ready || picks.length === 0) return null

  return (
    <section aria-label="常去却未收藏" className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Star className="h-5 w-5 text-amber-500" aria-hidden /> 常去却未收藏
        </h2>
        <Link href="/favorites" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          去收藏页看看 <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        按本机记录算，最近常去、还没收藏的站，点一下就收进收藏，换设备 / 清数据也不丢直达路径。
      </p>
      <ul className="space-y-2">
        {picks.map((visit) => (
          <li key={visit.id} className="flex items-center gap-2 rounded-lg border border-border/50 bg-background/60 px-2 py-1.5 text-xs">
            <span className="w-5 h-5 shrink-0 flex items-center justify-center">
              <SiteFavicon title={visit.title} url={visit.href} icon={visit.icon} className="w-5 h-5 object-contain rounded" />
            </span>
            <a
              href={safeHref(visit.href)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => recordOfflineVisit(visit)}
              className="min-w-0 flex-1 truncate font-medium text-foreground hover:text-primary"
            >
              {visit.title}
            </a>
            <span className="shrink-0 text-muted-foreground">最近常去 · {visit.count ?? 1} 次</span>
            <button
              type="button"
              onClick={() => {
                void favorites.toggle({
                  siteId: visit.id,
                  title: visit.title,
                  href: visit.href,
                  icon: visit.icon ?? undefined,
                })
              }}
              className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-foreground hover:bg-accent"
            >
              <Star className="h-3.5 w-3.5" />
              收藏
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-right">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          不再提示
        </button>
      </div>
    </section>
  )
}
