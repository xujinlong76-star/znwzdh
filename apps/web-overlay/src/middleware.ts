import NextAuth from 'next-auth'
import { authConfig } from '@/lib/auth.config'
import { NextResponse } from 'next/server'

const { auth } = NextAuth(authConfig)

export default auth((req) => {
  if (req.nextUrl.pathname.startsWith('/admin')) {
    if (!req.auth?.user) {
      const callbackUrl = req.url
      return NextResponse.redirect(
        new URL(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`, req.url)
      )
    }
  }
  return NextResponse.next()
})

export const config = {
  matcher: ['/admin/:path*'],
}