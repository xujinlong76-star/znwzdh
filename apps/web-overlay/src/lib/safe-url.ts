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

