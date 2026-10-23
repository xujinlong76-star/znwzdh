import type { Metadata } from 'next'
import { MePluginsView } from './me-plugins-view'

/**
 * 用户中心「插件中心」。
 * `/me/layout.tsx` 已为整棵 `/me/*` 声明 noindex，这里只补标题。
 */
export const metadata: Metadata = {
  title: '插件中心 · 用户中心',
  description: '已安装插件、我发布的插件、星标与投稿入口。',
}

export default function MePluginsPage() {
  return <MePluginsView />
}
