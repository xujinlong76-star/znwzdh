/**
 * 动态路由参数的唯一解码入口。
 *
 * Next 传入的 params 可能仍是百分号编码；直接用 decodeURIComponent 遇到
 * 畸形输入（例如 `%`、`%E0%A4%A`）会抛 URIError，把一次爬虫探测变成 500。
 * 解码失败返回 null，由调用方 notFound()——坏 URL 应当是 404，不是服务器错误。
 */
export function safeDecodeParam(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    const decoded = decodeURIComponent(value)
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}
