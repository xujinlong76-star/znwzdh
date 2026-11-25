/**
 * 渲染期 URL 安全化。
 *
 * 站点 URL 可由匿名投稿写入（`/api/submissions`），若存成 `javascript:alert(1)`
 * 或 `data:text/html,...`，前台 `<a href={site.url}>` 就会变成可点击的 XSS 载体
 * （服务端已用 httpUrl schema 收紧入库，这里是纵深防御：历史脏数据同样要挡住）。
 *
 * 放行规则：
 *   - 站内路径（/xxx）、锚点（#xxx）、相对路径 -> 原样放行
 *   - 完整 URL -> 仅 http/https 放行，且不带 userinfo
 *   - 其余（javascript:、data:、vbscript:、file: 等）-> 降级为 '#'
 *
 * 两条以前漏掉的口径：
 *   1. **控制字符**。浏览器在解析 URL 前会先删掉 Tab/LF/CR（WHATWG 的 forgiving
 *      parsing），所以 `"/\t/evil.com"` 会被当成 `"//evil.com"` 打开站外站点：
 *      按原始串做的 `startsWith('//')` 判定根本管不到它。这类输入一律拒绝，
 *      不去猜浏览器删完字符后剩下什么。
 *   2. **userinfo 伪装**。`https://navhub.example@evil.example` 的权威域是
 *      evil.example，但卡片与链接文字截断后看起来像 navhub.example —— 这是
 *      钓鱼最常用的显示/跳转不一致，直接拒绝（导航站没有正当理由带凭据）。
 */

/** C0 控制字符与 DEL：合法 URL 里不该出现，而浏览器对它们的处理是「删掉再继续解析」 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/** 站内安全前缀：以这些开头的才可能是「站内路径/锚点/相对路径」 */
const RELATIVE_PREFIXES = ['/', '#', './', '../']

/** 是否为可安全用于 href/src 的 http(s) URL */
export function isSafeHttpUrl(value: string): boolean {
  if (CONTROL_CHARS.test(value)) return false
  try {
    const u = new URL(value)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    // userinfo（https://显示名@真实域）会让「看到的域名」与「打开的域名」不一致
    if (u.username || u.password) return false
    return true
  } catch {
    return false
  }
}

/**
 * 把任意用户输入转成可安全渲染的 href。
 * @param value 原始值
 * @param fallback 不安全时的回落值（默认 '#'，点击无副作用）
 */
export function safeHref(value?: string | null, fallback = '#'): string {
  if (!value) return fallback
  const v = value.trim()
  if (!v) return fallback
  // 含控制字符时，浏览器解析出来的地址与我们校验的串不是同一个东西：拒绝，不猜
  if (CONTROL_CHARS.test(v)) return fallback
  // 站内路径 / 锚点 / 相对路径。
  // 明确拒绝协议相对路径（//evil.com）与反斜杠变体（/\evil.com）：
  // 浏览器会把它们解析成站外地址，不能当“站内路径”放行。
  if (v.startsWith('//') || v.startsWith('/\\')) return fallback
  if (RELATIVE_PREFIXES.some((prefix) => v.startsWith(prefix))) {
    return v
  }
  return isSafeHttpUrl(v) ? v : fallback
}

/** iframe/媒体 src 安全化：不安全返回 undefined（调用方应跳过渲染） */
export function safeSrc(value?: string | null): string | undefined {
  if (!value) return undefined
  const v = value.trim()
  return isSafeHttpUrl(v) ? v : undefined
}

/**
 * 新窗口打开一个用户可控地址。
 *
 * 三条一起解决：伪协议/协议相对（safeHref 的口径）、缺 `noopener` 造成的
 * reverse tabnabbing（新窗口能改 opener.location），以及不安全值下
 * `window.open('#')` 白白开一个空标签页。返回 null 时调用方应给出可见反馈。
 *
 * features 不做参数：这扇门以前由调用方各自传字符串，少写一个词就把
 * reverse tabnabbing 又放开一次，而全仓三十个调用点没人会逐个复查。
 */
export function safeWindowOpen(value?: string | null): Window | null {
  if (!value) return null
  const target = safeHref(value, '')
  if (!target) return null
  return window.open(target, '_blank', 'noopener,noreferrer')
}

/**
 * URL 主机归属判定（CodeQL `js/incomplete-url-substring-sanitization` 根治）。
 *
 * 与 `packages/core/src/url-host.ts` 及 `scripts/lib/url-host.mjs` 同语义实现：
 * 前端为独立 vendored 底座、不依赖 `@navhub/*`（加 workspace 依赖会炸
 * `Dockerfile.web` 的 `docker-smoke`，见 U-352 A′ 教训），故就地一份；
 * 三份共用同一套测试用例，行为必须一致。改动任一份时须同步另外两份 + 三份测试。
 *
 * 规则：`new URL(rawUrl)` 解析，非法 URL 返回 `false`；协议必须为
 * `http:` / `https:`；主机名严格比对 `hostname === host ||
 * hostname.endsWith('.' + host)`（均小写；端口不影响判定）。
 * 只判定“主机归属”，不管 userinfo（渲染层另有 `safeHref` 拦 userinfo）；
 * 无方案裸串 `new URL` 抛错 -> `false`，不自动补方案。
 */
function normalizeAllowedHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

export function isAllowedHost(rawUrl: string, allowedHosts: string[]): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false
  let hostname: string
  try {
    const u = new URL(rawUrl.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    // WHATWG 保留主机名末尾的点（https://github.com./x -> "github.com."），去点再比对。
    hostname = u.hostname.toLowerCase().replace(/\.$/, '')
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
    // 非 http(s) 方案：若串里已有 `://`，它就是带方案的绝对 URL（如 httpx://），
    // 不补方案（`https://httpx://evil.com` 会被 WHATWG 解析成主机名 httpx，
    // 属于误解析）；只有无 `://` 的裸串才补 `https://` 再试。
    if (trimmed.includes('://')) return null
  } catch {
    // 无方案裸串，补 https:// 再试。
  }
  try {
    return new URL(`https://${trimmed}`)
  } catch {
    return null
  }
}

/**
 * GitHub blob 链接转 raw 链接（`github.com/<owner>/<repo>/blob/<branch>/<path>`
 * → `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>`）。
 *
 * 主机名必须用 URL 解析判定，不用子串 includes：子串匹配会被
 * `github.com.evil.com` 或查询串里的 `github.com/` 绕过（CodeQL
 * js/incomplete-url-substring-sanitization）。非 blob 链接或非
 * github.com 主机返回 null（调用方保留原 URL）。
 */
export function toRawGithubUrl(raw: string): string | null {
  const u = parseSiteUrl(raw)
  if (!u || u.hostname.toLowerCase().replace(/\.$/, '') !== 'github.com') return null
  if (!u.pathname.includes('/blob/')) return null
  return `https://raw.githubusercontent.com${u.pathname.replace('/blob/', '/')}${u.search}${u.hash}`
}

