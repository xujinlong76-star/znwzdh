import { NextResponse, type NextRequest } from 'next/server'
import { guardedFetch, readBodyLimited, SsrfBlockedError } from '@/lib/ssrf-guard'
import { extractFaviconHostname } from '@/lib/favicon-host'

export const runtime = 'nodejs'
const MAX_FAVICON_BYTES = 2 * 1024 * 1024
const SAFE_FAVICON_TYPE_REGEX = /^image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|avif)$/

export async function GET(req: NextRequest) {
  const hostname = extractFaviconHostname(req.nextUrl.searchParams.get('domain'))
  if (!hostname) return NextResponse.json({ error: '缺少有效的 domain 参数' }, { status: 400 })
  const faviconUrl = `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(hostname)}`
  try {
    const { response } = await guardedFetch(faviconUrl, { timeoutMs: 8000, maxBytes: MAX_FAVICON_BYTES })
    if (!response.ok) return NextResponse.json({ error: '无法访问该网站或未找到 Favicon' }, { status: response.status })
    const rawType = (response.headers.get('content-type') || 'image/x-icon').split(';')[0].trim().toLowerCase()
    if (!SAFE_FAVICON_TYPE_REGEX.test(rawType)) {
      return NextResponse.json({ error: '上游图标类型不受支持' }, { status: 502 })
    }
    const { bytes } = await readBodyLimited(response, MAX_FAVICON_BYTES)
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': rawType,
        'Cache-Control': 'public, max-age=86400',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof SsrfBlockedError) return NextResponse.json({ error: '目标地址不被允许' }, { status: 403 })
    console.error('[favicon] 抓取失败:', error)
    return NextResponse.json({ error: '发生错误，请重试。' }, { status: 502 })
  }
}
