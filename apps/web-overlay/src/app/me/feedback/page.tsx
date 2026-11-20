import type { Metadata } from 'next'
import { SubmissionFeedbackView } from '@/components/user-center/submission-feedback-view'

/**
 * 用户中心「收录反馈」：提交网址后的收录情况汇报（提交时间 / 网址 /
 * 状态 / 原因说明）。审核通过与未通过都给原因（AI 生成的面向投稿人说明），
 * 状态或原因更新后刷新即见最新。
 */
export const metadata: Metadata = {
  title: '收录反馈 · 用户中心',
  description: '查看你投稿网站的收录审核结果与原因说明。',
}

export default function MeFeedbackPage() {
  // 主内容地标在页面壳上（照其它用户中心页的写法）：视图组件只负责内容
  return (
    <main id="main-content">
      <SubmissionFeedbackView />
    </main>
  )
}
