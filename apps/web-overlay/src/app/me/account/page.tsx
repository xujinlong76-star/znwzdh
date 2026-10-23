import type { Metadata } from 'next'
import { AccountView } from './account-view'

/**
 * 用户中心「账号与身份」。
 * `/me/layout.tsx` 已为整棵 `/me/*` 声明 noindex，这里只补标题。
 */
export const metadata: Metadata = {
  title: '账号与身份 · 用户中心',
  description: '展示资料、身份来源、匿名数据合并结果与账户数据自检。',
}

export default function MeAccountPage() {
  return <AccountView />
}
