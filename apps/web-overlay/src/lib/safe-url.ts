/**
 * 渲染期 URL 安全化。
 *
 * 站点 URL 可由匿名投稿写入（`/api/submissions`），若存成 `javascript:alert(1)`
 * 或 `data:text/html,...`，前台 `<a href={site.url}>` 就会变成可点击的 XSS 载体
 * （服务端已用 httpUrl schema 收紧入库，这里是纵深防御：历史脏数据同样要挡住）。
 *
 * 放行规则：
 *   - 站内路径（/xxx）、锚点（#xxx）、相对路径 -> 原样放行
 *   - 完整 URL -> 仅 http/https 放行
 *   - 其余（javascript:、data:、vbscript:、file: 等）-> 降级为 '#'
 */

/** 是否为可安全用于 href/src 的 http(s) URL */
export function isSafeHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
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
  // 站内路径 / 锚点 / 协议相对路径
  if (v.startsWith('/') || v.startsWith('#') || v.startsWith('./') || v.startsWith('../')) {
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
