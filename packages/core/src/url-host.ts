/**
 * URL 主机归属判定（CodeQL `js/incomplete-url-substring-sanitization` 根治）。
 *
 * 背景：`.includes('github.com')` / `.startsWith('http')` / 宽松正则这类子串
 * 校验对 URL 都是不完整的——
 *   - `https://evil.com/?github.com`（白名单 host 只在查询串里）
 *   - `https://github.com.evil.com/x`（后缀伪装成子域）
 *   - `https://evilgithub.com`（前缀拼接）
 *   - `httpx://evil.com`（`startsWith('http')` 误判为绝对 URL）
 * 都会绕过子串检查。本模块统一用 WHATWG `new URL()` 解析 + 协议校验 +
 * 严格主机名比对，替代所有 URL 子串判断。
 *
 * 同语义实现另见 `apps/web-overlay/src/lib/safe-url.ts`（前端 vendored 底座，
 * 不依赖 `@navhub/*`）与 `scripts/lib/url-host.mjs`（脚本层 `.mjs` 无法
 * import `.ts`）；三份共用同一套测试用例，行为必须一致。
 */

function normalizeAllowedHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

/**
 * 判定 `rawUrl` 是否属于 `allowedHosts` 任一主机（含其子域）。
 *
 * 规则：
 *   - 非法 URL / 空串 -> `false`；
 *   - 协议必须为 `http:` / `https:`，其余（`ftp:`、`javascript:`、`data:`…）一律 `false`；
 *   - 主机名严格比对：`hostname === host || hostname.endsWith('.' + host)`，
 *     均小写比对；端口不影响判定。
 *
 * 注意：本函数只判定“主机归属”，不管 userinfo（`https://user@github.com/` 按
 * 主机名判定为 true；渲染层另有 `safeHref` 拦 userinfo，这里不越权）。
 * 无方案裸串（如 `github.com/foo`）`new URL` 会抛错 -> `false`，不自动补方案。
 */
export function isAllowedHost(rawUrl: string, allowedHosts: string[]): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false
  let hostname: string
  try {
    const u = new URL(rawUrl.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    hostname = u.hostname.toLowerCase()
  } catch {
    return false
  }
  if (!hostname) return false
  for (const host of allowedHosts) {
    const h = normalizeAllowedHost(host)
    if (!h) continue
    if (hostname === h || hostname.endsWith(`.${h}`)) return true
  }
  return false
}

/** 是否为可解析的 http(s) 绝对 URL（替代 `value.startsWith('http')` 嗅探）。 */
export function isAbsoluteHttpUrl(value: string): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 站点 URL 归一化解析（替代 `raw.startsWith('http') ? raw : `https://${raw}``）。
 *
 *   - http(s) 绝对 URL -> 原样解析返回；
 *   - 裸主机名 / 带端口裸串（如 `example.com:8080/path`，`new URL` 会误解析出
 *     `example.com:` 这种“方案”）-> 补 `https://` 再解析；
 *   - 真正的非 http(s) 绝对 URL（如 `httpx://evil.com`，补方案后仍非法）或
 *     完全非法串 -> `null`，调用方按原有回落处理。
 */
export function parseSiteUrl(raw: string): URL | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u
    // 非 http(s) 方案：可能是裸串被误解析（如 example.com:8080），也可能是
    // httpx:// 之类——统一按裸串补 https:// 再试一次，非法则 null。
  } catch {
    // 无方案裸串，补 https:// 再试。
  }
  try {
    return new URL(`https://${trimmed}`)
  } catch {
    return null
  }
}
