'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, Star, ExternalLink } from 'lucide-react'
import Link from 'next/link'

import { fetchTrending } from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'

interface HotSite {
  id: string
  title: string
  url: string
  score: number
  description?: string
  icon?: string
}

/**
 * 兜底演示数据。
 *
 * 必须显式标注「演示数据」：以前中枢不可用时，这 4 条硬编码站点会以
 * 和真实榜单完全相同的样式渲染在「今日技术飙升热度榜」标题下，
 * 用户会把编造的分数当成全网事实（对比：天气 / RSS 小卡早就标了演示数据）。
 */
const DEMO_SITES: HotSite[] = [
  { id: '1', title: 'Next.js 15', url: 'https://nextjs.org', score: 124000, description: '全栈 React 框架' },
  { id: '2', title: 'Tailwind CSS v4', url: 'https://tailwindcss.com', score: 82000, description: '实用类优先 CSS' },
  { id: '3', title: 'Vitest 3', url: 'https://vitest.dev', score: 45000, description: '极速下一代测试框架' },
  { id: '4', title: 'Hono', url: 'https://hono.dev', score: 23000, description: '终极轻量边缘 Web 框架' },
]

export function TrendingWidget() {
  const [sites, setSites] = useState<HotSite[]>([])
  const [loading, setLoading] = useState(true)
  const [demo, setDemo] = useState(false)

  useEffect(() => {
    let unmounted = false
    const showDemo = () => {
      if (unmounted) return
      setSites(DEMO_SITES)
      setDemo(true)
    }
    fetchTrending(5)
      .then((items) => {
        if (unmounted) return
        if (items && items.length > 0) {
          setSites(
            items.map((s) => ({
              id: s.id,
              title: s.title,
              url: s.url,
              score: s.trendScore ?? s.visitCount ?? 100,
              description: s.description ?? undefined,
            }))
          )
          setDemo(false)
        } else {
          showDemo()
        }
      })
      .catch(() => {
        showDemo()
      })
      .finally(() => {
        if (!unmounted) setLoading(false)
      })
    return () => {
      unmounted = true
    }
  }, [])

  return (
    <div className="h-full flex flex-col justify-between p-3 select-none">
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/40 pb-2">
        <div className="flex items-center gap-1.5 font-medium">
          <TrendingUp className="w-3.5 h-3.5 text-amber-500" />
          <span>今日技术飙升热度榜</span>
          {demo && !loading && (
            <span className="px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-normal leading-none">
              演示数据
            </span>
          )}
        </div>
        <Link href="/hot" className="text-xs text-primary hover:underline flex items-center gap-0.5">
          <span>完整榜单</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5 space-y-1.5">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            正在拉取全网趋势...
          </div>
        ) : (
          sites.map((site, index) => (
            <a
              key={site.id}
              href={safeHref(site.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-muted/50 transition-colors group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    index === 0
                      ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                      : index === 1
                      ? 'bg-slate-400/20 text-slate-500'
                      : index === 2
                      ? 'bg-amber-700/20 text-amber-700'
                      : 'text-muted-foreground'
                  }`}
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground group-hover:text-primary transition-colors truncate">
                    {site.title}
                  </div>
                  {site.description && (
                    <div className="text-xs text-muted-foreground truncate">
                      {site.description}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 font-mono text-xs text-muted-foreground">
                <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                <span>{Math.round(site.score / 1000)}k</span>
              </div>
            </a>
          ))
        )}
      </div>

      <div className="pt-1 text-xs text-muted-foreground/70 text-center font-mono">
        {demo ? '演示数据 · 中枢趋势暂不可用' : '全网开发者实时协同偏好'}
      </div>
    </div>
  )
}
