'use client'

/**
 * 「好久没打开」视图（/favorites/stale）。
 *
 * 今日重温的另一半：/brief 的岛只推 3 条轻提醒，这里是完整的分拣台——
 * 全部超过 90 天没有记录到的打开的收藏，按最久没打开排前面，每条都能
 * 一键重开 / 归档 / 删除；归档过的列在下面，可恢复。
 *
 * 口径（与 lib/resurface 一致）：「没打开」= 本机没记录到打开。直接点卡片
 * 打开不会被记下来，所以这里可能比你实际打开的要多——文案按这个口径写，
 * 不把任何一条说成「你肯定没看过」。
 * 归档只保存在本机；删除是真删（走收藏 remove 的同一条路，云端也会删）。
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { useFavorites } from '@/hooks/useFavorites'
import { readOfflineVisits, type RecentVisit } from '@/lib/offline-recent'
import { selectStaleFavorites, type ResurfacedFavorite } from '@/lib/resurface'
import {
  archiveItems,
  readArchivedFavorites,
  unarchiveItems,
  writeArchivedFavorites,
  type ArchivedFavoriteItem,
} from '@/lib/favorites-archive'
import { ResurfaceRow } from '@/components/resurface-row'
import { UserCenterNav } from '@/components/user-center/user-center-nav'
import { Archive, History, Undo2 } from 'lucide-react'

export default function StaleFavoritesPage() {
  const favorites = useFavorites()
  const [visits, setVisits] = useState<RecentVisit[]>([])
  const [visitsLoaded, setVisitsLoaded] = useState(false)
  const [archived, setArchived] = useState<ArchivedFavoriteItem[]>(() =>
    typeof window === 'undefined' ? [] : readArchivedFavorites(),
  )
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    readOfflineVisits(50)
      .then((rows) => {
        if (active && Array.isArray(rows)) setVisits(rows)
      })
      .catch(() => {
        // 最近访问读不到时只按收藏时间算旧，不阻断分拣
      })
      .finally(() => {
        if (active) setVisitsLoaded(true)
      })
    return () => {
      active = false
    }
  }, [])

  const stale = useMemo(
    () => (favorites.ready && visitsLoaded ? selectStaleFavorites(favorites.items, visits, Date.now()) : []),
    [favorites, visits, visitsLoaded],
  )

  const handleReopen = (siteId: string) => {
    favorites.recordOpened(siteId)
  }

  const handleArchive = (item: ResurfacedFavorite) => {
    const next = archiveItems(archived, item, Date.now())
    if (!writeArchivedFavorites(next)) {
      setNotice('归档失败：本机存储写不进去，收藏还在原处')
      return
    }
    setArchived(next)
    favorites.remove(item.siteId)
    setNotice(`已归档「${item.title}」，下面可以恢复`)
  }

  const handleDelete = (item: ResurfacedFavorite) => {
    if (!window.confirm(`确定要删除收藏「${item.title}」吗？删除后无法恢复。`)) return
    favorites.remove(item.siteId)
    setNotice(`已删除「${item.title}」`)
  }

  const handleRestore = (item: ArchivedFavoriteItem) => {
    const result = favorites.importJson(
      JSON.stringify({
        version: 1,
        items: [
          {
            siteId: item.siteId,
            title: item.title,
            href: item.href,
            icon: item.icon,
            description: item.description,
            note: item.note,
            tags: item.tags,
            folderId: item.folderId,
            createdAt: item.createdAt,
          },
        ],
      }),
    )
    if (!result.ok || result.imported === 0) {
      setNotice(`恢复失败：${result.error ?? '这条收藏没能重新加入'}`)
      return
    }
    const { items } = unarchiveItems(archived, item.siteId)
    if (!writeArchivedFavorites(items)) {
      setNotice(`「${item.title}」已恢复到收藏，但归档柜没能同步清掉（本机存储写不进去）`)
      return
    }
    setArchived(items)
    setNotice(`已把「${item.title}」恢复到收藏`)
  }

  const loaded = favorites.ready && visitsLoaded

  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <UserCenterNav />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <History className="h-6 w-6 text-amber-500" aria-hidden />
            好久没打开
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            超过 90 天没有从这里打开过的收藏，按最久没打开的排在前面。只按本机记录算——
            直接点卡片打开的不计入，所以这里可能比你实际打开的要多。点标题就能重开，
            不想要的归档（可恢复）或删除。
          </p>
        </div>

        {notice ? (
          <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">{notice}</p>
        ) : null}

        {!loaded ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl border bg-card/50" />
            ))}
          </div>
        ) : stale.length === 0 && archived.length === 0 ? (
          <EmptyState
            icon={History}
            iconTone="success"
            title="没有好久没打开的收藏"
            description="要么收藏都还新鲜，要么你最近都翻过它们。攒下新收藏、放上 90 天没打开，它就会出现在这里等你重温。"
            action={
              <Button asChild size="sm" variant="outline" className="text-xs">
                <Link href="/favorites">回我的收藏</Link>
              </Button>
            }
          />
        ) : (
          <>
            {stale.length > 0 ? (
              <section aria-label="好久没打开的收藏">
                <p className="mb-3 text-xs text-muted-foreground">共 {stale.length} 个收藏超过 90 天没打开</p>
                <ul className="space-y-2">
                  {stale.map((item) => (
                    <ResurfaceRow
                      key={item.siteId}
                      item={item}
                      onReopen={handleReopen}
                      onArchive={handleArchive}
                      onDelete={handleDelete}
                    />
                  ))}
                </ul>
              </section>
            ) : (
              <p className="text-sm text-muted-foreground">没有好久没打开的收藏——最近都翻过，很好。</p>
            )}

            {archived.length > 0 ? (
              <section aria-label="已归档的收藏">
                <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
                  <Archive className="h-5 w-5 text-muted-foreground" aria-hidden />
                  已归档（{archived.length}）
                </h2>
                <p className="mb-3 text-xs text-muted-foreground">归档只保存在本机，恢复后会重新回到收藏。</p>
                <ul className="space-y-2">
                  {archived.map((item) => (
                    <li key={item.siteId} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{item.title}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          归档于 {new Date(item.archivedAt).toLocaleDateString('zh-CN')}
                        </p>
                      </div>
                      <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={() => handleRestore(item)}>
                        <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                        恢复
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
      <Footer />
    </Container>
  )
}
