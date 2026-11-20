import type { Metadata } from 'next'
import { Container } from '@/components/ui/container'
import { GrowthPanelLazy } from '@/components/user-center/growth-panel-lazy'

/**
 * 用户中心「成长与任务」。
 *
 * 2026-11-21 结构重构：成长系统从 /me 概览底部整体迁移至此独立 Tab，
 * 概览只留一张「今日成长速览」横幅卡。内容本身不改（内容重构是 (b) 线的事），
 * 只移挂载位置；仍走 GrowthPanelLazy 懒加载边界，不静态 import 成长面板。
 * `/me/layout.tsx` 已为整棵 `/me/*` 声明 noindex，因此这里只补标题。
 */
export const metadata: Metadata = {
  title: '成长与任务 · 用户中心',
  description: '等级、每日任务、宝箱、赛季、徽章与新手引导。',
}

export default function MeGrowthPage() {
  return (
    <Container as="main" id="main-content" className="space-y-4 pb-20 pt-3 sm:space-y-5 sm:pb-14 sm:pt-4">
      <GrowthPanelLazy />
    </Container>
  )
}
