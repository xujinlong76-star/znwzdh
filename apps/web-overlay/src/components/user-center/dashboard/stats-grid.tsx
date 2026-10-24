'use client'

/**
 * 数据概览：把 `/api/me` 的 counts 变成可点击的管理入口。
 * 链接与原概览保持一致，只是拆成独立组件，便于后续复用。
 *
 * 视觉（美化批次）：每项统计一枚专属色相的图标芯片（图标为装饰、不承担对比度），
 * 数字放大到 28px 等宽；悬停上浮 + 主色描边，让「这是可点的入口」一眼可辨。
 */
import Link from 'next/link'
import { ArrowRight, FolderHeart, Heart, Plug, Search, Sparkles, Star, User } from 'lucide-react'
import type { Overview } from '@/lib/me-types'

const STAT_ITEMS: Array<{
  key: keyof Overview['counts']
  label: string
  icon: typeof Heart
  href: string
  /** 图标芯片色相（仅装饰性图标使用，文字一律走主题令牌保 AA） */
  chip: string
  /** 跨列大卡的补充说明；普通小卡留空保持紧凑 */
  hint?: string
}> = [
  { key: 'favorites', label: '收藏站点', icon: Heart, href: '/favorites', chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  { key: 'folders', label: '收藏夹', icon: FolderHeart, href: '/favorites', chip: 'bg-orange-500/10 text-orange-700 dark:text-orange-300' },
  { key: 'searches', label: '搜索历史', icon: Search, href: '/me/history', chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  { key: 'activePluginInstalls', label: '已装插件', icon: Plug, href: '/me/plugins', chip: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  { key: 'pluginStars', label: '星标插件', icon: Star, href: '/marketplace', chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  { key: 'authoredPlugins', label: '我的插件', icon: Sparkles, href: '/marketplace/mine', chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  { key: 'recentEvents', label: '近 30 天行为', icon: User, href: '/me/data', chip: 'bg-primary/10 text-primary', hint: '操作记录汇总，可在数据与隐私页导出或清理' },
]

export function StatsGrid({ counts }: { counts: Overview['counts'] }) {
  return (
    <section aria-label="用户数据概览" className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {STAT_ITEMS.map((item, index) => {
        const Icon = item.icon
        const value = counts[item.key]
        return (
          <Link
            key={item.key}
            href={item.href}
            // 7 项计数在 2 列布局下最后一项会落单：让末项横跨两列填满整行
            className={`group flex flex-col justify-between gap-3.5 rounded-2xl border border-border/70 bg-card/60 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-md dark:hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${index === STAT_ITEMS.length - 1 ? 'col-span-2 md:col-span-3' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.chip}`}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="truncate text-xs text-muted-foreground">{item.label}</span>
              </span>
              <ArrowRight
                className="h-3.5 w-3.5 shrink-0 text-border transition-all group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden
              />
            </div>
            {item.hint ? (
              <div className="space-y-1.5">
                <p className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
                <p className="text-[11px] leading-snug text-muted-foreground">{item.hint}</p>
              </div>
            ) : (
              <p className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
            )}
          </Link>
        )
      })}
    </section>
  )
}
