/**
 * 登录回跳地址白名单。
 *
 * callbackUrl 来自查询参数；若直接赋值给 location，会把用户带到站外，
 * 甚至执行 javascript: URL。这里只保留与当前 origin 同源的 http(s) 地址，
 * 并统一收敛为 path + search + hash。
 */
export const DEFAULT_CALLBACK_URL = '/admin'

export function normalizeCallbackUrl(
  raw: string | null | undefined,
  origin: string,
  fallback = DEFAULT_CALLBACK_URL,
): string {
  if (!raw) return fallback

  try {
    const url = new URL(raw, origin)
    if (url.origin !== origin) return fallback
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback

    const path = `${url.pathname}${url.search}${url.hash}`
    return path || fallback
  } catch {
    return fallback
  }
}
