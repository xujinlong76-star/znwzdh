import NextAuth from 'next-auth'
import { authConfig, isAdminAccessAllowed, type AdminUserLike } from '@/lib/auth.config'
import { NextResponse } from 'next/server'
import { NAV_VIEW_MODE_COOKIE, parseViewModeCookie } from '@/lib/modular/view-mode-cookie'

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
  // 首页展示模式：读 nav_view_mode Cookie，命中非 standard 规范模式就透明重写到
  // 预渲染变体 /vm/[mode]（Zero-CLS：服务端直接出该模式 HTML）。standard / 无
  // Cookie / 非法值都落到 app/page.tsx 的 standard 变体，首页得以保持 ISR。
  if (req.nextUrl.pathname === '/') {
    const mode = parseViewModeCookie(req.cookies.get(NAV_VIEW_MODE_COOKIE)?.value)
    if (mode && mode !== 'standard') {
      return NextResponse.rewrite(new URL(`/vm/${mode}`, req.nextUrl))
    }
  }
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
  matcher: ['/admin/:path*', '/'],
}
