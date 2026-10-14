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

export const authConfig = {
    providers: [],
    callbacks: {
        authorized({ auth, request: { nextUrl } }) {
            const isLoggedIn = !!auth?.user
            const isOnAdmin = nextUrl.pathname.startsWith('/admin')

            if (isOnAdmin) {
                if (!isLoggedIn) return false
                // 白名单未配置时：开发环境放行，生产环境 fail-closed
                const identity =
                    (auth?.user as { email?: string; name?: string } | undefined)?.email ||
                    (auth?.user as { email?: string; name?: string } | undefined)?.name
                if (ADMIN_IDS.length === 0) return IS_DEV
                return isAdminIdentity(identity)
            }

            return true
        },
        async jwt({ token, account }) {
            if (account?.access_token) {
                token.accessToken = account.access_token
            }
            return token
        },
        async session({ session, token }) {
            // 不下发 accessToken：session 可能被 /api/auth/session 返回给浏览器。
            // 真实 token 由 lib/auth.ts 的服务端 store 保管，服务端路由用
            // getServerGithubToken(session.user.id) 取用。
            if (session?.user && token.sub) {
                ;(session.user as { id?: string }).id = token.sub
            }
            return session
        }
    },
    pages: {
        signIn: '/auth/signin'
    }
} satisfies NextAuthConfig
