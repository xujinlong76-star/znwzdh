import type { Metadata } from 'next'

/**
 * `/me/workspaces` 的标题层。
 *
 * 页面本身是客户端组件（需要会话、本地存储与交互），不能导出 metadata；
 * 用同目录 layout 提供标题与描述，避免路由退化成只剩站点名。
 */
export const metadata: Metadata = {
  title: '工作空间',
  description: '个人与团队空间、成员角色与权限管理。',
}

export default function WorkspacesLayout({ children }: { children: React.ReactNode }) {
  return children
}
