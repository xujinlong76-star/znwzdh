/**
 * 候选平替的探活、档位与可信度合成 —— 全仓唯一实现。
 *
 * 为什么单独成模块：这套判据原本长在 `routes/plugin-audit.ts` 里，于是只有插件体检能享受
 * 「先实测再推荐」。普通站点的 AI 平替推荐（`/api/sites/:id/recommend-alternative`）
 * 把模型给的 URL 原样返回，一个请求都不发 —— 模型推荐了停放页、拼错的域名、已经下线的官网，
 * 界面照样写「智能平替」，运营照样能一键把它写进 `sites` 并置为 active。
 * 插件那条链路早就吃过这个亏（原注释写着「模型推荐的 200 也可能是停放页」），
 * 修法却留在了自己文件里。抽出来不是为了让目录好看，是为了让第二个消费方存在。
 *
 * 口径仍全部来自 `@navhub/core` 的 `probe-policy`（唯一事实源）：本模块只做
 * 「读结论 → 翻成候选档位 → 合成可信度」，不自己解释状态码。
 * 超时 / 体积 / 跳数 / UA 统一取 `@navhub/ai` 的 candidate profile。
 */
import { guardedFetch, outboundProfile, withTimeout, type GuardedFetchResult } from "@navhub/ai";
import {
  auditPageHealth,
  classifyProbeError as classifyErrorOutcome,
  classifyProbeStatus as classifyStatusOutcome,
  conditionalHeaders,
  isTextualContentType,
  outcomeToCandidateGrade,
  type CandidateGrade,
  type ProbeOutcome,
  type ProbeOutcomeKind,
} from "@navhub/core";
import { getProbeCache, scheduleProbeCacheFlush } from "./probe-cache.ts";

/**
 * 候选档位的四档 + 一档「未能验证」。
 *
 * `unverified` 是刻意存在的：超时、连接被重置这类失败只说明「这次没测到」，
 * 不等于站点已死。历史实现把它们和 404 一起写成 `dead`（界面「不可达」），
 * 违反本项目既有口径「慢 ≠ 死、超时属于不可判定」，也让运营误以为该站点已确认下线。
 *
 * 类型与判定都来自 `@navhub/core` 的 `probe-policy`：以前判档在 `routes/plugin-audit.ts`
 * 里自有一套实现，与深检层各自演化，才出现了「5xx 判死」这类漂移。
 */
export interface CandidateProbe {
  grade: CandidateGrade
  /** 仅 verified 为 true：blocked 无法验证内容，suspicious/dead 明确不可用 */
  ok: boolean
  status?: number
  latencyMs?: number
  reason?: string
}

/** 候选探活的超时上限：候选只需证明「能打开且内容正常」，2.5 秒足够，不必等满正式体检的时长 */
const CANDIDATE_PROFILE = outboundProfile("candidate")
const CANDIDATE_PROBE_TIMEOUT_MS = CANDIDATE_PROFILE.timeoutMs

/**
 * 一批候选的探活总预算。
 *
 * 单条已有 2.5 秒硬超时，但 `guardedFetch` 的超时是**逐跳**的：重定向最多 3 跳，
 * 每跳前还要各做一次 DNS 解析，最坏一条就能吃掉十几秒。三条并发时接口响应时间
 * 完全不可预期，而这条路由前面还挂着大模型调用（前端代理对 `/api/hub/*` 的默认耐心是 30 秒）。
 * 所以这里给整批一个绝对截止点，预算用尽的候选按「没测准」如实标注 ——
 * 不给假档位，也不让接口挂着。
 */
const CANDIDATE_PROBE_BUDGET_MS = 6_000

/**
 * 探活异常 → 候选档位（薄包装）。
 *
 * 判定逻辑已收拢到 `@navhub/core` 的 `probe-policy.ts`（唯一事实源）；
 * 这里只负责把结论翻译成候选档位，保证与深检层、抽样体检说的是同一件事。
 * 保留函数签名是因为它是纯函数契约测试的入口。
 */
export function classifyProbeFailure(
  url: string,
  err: unknown,
  elapsedMs: number,
  timeoutMs: number,
): { grade: CandidateGrade; reason: string } {
  const outcome = classifyErrorOutcome(err, { elapsedMs, timeoutMs, url })
  return { grade: outcomeToCandidateGrade(outcome.kind), reason: outcome.reason }
}

/**
 * HTTP 状态码 → 候选档位（薄包装，判定在 core 的 `classifyProbeStatus`）。
 *
 * 口径表见 `packages/core/src/probe-policy.ts`：404/410/451 才算 dead，
 * 5xx/408 与其余 4xx 都是 unverified（「这一课没测准 / 此刻不可用」≠「站点已死」）。
 * 1xx–3xx 返回 null，交回调用方继续做内容判定。
 */
export function classifyProbeStatus(status: number): { grade: CandidateGrade; reason: string } | null {
  const outcome = classifyStatusOutcome(status)
  if (!outcome) return null
  return { grade: outcomeToCandidateGrade(outcome.kind), reason: outcome.reason }
}

/**
 * 候选探活结果 → 统一结论。内容层（停放 / 软 404 / 正文过少）也翻译成 ProbeOutcome，
 * 这样「缓存里存什么」与「面板显示什么档位」来自同一个值，不会各说各话。
 */
function candidateOutcomeOf(res: GuardedFetchResult, url: string): ProbeOutcome {
  const statusOutcome = classifyStatusOutcome(res.status)
  if (statusOutcome) return statusOutcome
  // 非文本响应（PDF/图片/压缩包）不做正文判定：二进制乱码的低熵会被读成停放页
  if (res.body && isTextualContentType(res.contentType)) {
    const health = auditPageHealth(url, res.body, undefined, undefined, { truncated: res.truncated })
    // 停放词与软 404 的命中本身就是证据，截断不会凭空造出这些词，所以照常判。
    if (health.status === "SUSPICIOUS_PARKED" || health.status === "SOFT_404") {
      return { kind: "parked", status: res.status, reason: health.reason }
    }
    /**
     * THIN_CONTENT 只在「整页都读到了」时才算证据。
     *
     * 现代站点前 8KB 常被 inline CSS / modulepreload 占满——实测 nextjs.org 的
     * 前 8192 字符里正文只有 134 个，gov.cn 有 5048 个，同一阈值下命运完全不同。
     * 响应被截断时判「正文太少」，等于拿缺失证据当结论：正常站被判成空壳候选，
     * 然后被静默排除。这里宁可不下结论，只把「内容未判」如实带出去。
     */
    if (health.status === "THIN_CONTENT" && !res.truncated) {
      return { kind: "parked", status: res.status, reason: health.reason }
    }
    if (health.status === "THIN_CONTENT") {
      return { kind: "ok", status: res.status, reason: "响应被截断，内容级判定已跳过（无法确认正文量）" }
    }
  }
  return { kind: "ok", status: res.status, reason: "内容检测通过" }
}

/** 结论 → 候选探活返回体（唯一出口，保证 ok/latency/reason 三者的口径一致） */
function candidateProbeOf(
  kind: ProbeOutcomeKind,
  status: number | undefined,
  latencyMs: number,
  reason: string,
): CandidateProbe {
  return {
    grade: outcomeToCandidateGrade(kind),
    ok: kind === "ok",
    ...(status !== undefined ? { status } : {}),
    latencyMs,
    reason,
  }
}

/**
 * 候选探活（带缓存与条件请求）。
 *
 * 三层加速，逐层降级：
 *   1. 缓存新鲜（未过 TTL）→ 一个网络请求都不发，直接复用上次判定；
 *   2. 缓存过期但有 ETag/Last-Modified → 带条件头发请求，对端回 304 就只续期；
 *   3. 否则完整 GET（仍然走 guardedFetch 的逐跳 SSRF + 超时 + 8KB 上限）。
 * 失败结论同样入缓存，但 unverified/server-error 的 TTL 只有 1 小时，
 * 不会把一次网络抖动固化成长期事实。
 */
export async function probeCandidateUrl(url: string): Promise<CandidateProbe> {
  const started = Date.now()
  const cache = await getProbeCache()
  const cached = cache.lookup(url)

  if (cached?.fresh) {
    const ageMinutes = Math.max(0, Math.round((Date.now() - cached.entry.checkedAt) / 60_000))
    return candidateProbeOf(
      cached.entry.kind,
      cached.entry.status,
      0,
      `缓存命中（${ageMinutes} 分钟前实测）：${cached.entry.reason}`,
    )
  }

  try {
    const res = await guardedFetch(
      url,
      {
        // 超时/体积/跳数/UA 统一从 profile 取：2KB 不足以做信息熵判断
        //（停放页的「域名出售」区块常在页面尾部），candidate profile 定在 8KB
        timeoutMs: CANDIDATE_PROFILE.timeoutMs,
        maxBytes: CANDIDATE_PROFILE.maxBytes,
        maxRedirects: CANDIDATE_PROFILE.maxRedirects,
        userAgent: CANDIDATE_PROFILE.userAgent,
      },
      { headers: conditionalHeaders(cached?.entry) },
    )
    const elapsed = Date.now() - started

    // 304：对端确认「没变」。沿用上次结论并续期，比重新抓一遍更可信。
    if (res.status === 304 && cached) {
      cache.markRevalidated(url)
      scheduleProbeCacheFlush(cache)
      return candidateProbeOf(cached.entry.kind, cached.entry.status, elapsed, `未变更（304）：${cached.entry.reason}`)
    }

    const outcome = candidateOutcomeOf(res, url)
    cache.record(url, outcome, { etag: res.etag ?? null, lastModified: res.lastModified ?? null })
    scheduleProbeCacheFlush(cache)
    return candidateProbeOf(outcome.kind, outcome.status, elapsed, outcome.reason)
  } catch (err) {
    const elapsed = Date.now() - started
    const outcome = classifyErrorOutcome(err, {
      elapsedMs: elapsed,
      timeoutMs: CANDIDATE_PROBE_TIMEOUT_MS,
      url,
    })
    cache.record(url, outcome)
    scheduleProbeCacheFlush(cache)
    return candidateProbeOf(outcome.kind, outcome.status, elapsed, outcome.reason)
  }
}

/** 候选可信度分解：把「凭空的 qualityScore」换成可追溯的三项加权 */
export interface CandidateConfidence {
  total: number
  reachability: number
  contentHealth: number
  domainFit: number
}

const GRADE_REACHABILITY: Record<CandidateGrade, number> = {
  verified: 100,
  blocked: 60, // 站点活着，但被 WAF 挡住，无法验证内容
  unverified: 0, // 没测到就不声称可达
  suspicious: 0,
  dead: 0,
}

/** 排序权重：先按档位（verified > blocked > unverified > suspicious > dead），档内再比可信度 */
const GRADE_RANK: Record<CandidateGrade, number> = {
  verified: 4,
  blocked: 3,
  unverified: 2,
  suspicious: 1,
  dead: 0,
}

export interface StructuredReplacementCandidate {
  title: string
  url: string
  reason: string
  tag?: string
  qualityScore?: number
  verified?: boolean
  latencyMs?: number
  source?: "ai" | "catalog" | "search"
  /** 探活四档结论（未探活时缺省） */
  grade?: CandidateGrade
  /** 未通过时的原因（停放/软404/HTTP 状态/超时） */
  gradeReason?: string
  /** 可信度分解，替代无法追溯的单一 qualityScore */
  confidence?: CandidateConfidence
  /** 领域匹配分：词典 100 / 同类目 85 / 语义 70 / 兜底 50 / 大模型 75 */
  domainFit?: number
}

/**
 * 领域匹配分的缺省：调用点没写明来源时，模型自述按 75、站内/检索来源按 70。
 * 收成一个函数是因为两个调用方此前各写了一遍同样的三元表达式。
 */
function domainFitOf(candidate: StructuredReplacementCandidate): number {
  return candidate.domainFit ?? (candidate.source === "ai" ? 75 : 70)
}

export function rankCandidate(c: StructuredReplacementCandidate): number {
  return (GRADE_RANK[c.grade ?? "dead"] ?? 0) * 1000 + (c.confidence?.total ?? 0)
}

/**
 * 合成可信度：可达性 0.5 / 内容健康 0.3 / 领域匹配 0.2。
 * 权重这样分配的理由：可达是底线（不可达就没有讨论价值），内容健康决定它是不是「真网页」，
 * 领域匹配只在两者都过线时才有意义，所以权重最低。
 */
function buildCandidateConfidence(
  grade: CandidateGrade,
  domainFit: number,
  baseQuality?: number,
): CandidateConfidence {
  const reachability = GRADE_REACHABILITY[grade]
  const contentHealth = grade === "verified" ? 100 : grade === "blocked" ? 50 : 0
  const total = Math.round(reachability * 0.5 + contentHealth * 0.3 + domainFit * 0.2)
  // baseQuality 只做小幅修正（±3），避免「词典里写了 99 分」压过实测结论
  const adjusted = baseQuality === undefined ? total : Math.min(100, Math.max(0, total + Math.round((baseQuality - 92) * 0.15)))
  return { total: adjusted, reachability, contentHealth, domainFit }
}

/** 用真实探活结论给候选定档，并合成可信度（探活是唯一事实来源，模型自评分只做微调） */
export function applyProbeResult(
  candidate: StructuredReplacementCandidate,
  probe: CandidateProbe,
): StructuredReplacementCandidate {
  const confidence = buildCandidateConfidence(probe.grade, domainFitOf(candidate), candidate.qualityScore)
  return {
    ...candidate,
    verified: probe.grade === "verified",
    grade: probe.grade,
    gradeReason: probe.reason,
    latencyMs: probe.latencyMs ?? candidate.latencyMs,
    confidence,
    qualityScore: confidence.total,
  }
}

/** 一批候选探完之后的读数（前端据此决定横幅文案，而不是逐条猜「是不是都挂了」） */
export interface CandidateProbeSummary {
  /** 参与本轮实测的候选条数 */
  checked: number
  /** 实测通过 */
  verified: number
  /** 实测确认不可用（dead / suspicious）——这类候选不该被一键采纳 */
  unreachable: number
  /** 没测准（blocked / unverified）——慢 ≠ 死，不能渲染成「已失效」 */
  inconclusive: number
  /** 未在总预算内给出结论、按「没测准」标注的条数 */
  pending: number
  /** 本轮总预算（毫秒） */
  budgetMs: number
  /** 至少有一条实测通过 */
  hasVerified: boolean
  /** 口径声明：本机测不到不等于站点挂了 */
  caveat: string
}

/**
 * 批量探活、按实测档位排序、汇总读数。
 *
 * 刻意**不**在这里剔除不可达候选：模型说「这个站很好」而实测说「这个站 404」，
 * 这个分歧本身就是要给运营看的信息；静默删掉一条只会让列表看起来更干净、更假。
 *
 * `probe` 可注入是为了单测能离线复现「档位排序 / 预算用尽 / 抛错归类」，
 * 真实探活走 `probeCandidateUrl`（缓存 + 条件请求）。
 */
export async function probeCandidates(
  candidates: StructuredReplacementCandidate[],
  options: {
    probe?: (url: string) => Promise<CandidateProbe>
    budgetMs?: number
  } = {},
): Promise<{ candidates: StructuredReplacementCandidate[]; summary: CandidateProbeSummary }> {
  const probe = options.probe ?? probeCandidateUrl
  const budgetMs = options.budgetMs ?? CANDIDATE_PROBE_BUDGET_MS
  const startedAt = Date.now()
  const deadlineAt = startedAt + budgetMs

  const settled = await Promise.all(
    candidates.map(async (candidate): Promise<{ candidate: StructuredReplacementCandidate; pending: boolean }> => {
      const remaining = Math.max(0, deadlineAt - Date.now())
      let budgetExhausted = false
      try {
        const probeResult = await withTimeout(
          probe(candidate.url),
          remaining,
          "候选探活未在总预算内给出结论",
          () => {
            budgetExhausted = true
          },
        )
        return { candidate: applyProbeResult(candidate, probeResult), pending: false }
      } catch (err) {
        /**
         * 两种失败必须分开说：预算耗尽只证明「我们没等够」，
         * 而探活函数抛出的是真异常（比如缓存读写坏了），按探活异常口径归类。
         * 把两者混成「预算」文案，会让人以为重试一次就能拿到结论。
         */
        if (budgetExhausted) {
          return {
            candidate: applyProbeResult(candidate, {
              grade: "unverified",
              ok: false,
              latencyMs: Date.now() - startedAt,
              reason: `未在 ${Math.round(budgetMs / 1000)} 秒探活预算内给出结论（慢 ≠ 死，需人工复核）`,
            }),
            pending: true,
          }
        }
        const elapsed = Date.now() - startedAt
        const classified = classifyProbeFailure(candidate.url, err, elapsed, CANDIDATE_PROBE_TIMEOUT_MS)
        return {
          candidate: applyProbeResult(candidate, {
            grade: classified.grade,
            ok: false,
            latencyMs: elapsed,
            reason: classified.reason,
          }),
          pending: false,
        }
      }
    }),
  )

  const graded = settled.map((s) => s.candidate)
  graded.sort((a, b) => rankCandidate(b) - rankCandidate(a))

  const pending = settled.filter((s) => s.pending).length
  const verified = graded.filter((c) => c.grade === "verified").length

  return {
    candidates: graded,
    summary: {
      checked: graded.length,
      verified,
      unreachable: graded.filter((c) => c.grade === "dead" || c.grade === "suspicious").length,
      inconclusive: graded.filter((c) => c.grade === "blocked" || c.grade === "unverified").length,
      pending,
      budgetMs,
      hasVerified: verified > 0,
      caveat:
        "可达性为「从本机网络实测」的即时快照：超时、被 WAF 挡住或 DNS 未解析不等于站点已死，反之实测通过也只证明这一刻能打开。档位为 unverified/suspicious/dead 的候选请人工复核后再采纳。",
    },
  }
}
