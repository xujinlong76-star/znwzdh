import NextAuth from 'next-auth'
import GithubProvider from 'next-auth/providers/github'
import CredentialsProvider from 'next-auth/providers/credentials'
import type { NextAuthConfig } from 'next-auth'
import { authConfig, authSecret, isAdminAccessAllowed } from './auth.config'

/**
 * 服务端侧的 GitHub token 保管（进程内、仅服务端可读）。
 *
 * 此前把 accessToken 写进 session 下发给浏览器：/api/auth/session 可被任意前端
 * JS 读取，且 scope 是 'repo'（读写用户全部仓库）——一次 XSS 或恶意脚本即全量失守。
 * 现在 token 只留在服务端，按 sub（用户唯一 ID）索引；前端需要写仓库时走
 * 服务端路由（需自行校验会话与管理员身份），不再接触原始 token。
 */
const serverTokenStore = new Map<string, string>()

/**
 * 启动期可观测告警：管理员白名单缺失。
 *
 * 白名单未配置时，verifyAdminSession / requireAdmin 在生产环境一律 fail-closed（403），
 * 「还没配 NAVHUB_ADMIN_IDS」必须是一条部署后立刻能看见的告警，而不是等后台被锁死
 * 才被发现。凭证管理员（NAVHUB_ADMIN_PASSWORD 等）不受影响，仅 GitHub OAuth 身份被拒。
 *
 * next build 期（NEXT_PHASE）不打：构建期本来就不持有任何部署配置，打了只会污染
 * 镜像构建日志（口径与 auth.config.ts 的 secret 检查一致）。
 */
const ADMIN_IDS_CONFIGURED = Boolean(process.env.NAVHUB_ADMIN_IDS)
const IS_PRODUCTION_RUNTIME =
  process.env.NODE_ENV === 'production' &&
  process.env.NEXT_PHASE !== 'phase-production-build'

if (IS_PRODUCTION_RUNTIME && !ADMIN_IDS_CONFIGURED) {
  console.warn(
    '[navhub][安全警告] 未配置 NAVHUB_ADMIN_IDS：生产环境下管理员入口将拒绝全部请求' +
      '（/admin 页面与 /api/admin/*、投稿审核、导航写接口等一律 403）。' +
      '迁移步骤：设置 NAVHUB_ADMIN_IDS=github登录名或邮箱（逗号分隔，大小写不敏感），' +
      '或改用 NAVHUB_ADMIN_PASSWORD 凭证管理员登录；设置后重启生效。'
  )
}

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

      // 不安全登录通道（快捷 bypass / 默认口令）的生产总闸。
      // 历史行为：这两条通道只判 isDev 或 !authRequired——公开部署
      // （NAVHUB_AUTH_REQUIRED 默认 false）时任何人可登录后台（方案 P0-2）。
      // 现在：生产环境一律关闭，除非运维显式设置
      // NAVHUB_ALLOW_DEFAULT_PASSWORD=1（启动日志会打印醒目警告，责任自负）。
      const allowInsecureLogin =
        isDev ||
        process.env.NAVHUB_ALLOW_DEFAULT_PASSWORD === '1' ||
        process.env.NAVHUB_ALLOW_DEFAULT_PASSWORD === 'true'
      if (!isDev && allowInsecureLogin) {
        console.warn(
          '[navhub][安全警告] 生产环境开启了不安全登录通道（NAVHUB_ALLOW_DEFAULT_PASSWORD）：' +
            '快捷登录与默认口令可用。请尽快配置 NAVHUB_ADMIN_PASSWORD 并移除该开关。'
        )
      }

      // 1. 本地单机 / 开发调试快速登录通道
      if (credentials?.bypass === 'true') {
        if (allowInsecureLogin) {
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

      // 4. 默认口令开箱即用支持——同样受 allowInsecureLogin 总闸管辖：
      //    未显式配置生产密码时接受 (admin / admin123 / navhub / 123456)。
      //    生产环境默认拒绝（见上方总闸注释）；空口令快捷登录仍只限
      //    isDev 或未开启鉴权时（原语义保留）。
      if (!envAdminPassword && validTokens.length === 0) {
        if (allowInsecureLogin) {
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
      if (account?.provider) token.provider = account.provider
      if (user) {
        // 这里**不能**默认成 'admin'：GitHub OAuth 用户的 profile 没有 role 字段，
        // 一旦默认成 admin，verifyAdminSession 里的 `user.role === 'admin'` 就会对
        // 任何登录用户放行，把 NAVHUB_ADMIN_IDS 白名单整个绕过（页面中间件拦住了，
        // 但 API 路由全部失守）。只有 Credentials 管理员登录会显式带 role='admin'。
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
        if (typeof token.provider === 'string') {
          ;(session.user as { provider?: string }).provider = token.provider
        }
      }
      return session
    },
  },
  secret: authSecret,
} satisfies NextAuthConfig

const handler = NextAuth(config)

export const auth = handler.auth
export const { handlers: { GET, POST } } = handler

/**
 * 校验当前请求是否具备管理员权限（供后台管理 API 路由统一调用）。
 *
 * 放行矩阵在 auth.config.ts 的 `isAdminAccessAllowed`——页面 authorized 回调、
 * proxy.ts 的 /admin 路由、本函数三处共用，避免再出现「API 关了、页面还进得去」。
 */
export async function verifyAdminSession() {
  const session = await auth()
  const user = session?.user as { id?: string; email?: string; name?: string; role?: string } | undefined

  if (!user) {
    return { ok: false as const, error: 'Unauthorized', status: 401 }
  }
  if (!isAdminAccessAllowed(user)) {
    return { ok: false as const, error: 'Forbidden', status: 403 }
  }

  // 只有凭证管理员（固定 id）会拿到服务端 GitHub token；GitHub OAuth 身份走白名单放行
  const githubToken = getServerGithubToken(user.id) || process.env.GITHUB_PAT || ''
  return { ok: true as const, session, user, githubToken }
}