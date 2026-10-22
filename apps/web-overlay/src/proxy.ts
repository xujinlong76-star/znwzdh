import NextAuth from 'next-auth'
import { authConfig, isAdminAccessAllowed, type AdminUserLike } from '@/lib/auth.config'
import { NextResponse } from 'next/server'

const { auth } = NextAuth(authConfig)

/**
 * /admin 页面层守卫。
 *
 * 此前只判「已登录」：API 层（requireAdmin → verifyAdminSession）已经 fail-closed，
 * 页面层却仍然放行任意登录用户进来，落在一个「进得去但什么都加载不出来」的后台
 * （每个请求都 403）——看起来像系统故障而不是权限不足（方案 P1-11）。
 *
 * 现在改为与 API 层同一个 `isAdminAccessAllowed`：未登录 → 去登录页；
 * 已登录但不在白名单 → 回登录页并带 `error=AccessDenied`，由登录页给出明确文案。
 */
export default auth((req) => {
  if (req.nextUrl.pathname.startsWith('/admin')) {
    const user = req.auth?.user as AdminUserLike | undefined

    if (!user) {
      const callbackUrl = req.url
      return NextResponse.redirect(
        new URL(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`, req.url)
      )
    }

    if (!isAdminAccessAllowed(user)) {
      const callbackUrl = req.url
      return NextResponse.redirect(
        new URL(
          `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}&error=AccessDenied`,
          req.url
        )
      )
    }
  }
  return NextResponse.next()
})

export const config = {
  matcher: ['/admin/:path*'],
}
