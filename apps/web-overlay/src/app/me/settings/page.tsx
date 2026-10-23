import type { Metadata } from 'next'
import { MeSettingsView } from '@/components/user-center/me-settings-view'

/**
 * 用户中心「设置」。
 *
 * 页面本身是客户端岛（身份与偏好都在浏览器侧读取）；`/me/layout.tsx` 已为整棵
 * `/me/*` 声明 noindex，因此这里只补标题。
 */
export const metadata: Metadata = {
  title: '设置 · 用户中心',
  description: '默认搜索引擎、卡片密度、0-RTT、快捷键、历史保留与遥测开关。',
}

export default function MeSettingsPage() {
  return <MeSettingsView />
}
