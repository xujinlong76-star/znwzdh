'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Flame, Search } from 'lucide-react'
import { safeHref } from '@/lib/safe-url'
import { hubGet } from '@/lib/navhub-api'
import { formatHotValue } from '@/lib/format-hot-value'
import type { HubBrief } from '@/lib/server/brief'

/**
 * 首页「今日简报」紧凑条（客户端版）。
 *
 * 只放三样真实内容：小猫猫开场白、各源第 1 名、一句新收录提示，
 * 全部来自中枢按天组版的简报缓存；取不到或全空时整条不渲染，
 * 不让首页为一个模块开天窗或放占位假数据。完整版在 /brief。
 *
 * U-358：原为 async 服务端组件（`loadBriefToday` 走服务端直连中枢），由 page.tsx
 * 透传——服务端每请求都取数渲染、客户端代码也随首屏下发。
 * 本条只在「今日中心」小窗打开时才需要，改为客户端组件后由 NavigationContent
 * 以 dynamic(ssr:false) 按需加载；取数沿用 `app/brief/brief-watch.tsx` 已有的
 * 客户端模式 `hubGet('/api/brief/today')`（同一端点、同一 HubBrief 形状），
 * 加载中 / 取不到时返回 null，与旧版「无简报不渲染」行为一致。
 */
export function HomeBriefStrip() {
  const [brief, setBrief] = useState<HubBrief | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    hubGet<HubBrief>('/api/brief/today')
      .then((data) => {
        if (!cancelled) setBrief(data)
      })
      .catch(() => {
        /* 取不到简报时整条不渲染，不编假简报 */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!loaded) return null
  if (!brief) return null
  const firsts = [...new Map(brief.hotPicks.map((p) => [p.source, p])).values()].slice(0, 5)
  if (firsts.length === 0 && brief.newSites.length === 0) return null

  return (
    <section aria-label="今日简报" className="mx-auto w-full max-w-[1600px] px-3 pt-3 sm:px-5">
      <div className="rounded-2xl border bg-gradient-to-r from-primary/10 via-card to-card px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <Flame className="h-4 w-4 text-orange-500" aria-hidden />
            今日简报 · {brief.date.slice(5)}
          </span>
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{brief.opening}</p>
          <Link href="/brief" className="inline-flex min-h-6 shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline">
            看完整简报 <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {firsts.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {firsts.map((pick) => {
              const hot = formatHotValue(pick.hotValue)
              return (
                <li key={pick.source} className="inline-flex min-h-6 min-w-0 items-center gap-1.5">
                  <span className="shrink-0 font-medium text-foreground/70">{pick.sourceName}</span>
                  <a
                    href={safeHref(pick.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="max-w-56 truncate hover:text-primary"
                  >
                    {pick.title}
                  </a>
                  {/* 站内搜是标题旁的独立小按钮（更小一号、shrink-0，不挤占标题截断），
                      同页跳 /search，不开新标签；标题本身仍是直达原平台的外链。 */}
                  <Link
                    href={`/search?q=${encodeURIComponent(pick.title)}`}
                    aria-label={`站内搜「${pick.title}」`}
                    title={`站内搜「${pick.title}」`}
                    className="inline-flex shrink-0 items-center rounded-md p-0.5 text-muted-foreground hover:text-primary"
                  >
                    <Search className="h-3 w-3" aria-hidden />
                  </Link>
                  {hot ? <span className="shrink-0">{hot}</span> : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </section>
  )
}
