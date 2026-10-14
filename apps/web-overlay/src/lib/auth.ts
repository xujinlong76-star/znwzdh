import NextAuth from 'next-auth'
import GithubProvider from 'next-auth/providers/github'
import type { DefaultSession, NextAuthConfig } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      accessToken?: string
    } & DefaultSession['user']
  }
  interface JWT {
    accessToken?: string
  }
  interface User {
    accessToken?: string
  }
}

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

const config = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        // 最小权限：只有需要写内容仓库时才要 public_repo；默认是只读身份（无 scope）。
        // 需要写仓库（后台保存导航数据）的部署可设 NAVHUB_GITHUB_WRITE_SCOPE=1 提升权限。
        params:
          process.env.NAVHUB_GITHUB_WRITE_SCOPE === '1'
            ? { scope: 'public_repo' }
            : { scope: '' },
      },
    })
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account?.access_token) {
        // 只在服务端保存，不写入 token（token 会被序列化进 JWT cookie 下发）
        if (token.sub) serverTokenStore.set(token.sub, account.access_token)
      }
      return token
    },
    async session({ session, token }) {
      // 不再下发 accessToken：session 只保留身份信息
      if (session?.user && token.sub) {
        ;(session.user as { id?: string }).id = token.sub
      }
      return session
    }
  },
  pages: {
    signIn: '/auth/signin'
  },
  // 会话签名密钥不应复用 OAuth client secret（一泄露两处同时失守）。
  // 缺失时交给 NextAuth 报错，而不是静默降级。
  secret: process.env.AUTH_SECRET
} satisfies NextAuthConfig

const handler = NextAuth(config)

export const auth = handler.auth
export const { handlers: { GET, POST } } = handler