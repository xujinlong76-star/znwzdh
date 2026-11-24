/**
 * GET /api/safe-browsing?url=<单个 URL>
 *
 * 品牌认官网第二步（W3）：对单个 URL 同时返回 Google Safe Browsing 查询
 * 结果与目标主机的 TLS 证书信息（签发者与有效期）。
 *
 * - 只校验 URL 合法（可解析、http/https、长度上限）；不限制域名，
 *   因为本端点的用途就是核查任意候选 URL（包括疑似仿冒站），
 *   50 家已核实品牌名单的范围由 verified-brands.ts 另行守住，不由这里扩。
 * - 不缓存（Cache-Control: no-store）、不记日志、不持久化用户查过的 URL。
 * - Safe Browsing 无 key 或请求失败时不在这里编结论：如实透传
 *   safe-browsing.ts 返回的 status（unavailable / unknown）与原因。
 */
import { NextResponse, type NextRequest } from 'next/server'
import {
  getCertificateInfo,
  lookupUrls,
  SAFE_BROWSING_SOURCE,
  type SafeBrowsingResult,
} from '@/lib/safe-browsing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_URL_LENGTH = 2048

/**
 * 由 Safe Browsing 查询结果派生顶层 conclusion，供 /verify 比对页
 * pickConclusion 原样转述；无结论的状态（unavailable / unknown）返回
 * null，页面照常显示“未查到”，这里不编结论。
 */
function deriveConclusion(safeBrowsing: SafeBrowsingResult): string | null {
  if (safeBrowsing.status === 'unsafe') {
    return `Google Safe Browsing 命中：${safeBrowsing.matches.map((m) => m.threatType).join('、')}`
  }
  if (safeBrowsing.status === 'safe') {
    return 'Google Safe Browsing 未发现已知威胁'
  }
  return null
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url')
  if (!raw) {
    return NextResponse.json({ error: '缺少有效的 url 参数' }, { status: 400 })
  }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return NextResponse.json({ error: 'url 参数不是有效的 URL' }, { status: 400 })
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    raw.length > MAX_URL_LENGTH
  ) {
    return NextResponse.json({ error: 'url 参数不是有效的 http(s) URL' }, { status: 400 })
  }

  const checkedAt = new Date().toISOString()
  try {
    const [safeBrowsing, certificate] = await Promise.all([
      lookupUrls([parsed.toString()]),
      getCertificateInfo(parsed.hostname),
    ])
    return NextResponse.json(
      {
        url: parsed.toString(),
        safeBrowsing,
        conclusion: deriveConclusion(safeBrowsing),
        certificate,
        checkedAt,
        source: SAFE_BROWSING_SOURCE,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    return NextResponse.json({ error: '查询失败，请重试。' }, { status: 502 })
  }
}
