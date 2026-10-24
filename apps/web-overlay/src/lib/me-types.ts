/**
 * 用户中心共享类型（T1 下沉）。
 *
 * `Overview` 原先定义在页面模块 `app/me/me-view.tsx`，被 dashboard 组件、
 * account 页、use-me-overview、服务端取数模块反向 import——页面 ↔ 组件形成
 * 环式耦合。类型属于域，不属于任何一个页面，下沉到这里。
 */
import type { UserSettingsModel } from '@/lib/user-settings'

export interface MeOverview {
  identity: string
  user: { id: string; username: string; email: string | null; avatar: string | null; source: string } | null
  counts: {
    favorites: number
    folders: number
    searches: number
    activePluginInstalls: number
    pluginStars: number
    authoredPlugins: number
    recentEvents: number
  }
  profile: { exists: boolean; updatedAt: number | null }
  vault: { exists: boolean; version: number | null; updatedAt: number | null }
  llmConfig: { exists: boolean }
  settings: Partial<UserSettingsModel> & {
    personalizationEnabled: boolean
    favoriteSignalCutoff: number
    updatedAt: number
  }
  aliases: string[]
}

/** 向后兼容旧名（me-view 曾以此名导出） */
export type Overview = MeOverview
