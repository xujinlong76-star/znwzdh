import { NextResponse, type NextRequest } from 'next/server'
import { guardedFetch, readBodyLimited, SsrfBlockedError } from '@/lib/ssrf-guard'
import { extractFaviconHostname } from '@/lib/favicon-host'

export const runtime = 'nodejs'
const MAX_FAVICON_BYTES = 2 * 1024 * 1024

export async function GET(req: NextRequest) {
  const hostname = extractFaviconHostname(req.nextUrl.searchParams.get('domain'))
  if (!hostname) return NextResponse.json({ error: '缺少有效的 domain 参数' }, { status: 400 })
  // larger 参数真正生效（历史实现读取后未使用，且 URL 尾部残留 `' }` 字面量）
  const larger = req.nextUrl.searchParams.get('larger') === 'true'
  const faviconUrl = `https://favicon.im/zh/${encodeURIComponent(hostname)}?larger=${larger}`
  try {
    const { response } = await guardedFetch(faviconUrl, { timeoutMs: 8000, maxBytes: MAX_FAVICON_BYTES })
    if (!response.ok) return NextResponse.json({ error: '无法访问该网站或未找到 Favicon' }, { status: response.status })
    const { bytes } = await readBodyLimited(response, MAX_FAVICON_BYTES)
    // 不放行 svg+xml：与 media-proxy 同口径，避免同源代理成为脚本型图片投递面
    const rawType = (response.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase()
    const contentType = /^image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon)$/.test(rawType) ? rawType : 'image/png'
    return new NextResponse(new Uint8Array(bytes), {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' },
    })
  } catch (error) {
    if (error instanceof SsrfBlockedError) return NextResponse.json({ error: '目标地址不被允许' }, { status: 403 })
    console.error('[favicon-im] 抓取失败:', error)
    return NextResponse.json({ error: '发生错误，请重试。' }, { status: 502 })
  }
}
