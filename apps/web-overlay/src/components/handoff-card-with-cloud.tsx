'use client'

/**
 * 跨设备接力卡云端外壳（Batch 3 第 9 项，D 组）。
 *
 * 两处挂载点（首页、/me/history）都挂这个外壳而不是裸 HandoffCard：
 * 外壳接云端（useHandoffCloudSync），HandoffCard 本身只做展示与本机
 * 读写，不自己发云端请求。
 *
 *  - 未登录：直接渲染裸 HandoffCard（本机进度 + 登录引导，不传任何
 *    云端 props；云端拉取根本不会启动）。
 *  - 已登录：把云端断点与拉取状态传进 HandoffCard；「清除」时除本机
 *    删除外再删云端断点（D4）。
 *  - 云端拉取中 / 失败时 HandoffCard 按既有诚实规则整块不渲染。
 */
import { HandoffCard } from '@/components/handoff-card'
import { useHandoffCloudSync } from '@/hooks/use-handoff-cloud-sync'
import type { HandoffItem } from '@/lib/handoff'

export interface HandoffCardWithCloudProps {
  /** 在 /me/history 内复用时不展示「还有 N 条」回链（已经在该页了） */
  showMoreLink?: boolean
}

export function HandoffCardWithCloud({ showMoreLink = true }: HandoffCardWithCloudProps) {
  const cloud = useHandoffCloudSync()

  if (!cloud.isLoggedIn) {
    return <HandoffCard showMoreLink={showMoreLink} />
  }

  const handleClear = (item: HandoffItem) => {
    // 视频类：本机删除由 HandoffCard 内部先做；这里只补发云端删除。
    if (item.kind === 'video') cloud.deleteCloudProgress(item.id)
  }

  return (
    <HandoffCard
      showMoreLink={showMoreLink}
      cloudProgress={cloud.cloudProgress}
      cloudStatus={cloud.cloudStatus}
      isLoggedIn
      onClear={handleClear}
    />
  )
}
