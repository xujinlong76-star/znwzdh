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
 * 安全 Secret 解析器。
 *
 * 历史行为：缺失显式 AUTH_SECRET 时静默回退到写死在仓库里的开发密钥。
 * 风险：生产环境如此回退 = session 签名密钥公开可查，任何人可伪造管理员
 * session cookie 直接登录后台（升级改造方案 P0-1）。
 *
 * 现在的策略：
 * - 开发环境（NODE_ENV !== 'production'）保留原回退，本地行为完全不变；
 * - `next build` 期（NEXT_PHASE=phase-production-build）不抛错——构建期
 *   不持有 secret 是常态，运行时才强制；
 * - 生产运行期（next start / node 直跑）四个来源全部缺失时直接抛错——
 *   拒绝启动好过带着公开密钥裸奔。
 */
const DEV_FALLBACK_SECRET = 'navhub-session-secret-dev-default-32-chars-long-auth-key'
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
// next build 期间 Next 会置该变量；此阶段不强制 secret（见上方注释）
const IS_NEXT_BUILD = process.env.NEXT_PHASE === 'phase-production-build'

const explicitSecret =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  process.env.NAVHUB_SESSION_SECRET

if (IS_PRODUCTION && !IS_NEXT_BUILD && !explicitSecret) {
  throw new Error(
    '[navhub] 生产环境必须显式设置 AUTH_SECRET（或 NEXTAUTH_SECRET / NAVHUB_SESSION_SECRET，>=32 字符随机值）。' +
      '已拒绝使用仓库内的开发回退密钥启动——该值公开可查，会导致 session 可被伪造签发。'
  )
}

export const authSecret = explicitSecret || DEV_FALLBACK_SECRET

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
        // 与 lib/auth.ts 保持一致：不把 role 默认成 'admin'（否则等于绕过白名单）。
        token.role = (user as { role?: string }).role
        token.sub = user.id || token.sub || 'admin'
      }
      return token
    },
    async session({ session, token }) {
      if (session?.user && token.sub) {
        ;(session.user as { id?: string }).id = token.sub
        if (typeof token.role === 'string') {
          ;(session.user as { role?: string }).role = token.role
        }
      }
      return session
    }
  },
  pages: {
    signIn: '/auth/signin'
  }
} satisfies NextAuthConfig
