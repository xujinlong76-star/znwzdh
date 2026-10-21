import { headers } from 'next/headers'

/**
 * 站点对外 origin 的唯一来源。
 *
 * 为什么不用 `NAVHUB_PUBLIC_URL`：那个变量与 `PORT=8787` 相邻、示例值是
 * `http://localhost:8787`，语义上是中枢 API 自己的对外地址，一个变量不能
 * 同时承担「API 地址」与「站点地址」两种语义。canonical / sitemap / OG 全部
 * 依赖这里，写错就是整站指向错误域名。
 *
 * 顺序很重要：先读环境变量，只有缺失时才触碰 `headers()`。
 * 一旦无条件调用 `headers()`，sitemap / robots / 详情页都会被钉死为动态渲染，
 * `revalidate` 写了也不生效。
 */
/**
 * 从请求头里提取 origin。
 *
 * `Host` / `x-forwarded-*` 都可由客户端伪造（Host 头投毒会把 canonical、
 * sitemap、OG 全部指向攻击者域名）。这里做格式收敛：只接受
 * `host[:port]`，拒绝 userinfo、路径、空白与控制字符；协议只认 http/https。
 * 真正部署时仍应优先配置 `NAVHUB_SITE_URL`，请求头推导只是兜底。
 */
export function originFromHeaders(
  hostHeader: string | null | undefined,
  protoHeader: string | null | undefined,
): string | null {
  // 取第一个值（逗号分隔的转发链）。这里刻意**不 trim**：首尾空白本身
  // 就是可疑格式（正常代理不会带），直接拒绝比“帮忙修正”更安全。
  const rawHost = (hostHeader ?? '').split(',')[0] ?? ''
  if (!rawHost || rawHost.length > 253) return null
  if (/[\/\\?#@\s]/.test(rawHost)) return null
  let normalizedHost: string
  try {
    const parsed = new URL(`http://${rawHost}`)
    if (!parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/') return null
    normalizedHost = parsed.host
  } catch {
    return null
  }
  const rawProto = (protoHeader ?? 'https').split(',')[0]?.trim().toLowerCase() ?? 'https'
  const proto = rawProto === 'http' ? 'http' : 'https'
  return `${proto}://${normalizedHost}`
}

export async function siteOrigin(): Promise<string | null> {
  const configured = process.env.NAVHUB_SITE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')

  const h = await headers()
  // 反代链路上没有 x-forwarded-proto 时按 https 兜底：自托管的公开站点基本都是 https，
  // 兜底成 http 会让 sitemap 出现 http 地址，比兜底成 https 更容易出问题。
  return originFromHeaders(h.get('x-forwarded-host') ?? h.get('host'), h.get('x-forwarded-proto'))
}

/** 同步版本：给不能 await 的地方（如 route handler 的常量初始化）用。 */
export function configuredSiteOrigin(): string | null {
  const configured = process.env.NAVHUB_SITE_URL?.trim()
  return configured ? configured.replace(/\/+$/, '') : null
}
