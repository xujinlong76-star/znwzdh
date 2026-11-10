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
    /**
     * 解析失败返回空串，**不能返回原始输入**。
     *
     * 原实现返回 `url.trim()`，后果是所有调用方的 `if (!clean) …` 保护全部失效：
     * 任何脏输入（如 `"https://"`、`":::"`）都得到一个非空的"清洗后 URL"，
     * 于是被当成合法地址继续拼进 archive.org 请求或快照链接。
     *
     * 实测：`normalizeTargetUrl("https://")` 曾返回 `"https://"`，
     * 让 `discovery.ts` 的「无效的网址」分支几乎不可达。
     *
     * 改为空串后，调用方的既有判断（`if (!clean) return ''` /
     * `if (!cleanUrl) return fail(...)`）才真正生效。
     */
    return ''
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

/** 别名兼容：根据目标网址生成 Wayback 归档快照拯救链接 */
export const generateWaybackRecoveryUrl = buildWaybackSnapshotUrl;

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
