import type { Metadata } from 'next'
import { CustomSitesView } from '@/components/user-center/custom-sites-view'

/**
 * 用户中心「我的站点」：用户自己添加的网址，服务端按账号保存、跨设备同步。
 * 与收藏的区别写在页面文案里：收藏是目录内站点的仓库，这里是自己的网址。
 */
export const metadata: Metadata = {
  title: '我的站点 · 用户中心',
  description: '添加并管理你自己的常用网址，登录后跨设备同步。',
}

export default function MeSitesPage() {
  return <CustomSitesView />
}
