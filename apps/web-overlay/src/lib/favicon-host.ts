/**
 * favicon 代取端点的 hostname 解析（两个路由共用）。
 *
 * 历史实现把 `?domain=` 原样拼进 Google/favicon.im 的上游 URL：调用方传完整 URL
 * （https://example.com/path）时，`/` `?` `#` `&` 会改变上游请求的路径与查询语义，
 * 构成参数注入 + 无界第三方代取面。这里统一收敛为「先解析出纯主机名再拼接」。
 */

/** 合法主机名：至少一段点分结构，禁止空白/路径/查询字符。 */
const DOMAIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/

export function extractFaviconHostname(raw: string | null): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value || value.length > 253) return null
  let host = value
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    try { host = new URL(value).hostname } catch { /* 非法 URL 格式，拒绝并返回 null */ return null }
  }
  if (/[\/?#@\s]/.test(host)) return null
  host = host.split(':')[0].replace(/\.$/, '')
  return DOMAIN_RE.test(host) ? host : null
}
