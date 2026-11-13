'use client'

/**
 * 简报页的「今日重温」岛（客户端岛，BriefWatch 的同款做法）。
 *
 * 为什么必须是岛：/brief 是服务端渲染的中枢缓存页，看不到本机收藏；
 * 重温的原料（localStorage 收藏 + 离线最近访问）只存在用户自己的浏览器里。
 * SSR 壳里不出现任何用户数据（brief-page.test.ts 的红线），岛在挂载后
 * 现算：超过 90 天没有记录到的打开的收藏里取最久没打开的 3 条。
 * 没有可重温的收藏时安静消失，不拿空盒子占版面。
 * 简报岛只放「重开 + 归档」：删数据是分拣动作，留给 /favorites/stale。
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, History } from 'lucide-react'
import { useFavorites } from '@/hooks/useFavorites'
import { readOfflineVisits, type RecentVisit } from '@/lib/offline-recent'
import { selectDailyResurface, type ResurfacedFavorite } from '@/lib/resurface'
import { archiveItems, readArchivedFavorites, writeArchivedFavorites } from '@/lib/favorites-archive'
import { ResurfaceRow } from '@/components/resurface-row'

export default function BriefResurface() {
  const favorites = useFavorites()
  const [visits, setVisits] = useState<RecentVisit[]>([])
  const [visitsLoaded, setVisitsLoaded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    readOfflineVisits(50)
      .then((rows) => {
        if (active && Array.isArray(rows)) setVisits(rows)
      })
      .catch(() => {
        // 最近访问读不到时只按收藏时间算旧，不阻断重温
      })
      .finally(() => {
        if (active) setVisitsLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])

  const picks = useMemo(
    () => (favorites.ready && visitsLoaded ? selectDailyResurface(favorites.items, visits, Date.now()) : []),
    [favorites, visits, visitsLoaded],
  )

  if (!favorites.ready || !visitsLoaded) return null
  if (picks.length === 0) return null

  const handleReopen = (siteId: string) => {
    favorites.recordOpened(siteId)
  }

  const handleArchive = (item: ResurfacedFavorite) => {
    const next = archiveItems(readArchivedFavorites(), item, Date.now())
    if (!writeArchivedFavorites(next)) {
      setNotice('归档失败：本机存储写不进去，收藏还在原处')
      return
    }
    favorites.remove(item.siteId)
    setNotice(`已归档「${item.title}」，可在「好久没打开」里恢复`)
  }

  return (
    <section aria-label="今日重温" className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <History className="h-5 w-5 text-amber-500" aria-hidden /> 今日重温
        </h2>
        <Link href="/favorites/stale" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          全部好久没打开 <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        这些收藏超过 90 天没有从这里打开过——按本机记录算，直接点卡片打开的不计入。今天翻一个？
      </p>
      {notice ? <p className="mb-3 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{notice}</p> : null}
      <ul className="space-y-2">
        {picks.map((item) => (
          <ResurfaceRow key={item.siteId} item={item} onReopen={handleReopen} onArchive={handleArchive} />
        ))}
      </ul>
    </section>
  )
}
