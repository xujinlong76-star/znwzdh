/**
 * 站点健康徽标的展示口径（03-livelink-mapping §3）。
 *
 * 历史问题：只要 health 对象存在就渲染「SLA 正常 / 响应缓慢」，但大量站点
 * 从未被巡检（lastCheckedAt/latencyMs 为空），会被误标成「响应缓慢」；
 * 「SLA」还是内部术语，对访客没有意义。
 *
 * 口径：只有完成过巡检（lastCheckedAt 有值）才展示；文案按可验证的事实
 * 给出——HTTP 状态码优先；没有状态码时只说「近期检测异常」（是本站的检测
 * 失败，不等于目标站对用户不可达），不臆测原因。
 *
 * 分级映射 `siteHealthState()`（§3.1/§3.2）：判定顺序写死，按表自上而下，
 * 第一条命中即返回，不叠加——未巡检 → 已失效（硬条件）→ 疑似反爬 →
 * 疑似停放 / 疑似软 404 / 疑似内容过薄 → 检测异常 → 可访问。
 * 绝不引入分数/百分比字段：不折算 0–100 分，不算健康百分比。
 *
 * 可访问档的延迟分档（2026-11-25 UI 评审 P1-4）：延迟 >3000ms 不再标绿
 * 「可访问」（7035ms 的绿灯是矛盾信号），按三档给词——≤1s 可访问 /
 * 1–3s 响应较慢 / >3s 响应缓慢。**只改展示词与徽标配色，不动 state/tone**：
 * 慢站仍是 accessible、tone 仍为 ok，「只看失效」（isFailingHealthState）的
 * 过滤口径不变，慢 ≠ 失效。延迟数字不再进徽标正文（title 里本来就有完整
 * 「HTTP code · latency · 巡检日期」），避免与状态词抢注意力。
 */
import type { HealthStatus } from './health-sentinel'
import type { SiteNotice } from './site-notices'

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
  | 'maintenance'

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

/**
 * 可访问档的延迟分档阈值（2026-11-25 UI 评审 P1-4）。
 * 边界口径：>3000ms → 响应缓慢；>1000ms → 响应较慢；其余（含无延迟值）→ 可访问。
 * 只影响展示词与徽标配色（healthVisualTone），不影响 state/tone 过滤口径。
 */
const LATENCY_SLOW_MS = 1000
const LATENCY_SLUGGISH_MS = 3000

function accessibleLabel(latencyMs: number | null): string {
  if (latencyMs != null && latencyMs > LATENCY_SLUGGISH_MS) return '响应缓慢'
  if (latencyMs != null && latencyMs > LATENCY_SLOW_MS) return '响应较慢'
  return '可访问'
}

/**
 * 维护中（人工标注，见 site-notices.ts）：有效 notice 独立生效，
 * 不依赖 lastCheckedAt——巡检暂停期间 lastCheckedAt 会变陈旧，
 * 但人工确认的维护事实不应因此消失。tone 为 warn：自动进「只看失效」
 * 侧、复用琥珀点/胶囊；showArchive 只认 dead/suspect-soft404，
 * 维护档不挂「看存档」链接。
 */
export function siteHealthState(
  health: SiteHealthInput | null | undefined,
  notice?: SiteNotice,
): SiteHealthState | null {
  if (notice) {
    return { state: 'maintenance', tone: 'warn', label: '维护中', latencyMs: health?.latencyMs ?? null }
  }
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
  // 不等于目标站对用户不可达）。
  if (health.ok === false && health.httpStatus == null) {
    return { state: 'anomaly', tone: 'warn', label: '近期检测异常', latencyMs }
  }

  // 可访问：最近一次巡检确认目标站正常响应，且内容审计未检出劫持特征。
  // 走到这里时 auditStatus 只可能是空或 HEALTHY（SOFT_404 等已在上面返回）；
  // HEALTHY 与 ok === false 同时出现时以连通性为准，上面分支已处理，
  // 所以这里只认 ok === true——没有肯定事实就不报可访问。
  if (health.ok === true) {
    return { state: 'accessible', tone: 'ok', label: accessibleLabel(latencyMs), latencyMs }
  }

  // 兜底：ok 既非 true 又非上述失败形态（如 ok 缺失但给了 200）——
  // 事实自相矛盾时不报可访问，只报检测异常。
  return { state: 'anomaly', tone: 'warn', label: '近期检测异常', latencyMs }
}

/**
 * `siteHealthBadge()` 保持不动的兼容薄壳：内部改调 `siteHealthState()`，
 * 再取 tone/label/latencyMs。现有调用方（详情页、速览弹窗）不受影响。
 */
export function siteHealthBadge(
  health: SiteHealthInput | null | undefined,
  notice?: SiteNotice,
): SiteHealthBadge | null {
  const state = siteHealthState(health, notice)
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
 * 延迟无值时不写延迟段；无状态码时写 `近期检测异常 · 巡检于 <YYYY-MM-DD>`；
 * 未巡检返回 null（无徽标、无 title）。
 *
 * 维护档：第二参数传已算出的 state（调用方手头已有，无需再传 notice，
 * CardHealthBadge 因此零改动）；维护时返回 `维护中 · 巡检于 <YYYY-MM-DD>`，
 * health 为空（未巡检）时只返回 `维护中`。
 */
export function siteHealthTitle(
  health: SiteHealthInput | null | undefined,
  state?: SiteHealthState | null,
): string | null {
  if (state?.state === 'maintenance') {
    if (!health || !health.lastCheckedAt) return '维护中'
    const d = new Date(health.lastCheckedAt)
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `维护中 · 巡检于 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  if (!health || !health.lastCheckedAt) return null
  const d = new Date(health.lastCheckedAt)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (health.httpStatus == null) return `近期检测异常 · 巡检于 ${day}`
  const latency = health.latencyMs != null ? ` · ${health.latencyMs}ms` : ''
  return `HTTP ${health.httpStatus}${latency} · 巡检于 ${day}`
}

/**
 * 徽标/胶囊的视觉档（2026-11-25 UI 评审 P1-4）：与语义 tone 分离。
 * tone 管过滤口径（慢站仍是 ok、进不了「只看失效」），visualTone 管配色——
 * 响应较慢/缓慢要用琥珀警示档，不能跟着 tone 亮绿灯。
 */
export type HealthVisualTone = 'ok' | 'warn' | 'error'

export function healthVisualTone(state: SiteHealthState | null | undefined): HealthVisualTone {
  if (!state) return 'ok'
  if (state.tone !== 'ok') return state.tone
  if (state.latencyMs != null && state.latencyMs > LATENCY_SLOW_MS) return 'warn'
  return 'ok'
}

/**
 * 状态点配色（Token 化，替代原 bg-emerald-500 / bg-amber-500 / bg-rose-500 三连）：
 * ok → bg-success，warn → bg-pinned，error → bg-destructive。
 * 静态巡检快照不再用 animate-pulse——脉动暗示“实时监控”，而数据是随分片下发的
 * 快照（reduced-motion 下动画本来也会被压掉），去掉是诚实且更安静。
 */
export function healthDotClass(state: SiteHealthState | null | undefined): string {
  const tone = healthVisualTone(state)
  if (tone === 'error') return 'bg-destructive'
  if (tone === 'warn') return 'bg-pinned'
  return 'bg-success'
}

/**
 * 状态胶囊底色/文字/边框（详情页等带底色的展示位）。文字档全部走已实测对比度的
 * Token（success-foreground 5.48/10.35、pinned-foreground 5.02/11.92、
 * destructive-text 6.41/7.07），不再用 emerald-700 之类的 raw palette 类。
 * 错误档底色走 /15（不是 /10）：a11y-token-contrast 的危险文字配方要求
 * text-destructive-text + bg-destructive/15，/10 实测对比度不足。
 */
export function healthPillClass(state: SiteHealthState | null | undefined): string {
  const tone = healthVisualTone(state)
  if (tone === 'error') return 'bg-destructive/15 text-destructive-text border-destructive/30'
  if (tone === 'warn') return 'bg-pinned/10 text-pinned-foreground border-pinned/30'
  return 'bg-success/10 text-success-foreground border-success/30'
}
