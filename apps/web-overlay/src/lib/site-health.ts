/**
 * 站点健康徽标的展示口径（03-livelink-mapping §3）。
 *
 * 历史问题：只要 health 对象存在就渲染「SLA 正常 / 响应缓慢」，但大量站点
 * 从未被巡检（lastCheckedAt/latencyMs 为空），会被误标成「响应缓慢」；
 * 「SLA」还是内部术语，对访客没有意义。
 *
 * 口径：只有完成过巡检（lastCheckedAt 有值）才展示；文案按可验证的事实
 * 给出——HTTP 状态码优先；没有状态码时只说「待核验」（是本站的检测
 * 失败，不等于目标站对用户不可达），不臆测原因，且不带毫秒数——没有收
 * 到 HTTP 响应时，探测自身的耗时不是站点的延迟（DNS 失败瞬间返回的
 * 0ms 尤其不能当众展示，否则「待核验 (0ms)」自相矛盾）。
 *
 * 分级映射 `siteHealthState()`（§3.1/§3.2）：判定顺序写死，按表自上而下，
 * 第一条命中即返回，不叠加——未巡检 → 已失效（硬条件）→ 疑似反爬 →
 * 疑似停放 / 疑似软 404 / 疑似内容过薄 → 检测异常 → 可访问。
 * 绝不引入分数/百分比字段：不折算 0–100 分，不算健康百分比。
 */
import type { HealthStatus } from './health-sentinel'

export interface SiteHealthLike {
  ok?: boolean
  httpStatus?: number | null
  latencyMs?: number | null
  lastCheckedAt?: number | null
}

/**
 * `siteHealthState()` 的输入：巡检事实 + 内容审计事实 + 连续失败计数。
 * 三个审计字段全是可选——数据管道尚未透传它们时（B 段计数持久化未定），
 * 映射仍按“单次失败只记疑似”保守判定，永不直升已失效。
 */
export interface SiteHealthInput extends SiteHealthLike {
  auditStatus?: HealthStatus
  auditConfidence?: number
  consecutiveFailures?: number
}

export type SiteHealthStateName =
  | 'accessible'
  | 'suspect-bot'
  | 'suspect-parked'
  | 'suspect-soft404'
  | 'suspect-thin'
  | 'suspect-not-found'
  | 'suspect-server-error'
  | 'anomaly'
  | 'dead'

export interface SiteHealthState {
  state: SiteHealthStateName
  tone: 'ok' | 'warn' | 'error'
  label: string
  latencyMs: number | null
}

export interface SiteHealthBadge {
  tone: 'ok' | 'warn' | 'error'
  label: string
  latencyMs: number | null
}

/** 旧口径的死链状态码（见 dead-link.ts）：404/410/451/5xx。 */
function isDeadLinkStatus(httpStatus: number | null | undefined): boolean {
  if (httpStatus == null) return false
  return (
    httpStatus === 404 ||
    httpStatus === 410 ||
    httpStatus === 451 ||
    (httpStatus >= 500 && httpStatus <= 599)
  )
}

/** 单次失败的种类文案（§3.2 补充规则）：按状态码写种类词，不写“已失效”。 */
function singleFailureLabel(httpStatus: number): string {
  if (httpStatus === 404) return '未找到 (404)'
  if (httpStatus === 410) return '已删除 (410)'
  if (httpStatus === 451) return '不可用 (451)'
  return `服务端错误 (${httpStatus})`
}

function singleFailureState(httpStatus: number): 'suspect-not-found' | 'suspect-server-error' {
  return httpStatus >= 500 && httpStatus <= 599 ? 'suspect-server-error' : 'suspect-not-found'
}

export function siteHealthState(health: SiteHealthInput | null | undefined): SiteHealthState | null {
  if (!health || !health.lastCheckedAt) return null
  const latencyMs = health.latencyMs ?? null
  // 无计数时按单次失败计：拿不出“连续两次”的证据，就永不直升已失效。
  const consecutiveFailures = health.consecutiveFailures ?? 1
  const auditConfidence = health.auditConfidence ?? 0

  // 已失效（硬条件，§3.2 第 8 行）：连续失败 >= 2，且满足其一——
  // ① 死链状态码；② SOFT_404 / SUSPICIOUS_PARKED 且置信度 >= 0.9 且连续两次命中。
  // 401/403/429 与无状态码永远不进本档。
  if (consecutiveFailures >= 2) {
    if (isDeadLinkStatus(health.httpStatus)) {
      return { state: 'dead', tone: 'error', label: '已失效 · 看存档', latencyMs }
    }
    if (
      (health.auditStatus === 'SOFT_404' || health.auditStatus === 'SUSPICIOUS_PARKED') &&
      auditConfidence >= 0.9
    ) {
      return { state: 'dead', tone: 'error', label: '已失效 · 看存档', latencyMs }
    }
  }

  // 疑似反爬：401/403/429，无论 ok 值；403 算疑似反爬，不算 UP（已裁决）。
  if (isBotBlockStatus(health.httpStatus)) {
    return { state: 'suspect-bot', tone: 'warn', label: `疑似反爬 · HTTP ${health.httpStatus}`, latencyMs }
  }

  // 疑似停放：pHash 汉明距离 ≤8（置信度 0.95）单次命中也只落本档，不直接升已失效。
  if (health.auditStatus === 'SUSPICIOUS_PARKED') {
    return { state: 'suspect-parked', tone: 'warn', label: '疑似停放', latencyMs }
  }
  // 疑似软 404：高置信度（>= 0.9）单次也只写“疑似失效 · 看存档”，不写“已失效”。
  if (health.auditStatus === 'SOFT_404') {
    return { state: 'suspect-soft404', tone: 'warn', label: '疑似失效 · 看存档', latencyMs }
  }
  // 疑似内容过薄：截断样本置信度只记 0.4，本档文案不变，不升级。
  if (health.auditStatus === 'THIN_CONTENT') {
    return { state: 'suspect-thin', tone: 'warn', label: '疑似内容过薄', latencyMs }
  }

  // 单次失败只记疑似：ok === false + 死链状态码，但连续失败未到 2 次。
  if (health.ok === false && health.httpStatus != null && isDeadLinkStatus(health.httpStatus)) {
    return {
      state: singleFailureState(health.httpStatus),
      tone: 'warn',
      label: singleFailureLabel(health.httpStatus),
      latencyMs,
    }
  }

  // 检测异常：已巡检且 ok === false 且无状态码（本站检测本身失败，
  // 不等于目标站对用户不可达）。结论存疑，不判站死刑：文案降级为「待核验」，
  // 毫秒数置空——没有 HTTP 响应就没有可展示的站点延迟，三处渲染方
  // （卡片 / 详情页 / 速览弹窗）据此不再画 "(0ms)"。
  if (health.ok === false && health.httpStatus == null) {
    return { state: 'anomaly', tone: 'warn', label: '待核验', latencyMs: null }
  }

  // 可访问：最近一次巡检确认目标站正常响应，且内容审计未检出劫持特征。
  // 走到这里时 auditStatus 只可能是空或 HEALTHY（SOFT_404 等已在上面返回）；
  // HEALTHY 与 ok === false 同时出现时以连通性为准，上面分支已处理，
  // 所以这里只认 ok === true——没有肯定事实就不报可访问。
  if (health.ok === true) {
    return { state: 'accessible', tone: 'ok', label: '可访问', latencyMs }
  }

  // 兜底：ok 既非 true 又非上述失败形态（如 ok 缺失但给了 200）——
  // 事实自相矛盾时不报可访问，只报待核验（同样不带毫秒数）。
  return { state: 'anomaly', tone: 'warn', label: '待核验', latencyMs: null }
}

/**
 * `siteHealthBadge()` 保持不动的兼容薄壳：内部改调 `siteHealthState()`，
 * 再取 tone/label/latencyMs。现有调用方（详情页、速览弹窗）不受影响。
 */
export function siteHealthBadge(health: SiteHealthInput | null | undefined): SiteHealthBadge | null {
  const state = siteHealthState(health)
  if (!state) return null
  return { tone: state.tone, label: state.label, latencyMs: state.latencyMs }
}

/**
 * 401/403/429 = 对方站点拒绝「自动访问」的典型状态（反爬、登录墙、按 IP 限流），
 * 对真实用户的浏览器往往照常可用。详情页据此给出解释，避免把巡检失败
 * 读成「站点已下线」；这不改变 state 判定，只影响文案。
 */
export function isBotBlockStatus(httpStatus: number | null | undefined): boolean {
  return httpStatus === 401 || httpStatus === 403 || httpStatus === 429
}

/**
 * 「只看失效」开关的过滤口径（§7）：有巡检事实且非可访问的站都算“失效侧”，
 * 包括疑似档与检测异常；未巡检（null）无事实可筛，不进筛选结果。
 */
export function isFailingHealthState(state: SiteHealthState | null | undefined): boolean {
  return state != null && state.tone !== 'ok'
}

/**
 * 徽标悬停 title（§7 写死）：`HTTP <code> · <latency>ms · 巡检于 <YYYY-MM-DD>`；
 * 延迟无值时不写延迟段；无状态码时写 `待核验 · 巡检于 <YYYY-MM-DD>`；
 * anomaly 态（主分支无状态码 / 兜底自相矛盾快照）一律写待核验、不写延迟段——
 * 徽章本体不画毫秒数时悬停也不展示延迟，口径一致（W11 返工）；
 * 未巡检返回 null（无徽标、无 title）。
 */
export function siteHealthTitle(health: SiteHealthInput | null | undefined): string | null {
  if (!health || !health.lastCheckedAt) return null
  const d = new Date(health.lastCheckedAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  // anomaly 态一律不写延迟段：主分支（无状态码）与兜底分支（ok 缺失但给了 200）
  // 的徽章都不带毫秒数，title 若仍写 "HTTP 200 · 87ms" 即自相矛盾。
  if (siteHealthState(health)?.state === 'anomaly') return `待核验 · 巡检于 ${day}`
  if (health.httpStatus == null) return `待核验 · 巡检于 ${day}`
  const latency = health.latencyMs != null ? ` · ${health.latencyMs}ms` : ''
  return `HTTP ${health.httpStatus}${latency} · 巡检于 ${day}`
}
