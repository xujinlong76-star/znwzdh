import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import NextAuth from 'next-auth'
import GithubProvider from 'next-auth/providers/github'
import CredentialsProvider from 'next-auth/providers/credentials'
import type { NextAuthConfig } from 'next-auth'
import { authConfig, authSecret, isAdminAccessAllowed } from './auth.config'
import { canonicalUserId } from './me-identity'
import { hubSessionRevoked } from './server/hub'

/** 时序安全的字符串比较（长度不等归一化到哑比较防短路） */
function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) {
    // 长度不等仍做一次哑比较抹平时序，再返回 false
    timingSafeEqual(ab, ab)
    return false
  }
  return timingSafeEqual(ab, bb)
}

interface EncryptedTokenRecord {
  ciphertext: string
  iv: string
  tag: string
  expiresAt: number
}

const MAX_CACHED_TOKENS = 500
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时过期

/**
 * 服务端加密 Token 缓存（AES-256-GCM + LRU + TTL）。
 *
 * 此前把 accessToken 写进 session 下发给浏览器：/api/auth/session 可被任意前端
 * JS 读取，且 scope 是 'repo'（读写用户全部仓库）——一次 XSS 或恶意脚本即全量失守。
 * 现在 token 只留在服务端，按 sub（用户唯一 ID）索引且经 AES-256-GCM 加密，前端写仓库时走
 * 服务端路由（需校验会话与管理员白名单），杜绝明文驻留与无界内存泄露风险。
 */
class EncryptedServerTokenStore {
  private readonly records = new Map<string, EncryptedTokenRecord>()
  private keyCache: Buffer | null = null

  private getEncryptionKey(): Buffer {
    if (!this.keyCache) {
      const secret = authSecret || 'navhub-token-storage-default-key'
      this.keyCache = scryptSync(secret, 'navhub-oauth-server-token-salt', 32)
    }
    return this.keyCache
  }

  set(sub: string, token: string): void {
    if (!sub || !token) return
    try {
      const key = this.getEncryptionKey()
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      let ciphertext = cipher.update(token, 'utf8', 'hex')
      ciphertext += cipher.final('hex')
      const tag = cipher.getAuthTag().toString('hex')

      // LRU 淘汰：超过上限丢弃最早条目
      if (this.records.size >= MAX_CACHED_TOKENS) {
        const oldest = this.records.keys().next().value
        if (oldest) this.records.delete(oldest)
      }

      this.records.set(sub, {
        ciphertext,
        iv: iv.toString('hex'),
        tag,
        expiresAt: Date.now() + TOKEN_TTL_MS,
      })
    } catch {
      // 容错降级
    }
  }

  get(sub: string): string | undefined {
    if (!sub) return undefined
    const record = this.records.get(sub)
    if (!record) return undefined

    if (Date.now() > record.expiresAt) {
      this.records.delete(sub)
      return undefined
    }

    try {
      const key = this.getEncryptionKey()
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'hex'))
      decipher.setAuthTag(Buffer.from(record.tag, 'hex'))
      let decrypted = decipher.update(record.ciphertext, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
      return decrypted
    } catch {
      this.records.delete(sub)
      return undefined
    }
  }

  clear(): void {
    this.records.clear()
  }
}

const serverTokenStore = new EncryptedServerTokenStore()

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

      // 生产环境绝对禁止不安全登录（Fail-Closed 原则）
      const allowInsecureLogin =
        isDev &&
        (process.env.NAVHUB_ALLOW_DEFAULT_PASSWORD === '1' ||
          process.env.NAVHUB_ALLOW_DEFAULT_PASSWORD === 'true' ||
          !authRequired)
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
      // P0-6：timingSafeEqual 替代裸 ===，防时序泄露（普通用户口令链路已做到，管理员通道此前是裸比较）
      const envAdminPassword = process.env.NAVHUB_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD
      if (envAdminPassword && timingSafeEq(rawPassword, envAdminPassword)) {
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
        process.env.NAVHUB_ADMIN_TOKEN,
        process.env.NAVHUB_STORAGE_TOKEN,
        process.env.NAVHUB_BOOTSTRAP_TOKEN,
        process.env.NAVHUB_MCP_TOKEN,
      ].filter(Boolean) as string[]

      if (rawPassword && validTokens.some((t) => timingSafeEq(rawPassword, t))) {
        return {
          id: 'admin',
          name: username || 'Token 管理员',
          email: 'admin@navhub.local',
          image: '/assets/images/alogo.webp',
          role: 'admin',
        }
      }

      // 4. 真实用户凭证登录（邮箱/用户名 + 密码）
      //
      // 此前 credentials provider 只认环境变量管理员口令与静态 token，
      // 普通用户无法用注册的邮箱+密码登录（password_hash 列从未被使用）。
      // 这里改为：未命中管理员通道时，调 API 中枢的 /api/account/login 校验
      // 注册用户的 scrypt 口令。API 不可达时不阻断，继续落到默认口令分支（保持旧行为）。
      if (rawUsername && rawPassword) {
        const apiBase =
          process.env.NAVHUB_STORAGE_BASE_URL ||
          process.env.NAVHUB_API_BASE_URL ||
          "http://127.0.0.1:8787";
        try {
          const res = await fetch(`${apiBase.replace(/\/+$/, "")}/api/account/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ identifier: rawUsername, password: rawPassword }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              user?: { id?: string; username?: string; email?: string | null; role?: string };
            };
            const u = data?.user;
            if (u?.id) {
              return {
                id: u.id,
                name: u.username ?? rawUsername,
                email: u.email ?? null,
                role: u.role ?? "user",
              };
            }
          }
        } catch {
          // API 不可达：不阻断，落到下面的默认口令分支（保持历史行为）
        }
      }

      // 5. 默认口令开箱即用支持——同样受 allowInsecureLogin 总闸管辖
      if (!envAdminPassword && validTokens.length === 0) {
        if (allowInsecureLogin) {
          const allowedDefaults = ['admin', 'admin123', 'navhub', '123456']
          if (allowedDefaults.includes(rawPassword) || (!rawPassword && (isDev || !authRequired))) {
            return {
              id: 'admin',
              name: username || '山羊胡管理员',
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
        token.role = (user as { role?: string }).role
        token.sub = user.id || token.sub || 'admin'
      }
      // 会话治理（T8）：sid 是设备吊销的锚点。JWT 无状态，服务端只存 sid 的
      // sha256——用户在 /me/account 踢出某 sid 后，BFF 校验会让该设备 401。
      if (!token.sid) token.sid = globalThis.crypto.randomUUID()
    // 登录时强制登记会话（P0-2）：立即调 sessions/check 建行，不等用户第一次调 /api/me/*。
    if (user && typeof token.sid === 'string') {
      const issuedAt = Date.now()
      token.issuedAt = issuedAt
      const identity = canonicalUserId({ id: user.id, provider: account?.provider })
      if (identity) {
        const revoked = await hubSessionRevoked(token.sid, identity, issuedAt).catch(() => null)
        if (revoked === true) console.warn('[session-register] unexpected revoked at login')
        else if (revoked === null) console.warn('[session-register] sessions/check unavailable')
      }
    }
      return token
    },
    async session({ session, token }) {
      if (session?.user && token.sub) {
        ;(session.user as { id?: string }).id = token.sub
        // sid 只在 BFF（服务端）与吊销校验中使用：挂 session 顶层而不是 user 上，
        // 避免被当成用户资料透传给任意客户端组件。
        if (typeof token.sid === 'string') {
          ;(session as { sessionSid?: string }).sessionSid = token.sid
        }
      if (typeof token.issuedAt === 'number') {
        ;(session as { sessionIssuedAt?: number }).sessionIssuedAt = token.issuedAt
      }
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

export async function verifyAdminSession() {
  const session = await auth()
  const user = session?.user as { id?: string; email?: string; name?: string; role?: string } | undefined

  if (!user) {
    return { ok: false as const, error: 'Unauthorized', status: 401 }
  }
  if (!isAdminAccessAllowed(user)) {
    return { ok: false as const, error: 'Forbidden', status: 403 }
  }

  // 吊销检查（P0-2）：被踢出/改密的管理员 JWT 须 401；核对不可用时 fail-open。
  const sessionSid = (session as { sessionSid?: string }).sessionSid
  if (typeof sessionSid === 'string' && sessionSid) {
    const identity = canonicalUserId(user)
    const issuedAt = (session as { sessionIssuedAt?: number }).sessionIssuedAt
    const revoked = identity ? await hubSessionRevoked(sessionSid, identity, issuedAt).catch(() => null) : null
    if (revoked === true) return { ok: false as const, error: 'Unauthorized', status: 401 }
    if (revoked === null && identity) console.warn('[admin-session] sessions/check unavailable, fail-open')
  }
  const githubToken = getServerGithubToken(user.id) || process.env.GITHUB_PAT || ''
  return { ok: true as const, session, user, githubToken }
}