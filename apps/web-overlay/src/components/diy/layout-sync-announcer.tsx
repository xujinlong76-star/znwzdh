'use client'

/**
 * 跨标签页布局合并通知器（8a）。
 *
 * 订阅 layout-sync-events 的合并事件：弹 toast（复用全站 shadcn useToast，
 * 由 providers/layout 里的 <Toaster /> 渲染），同时把同一句话写进
 * aria-live 区域播报给读屏用户。自身不渲染任何可见内容。
 *
 * 协调员接线：在全局只挂载一次，例如 providers.tsx 里 <Toaster /> 旁边：
 * ```tsx
 * import { LayoutSyncAnnouncer } from '@/components/diy/layout-sync-announcer'
 * // ...
 * <Toaster />
 * <LayoutSyncAnnouncer />
 * ```
 * 再在 use-home-diy.ts 的 applyRemoteConfig 里调 notifyLayoutSyncMerge
 *（见 lib/modular/layout-sync-events.ts 底部的接线注释）。
 */
import { useEffect, useState } from 'react'
import { toast } from '@/components/ui/use-toast'
import {
  formatLayoutSyncMerge,
  subscribeLayoutSyncEvents,
} from '@/lib/modular/layout-sync-events'

export function LayoutSyncAnnouncer() {
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    return subscribeLayoutSyncEvents((summary) => {
      const copy = formatLayoutSyncMerge(summary)
      // toast 与 live region 说同一句话：视觉与读屏用户看到的是一致的事实
      setAnnouncement(`${copy.title} ${copy.description}`)
      toast({ title: copy.title, description: copy.description, variant: copy.variant })
    })
  }, [])

  return (
    <p className="sr-only" role="status" aria-live="polite">
      {announcement}
    </p>
  )
}
