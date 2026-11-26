import { headers } from 'next/headers'
import type { Session } from 'next-auth'
import { getToken } from 'next-auth/jwt'
import { authSecret, sessionGovernanceFromToken, type SessionGovernance } from './auth.config'

const SESSION_COOKIE_NAMES = ['__Secure-authjs.session-token', 'authjs.session-token'] as const

/**
 * auth() 会经过 JSON 响应边界，不能把 sid 藏在 session 对象的 Symbol 属性里。
 * 这里从当前请求的已验签会话 Cookie 取治理字段，并要求 sub 与 auth() 的用户一致。
 */
export async function readRequestSessionGovernance(
  session: Session | null | undefined,
): Promise<SessionGovernance> {
  if (!session?.user || typeof session.user.id !== 'string') return {}

  try {
    const requestHeaders = await headers()
    const cookie = requestHeaders.get('cookie') ?? ''
    for (const cookieName of SESSION_COOKIE_NAMES) {
      if (!new RegExp(`(?:^|;\\s*)${cookieName}=`).test(cookie)) continue
      const token = await getToken({
        req: { headers: requestHeaders },
        secret: authSecret,
        salt: cookieName,
        cookieName,
        secureCookie: cookieName.startsWith('__Secure-'),
      })
      if (!token || token.sub !== session.user.id) return {}
      return sessionGovernanceFromToken(token)
    }
  } catch {
    // 读取或验签失败一律按无法核验处理，由调用方 fail-closed。
  }
  return {}
}
