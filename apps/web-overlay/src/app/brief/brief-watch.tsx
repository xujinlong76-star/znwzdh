'use client'

/**
 * 简报页的在追剧提醒岛：带当前登录身份再取一次 /api/brief/today，
 * 中枢按其账号里的追剧清单现算 due（到更新日）/ check（节奏未标注）。
 *
 * 口径与追剧清单页一致：due 只断言「按你标注的节奏，今天是更新日」，
 * 不断言平台真的更新了；check 只给「去看看有没有更新」的诚实入口。
 * 未登录（watch=null）时给一句通用引导；已登录但今天没到期条目时
 * 安静消失，不拿空盒子占版面。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BellRing, Clapperboard } from 'lucide-react'
import { hubGet } from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'
import type { HubBrief } from '@/lib/server/brief'

export default function BriefWatch() {
  const [brief, setBrief] = useState<HubBrief | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    hubGet<HubBrief>('/api/brief/today')
      .then((data) => {
        if (!cancelled) setBrief(data)
      })
      .catch(() => {
        /* 取不到简报（含未登录被拒）时岛保持安静：页面主体是 SSR 的通用版，
           提醒区缺席比报错更合适，登录引导行也不依赖这次请求成功 */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!loaded) return null

  const watch = brief?.watch ?? null
  if (!watch) {
    return (
      <section aria-label="在追的剧" className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Clapperboard className="h-4 w-4" aria-hidden />
          登录后，你在追的剧到更新日会出现在这里提醒你。
          <Link href="/me/watchlist" className="text-primary hover:underline">
            去看看我的追剧清单
          </Link>
        </span>
      </section>
    )
  }

  if (watch.due.length === 0 && watch.check.length === 0) return null

  return (
    <section aria-label="在追的剧今日提醒" className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-950/30">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <BellRing className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden /> 在追的剧 · 今日提醒
      </h2>
      {watch.due.length > 0 ? (
        <ul className="space-y-1.5">
          {watch.due.map((item) => (
            <li key={item.key} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <a href={safeHref(item.playUrl)} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-primary">
                {item.title}
              </a>
              <span className="text-xs text-muted-foreground">
                {item.platformTitle} · 按你标注的节奏今天更新 · 看到第 {item.episode} 集
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {watch.check.length > 0 ? (
        <ul className="mt-1.5 space-y-1.5">
          {watch.check.map((item) => (
            <li key={item.key} className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <a href={safeHref(item.playUrl)} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-primary">
                {item.title}
              </a>
              <span className="text-xs text-muted-foreground">{item.platformTitle} · 还没标注更新节奏，去看看有没有更新</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
