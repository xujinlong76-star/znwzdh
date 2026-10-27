/**
 * 用户中心共享类型（T1 下沉）。
 *
 * `Overview` 原先定义在页面模块 `app/me/me-view.tsx`，被 dashboard 组件、
 * account 页、use-me-overview、服务端取数模块反向 import——页面 ↔ 组件形成
 * 环式耦合。类型属于域，不属于任何一个页面，下沉到这里。
 */
import type { MeOverviewResponse } from '@/lib/rest-contracts.generated'
import type { UserSettingsModel } from '@/lib/user-settings'

/**
 * 概览主体的字段集合与 `/api/me` 契约同源（生成物）。
 * `ok` 是响应封套，页面不读；`settings` 单独放宽（见下）。
 */
export interface MeOverview
  extends Pick<
    MeOverviewResponse,
    'identity' | 'user' | 'counts' | 'profile' | 'vault' | 'llmConfig' | 'aliases'
  > {
  /**
   * 设置：契约保证这些字段恒有值，但 /me 首屏取数会在老中枢上降级，
   * 展示层仍按 Partial 处理——真实缺值时由 DEFAULT_USER_SETTINGS 兜底。
   */
  settings: Partial<UserSettingsModel> & {
    personalizationEnabled: boolean
    favoriteSignalCutoff: number
    updatedAt: number
  }
}

/** 向后兼容旧名（me-view 曾以此名导出） */
export type Overview = MeOverview
