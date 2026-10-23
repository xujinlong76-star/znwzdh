import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * 用户中心统一的区块状态（第 4 批）。
 *
 * 背景：history / data / account / plugins 此前各写一套加载骨架、amber 错误框与
 * 虚线空态，样式与可访问性语义不一致。这里收成一份：
 *   - loading：`aria-busy` + `aria-live`，读屏能听到「加载中」；
 *   - error：`role="alert"`，必须给重试入口（失败 ≠ 空，不能让用户以为数据被清空）；
 *   - empty：只陈述「确实没有」，不带任何故障措辞。
 *
 * 纯展示组件，不发起请求；重试由调用方传入。
 */
export type SectionStateVariant = 'loading' | 'error' | 'empty'

export interface SectionStateProps {
  variant: SectionStateVariant
  title?: string
  description?: ReactNode
  /** 空态图标；error 用固定警示样式，不需要图标 */
  icon?: LucideIcon
  onRetry?: () => void
  retryLabel?: string
  /** error 态右侧附加动作（如「去登录」） */
  action?: ReactNode
  /** loading 骨架行数，默认 4 */
  rows?: number
  /** 骨架单行高度类，默认 h-16 */
  rowClassName?: string
  /** loading 读屏文案 */
  loadingLabel?: string
  className?: string
}

export function SectionState({
  variant,
  title,
  description,
  icon: Icon,
  onRetry,
  retryLabel = '重试',
  action,
  rows = 4,
  rowClassName = 'h-16',
  loadingLabel = '加载中…',
  className,
}: SectionStateProps) {
  if (variant === 'loading') {
    return (
      <div className={cn('space-y-2', className)} aria-busy="true" aria-live="polite">
        <span className="sr-only">{loadingLabel}</span>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={cn('animate-pulse rounded-2xl border border-border/70 bg-card/50', rowClassName)} />
        ))}
      </div>
    )
  }

  if (variant === 'error') {
    return (
      <section
        role="alert"
        className={cn('space-y-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-6', className)}
      >
        {title ? <p className="text-sm font-semibold">{title}</p> : null}
        {description ? <p className="text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
        {(onRetry || action) && (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {onRetry && (
              <Button size="sm" variant="outline" className="w-full text-xs sm:w-auto" onClick={onRetry}>
                {retryLabel}
              </Button>
            )}
            {action}
          </div>
        )}
      </section>
    )
  }

  return (
    <section
      className={cn('rounded-2xl border border-dashed border-border/70 bg-card/50 p-8 text-center sm:p-10', className)}
    >
      {Icon ? <Icon className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden /> : null}
      {title ? <p className="mt-2 text-sm font-medium">{title}</p> : null}
      {description ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </section>
  )
}
