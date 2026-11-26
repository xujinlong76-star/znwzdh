import NextAuth from 'next-auth'
import { authConfig, isAdminAccessAllowed, type AdminUserLike } from '@/lib/auth.config'
import { NextResponse, type NextRequest } from 'next/server'
import { NAV_VIEW_MODE_COOKIE, parseViewModeCookie } from '@/lib/modular/view-mode-cookie'

const { auth } = NextAuth(authConfig)

/**
 * /admin 页面层守卫（需 NextAuth 会话解码）。
 */
const adminAuthProxy = auth((req) => {
  const user = req.auth?.user as AdminUserLike | undefined

  if (!user) {
    const callbackUrl = req.url
    return NextResponse.redirect(
      new URL(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`, req.url),
    )
  }

  if (!isAdminAccessAllowed(user)) {
    const callbackUrl = req.url
    return NextResponse.redirect(
      new URL(
        `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}&error=AccessDenied`,
        req.url,
      ),
    )
  }
  return NextResponse.next()
})

/**
 * 统一入口（P0-6 优化）：
 * - 首页 `/` 仅读取 `nav_view_mode` Cookie 决定是否透明重写到 `/vm/[mode]`，
 *   **不进入 NextAuth `auth()` 包装**，彻底省去每次首页请求的会话/JWT 解码开销；
 * - 仅 `/admin/*` 路由进入 `adminAuthProxy` 执行管理员鉴权。
 */
export function resolveHomeViewModeRewrite(req: NextRequest): NextResponse | null {
  if (req.nextUrl.pathname !== '/') return null
  const mode = parseViewModeCookie(req.cookies.get(NAV_VIEW_MODE_COOKIE)?.value)
  if (mode && mode !== 'standard') {
    return NextResponse.rewrite(new URL(`/vm/${mode}`, req.nextUrl))
  }
  return NextResponse.next()
}

export default function proxy(req: NextRequest, ctx: unknown) {
  const homeResponse = resolveHomeViewModeRewrite(req)
  if (homeResponse) return homeResponse
  if (req.nextUrl.pathname.startsWith('/admin')) {
    return (adminAuthProxy as unknown as (r: NextRequest, c: unknown) => unknown)(req, ctx)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/'],
}
