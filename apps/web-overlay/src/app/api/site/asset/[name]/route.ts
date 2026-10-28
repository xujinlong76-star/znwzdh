import { NextResponse } from 'next/server'
import { readStorageFresh } from '@/lib/github'

export const runtime = 'nodejs'

/** 与上传路由同一份目录约定 */
const ASSET_DIR = 'src/navsphere/content/assets'

/**
 * 只认「kind-<10 位哈希>.<位图扩展名>」这种由上传路由生成的形状。
 *
 * 名字直接进存储键，所以宁可拒绝也不做「帮你修正」：正则收死之后，
 * 目录穿越（..%2F）、超长名、非常规扩展名都到不了中枢。
 * 扩展名白名单里没有 svg——同域渲染的矢量图可携带脚本。
 */
const NAME_RE = /^(?:logo|favicon|ogImage|appleTouchIcon|pwaIcon192|pwaIcon512|pwaMaskable512)-(?:[0-9a-f]{10})\.(?:png|jpe?g|webp|ico)$/

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  if (!NAME_RE.test(name)) {
    return new NextResponse('Invalid asset name', { status: 400 })
  }

  const path = ASSET_DIR + '/' + name + '.json'
  let data: Record<string, unknown> | null
  try {
    data = await readStorageFresh<Record<string, unknown>>(path)
  } catch {
    return new NextResponse('Asset storage unavailable', { status: 503, headers: { 'cache-control': 'no-store' } })
  }
  if (!data || typeof data !== 'object' || typeof data.data !== 'string') {
    return new NextResponse('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })
  }

  const allowedMime = ['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']
  if (typeof data.mime !== 'string' || !allowedMime.includes(data.mime)) {
    return new NextResponse('Invalid asset', { status: 415, headers: { 'cache-control': 'no-store' } })
  }
  const mime = data.mime
  const body = Buffer.from(data.data, 'base64')

  return new NextResponse(new Uint8Array(body), {
    headers: {
      'content-type': mime,
      // 文件名带内容哈希，换图即换 URL，因此可以交给浏览器一年不过期
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      vary: 'Accept',
    },
  })
}
