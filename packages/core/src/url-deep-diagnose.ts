/**
 * 单站点深度取证（Deep Diagnose）：把「一个 URL 为什么不可用」拆成可核对的证据链。
 *
 * 为什么单独成模块（而不是塞进路由）：
 *   路由里只能拿到 `{ ok, status }` 这一层结论，于是历史上所有失败都被写成
 *   「404 / 网络连接失败」—— 一个因超时（站点只是慢）的目标和一个 DNS 彻底失败的域名，
 *   拿到了完全相同的诊断。本模块把**判定**与**采集**分离：采集（HTTP/DNS/TLS）在 API 层，
 *   判定是这里的纯函数。好处是判定逻辑可在无网络环境下逐条锁死，
 *   而且「没采集到的层」必须显式标注 `skip`，不允许用 `pass` 蒙混。
 *
 * 与既有能力的关系：
 *   - 内容层事实（信息熵 / 停放词 / 软 404）复用 `auditPageHealth`，不重复实现算法；
 *   - 失败原因归类沿用 `ProbeFailureKind` 的口径（timeout / redirect-limit / ssrf-blocked /
 *     connect / http-error / other），保证深度报告与列表徽标说的是同一件事。
 */
import { auditPageHealth } from "./health-sentinel.ts";

/** 深度取证的可能结论。顺序即优先级（靠前者覆盖靠后者） */
export type DeepVerdict =
  | "unreachable" // 连不上：DNS 失败 / 连接拒绝 / SSRF 拦截
  | "expired-domain" // 域名疑似过期（DNS 无解析或跳转到域名交易页）
  | "server-error" // 5xx
  | "bot-blocked" // 存活但拒绝爬虫（401/403/405/412/418/429）
  | "redirect-hijack" // 跨站劫持式跳转
  | "parked" // 域名停放 / 广告占位
  | "soft-404" // HTTP 200 但内容是「找不到页面」
  | "http-error" // 其它 4xx
  | "healthy";

/** 证据分层：URL 结构 → DNS → 重定向 → HTTP → 内容 → 历史归档 */
export type DeepLayer = "url" | "dns" | "redirect" | "http" | "content" | "wayback";

export type DeepLayerStatus = "pass" | "warn" | "fail" | "skip";

export interface DeepEvidence {
  layer: DeepLayer;
  status: DeepLayerStatus;
  /** 面向人的一句事实陈述（写「观察到了什么」，不写推断） */
  detail: string;
}

export interface DeepAction {
  id: string;
  label: string;
  kind: "replace" | "remove" | "archive" | "manual";
}

/** 采集层喂给判定层的观测（全部可选：没采到的层会在证据里显示 skip） */
export interface DeepProbeObservations {
  url: string;
  finalUrl?: string;
  status?: number;
  contentType?: string | null;
  /** 逐跳重定向链（不含起始 URL） */
  redirects?: string[];
  /** 响应体样本（截断后的前若干 KB） */
  bodySample?: string;
  /** 连接层错误信息（原始） */
  error?: string;
  /** 失败原因归类，与 plugin-audit 的 ProbeFailureKind 同口径 */
  failureKind?: "timeout" | "redirect-limit" | "ssrf-blocked" | "connect" | "http-error" | "other" | string;
  latencyMs?: number;
  /** DNS 是否解析成功（未采集则不传） */
  dnsOk?: boolean;
  /** Wayback 最近一次快照年份（未查询则不传） */
  waybackLatestYear?: number;
}

export interface DeepDiagnosis {
  url: string;
  verdict: DeepVerdict;
  /** 0..1：对该结论的置信度（不是「站点质量分」） */
  confidence: number;
  headline: string;
  evidence: DeepEvidence[];
  actions: DeepAction[];
  /** 内容层事实（仅当采集到 body 时存在） */
  contentFacts?: {
    title?: string;
    shannonEntropy: number;
    textLength: number;
    matchedParkingKeywords: string[];
    pageHealth: "HEALTHY" | "SUSPICIOUS_PARKED" | "SOFT_404" | "THIN_CONTENT";
  };
}

/** 「存活但拒绝爬虫」的状态码（与 plugin-audit.ts 的 BLOCKED_BY_BOT_STATUSES 保持一致） */
const BOT_BLOCKED_STATUSES = new Set([401, 403, 405, 412, 418, 429]);

/**
 * 已知的域名停放 / 域名交易服务。
 *
 * 为什么单列：这类跳转的终点往往是 HTTP 200 + 一页「此域名可出售」，
 * 只看状态码会判活；而它其实是**死链的另一种形态**。
 */
const PARKING_HOSTS = [
  "sedoparking.com",
  "parkingcrew.net",
  "bodis.com",
  "dan.com",
  "afternic.com",
  "hugedomains.com",
  "undeveloped.com",
  "domainmarket.com",
  "buydomains.com",
  "parklogic.com",
  "above.com",
];

/** 从域名里取可注册主域（粗略版：默认保留最后两段，处理 com.cn 一类二级后缀） */
export function registrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/\.$/, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const secondLast = parts[parts.length - 2] ?? "";
  const last = parts[parts.length - 1] ?? "";
  // 形如 example.com.cn / example.gov.uk：末段是国家代码、倒数第二段是通用二级类目，
  // 此时最后两段只是公共后缀，主域要再往前取一段。
  const twoLevelPrefixes = new Set(["com", "net", "org", "gov", "edu", "co", "or", "ac", "ne"]);
  if (last.length <= 3 && twoLevelPrefixes.has(secondLast)) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function safeHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isParkingHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return PARKING_HOSTS.some((p) => h === p || h.endsWith("." + p))
}

/** 单个证据 → 置信度增量（只在结论方向一致时累加） */
function evidenceWeight(status: DeepLayerStatus, strong: number, weak: number): number {
  if (status === "fail") return strong;
  if (status === "warn") return weak;
  return 0;
}

function clampConfidence(n: number): number {
  return Math.round(Math.min(0.98, Math.max(0.3, n)) * 100) / 100;
}

function pushEvidence(
  evidence: DeepEvidence[],
  layer: DeepLayer,
  status: DeepLayerStatus,
  detail: string,
): void {
  evidence.push({ layer, status, detail });
}

/**
 * 分层判定。
 *
 * 关键设计：**先判「连不上」再判「连上了但内容不对」**。
 * 反过来会把 DNS 失败的站点误判成 parked（因为没内容），结论比现象更离谱。
 */
export function diagnoseUrlDeep(obs: DeepProbeObservations): DeepDiagnosis {
  const evidence: DeepEvidence[] = []
  const actions: DeepAction[] = []
  const rawUrl = (obs.url || "").trim()

  // ── 1. URL 结构层 ─────────────────────────────────────────────
  let parsed: URL | null = null
  try {
    parsed = new URL(rawUrl)
  } catch {
    pushEvidence(evidence, "url", "fail", "URL 不是合法的绝对地址，无法解析协议与主机")
    return finish(rawUrl, "unreachable", 0.9, "网址格式非法，无法发起任何探测", evidence, [
      { id: "fix-url", label: "修正为完整 URL（含协议）", kind: "manual" },
    ])
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    pushEvidence(evidence, "url", "fail", `协议 ${parsed.protocol} 不是 http/https`)
    return finish(rawUrl, "unreachable", 0.88, "不支持的协议，浏览器无法直接打开", evidence, [
      { id: "fix-url", label: "改为 http/https 地址", kind: "manual" },
    ])
  }

  const host = parsed.hostname.toLowerCase()
  const urlWarnings: string[] = []
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) urlWarnings.push("主机是 IP 直连（无域名，易变更且无法用证书校验身份）")
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") urlWarnings.push(`使用了非标准端口 ${parsed.port}`)
  if (host.startsWith("xn--") || /[^\u0000-\u007f]/.test(host)) urlWarnings.push("主机名含国际化域名编码（需留意同形字钓鱼）")
  if (urlWarnings.length > 0) pushEvidence(evidence, "url", "warn", urlWarnings.join("；"))
  else pushEvidence(evidence, "url", "pass", `结构正常：${parsed.protocol}//${host}`)

  // ── 2. DNS 层 ─────────────────────────────────────────────────
  const errText = (obs.error || "").toLowerCase()
  const dnsFailedByError =
    errText.includes("dns-failure") ||
    errText.includes("enotfound") ||
    errText.includes("getaddrinfo") ||
    errText.includes("dns-empty")
  if (obs.dnsOk === false || dnsFailedByError) {
    pushEvidence(evidence, "dns", "fail", "域名解析失败（ENOTFOUND / 无 A 记录）")
    return finish(rawUrl, "expired-domain", 0.82, "域名已无法解析，通常意味着过期、注销或停止解析", evidence, [
      { id: "archive", label: "查 Wayback 历史快照做归档", kind: "archive" },
      { id: "replace", label: "替换为同领域可用站点", kind: "replace" },
      { id: "remove", label: "从清单中剔除", kind: "remove" },
    ])
  }
  pushEvidence(
    evidence,
    "dns",
    obs.dnsOk === true ? "pass" : "skip",
    obs.dnsOk === true ? "域名解析正常" : "未独立探测 DNS（由 HTTP 链路间接验证）",
  )

  // ── 3. 重定向层 ───────────────────────────────────────────────
  const chain = Array.isArray(obs.redirects) ? obs.redirects.filter((u) => typeof u === "string" && u) : []
  const finalUrl = obs.finalUrl || chain[chain.length - 1] || rawUrl
  const finalHost = safeHost(finalUrl)
  let redirectedToParking = false
  let crossSiteJump = false
  if (chain.length === 0) {
    pushEvidence(evidence, "redirect", "pass", "无重定向，直达目标地址")
  } else {
    const details: string[] = [`共 ${chain.length} 跳`]
    if (finalHost && isParkingHost(finalHost)) {
      redirectedToParking = true
      details.push(`落点 ${finalHost} 属域名停放/交易服务`)
    } else if (finalHost) {
      const fromDomain = registrableDomain(host)
      const toDomain = registrableDomain(finalHost)
      if (fromDomain !== toDomain) {
        crossSiteJump = true
        details.push(`跨主域跳转：${fromDomain} → ${toDomain}`)
      }
    }
    if (chain.length >= 5) details.push("跳数偏多（可能被多层调度/风控接管）")
    // https 降级到 http
    try {
      if (parsed.protocol === "https:" && new URL(finalUrl).protocol === "http:") {
        details.push("最终落点从 HTTPS 降级为 HTTP")
      }
    } catch {
      /* finalUrl 不合法时忽略该子判断 */
    }
    const status: DeepLayerStatus = redirectedToParking ? "fail" : crossSiteJump || chain.length >= 5 ? "warn" : "pass"
    pushEvidence(evidence, "redirect", status, details.join("；"))
  }

  // ── 4. HTTP 层 ────────────────────────────────────────────────
  const status = typeof obs.status === "number" ? obs.status : undefined
  if (status === undefined) {
    const kind = obs.failureKind || ""
    if (kind === "ssrf-blocked" || errText.includes("ssrf") || errText.includes("受保护")) {
      pushEvidence(evidence, "http", "fail", "目标落在私网/内网地址，被 SSRF 守卫拒绝")
      return finish(rawUrl, "unreachable", 0.9, "目标地址被安全策略拒绝，无法探活", evidence, [
        { id: "manual", label: "确认是否为内网站点，人工核实地址", kind: "manual" },
      ])
    }
    if (kind === "redirect-limit" || errText.includes("重定向")) {
      pushEvidence(evidence, "http", "fail", "重定向次数超过探针上限，未能拿到最终响应")
      return finish(rawUrl, "redirect-hijack", 0.55, "重定向链路异常（可能是调度墙或循环跳转），需人工确认", evidence, [
        { id: "manual", label: "在浏览器中复现跳转链路", kind: "manual" },
        { id: "archive", label: "查 Wayback 历史快照", kind: "archive" },
      ])
    }
    if (kind === "timeout" || errText.includes("timeout") || errText.includes("etimedout")) {
      pushEvidence(evidence, "http", "fail", "连接超时，未获得任何 HTTP 响应")
      // 超时的置信度刻意压低：慢不等于死，地域/链路抖动都会超时
      return finish(rawUrl, "unreachable", 0.5, "连接超时（可能是网络限制或站点过慢，不等于死链）", evidence, [
        { id: "retry", label: "稍后复检（换时段/换网络）", kind: "manual" },
        { id: "archive", label: "查 Wayback 历史快照", kind: "archive" },
      ])
    }
    pushEvidence(evidence, "http", "fail", `连接失败：${obs.error ? obs.error.slice(0, 120) : "无响应"}`)
    return finish(rawUrl, "unreachable", 0.6, "无法建立连接（DNS 之后的握手阶段失败）", evidence, [
      { id: "retry", label: "稍后复检", kind: "manual" },
      { id: "replace", label: "替换为同领域可用站点", kind: "replace" },
    ])
  }

  if (status >= 500) {
    pushEvidence(evidence, "http", "fail", `服务端返回 HTTP ${status}`)
    return finish(rawUrl, "server-error", 0.72, `站点服务端异常（HTTP ${status}），可能维护或过载`, evidence, [
      { id: "retry", label: "观察是否自动恢复", kind: "manual" },
      { id: "archive", label: "查 Wayback 历史快照", kind: "archive" },
    ])
  }

  if (BOT_BLOCKED_STATUSES.has(status)) {
    pushEvidence(evidence, "http", "warn", `HTTP ${status}：站点存活但拒绝爬虫 UA`)
    return finish(rawUrl, "bot-blocked", 0.6, "站点可用，仅拒绝了自动化访问（不应视为死链）", evidence, [])
  }

  if (status >= 400) {
    const gone = status === 410
    pushEvidence(evidence, "http", "fail", `HTTP ${status}${gone ? "（已永久移除）" : ""}`)
    return finish(
      rawUrl,
      "http-error",
      gone ? 0.85 : 0.78,
      gone ? "站点明确声明资源已永久移除（410）" : `请求被拒绝或资源不存在（HTTP ${status}）`,
      evidence,
      [
        { id: "archive", label: "查 Wayback 历史快照", kind: "archive" },
        { id: "replace", label: "替换为同领域可用站点", kind: "replace" },
        { id: "remove", label: "从清单中剔除", kind: "remove" },
      ],
    )
  }

  pushEvidence(evidence, "http", "pass", `HTTP ${status}${obs.latencyMs ? `，耗时 ${obs.latencyMs}ms` : ""}`)

  // ── 5. 内容层 ─────────────────────────────────────────────────
  let contentFacts: DeepDiagnosis["contentFacts"]
  let contentStatus: DeepLayerStatus = "skip"
  let contentVerdict: DeepVerdict | null = null
  const body = obs.bodySample
  if (typeof body === "string" && body.length > 0) {
    const health = auditPageHealth(rawUrl, body)
    contentFacts = {
      shannonEntropy: health.shannonEntropy,
      textLength: health.textLength,
      matchedParkingKeywords: health.matchedParkingKeywords,
      pageHealth: health.status,
    }
    if (health.status === "SUSPICIOUS_PARKED") {
      contentStatus = "fail"
      contentVerdict = "parked"
      pushEvidence(evidence, "content", "fail", health.reason)
    } else if (health.status === "SOFT_404") {
      contentStatus = "fail"
      contentVerdict = "soft-404"
      pushEvidence(evidence, "content", "fail", health.reason)
    } else if (health.status === "THIN_CONTENT") {
      contentStatus = "warn"
      pushEvidence(evidence, "content", "warn", health.reason)
    } else {
      contentStatus = "pass"
      pushEvidence(
        evidence,
        "content",
        "pass",
        `内容正常：正文 ${health.textLength} 字，信息熵 ${health.shannonEntropy.toFixed(2)}`,
      )
    }
  } else {
    pushEvidence(evidence, "content", "skip", "未采集响应体，跳过内容级防劫持检测")
  }

  // 非 HTML 内容类型单独提示（下载直链 / JSON 接口被当成网页收录是常见数据错误）
  if (obs.contentType && !/html|xml|text\/plain/i.test(obs.contentType)) {
    pushEvidence(evidence, "http", "warn", `Content-Type 为 ${obs.contentType}，可能不是网页`)
  }

  // ── 6. 历史归档层 ─────────────────────────────────────────────
  if (typeof obs.waybackLatestYear === "number" && obs.waybackLatestYear > 0) {
    const age = new Date().getUTCFullYear() - obs.waybackLatestYear
    if (age >= 2) {
      pushEvidence(evidence, "wayback", "warn", `最近一次归档在 ${obs.waybackLatestYear} 年（${age} 年前），长期无人维护`)
    } else {
      pushEvidence(evidence, "wayback", "pass", `最近归档年份 ${obs.waybackLatestYear}`)
    }
  } else {
    pushEvidence(evidence, "wayback", "skip", "未查询 Wayback 归档")
  }

  // ── 7. 结论 ───────────────────────────────────────────────────
  if (contentVerdict === "parked" || redirectedToParking) {
    const confidence =
      0.55 +
      (contentVerdict === "parked" ? 0.35 : 0) +
      (redirectedToParking ? 0.25 : 0) +
      (contentFacts && contentFacts.shannonEntropy < 2 ? 0.1 : 0)
    return finish(rawUrl, "parked", confidence, "域名已被停放或用于广告占位，内容不再可用", evidence, [
      { id: "archive", label: "查 Wayback 历史快照", kind: "archive" },
      { id: "replace", label: "替换为同领域可用站点", kind: "replace" },
      { id: "remove", label: "从清单中剔除", kind: "remove" },
    ], contentFacts)
  }

  if (contentVerdict === "soft-404") {
    return finish(rawUrl, "soft-404", 0.8, "返回 200 但内容是「页面不存在」，属软 404", evidence, [
      { id: "archive", label: "查 Wayback 历史快照", kind: "archive" },
      { id: "replace", label: "替换为同领域可用站点", kind: "replace" },
    ], contentFacts)
  }

  if (crossSiteJump) {
    return finish(rawUrl, "redirect-hijack", 0.6, "跨主域跳转，原地址已不再提供内容", evidence, [
      { id: "manual", label: "确认跳转是否官方（域名迁移）", kind: "manual" },
      { id: "replace", label: "如需保留，改为直连最终落点", kind: "replace" },
    ], contentFacts)
  }

  // 站得住脚的健康：HTTP 2xx/3xx + 内容层未见异常
  const healthyConfidence =
    0.6 +
    (contentStatus === "pass" ? 0.25 : 0) +
    (urlWarnings.length === 0 ? 0.08 : 0) +
    (chain.length === 0 ? 0.05 : 0)
  return finish(
    rawUrl,
    "healthy",
    healthyConfidence,
    contentStatus === "pass" ? "各层检查通过，站点可正常访问" : "HTTP 可达，内容层未做检测（结论有限）",
    evidence,
    [],
    contentFacts,
  )
}

/** 早返回时补齐缺失层用的说明（不伪装成「已检查且正常」） */
const MISSING_LAYER_REASONS: Record<DeepLayer, string> = {
  url: "未检查 URL 结构",
  dns: "未独立探测 DNS",
  redirect: "未建立连接，未观察到重定向",
  http: "未获得 HTTP 响应",
  content: "未采集响应体，跳过内容级检测",
  wayback: "未查询 Wayback 归档",
}

const LAYER_ORDER: DeepLayer[] = ["url", "dns", "redirect", "http", "content", "wayback"]

function finish(
  url: string,
  verdict: DeepVerdict,
  confidence: number,
  headline: string,
  evidence: DeepEvidence[],
  actions: DeepAction[],
  contentFacts?: DeepDiagnosis["contentFacts"],
): DeepDiagnosis {
  /**
   * 补齐缺失层 + 固定层序。
   *
   * 为什么必须补：判定会在「连不上」处早返回，若不补，报告里就只剩 url/dns/http 三层，
   * 调用方无法区分「内容层没问题」与「内容层根本没查」。缺层一律写 skip 并说明原因。
   */
  const present = new Set(evidence.map((e) => e.layer))
  for (const layer of LAYER_ORDER) {
    if (!present.has(layer)) {
      evidence.push({ layer, status: "skip", detail: MISSING_LAYER_REASONS[layer] })
    }
  }
  evidence.sort((a, b) => LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer))

  return {
    url,
    verdict,
    confidence: clampConfidence(confidence),
    headline,
    evidence,
    actions,
    ...(contentFacts ? { contentFacts } : {}),
  }
}

/** 体检历史里的一个点（只有真实测量值，stale 快照不参与趋势） */
export interface ReachabilityPoint {
  at: number
  reachability: number | null
}

export interface ReachabilityTrend {
  trend: "improving" | "degrading" | "stable" | "insufficient"
  /** 每次体检的可达率变化（最小二乘斜率） */
  slope: number
  /** 首个有效点到最后一个有效点的绝对变化 */
  delta: number
  points: number
}

/**
 * 趋势判定：用最小二乘斜率而非首尾差。
 *
 * 为什么不能用首尾差：体检本身有随机性（抽样不同、目标站偶发超时），
 * 首尾两点一抖动就会把「稳定」判成「恶化」。斜率对中间点也敏感，单点噪声不足以翻转结论。
 * 阈值 0.005/次 的意思是「连续 20 次体检才变化 10 个百分点」，低于此视为稳定。
 */
export function computeReachabilityTrend(points: readonly ReachabilityPoint[]): ReachabilityTrend {
  const valid = points.filter(
    (p): p is { at: number; reachability: number } =>
      typeof p.reachability === "number" && Number.isFinite(p.reachability),
  )
  if (valid.length < 2) {
    return { trend: "insufficient", slope: 0, delta: 0, points: valid.length }
  }
  const n = valid.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (let i = 0; i < n; i++) {
    const y = valid[i]!.reachability
    sumX += i
    sumY += y
    sumXY += i * y
    sumXX += i * i
  }
  const denom = n * sumXX - sumX * sumX
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
  const delta = valid[n - 1]!.reachability - valid[0]!.reachability
  const trend: ReachabilityTrend["trend"] =
    Math.abs(slope) < 0.005 ? "stable" : slope > 0 ? "improving" : "degrading"
  return {
    trend,
    slope: Math.round(slope * 10000) / 10000,
    delta: Math.round(delta * 1000) / 1000,
    points: n,
  }
}
