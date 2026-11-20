'use client'

/**
 * 快捷操作：只做跳转，不在概览里直接写数据。
 * 破坏性动作（清空历史 / 删除数据）保留各自页面里的二次确认，避免误触。
 *
 * 视觉（美化批次）：图标入芯片、卡片悬停上浮——与统计卡同一套交互语言，
 * 「概览页所有可点的东西都会轻轻抬起来」。
 */
import Link from 'next/link'
import { ArrowRight, Download, Heart, Search, Sparkles } from 'lucide-react'

const ACTIONS = [
  { href: '/me/data', label: '导出我的数据', hint: 'JSON / 浏览器书签', icon: Download, chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  { href: '/favorites', label: '收藏与文件夹', hint: '同步 / 备注 / 金库', icon: Heart, chip: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' },
  { href: '/me/history', label: '管理搜索历史', hint: '单条删除 / 清空', icon: Search, chip: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  { href: '/preferences', label: '画像与行为信号', hint: '重置 / 按类型清理', icon: Sparkles, chip: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' },
] as const

export function QuickActions() {
  return (
    <section aria-label="快捷操作" className="rounded-2xl border border-border/70 bg-card/75 px-4 py-3.5 shadow-xs sm:px-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">快捷操作</h2>
        <span className="text-[11px] text-muted-foreground">高频管理一键直达</span>
      </div>
      <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {ACTIONS.map(({ href, label, hint, icon: Icon, chip }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-center justify-between gap-2.5 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-xs transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${chip}`}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{label}</span>
                <span className="block truncate text-[11px] text-muted-foreground" aria-hidden>{hint}</span>
              </span>
            </span>
            <ArrowRight
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-primary"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </section>
  )
}
