'use client'

import { HubDegradedNotice } from '@/components/hub-degraded-notice'
import type { DegradeNotice } from '@/lib/degrade'

/**
 * 插件市场三页共用的整页失败态（P1-2：失败 ≠ 空）。
 *
 * 只显失败文案 + 重试，不渲染任何空态断言；整页失败时下方没有内容，
 * HubDegradedNotice 的「下方内容可能不完整」后缀是错话，固定传
 * incompleteHint={false}；notice.retryable 为 false（401/403/404）时
 * 不给死重试按钮，只留可读原因（重试入口由 HubDegradedNotice 按
 * retryable 门控）。
 */
export function MarketplaceLoadError({
  title,
  notice,
  detail,
  onRetry,
}: {
  title: string
  /** 失败原因；null 时给默认中文网络文案（loadFailed 恒有 notice，防御而已） */
  notice: DegradeNotice | null
  /** 失败原因之外的补充说明 */
  detail?: string
  onRetry: () => void
}) {
  const shown: DegradeNotice = notice ?? {
    message: '网络请求失败，请检查网络后重试。',
    retryable: true,
  }
  return (
    <div
      role="alert"
      data-testid="marketplace-load-error"
      className="py-14 text-center border border-dashed border-border/70 rounded-2xl space-y-3"
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      <div className="max-w-2xl mx-auto text-left">
        <HubDegradedNotice notice={shown} onRetry={onRetry} incompleteHint={false} />
      </div>
      {detail && <p className="text-xs text-muted-foreground leading-relaxed">{detail}</p>}
    </div>
  )
}
