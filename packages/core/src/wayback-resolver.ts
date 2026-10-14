/**
 * 坏链自愈与时间机器历史镜像解析引擎 (Wayback Machine & Dead Link Sentinel)
 * 纯算法实现，0 DOM 依赖，跨 Node.js 和浏览器通用。
 */

export interface WaybackSnapshotInfo {
  available: boolean
  url?: string
  timestamp?: string
  status?: string
}

/**
 * 1. 规范化目标网址 (清理多余的定位锚点与追踪参数)
 */
export function normalizeTargetUrl(url: string): string {
  if (!url) return ''
  try {
    const raw = url.trim()
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
    // 移除常见跟踪参数
    const paramsToDelete: string[] = []
    parsed.searchParams.forEach((_, key) => {
      if (key.startsWith('utm_') || key === 'spm' || key === 'from' || key === 'ref') {
        paramsToDelete.push(key)
      }
    })
    for (const key of paramsToDelete) {
      parsed.searchParams.delete(key)
    }
    parsed.hash = ''
    let result = parsed.toString()
    if (parsed.pathname === '/' && !parsed.search && !raw.endsWith('/')) {
      result = result.replace(/\/$/, '')
    }
    return result
  } catch {
    return url.trim()
  }
}

/**
 * 2. 构造官方 Wayback Machine 历史快照瞬时入口
 */
export function buildWaybackSnapshotUrl(
  targetUrl: string,
  timestamp?: string | number
): string {
  const clean = normalizeTargetUrl(targetUrl)
  if (!clean) return ''
  const timeSeg = timestamp ? String(timestamp) : '*'
  return `https://web.archive.org/web/${timeSeg}/${clean}`
}

/**
 * 3. 构造主动向 Wayback Machine 归档请求的 URL
 */
export function buildWaybackSaveUrl(targetUrl: string): string {
  const clean = normalizeTargetUrl(targetUrl)
  if (!clean) return ''
  return `https://web.archive.org/save/${clean}`
}

/**
 * 4. 判定是否为典型死链或服务器不可达状态码
 */
export function isPotentialBrokenHttpCode(status: number): boolean {
  // 404 (Not Found), 410 (Gone), 451 (Unavailable For Legal Reasons)
  // 500, 502, 503, 504 (Server Errors)
  // 521, 522, 523 (Cloudflare Server Down)
  return (
    status === 404 ||
    status === 410 ||
    status === 451 ||
    (status >= 500 && status <= 599)
  )
}

/**
 * 5. 解析 Internet Archive Availability API 响应
 */
export function parseWaybackAvailabilityResponse(data: any): WaybackSnapshotInfo {
  if (!data || typeof data !== 'object') {
    return { available: false }
  }

  const snapshots = data.archived_snapshots
  if (!snapshots || !snapshots.closest || !snapshots.closest.available) {
    return { available: false }
  }

  const closest = snapshots.closest
  return {
    available: true,
    url: typeof closest.url === 'string' ? closest.url : undefined,
    timestamp: typeof closest.timestamp === 'string' ? closest.timestamp : undefined,
    status: typeof closest.status === 'string' ? closest.status : undefined,
  }
}
