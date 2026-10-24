'use client'

import { cn } from '@/lib/utils'

/**
 * 插件审计维度分块（详情页与 AI 工坊共用同一口径）。
 *
 * null 表示「这一维本次根本没测」，必须写「未测」而不是留空或补 0：
 * 空白会被读成「0 分 = 很差」，那比没有结论更误导人；把没测伪装成满分
 * 更是审计报告的假评分源头（AUDIT-2026-10-20-PASS3 系列）。
 */
export function AuditDimensionTile({
  label,
  value,
  className,
}: {
  label: string
  value: number | null | undefined
  className?: string
}) {
  const measured = typeof value === 'number'
  return (
    <div className={cn('p-2 rounded-lg bg-card border border-border/50', className)}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-0.5 font-mono text-sm',
          measured ? 'font-bold text-emerald-600 dark:text-emerald-400' : 'font-medium text-muted-foreground/70',
        )}
      >
        {measured ? `${value} 分` : '未测'}
      </div>
    </div>
  )
}
