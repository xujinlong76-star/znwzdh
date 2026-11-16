'use client'

/**
 * 简报页的「今日重温」岛（客户端岛，BriefWatch 的同款做法）。
 *
 * 为什么必须是岛：/brief 是服务端渲染的中枢缓存页，看不到本机收藏；
 * 重温的原料（localStorage 收藏 + 本机离线最近访问 + 登录用户的云端 visits）
 * 只存在用户自己的浏览器 / 会话里。SSR 壳里不出现任何用户数据
 * （brief-page.test.ts 的红线），岛在挂载后现算：超过 90 天没有记录到的打开
 * 的收藏里取最久没打开的 3 条。登录用户按本机 + 云端合并后的记录算（另一台
 * 设备上打开的也计入），匿名用户只按本机记录算。
 * 没有可重温的收藏时安静消失，不拿空盒子占版面。
 * 简报岛只放「重开 + 归档」：删数据是分拣动作，留给 /favorites/stale。
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, History } from 'lucide-react'
import { useFavorites } from '@/hooks/useFavorites'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import { useMergedVisits } from '@/lib/resurface-visits'
import { selectDailyResurface, type ResurfacedFavorite } from '@/lib/resurface'
import { archiveItems, readArchivedFavorites, writeArchivedFavorites } from '@/lib/favorites-archive'
import { ResurfaceRow } from '@/components/resurface-row'

export default function BriefResurface() {
  const favorites = useFavorites()
  // 登录态（与接力卡云端同步同款判定）：只有登录用户才取云端 visits；
  // 匿名用户不发任何云端请求，行为与接线前一致。
  const identityReady = useIdentityReady()
  const isLoggedIn =
    identityReady.ready && !identityReady.isAnonymous && !!identityReady.identity
  // 本机 + 云端合并后的最近访问（云端取不到时回落本机-only，见 lib/resurface-visits）。
  const { visits, loaded: visitsLoaded } = useMergedVisits(isLoggedIn)
  const [notice, setNotice] = useState<string | null>(null)

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
        {isLoggedIn
          ? '这些收藏超过 90 天没有在任何设备上打开过——按你的账号记录算。今天翻一个？'
          : '这些收藏超过 90 天没有在本机打开过——按本机记录算，另一台设备上打开的不计入。今天翻一个？'}
      </p>
      {notice ? <p className="mb-3 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{notice}</p> : null}
      <ul className="space-y-2">
        {picks.map((item) => (
          <ResurfaceRow key={item.siteId} item={item} isLoggedIn={isLoggedIn} onReopen={handleReopen} onArchive={handleArchive} />
        ))}
      </ul>
    </section>
  )
}
