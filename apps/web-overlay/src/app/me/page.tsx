import { auth } from '@/lib/auth'
import { canonicalUserId } from '@/lib/me-identity'
import { fetchMeOverview } from '@/lib/server/me-overview'
import { MeView } from './me-view'
import type { Overview } from '@/lib/me-types'

/**
 * 用户中心概览（服务端壳）。
 *
 * 身份来自 /api/me：Web 侧 BFF 从 NextAuth 会话派生并签名转发，
 * 客户端不需要也不应该自报 userId。未登录时展示匿名状态与登录入口。
 *
 * 壳只做两件事：读会话派生 canonical identity；把概览首屏数据注入客户端岛
 * （app/me/me-view.tsx）。取数失败一律按 null 注入，岛会回落到原有的
 * 「/api/auth/session → /api/me」自取分支，四态语义（loading / anonymous /
 * ready / error）一个字都没变。
 *
 * 必须动态渲染：同一个 URL 对不同 Cookie 要出不同 HTML（登录态直接 ready，
 * 匿名态直接 anonymous），静态化会把某个用户的概览固化给所有人。
 */
export const dynamic = 'force-dynamic'

export default async function MePage() {
  let identity: string | null = null
  try {
    const session = await auth()
    identity = canonicalUserId(session?.user) ?? null
  } catch {
    // 会话读取本身失败时按「未登录」注入 null：客户端会再探一次 /api/auth/session，
    // 那条路径把非 2xx 渲染成 error（而不是谎称匿名），降级语义仍由岛兜住
    identity = null
  }

  const overview: Overview | null = identity ? await fetchMeOverview(identity) : null

  return <MeView initialOverview={overview} />
}
