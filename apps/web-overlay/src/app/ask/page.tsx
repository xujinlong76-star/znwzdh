import type { Metadata } from 'next'
import AskView from './ask-view'

/**
 * 问问我的收藏（/ask，登录用户专属的个人工具页）。
 *
 * ?q= 深链预填问题；问答本身是客户端岛：状态与流式问答都带登录身份取数，
 * SSR 壳里不出现任何用户数据（与 /brief 的在追提醒岛同一口径）。
 * 个人工具页不参与索引。
 */
export const metadata: Metadata = {
  title: '问问我的收藏',
  description: '在自己的收藏里带引用问答：每条结论都链到原收藏条目，找不到就老实说不知道。',
  robots: { index: false, follow: true },
}

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const q = sp.q
  const initialQ = typeof q === 'string' ? q.slice(0, 500) : ''
  return (
    <main id="main-content">
      <AskView initialQ={initialQ} />
    </main>
  )
}
