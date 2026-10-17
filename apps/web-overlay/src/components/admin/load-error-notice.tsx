'use client'

/**
 * 后台列表加载失败提示（带重试）。
 *
 * 为什么必须有这个组件：这些页面拉取失败时会回落到空列表，
 * 与「本来就没有数据」长得一模一样（见 lib/admin-load-failure.ts 的说明）。
 * 提示本体必须能被区分出来，所以带 role="alert"。
 */

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LoadErrorNoticeProps {
  /** describeLoadFailure() 生成的整句文案 */
  message: string
  /** 重试入口。省略则不渲染按钮（例如没有可重试的动作时） */
  onRetry?: () => void
  /** 正在重试时的按钮文案 */
  retrying?: boolean
  className?: string
}

export function LoadErrorNotice({ message, onRetry, retrying = false, className }: LoadErrorNoticeProps) {
  return (
    <div
      role="alert"
      className={
        'mb-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 ' +
        (className ?? '')
      }
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span className="flex-1 leading-snug">{message}</span>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 rounded-lg gap-1.5 text-xs flex-shrink-0"
          onClick={onRetry}
          disabled={retrying}
        >
          <RefreshCw className={'w-3.5 h-3.5 ' + (retrying ? 'animate-spin' : '')} />
          {retrying ? '重试中…' : '重试'}
        </Button>
      )}
    </div>
  )
}
