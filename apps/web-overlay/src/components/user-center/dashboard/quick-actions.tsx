'use client'

/**
 * 快捷操作：只做跳转，不在概览里直接写数据。
 * 破坏性动作（清空历史 / 删除数据）保留各自页面里的二次确认，避免误触。
 */
import Link from 'next/link'
import { ArrowRight, Download, Heart, Search, Sparkles } from 'lucide-react'

const ACTIONS = [
  { href: '/me/data', label: '导出我的数据', hint: 'JSON / 浏览器书签', icon: Download },
  { href: '/favorites', label: '收藏与文件夹', hint: '同步 / 备注 / 金库', icon: Heart },
  { href: '/me/history', label: '管理搜索历史', hint: '单条删除 / 清空', icon: Search },
  { href: '/preferences', label: '画像与行为信号', hint: '重置 / 按类型清理', icon: Sparkles },
] as const

export function QuickActions() {
  return (
    <section aria-label="快捷操作" className="rounded-2xl border border-border/70 bg-card/60 p-4 sm:p-5">
      <h2 className="text-sm font-semibold">快捷操作</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {ACTIONS.map(({ href, label, hint, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-xs transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate font-medium">{label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
              </span>
            </span>
            <ArrowRight
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </section>
  )
}
