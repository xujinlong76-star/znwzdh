import 'next-auth'
import type { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    /**
     * @deprecated 不再下发 GitHub token 给浏览器（安全修复）。
     * 保留字段仅为历史兼容，服务端路由请用 getServerGithubToken(session.user.id)。
     */
    accessToken?: string
    user: {
      /** 用户在 IdP 的唯一 ID（服务端按它索引 token） */
      id?: string
      role?: string
    } & DefaultSession['user']
  }
  interface JWT {
    accessToken?: string
    role?: string
  }
  interface User {
    accessToken?: string
    role?: string
  }
}