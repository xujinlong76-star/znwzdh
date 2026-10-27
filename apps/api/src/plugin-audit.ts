/**
 * 插件 URL 体检的核心逻辑（纯函数 + 注入式探活）。
 *
 * 背景与边界（2026-10-20 P0-1）：
 *   1. **已安装**插件的站点本来就被既有链路覆盖：`jobs.ts` 的 `health_check`（24h、并发 2、
 *      Weibull 抽样）用 `packages/ai/src/ssrf.ts` 的 `guardedFetch` 探活，并 `updateSiteHealth`
 *      写回 `sites` 健康字段 + `health_checks` 历史。这条不需要重造。
 *   2. 真正缺的是：**未安装插件包**里声明的 URL 从未被验活，以及**按插件维度**的可达率报告。
 *      本文件负责后者的核心算法：抽样、并发探活编排、汇总。
 *
 * 为什么把探活函数做成参数注入：这里不 import 任何网络实现，测试可注入假探活器，
 * 在无网络环境下把并发上限、超时兜底、分类口径全部锁住（仓库纪律：纯逻辑可测）。
 *
 * 唯一的外部依赖是 `@navhub/core` 的 `probe-policy`（纯函数、不触网）：
 * 「什么状态码算拒绝爬虫」这类口径必须与候选探活、深检层共用一份，否则必然漂移。
 */
import { isBotBlockedStatus } from "@navhub/core"

/**
 * 失败原因归类：让报告能区分「我们的探针限制」与「站点真挂」。
 *
 * 真实教训（全市场首轮报告）：`maoyan.com` / `5i5j.com` 被记为不可达，原因其实是
 * 「重定向超过 3 次」——探针的跳数上限太紧，浏览器能正常打开；还有一批是 5s 超时，
 * 对国内大站偏短。这两类都属于**我们的限制**，不该与连接失败混为一谈。
 */
export type ProbeFailureKind =
  | 'timeout' // 超时（含探针兜底超时）
  | 'redirect-limit' // 超过重定向跳数上限（多半是探针限制，非站点问题）
  | 'ssrf-blocked' // 被 SSRF 守卫拦下（私网/内网目标）
  | 'connect' // DNS/连接/TLS 层失败
  | 'http-error' // 拿到了非 2xx/3xx 的响应码（4xx-other / 5xx）
  | 'other'

/** 单条 URL 的体检结果（与探活实现解耦的最小字段集） */
export interface UrlProbeResult {
  url: string
  /** 判定为可达（2xx/3xx，且未被 SSRF 守卫拒绝） */
  /** 2xx/3xx：服务端正常响应 */
  ok: boolean
  /**
   * 存活但拒绝爬虫：401/403/405/412/429。
   *
   * 为什么单列一类（2026-10-20 首轮真实体检的发现）：前端包的「不可达」全部是 HTTP 403
   * （webpagetest.org / wails.io），政务包大量是 412 —— 这些站点**在浏览器里完全正常**，
   * 只是 WAF/风控拒绝了我们的爬虫 UA。若把它们算成死链，会把好站点误判、甚至误导数据清理。
   */
  blocked?: boolean
  status?: number
  /** 跟随后重定向落点；与 url 归一后不同即视为发生重定向 */
  finalUrl?: string
  latencyMs?: number
  error?: string
  /** 不可达时的原因归类（见 ProbeFailureKind） */
  failureKind?: ProbeFailureKind
  /** 疑似停放页 / 软 404 / 异常劫持（2xx/3xx 但内容异常） */
  suspicious?: boolean
  suspiciousReason?: string
  extractedTitle?: string
  shannonEntropy?: number
  matchedKeywords?: string[]
}

/** 一个插件包的体检汇总（列表/徽标/报告三处共用同一口径） */
export interface PluginAuditSummary {
  total: number
  /** 正常响应（2xx/3xx 且无停放/软404劫持特征） */
  ok: number
  /** 存活但拒绝爬虫（401/403/405/412/429），**计入可达** */
  blocked: number
  /** 疑似停放页 / 软 404 / 极低信息熵劫持（HTTP 200 但实际不可用） */
  suspicious: number
  /** 真不可达：DNS/连接失败、超时、5xx、其它 4xx */
  broken: number
  redirected: number
  /**
   * 可达率（0..1，保留 3 位小数）= (ok + blocked) / total。
   * 口径说明：blocked 只说明「拒绝爬虫」，站点本身可用，因此计入可达；
   * total 为 0 时返回 null，避免用 0 冒充「全挂」。
   */
  reachability: number | null
  /** 真不可达明细（逐条列出，便于人工复核或替换站点） */
  brokenItems: Array<{ url: string; status?: number; error?: string; failureKind?: ProbeFailureKind }>
  /** 存活但拒绝爬虫的明细（单独列出，便于分辨「站点没问题、是爬虫被挡」） */
  blockedItems: Array<{ url: string; status?: number }>
  /** 疑似域名停放、软 404 或低信息熵空壳页明细 */
  suspiciousItems: Array<{
    url: string
    status?: number
    title?: string
    reason?: string
    shannonEntropy?: number
    matchedKeywords?: string[]
  }>
  /** 不可达原因分布（区分「探针限制」与「站点真挂」的依据） */
  brokenByReason: Record<ProbeFailureKind, number>
}

/**
 * 体检默认参数：单包抽样 30 条、并发 12、单条兜底超时 4s、重定向上限 6 跳。
 *
 * 优化（2026-10-26 治理 504 网关超时）：
 * 单条 4s 超时足以判定站点可达性与首包 HTML 状态；并发从 6 提至 12，
 * 即使整包 30 条全部挂死也能在 3 批内（< 12 秒）迅速收敛，彻底杜绝网关 30 秒超时（504 Gateway Timeout）。
 */
export const PLUGIN_AUDIT_DEFAULTS = {
  sample: 30,
  concurrency: 12,
  timeoutMs: 4_000,
  maxRedirects: 6,
} as const

/**
 * 「存活但拒绝爬虫」的状态码集合 —— **定义已迁到 `@navhub/core` 的 `probe-policy`**。
 *
 * 这里保留同名导出，是为了不打断既有 import（含测试与 MCP 处理器）；
 * 但判定逻辑只有一份，改口径请改 core，不要在这个文件里另起炉灶。
 * 历史教训：本仓曾有三套判定（抽样体检 / 候选探活 / 深检），漂移出
 * 「超时判死」「5xx 判死」两次事故。
 */
export { BOT_BLOCKED_STATUSES as BLOCKED_BY_BOT_STATUSES } from "@navhub/core"

export function isBlockedByBotStatus(status: number | undefined): boolean {
  return status !== undefined && isBotBlockedStatus(status)
}

/** 归一化 URL：协议/主机小写、去尾斜杠、去 hash —— 判「是否重定向」时用 */
export function normalizeAuditUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '')
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}${u.search}`
  } catch {
    return url.trim()
  }
}

/**
 * 均匀抽样：把整包按等距取点，保证样本覆盖包内各个分类，
 * 而不是只验前 N 条（后者会让「后面的分类全挂」这种问题漏检）。
 * 确定性：同一输入多次调用结果一致（报告可复现、可对比）。
 */
export function sampleUrls(urls: readonly string[], limit: number): string[] {
  const total = urls.length
  if (limit <= 0) return []
  if (total === 0) return []
  if (limit >= total) return [...urls]
  const picked: string[] = []
  const seen = new Set<string>()
  const step = total / limit
  for (let i = 0; i < limit; i++) {
    // 取每个等分区间内的固定位置（区间中点偏左，避免总是取到端点导致首尾过采样）
    const index = Math.min(total - 1, Math.floor(i * step + step / 2))
    const url = urls[index]
    if (!url || seen.has(url)) continue
    seen.add(url)
    picked.push(url)
  }
  return picked
}

/** 汇总探活结果（列表徽标 / 详情报告 / 管理端报表共用） */
export function summarizeProbes(probes: readonly UrlProbeResult[]): PluginAuditSummary {
  let ok = 0
  let blocked = 0
  let suspicious = 0
  let broken = 0
  let redirected = 0
  const brokenItems: PluginAuditSummary['brokenItems'] = []
  const blockedItems: PluginAuditSummary['blockedItems'] = []
  const suspiciousItems: PluginAuditSummary['suspiciousItems'] = []
  const brokenByReason: PluginAuditSummary['brokenByReason'] = {
    timeout: 0,
    'redirect-limit': 0,
    'ssrf-blocked': 0,
    connect: 0,
    'http-error': 0,
    other: 0,
  }
  for (const p of probes) {
    // 疑似停放页 / 软 404 / 劫持：不计入真实 ok，单独归入 suspicious
    if (p.suspicious) {
      suspicious++
      suspiciousItems.push({
        url: p.url,
        status: p.status,
        title: p.extractedTitle,
        reason: p.suspiciousReason,
        shannonEntropy: p.shannonEntropy,
        matchedKeywords: p.matchedKeywords,
      })
      if (p.finalUrl && normalizeAuditUrl(p.finalUrl) !== normalizeAuditUrl(p.url)) redirected++
      continue
    }
    if (p.ok) {
      ok++
      if (p.finalUrl && normalizeAuditUrl(p.finalUrl) !== normalizeAuditUrl(p.url)) redirected++
      continue
    }
    // 存活但拒绝爬虫：单列一类，并计入可达 —— 否则会把「WAF 挡我」误判成「站点挂了」
    if (p.blocked ?? isBlockedByBotStatus(p.status)) {
      blocked++
      blockedItems.push({ url: p.url, status: p.status })
      continue
    }
    broken++
    // 原因归类：探针兜底超时（error==='timeout'）优先按 timeout 记；否则用探活器给的 failureKind，
    // 再退化为「有状态码 = http-error / 无状态码 = other」
    const kind: ProbeFailureKind =
      p.error === "timeout" ? "timeout" : (p.failureKind ?? (p.status ? "http-error" : "other"))
    brokenByReason[kind] = (brokenByReason[kind] ?? 0) + 1
    brokenItems.push({ url: p.url, status: p.status, error: p.error, failureKind: kind })
  }
  const total = probes.length
  const reachable = ok + blocked
  return {
    total,
    ok,
    blocked,
    suspicious,
    broken,
    redirected,
    reachability: total === 0 ? null : Math.round((reachable / total) * 1000) / 1000,
    brokenItems,
    blockedItems,
    suspiciousItems,
    brokenByReason,
  }
}

/** 探活器签名：由调用方注入（生产用 guardedFetch 包装，测试注入假实现） */
export type UrlProber = (url: string, timeoutMs: number) => Promise<UrlProbeResult>

/**
 * 并发探活编排：分批并发 + 单条兜底超时。
 *
 * 兜底超时的意义：探活器自己可能不守时（DNS 挂起、连接半开），
 * 这里用 Promise.race 保证单条不会把整批体检拖死；超时按 broken 记录 error='timeout'。
 */
export async function probeUrls(
  urls: readonly string[],
  probe: UrlProber,
  options: { concurrency?: number; timeoutMs?: number } = {},
): Promise<UrlProbeResult[]> {
  const concurrency = Math.max(1, options.concurrency ?? PLUGIN_AUDIT_DEFAULTS.concurrency)
  const timeoutMs = Math.max(1, options.timeoutMs ?? PLUGIN_AUDIT_DEFAULTS.timeoutMs)
  const results: UrlProbeResult[] = []

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    const settled = await Promise.all(
      batch.map(async (url) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          return await Promise.race<UrlProbeResult>([
            probe(url, timeoutMs),
            new Promise<UrlProbeResult>((resolve) => {
              timer = setTimeout(() => resolve({ url, ok: false, error: 'timeout' }), timeoutMs)
            }),
          ])
        } catch (err) {
          return { url, ok: false, error: err instanceof Error ? err.message : String(err) }
        } finally {
          if (timer) clearTimeout(timer)
        }
      }),
    )
    results.push(...settled)
  }
  return results
}

/** 配齐「抽样 → 探活 → 汇总」的一步到位入口（路由与 job 共用） */
export async function auditPluginUrls(
  urls: readonly string[],
  probe: UrlProber,
  options: { sample?: number; concurrency?: number; timeoutMs?: number } = {},
): Promise<{ summary: PluginAuditSummary; sampledUrls: string[]; probes: UrlProbeResult[] }> {
  const sampledUrls = sampleUrls(urls, options.sample ?? PLUGIN_AUDIT_DEFAULTS.sample)
  const probes = await probeUrls(sampledUrls, probe, options)
  // 额外回传逐条探活结果：调用方要用它做指标聚合（原因分布 / 延迟直方图）。
  // 这是纯附加字段，既有解构 `{ summary }` 的调用方不受影响。
  return { summary: summarizeProbes(probes), sampledUrls, probes }
}
