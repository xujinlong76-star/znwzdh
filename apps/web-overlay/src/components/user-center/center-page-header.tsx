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
 *
 * 视觉（美化批次）：玻璃底 + 双侧光晕（右上主色、左下淡青），图标升级为渐变芯片，
 * 标题与说明的字阶拉出层级。
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
        'relative overflow-hidden rounded-3xl border border-border/70 glass-surface market-hero p-5 sm:p-7',
        className,
      )}
    >
      {/* 光晕只做氛围，不承载信息：aria-hidden + pointer-events-none。
          主色晕在浅色下低透明度会发灰显脏（深色相 + blur 半径不足），加大模糊、降浓度消除边界感 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-primary/[0.08] blur-[96px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-28 -left-20 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl dark:bg-sky-500/10"
      />
      <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {back ? (
            <Link
              href={back.href}
              className="mb-2.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {back.label}
            </Link>
          ) : null}
          {eyebrow ? (
            <p className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <span aria-hidden className="h-px w-4 bg-primary/50" />
              {eyebrow}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-primary/20">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          </div>
          <p className="mt-2.5 max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
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
