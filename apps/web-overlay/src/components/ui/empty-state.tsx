'use client'

/**
 * 统一空态（P1-4 设计系统样板组件之一）。
 *
 * 此站点各列表页的空态写法长期不统一：有的只有一行灰字（死路），
 * 有的图标颜色硬编码（`text-emerald-500`，暗色下发脏），有的缺主行动。
 * 约定统一为「图标 + 一句解释 + 一个主行动」三件套：
 *
 *   - **图标**：语义化，告诉用户「这里本该有什么」；
 *   - **解释**：一句话说清为什么空、数据去哪了（不是用户的操作失误）；
 *   - **行动**：永远给一个下一步按钮，让空态是「路口」不是「墙」。
 *
 * 样式全部走 token（`text-primary` / `bg-muted` / `border-border` …），
 * 不出现硬编码色值，暗色模式自动跟随。
 */
import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  /** 语义图标（lucide 组件，调用方按语境选） */
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  /** 标题：短句，说明「这里本该有什么」 */
  title: string
  /** 解释：为什么空、数据在哪（可选但强烈建议给） */
  description?: ReactNode
  /** 主行动：一个按钮 / 链接（可选） */
  action?: ReactNode
  /** 图标主色：默认 primary；需要中性或成功语义时可指定 */
  iconTone?: 'primary' | 'muted' | 'success' | 'warning'
  className?: string
}

const ICON_TONE: Record<NonNullable<EmptyStateProps['iconTone']>, string> = {
  primary: 'text-primary',
  muted: 'text-muted-foreground',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  iconTone = 'primary',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-dashed border-border/80 p-10 sm:p-12 text-center max-w-lg mx-auto space-y-3 bg-muted/60 my-6',
        className,
      )}
    >
      <div className="relative w-14 h-14 mx-auto mb-1">
        {/* 背景柔和呼吸光晕 */}
        <div className="absolute inset-0 rounded-2xl bg-primary/15 dark:bg-primary/20 blur-md pointer-events-none" />
        {/* 晶体多层质感图标底座 */}
        <div className="relative w-full h-full rounded-2xl bg-gradient-to-b from-card via-card/90 to-muted/80 flex items-center justify-center border border-border/70 shadow-sm ring-1 ring-inset ring-white/20 dark:ring-white/10">
          <Icon className={cn('w-6 h-6 sm:w-7 sm:h-7 transition-transform duration-200 group-hover:scale-105', ICON_TONE[iconTone])} aria-hidden />
        </div>
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      ) : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  )
}
