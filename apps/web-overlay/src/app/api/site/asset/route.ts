import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { verifyAdminSession } from '@/lib/auth'
import { commitFile, invalidateContentCache } from '@/lib/github'

export const runtime = 'nodejs'

/**
 * 站点图片上传（logo / favicon / 分享大图）。
 *
 * 为什么必须自建这条口：中枢只有 `PUT /api/storage`，且写任何路径前都会
 * `JSON.parse(content)`（apps/api/src/storage.ts 的 writeStoragePath）——二进制进不去。
 * 于是这里把图片以 base64 存进一个独立的 KV 文档，再由同目录的 GET 路由还原成图片。
 *
 * 三条硬约束：
 * 1. **只收位图**，明确拒绝 svg：同域渲染的 svg 是脚本容器，等于把后台变成 XSS 入口。
 * 2. **体积上限**：base64 会膨胀约 33%，而这份数据每次首页渲染都跟着站点配置走，
 *    不设上限就是把站点配置变成图床。
 * 3. **内容寻址命名**：文件名含内容哈希，因此可以给浏览器 `immutable`，
 *    换图即换 URL，不存在「缓存了旧 logo 洗不掉」的问题。
 */

const ASSET_DIR = 'src/navsphere/content/assets'

const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
}

const MAX_BYTES: Record<string, number> = { logo: 512 * 1024, favicon: 128 * 1024, ogImage: 1024 * 1024 }
const KINDS = Object.keys(MAX_BYTES)

const NO_STORE = { 'cache-control': 'no-store' }

export async function POST(request: Request) {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) return new Response(authCheck.error, { status: authCheck.status })

    const form = await request.formData().catch(() => {
      // 非 multipart 请求体解析必然失败，下面统一回 400，无需记录
      return null
    })
    if (!form) {
      return NextResponse.json({ error: '需要 multipart 表单' }, { status: 400, headers: NO_STORE })
    }
    const kind = String(form.get('kind') ?? '')
    if (!KINDS.includes(kind)) {
      return NextResponse.json(
        { error: '未知的图片类型，允许：' + KINDS.join('/') },
        { status: 400, headers: NO_STORE },
      )
    }
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '缺少 file 字段' }, { status: 400, headers: NO_STORE })
    }
    const ext = ALLOWED[file.type]
    if (!ext) {
      return NextResponse.json(
        { error: '只接受 PNG / JPEG / WebP / ICO（不接受 SVG：同域渲染的矢量图可携带脚本）' },
        { status: 415, headers: NO_STORE },
      )
    }
    if (file.size > MAX_BYTES[kind]) {
      return NextResponse.json(
        { error: `文件过大（${kind} 上限 ${Math.round(MAX_BYTES[kind] / 1024)} KB，当前 ${Math.round(file.size / 1024)} KB）` },
        { status: 413, headers: NO_STORE },
      )
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 10)
    const name = kind + '-' + hash + '.' + ext
    const path = ASSET_DIR + '/' + name + '.json'

    await commitFile(
      path,
      JSON.stringify({ encoding: 'base64', mime: file.type, bytes: buf.byteLength, data: buf.toString('base64') }),
      'Upload site asset: ' + name,
      authCheck.githubToken || undefined,
    )
    // 刚写入的文档不能命中 2.5s 微缓存，否则首次 GET 会读到「不存在」
    invalidateContentCache(path)

    return NextResponse.json(
      { success: true, url: '/api/site/asset/' + name, bytes: buf.byteLength, mime: file.type, kind },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error('Failed to upload site asset:', error)
    return NextResponse.json(
      { error: '上传失败：' + (error instanceof Error ? error.message : String(error)) },
      { status: 500, headers: NO_STORE },
    )
  }
}
