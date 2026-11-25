'use client'

/**
 * 简报页的「待读箱」岛（客户端岛，BriefResurface 的同款做法）。
 *
 * 为什么必须是岛：/brief 是服务端渲染的中枢缓存页，看不到本机收藏；
 * 待读的原料（localStorage 收藏 + 分流偏好）只存在用户自己的浏览器里。
 * SSR 壳里不出现任何用户数据（brief-page.test.ts 的红线），岛在挂载后现算：
 * 待读箱里 24 小时内到期的前 3 条。没有待读收藏时安静消失，不拿空盒子占版面。
 *
 * 与「今日重温」并列但方向写清：一个是「快过期的新收」，一个是「好久没翻的旧藏」。
 * 简报岛只放「重开 + 续期 / 值得留 / 移出」：删数据是已移出区的动作，留给 /favorites/shelved。
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Inbox } from 'lucide-react'
import { useFavorites } from '@/hooks/useFavorites'
import { useTriageSettings } from '@/hooks/useTriageSettings'
import {
  resolveTriageStatus,
  selectInboxDueSoon,
} from '@/lib/favorites-triage'
import { TriageInboxRow } from '@/components/triage-inbox-row'

export default function BriefTriage() {
  const favorites = useFavorites()
  const settings = useTriageSettings()
  const [notice, setNotice] = useState<string | null>(null)

  const inboxCount = useMemo(
    () => favorites.items.filter((f) => resolveTriageStatus(f) === 'inbox').length,
    [favorites.items],
  )
  const picks = useMemo(
    () =>
      favorites.ready && settings.enabled
        ? selectInboxDueSoon(favorites.items, settings, Date.now())
        : [],
    [favorites.ready, favorites.items, settings],
  )

  // 箱中有条目但 24h 内无到期时同样安静消失：不拿整节 + 一句
  // 「暂时没有」占版面（picks 为空时本节没有可操作内容）。
  if (!favorites.ready || !settings.enabled || inboxCount === 0 || picks.length === 0) return null

  const handleReopen = (siteId: string) => {
    favorites.recordOpened(siteId)
  }

  const handleRenew = (siteId: string) => {
    favorites.renewInbox(siteId)
  }

  const handlePromote = (siteId: string) => {
    favorites.promoteFavorite(siteId)
  }

  const handleShelve = (siteId: string) => {
    if (!favorites.shelveFavorite(siteId)) {
      setNotice('移出失败：本机存储写不进去，收藏还在原处')
      return
    }
    setNotice('已移到「已移出」，可在收藏页找回')
  }

  return (
    <section aria-label="待读箱" className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Inbox className="h-5 w-5 text-sky-500" aria-hidden /> 待读箱
        </h2>
        <Link href="/favorites" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          打开待读箱 <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        共 {inboxCount} 条待读，{picks.length} 条 24 小时内到期——这些是快过期的新收，
        和「今日重温」里好久没翻的旧藏方向不同。点标题就能打开（打开即算已读）。
      </p>
      {notice ? <p role="status" aria-live="polite" className="mb-3 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">{notice}</p> : null}
      <ul className="space-y-2">
        {picks.map((item) => (
          <TriageInboxRow
            key={item.siteId}
            item={item}
            settings={settings}
            now={Date.now()}
            onReopen={handleReopen}
            onRenew={handleRenew}
            onPromote={handlePromote}
            onShelve={handleShelve}
          />
        ))}
      </ul>
    </section>
  )
}
