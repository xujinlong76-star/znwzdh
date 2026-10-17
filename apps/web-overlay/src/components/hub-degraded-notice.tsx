'use client'

import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import type { DegradeNotice } from '@/lib/degrade'

/**
 * 降级提示条：中枢请求失败、页面仍渲染兜底内容时，明确告诉用户
 * 「现在看到的可能是残缺的，为什么，以及怎么再试一次」。
 *
 * 与 lib/degrade.ts 的分工：那里只做纯判定（文案 + 是否可重试），
 * 这里只做渲染，方便单测覆盖判定逻辑、也方便各页面复用同一观感。
 */
export function HubDegradedNotice({
  notice,
  onRetry,
  subject,
  incompleteHint = true,
  className = '',
}: {
  notice: DegradeNotice
  onRetry?: () => void
  /** 出错的对象，用于文案补全，如「站点数据」 */
  subject?: string
  /** 是否提示「下方内容可能不完整」。整页错误态（下面没有内容）传 false */
  incompleteHint?: boolean
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs sm:text-sm text-amber-700 dark:text-amber-400 ${className}`}
    >
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span className="flex-1 min-w-[12rem] leading-relaxed">
        {subject ? `${subject}：` : ''}
        {notice.message}
        {incompleteHint && (
          <span className="text-amber-600/80 dark:text-amber-400/80">（下方内容可能不完整）</span>
        )}
      </span>
      {notice.retryable && onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-7 gap-1.5 border-amber-500/40 text-xs text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
        >
          <RotateCw className="w-3.5 h-3.5" />
          重试
        </Button>
      )}
    </div>
  )
}
