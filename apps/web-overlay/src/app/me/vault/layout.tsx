import type { Metadata } from 'next'

/**
 * `/me/vault` 的标题层。
 *
 * 页面是客户端组件（需要读本机身份与云端密文状态），用同目录 layout 提供 metadata。
 */
export const metadata: Metadata = {
  title: '云端金库',
  description: 'E2EE 金库的密文状态、迁移备份与删除。',
}

export default function VaultLayout({ children }: { children: React.ReactNode }) {
  return children
}
