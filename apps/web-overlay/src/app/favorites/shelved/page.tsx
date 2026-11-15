'use client'

/**
 * 「已移出」视图（/favorites/shelved）。
 *
 * 待读分流的出口：待读箱 / 已读到期未处理，或用户手动移出的收藏，
 * 原文完整保留在这里。布局范式取 /favorites/stale 的归档列表：
 * 列表 + 每条恢复 / 删除。
 *
 * 口径（与 lib/favorites-triage 一致）：
 *  - 移出 ≠ 删除 ≠ 归档：移出是待读流转，归档是用户主动冷藏——
 *    两只柜子、两个键、两处入口，文案上区分开；
 *  - 不自动清，无限期保留，直到用户显式点「清空已移出」（二次确认，
 *    文案写明不可恢复）。真删除只发生两处：逐条删（确认框），或清空（确认框）；
 *  - 恢复默认进永久库，也可以选「放回待读箱」重新获得完整待读时间。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { Footer } from '@/components/footer'
import { Button } from '@/components/ui/button'
import { useFavorites } from '@/hooks/useFavorites'
import {
  readShelvedFavorites,
  type ShelvedFavoriteItem,
} from '@/lib/favorites-shelved'
import { safeHref } from '@/lib/safe-url'
import { UserCenterNav } from '@/components/user-center/user-center-nav'
import { Inbox, Trash2, Undo2 } from 'lucide-react'

export default function ShelvedFavoritesPage() {
  const favorites = useFavorites()
  const [shelved, setShelved] = useState<ShelvedFavoriteItem[]>(() =>
    typeof window === 'undefined' ? [] : readShelvedFavorites(),
  )
  const [notice, setNotice] = useState<string | null>(null)

  // 已移出区可能在别处变化（打开时结算、收藏页恢复/删除）：订阅
  // navhub_shelved_updated（useFavorites 写盘后派发）后重读，不只依赖挂载时的一次快照。
  useEffect(() => {
    const refresh = () => setShelved(readShelvedFavorites())
    window.addEventListener('navhub_shelved_updated', refresh)
    return () => window.removeEventListener('navhub_shelved_updated', refresh)
  }, [])

  const handleRestore = (item: ShelvedFavoriteItem, destination: 'inbox' | 'permanent') => {
    const result = favorites.restoreShelved(item.siteId, destination)
    if (!result.ok) {
      setNotice(`恢复失败：${result.error ?? '这条收藏没能回来'}`)
      return
    }
    setShelved((prev) => prev.filter((i) => i.siteId !== item.siteId))
    setNotice(
      destination === 'inbox'
        ? `已把「${item.title}」放回待读箱，重新获得完整待读时间`
        : `已把「${item.title}」恢复到永久库`,
    )
  }

  const handleDelete = (item: ShelvedFavoriteItem) => {
    if (!window.confirm(`确定要删除「${item.title}」吗？它在已移出区里的副本也会删掉，删除后无法恢复。`)) return
    if (!favorites.deleteShelved(item.siteId)) {
      setNotice(`删除失败：「${item.title}」还在已移出区里（本机存储写不进去）`)
      return
    }
    setShelved((prev) => prev.filter((i) => i.siteId !== item.siteId))
    setNotice(`已删除「${item.title}」`)
  }

  const handleClearAll = () => {
    if (shelved.length === 0) return
    if (
      !window.confirm(
        `确定要清空已移出区吗？${shelved.length} 条记录会全部删掉，无法恢复。收藏本身不受影响——它们早已不在活跃列表里。`,
      )
    ) {
      return
    }
    if (!favorites.clearShelved()) {
      setNotice('清空失败：已移出区还在（本机存储写不进去）')
      return
    }
    setShelved([])
    setNotice('已清空已移出区')
  }

  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <UserCenterNav />
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <Inbox className="h-6 w-6 text-sky-500" aria-hidden />
            已移出
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            待读箱 / 已读到期没处理、或你手动移出的收藏，原文完整保留在这里。
            这里不会自动清理——删掉才是真删。恢复默认进永久库，也可以放回待读箱重新计时。
          </p>
        </div>

        {notice ? (
          <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">{notice}</p>
        ) : null}

        {shelved.length === 0 ? (
          <EmptyState
            icon={Inbox}
            iconTone="success"
            title="已移出区是空的"
            description="待读箱里的新收藏到期没打开、或已读的收藏到期没晋升时，会先移到这里等你找回，而不是直接删掉。"
            action={
              <Button asChild size="sm" variant="outline" className="text-xs">
                <Link href="/favorites">回我的收藏</Link>
              </Button>
            }
          />
        ) : (
          <>
            <section aria-label="已移出的收藏">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">共 {shelved.length} 条已移出，可找回</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="min-h-11 border-destructive/30 text-[11px] text-destructive-text hover:bg-destructive/15"
                  onClick={handleClearAll}
                >
                  <Trash2 className="mr-1 h-3 w-3" aria-hidden />
                  清空已移出
                </Button>
              </div>
              <ul className="space-y-2">
                {shelved.map((item) => (
                  <li key={item.siteId} className="flex items-start gap-3 rounded-xl border bg-card p-3">
                    <div className="min-w-0 flex-1">
                      <a
                        href={safeHref(item.href)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-sm font-semibold hover:text-primary"
                      >
                        {item.title}
                      </a>
                      {item.description ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.description}</p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        移出于 {new Date(item.movedOutAt).toLocaleDateString('zh-CN')}
                        {' · '}
                        原状态：{item.originStatus === 'inbox' ? '待读箱' : '已读'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-11 shrink-0 text-xs"
                        onClick={() => handleRestore(item, 'permanent')}
                      >
                        <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                        恢复到永久库
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-11 shrink-0 text-xs"
                        onClick={() => handleRestore(item, 'inbox')}
                      >
                        <Inbox className="mr-1 h-3.5 w-3.5" aria-hidden />
                        放回待读箱
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-11 shrink-0 text-xs text-muted-foreground hover:text-destructive-text"
                        onClick={() => handleDelete(item)}
                        aria-label={`删除 ${item.title}`}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                        删除
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
      <Footer />
    </Container>
  )
}
