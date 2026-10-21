import type { Metadata } from 'next'

/** 数据主权页：私密且不应被索引 */
export const metadata: Metadata = {
  title: '数据与隐私',
  description: '导出或删除账号下的收藏、历史、画像与配置数据',
  robots: { index: false, follow: true },
}

export default function MeDataLayout({ children }: { children: React.ReactNode }) {
  return children
}
