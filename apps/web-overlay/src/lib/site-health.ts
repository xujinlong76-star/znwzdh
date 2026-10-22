/**
 * 站点健康徽标的展示口径。
 *
 * 历史问题：只要 health 对象存在就渲染「SLA 正常 / 响应缓慢」，但大量站点
 * 从未被巡检（lastCheckedAt/latencyMs 为空），会被误标成「响应缓慢」；
 * 「SLA」还是内部术语，对访客没有意义。
 *
 * 口径：只有完成过巡检（lastCheckedAt 有值）才展示；文案按可验证的事实
 * 给出——HTTP 状态码优先；没有状态码时只说「近期检测异常」（是本站的检测
 * 失败，不等于目标站对用户不可达），不臆测原因。
 */
export interface SiteHealthLike {
  ok?: boolean
  httpStatus?: number | null
  latencyMs?: number | null
  lastCheckedAt?: number | null
}

export interface SiteHealthBadge {
  tone: 'ok' | 'warn'
  label: string
  latencyMs: number | null
}

export function siteHealthBadge(health: SiteHealthLike | null | undefined): SiteHealthBadge | null {
  if (!health || !health.lastCheckedAt) return null
  const latencyMs = health.latencyMs ?? null
  if (health.ok) return { tone: 'ok', label: '可访问', latencyMs }
  if (health.httpStatus != null) return { tone: 'warn', label: `HTTP ${health.httpStatus}`, latencyMs }
  return { tone: 'warn', label: '近期检测异常', latencyMs }
}
