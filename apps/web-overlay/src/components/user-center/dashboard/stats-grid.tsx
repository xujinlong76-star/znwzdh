'use client'

/**
 * 数据概览：把 `/api/me` 的 counts 变成可点击的管理入口。
 * 链接与原概览保持一致，只是拆成独立组件，便于后续复用。
 */
import Link from 'next/link'
import { ArrowRight, Heart, Plug, Search, Sparkles, Star, User } from 'lucide-react'
import type { Overview } from '@/app/me/me-view'

const STAT_ITEMS: Array<{
  key: keyof Overview['counts']
  label: string
  icon: typeof Heart
  href: string
}> = [
  { key: 'favorites', label: '收藏站点', icon: Heart, href: '/favorites' },
  { key: 'folders', label: '收藏夹', icon: Heart, href: '/favorites' },
  { key: 'searches', label: '搜索历史', icon: Search, href: '/me/history' },
  { key: 'activePluginInstalls', label: '已装插件', icon: Plug, href: '/me/plugins' },
  { key: 'pluginStars', label: '星标插件', icon: Star, href: '/marketplace' },
  { key: 'authoredPlugins', label: '我的插件', icon: Sparkles, href: '/marketplace/mine' },
  { key: 'recentEvents', label: '近 30 天行为', icon: User, href: '/me/data' },
]

export function StatsGrid({ counts }: { counts: Overview['counts'] }) {
  return (
    <section aria-label="用户数据概览" className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {STAT_ITEMS.map((item) => {
        const Icon = item.icon
        const value = counts[item.key]
        return (
          <Link
            key={item.key}
            href={item.href}
            className="group flex flex-col justify-between gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <Icon className="h-4 w-4 shrink-0 transition-colors group-hover:text-primary" aria-hidden />
                <span className="truncate">{item.label}</span>
              </span>
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-border transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden
              />
            </div>
            <p className="text-2xl font-semibold leading-none tracking-tight tabular-nums sm:text-[26px]">{value}</p>
          </Link>
        )
      })}
    </section>
  )
}
