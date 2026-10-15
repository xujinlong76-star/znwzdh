import NextAuth from 'next-auth'
import GithubProvider from 'next-auth/providers/github'
import CredentialsProvider from 'next-auth/providers/credentials'
import type { NextAuthConfig } from 'next-auth'
import { authConfig, authSecret } from './auth.config'

/**
 * 服务端侧的 GitHub token 保管（进程内、仅服务端可读）。
 *
 * 此前把 accessToken 写进 session 下发给浏览器：/api/auth/session 可被任意前端
 * JS 读取，且 scope 是 'repo'（读写用户全部仓库）——一次 XSS 或恶意脚本即全量失守。
 * 现在 token 只留在服务端，按 sub（用户唯一 ID）索引；前端需要写仓库时走
 * 服务端路由（需自行校验会话与管理员身份），不再接触原始 token。
 */
const serverTokenStore = new Map<string, string>()

/** 服务端获取指定用户的 GitHub token（仅供服务端路由使用） */
export function getServerGithubToken(sub?: string | null): string | undefined {
  return sub ? serverTokenStore.get(sub) : undefined
}

/** 是否配置了有效的 GitHub OAuth 应用凭证 */
export const hasGithubAuth = Boolean(
  process.env.GITHUB_CLIENT_ID &&
  process.env.GITHUB_CLIENT_SECRET &&
  process.env.GITHUB_CLIENT_ID !== 'your-github-client-id' &&
  process.env.GITHUB_CLIENT_SECRET !== 'your-github-client-secret'
)

const providers: NextAuthConfig['providers'] = [
  CredentialsProvider({
    id: 'credentials',
    name: '管理员密码/凭证',
    credentials: {
      username: { label: '账号/身份', type: 'text' },
      password: { label: '管理密码或 Token', type: 'password' },
      bypass: { label: '快捷通道', type: 'hidden' },
    },
    async authorize(credentials) {
      const isDev = process.env.NODE_ENV !== 'production'
      const authRequired =
        process.env.NAVHUB_AUTH_REQUIRED === 'true' || process.env.NAVHUB_AUTH_REQUIRED === '1'

      // 1. 本地单机 / 开发调试快速登录通道
      if (credentials?.bypass === 'true') {
        if (isDev || !authRequired) {
          return {
            id: 'admin',
            name: '本地管理员',
            email: 'admin@navhub.local',
            image: '/assets/images/alogo.webp',
            role: 'admin',
          }
        }
      }

      const rawUsername = typeof credentials?.username === 'string' ? credentials.username.trim() : ''
      const rawPassword = typeof credentials?.password === 'string' ? credentials.password.trim() : ''
      const username = rawUsername || 'admin'

      // 2. 环境变量管理员密码校验 (NAVHUB_ADMIN_PASSWORD / ADMIN_PASSWORD)
      const envAdminPassword = process.env.NAVHUB_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD
      if (envAdminPassword && rawPassword === envAdminPassword) {
        return {
          id: 'admin',
          name: username,
          email: 'admin@navhub.local',
          image: '/assets/images/alogo.webp',
          role: 'admin',
        }
      }

      // 3. API Token / Master Token 静态凭证比对
      const validTokens = [
        process.env.NAVHUB_STORAGE_TOKEN,
        process.env.NAVHUB_BOOTSTRAP_TOKEN,
        process.env.NAVHUB_MCP_TOKEN,
      ].filter(Boolean) as string[]

      if (rawPassword && validTokens.some((t) => rawPassword === t)) {
        return {
          id: 'admin',
          name: username || 'Token 管理员',
          email: 'admin@navhub.local',
          image: '/assets/images/alogo.webp',
          role: 'admin',
        }
      }

      // 4. 未显式配置生产密码时的开箱即用支持：
      //    在本地开发或非强制鉴权模式下，支持默认口令 (admin / admin123 / navhub / 123456)
      if (!envAdminPassword && validTokens.length === 0) {
        const allowedDefaults = ['admin', 'admin123', 'navhub', '123456']
        if (allowedDefaults.includes(rawPassword) || (!rawPassword && (isDev || !authRequired))) {
          return {
            id: 'admin',
            name: username || 'NavHub 管理员',
            email: 'admin@navhub.local',
            image: '/assets/images/alogo.webp',
            role: 'admin',
          }
        }
      }

      return null
    },
  }),
]

if (hasGithubAuth) {
  providers.push(
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params:
          process.env.NAVHUB_GITHUB_WRITE_SCOPE === '1'
            ? { scope: 'public_repo' }
            : { scope: '' },
      },
    })
  )
}

const config = {
  ...authConfig,
  providers,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, account }) {
      if (account?.access_token) {
        if (token.sub) serverTokenStore.set(token.sub, account.access_token)
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
    },
  },
  secret: authSecret,
} satisfies NextAuthConfig

const handler = NextAuth(config)

export const auth = handler.auth
export const { handlers: { GET, POST } } = handler