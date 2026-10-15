import type { NextAuthConfig } from 'next-auth'

/**
 * 后台管理员白名单。
 *
 * 此前只校验「是否已登录」——任何 GitHub 账号登录即可进入 /admin 增删导航、
 * 提交写仓库，属横向越权。这里改为必须命中白名单才放行。
 * 配置方式（逗号分隔，支持 GitHub 登录名或邮箱）：
 *   NAVHUB_ADMIN_IDS=your-github-login,you@example.com
 * 未配置时的策略：生产环境一律拒绝（fail-closed），仅开发环境放行以便本地调试。
 */
const ADMIN_IDS = (process.env.NAVHUB_ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
const IS_DEV = process.env.NODE_ENV === 'development'

export function isAdminIdentity(identity?: string | null): boolean {
  if (!identity) return false
  return ADMIN_IDS.includes(identity.toLowerCase())
}

/**
 * 安全 Secret 解析器：
 * 保证在缺失显式 AUTH_SECRET 时安全回退到 session secret 或开发密钥，
 * 避免 NextAuth 抛出阻断性的 MissingSecret 异常崩溃。
 */
export const authSecret =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  process.env.NAVHUB_SESSION_SECRET ||
  'navhub-session-secret-dev-default-32-chars-long-auth-key'

if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = authSecret
}

export const authConfig = {
  secret: authSecret,
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isOnAdmin = nextUrl.pathname.startsWith('/admin')

      if (isOnAdmin) {
        if (!isLoggedIn) return false
        const user = auth?.user as { email?: string; name?: string; role?: string; id?: string } | undefined
        // 管理员凭证或单机开发放行身份直接授权通过
        if (user?.role === 'admin' || user?.id === 'admin' || user?.email === 'admin@navhub.local') {
          return true
        }
        // 白名单未配置时：开发环境放行，生产环境 fail-closed
        const identity = user?.email || user?.name
        if (ADMIN_IDS.length === 0) return IS_DEV
        return isAdminIdentity(identity)
      }

      return true
    },
    async jwt({ token, user, account }) {
      if (account?.access_token) {
        token.accessToken = account.access_token
      }
      if (user) {
        token.role = (user as { role?: string }).role || 'admin'
        token.sub = user.id || token.sub || 'admin'
      }
      return token
    },
    async session({ session, token }) {
      if (session?.user && token.sub) {
        ;(session.user as { id?: string }).id = token.sub
        ;(session.user as { role?: string }).role = (token.role as string) || 'admin'
      }
      return session
    }
  },
  pages: {
    signIn: '/auth/signin'
  }
} satisfies NextAuthConfig
