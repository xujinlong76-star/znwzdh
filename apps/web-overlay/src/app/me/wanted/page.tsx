import type { Metadata } from 'next'
import { WantedSearchesView } from '@/components/user-center/wanted-searches-view'

/**
 * 用户中心「我的待找」：零结果时存下的查询，投稿审核通过、新站收录时
 * 命中的待找会在站内通知一次。登录态服务端按账号保存，匿名只存当前设备。
 */
export const metadata: Metadata = {
  title: '我的待找 · 用户中心',
  description: '搜不到站时存下的查询，收录时站内通知你。',
}

export default function MeWantedPage() {
  // 主内容地标在页面壳上（照其它用户中心页的写法）：视图组件只负责内容，
  // 不再自己渲染 main，避免一页出现两个 main 地标。
  return (
    <main id="main-content">
      <WantedSearchesView />
    </main>
  )
}
