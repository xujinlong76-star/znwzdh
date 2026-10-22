import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CenterPageHeaderProps {
  /** 页面主标题（h1）。子页与概览共用同一字号层级。 */
  title: string
  /** 一句说明，限制在 2xl 行宽内，避免长文在大屏上铺满整行 */
  description: ReactNode
  icon: LucideIcon
  /** 子页的返回入口；概览页本身是用户中心，不传 */
  back?: { href: string; label: string }
  /** 右上角动作区：主操作在前，次操作在后（移动端自动纵向铺满） */
  actions?: ReactNode
  /** 标题上方的小标签，用于标注分区归属 */
  eyebrow?: string
  className?: string
}

/**
 * 用户中心统一页头。
 *
 * 之前 `/me`、`/me/history`、`/me/data` 各自实现了「大标题 + 返回按钮 + 说明 + 动作」，
 * 字号、内边距与动作位置都不同（同一个产品里页面标题在 20px~24px 之间来回跳）。
 * 这里收成一份结构：左侧标题/说明，右侧动作；窄屏自动上下堆叠，动作区整行铺满。
 * 纯展示组件，不承接任何状态或交互。
 */
export function CenterPageHeader({
  title,
  description,
  icon: Icon,
  back,
  actions,
  eyebrow,
  className,
}: CenterPageHeaderProps) {
  return (
    <header
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero p-4 sm:p-6',
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {back ? (
            <Link
              href={back.href}
              className="mb-2 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {back.label}
            </Link>
          ) : null}
          {eyebrow ? (
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
            {description}
          </p>
        </div>
        {actions ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  )
}
