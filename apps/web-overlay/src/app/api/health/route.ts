/**
 * Web 层健康探针。
 *
 * 旧实现的两处不诚实：
 *  1. `export const runtime = 'edge'` 却读 `process.uptime` —— Edge 运行时不提供
 *     Node 的 `process.uptime`，访问它直接抛错，结果是这个「健康探针」自己 500。
 *     本层要读环境变量、要服务端直连中枢、要真实 uptime，本来就没有任何 edge 诉求，
 *     因此如实声明 nodejs（与 /api/rss、/api/weather 同口径）。
 *  2. `status: 'ok'` 是写死的常量：中枢 (:8787) 挂了、搜索与收藏全废，这里照样
 *     报 ok —— 探针在唯一的用途上说谎，比没有探针更糟。
 *
 * 现在的口径（与中枢 health/ready 的分工一致）：
 *  - HTTP 200 + `ok: true` 只回答「web 进程活着」这一件事，永不因上游抖动而变，
 *    否则编排层会把「中枢慢」误读成「web 坏」而反复重启。
 *  - 上游事实一律进 `hub` 字段：拿不到就如实给 `ok: false` + 原因，测不到的字段给
 *    `null`，绝不用 `?? 0` / 上一次的值冒充实时值。
 *  - `status` 为 `degraded` 表示「web 活着但聚合面有问题」；带 `?strict=1` 时这种
 *    情况改答 503，给编排层一个真正的就绪探针（compose 里 web 的 healthcheck
 *    打的是 `/`，换成 `/api/health?strict=1` 才探得到中枢）。
 *  - 中枢探测结果缓存 15s（与中枢自身 `cache: {maxAge: 15}` 同频），并如实标注
 *    `fromCache`：监控轮询打到这个端点时不该每次都放大成一次上游请求。
 *
 * 公开面收敛（docs/AUDIT-2026-10-20-PASS3 对「探针即门牌」的同类问题）：中枢基址、
 * 运行模式、能力位与 Node 版本只回带给携带 `x-navhub-internal-token` 的调用方；
 * 匿名调用只拿到 ok / degraded / 延迟 / 通用原因。未配置 `NAVHUB_INTERNAL_TOKEN`
 * 时**任何人**都拿不到明细（与限流豁免层同样的「零豁免默认」）。
 */
import { NextResponse } from 'next/server'
import { hubGetProbe, type HubProbe } from '@/lib/server/hub'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 进程启动时刻：只作为 `process.uptime` 不可用时的回退，不参与任何业务判断 */
const START_TIME = Date.now()

/** 探针必须在有界时间内有结论：中枢连上但不回包时不能把端点一起挂死 */
const HUB_PROBE_TIMEOUT_MS = 3_000

/** 上游探测结果复用窗口；与中枢 /api/health 的 maxAge 同频 */
const HUB_CACHE_TTL_MS = 15_000

const INTERNAL_TOKEN_HEADER = 'x-navhub-internal-token'

interface HubHealthBody {
  mode?: unknown
  db?: { ok?: unknown } | null
  capabilities?: { semantic?: unknown; fts?: unknown; llm?: unknown; notes?: unknown } | null
}

interface HubView {
  ok: boolean
  probe: 'ok' | 'miss' | 'failed'
  latencyMs: number
  reason: string | null
  probedAt: string
  fromCache: boolean
  /** 以下明细只对内部调用方可见 */
  base: string
  mode: string | null
  db: boolean | null
  capabilities: { semantic: boolean | null; fts: boolean | null; llm: boolean | null }
  notes: string[]
}

let cachedHubView: HubView | null = null
let cachedHubViewAt = 0

function boolOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function uptimeSeconds(): number {
  const raw = typeof process === 'undefined' ? NaN : process.uptime()
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw)
  return Math.floor((Date.now() - START_TIME) / 1000)
}

function viewFromProbe(probe: HubProbe<HubHealthBody>, latencyMs: number, base: string): HubView {
  const probedAt = new Date().toISOString()
  const empty = { base, mode: null, db: null, capabilities: { semantic: null, fts: null, llm: null }, notes: [] }
  if (probe.status !== 'ok') {
    return {
      ...empty,
      ok: false,
      probe: probe.status,
      latencyMs,
      reason:
        probe.status === 'miss'
          ? '中枢可达但没有 /api/health（版本不匹配或被网关改写）'
          : `中枢不可达（HTTP 错误或超过 ${HUB_PROBE_TIMEOUT_MS}ms 未响应）`,
      probedAt,
      fromCache: false,
    }
  }
  const body = probe.data ?? {}
  const caps = body.capabilities ?? null
  const rawNotes = caps?.notes
  return {
    ...empty,
    ok: true,
    probe: 'ok',
    latencyMs,
    mode: typeof body.mode === 'string' ? body.mode : null,
    db: body.db && typeof body.db.ok === 'boolean' ? body.db.ok : null,
    capabilities: {
      semantic: boolOrNull(caps?.semantic),
      fts: boolOrNull(caps?.fts),
      llm: boolOrNull(caps?.llm),
    },
    notes: Array.isArray(rawNotes) ? rawNotes.filter((n): n is string => typeof n === 'string') : [],
    reason: null,
    probedAt,
    fromCache: false,
  }
}

/** 未配置 token = 零豁免：明细对所有人（含本机 curl）都关闭 */
function allowsDetail(request: Request): boolean {
  const expected = (process.env.NAVHUB_INTERNAL_TOKEN ?? '').trim()
  if (!expected) return false
  return (request.headers.get(INTERNAL_TOKEN_HEADER) ?? '').trim() === expected
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams

  let hub = cachedHubView
  if (!hub || Date.now() - cachedHubViewAt > HUB_CACHE_TTL_MS) {
    const started = Date.now()
    const base = (
      process.env.NAVHUB_STORAGE_BASE_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      'http://localhost:8787'
    ).replace(/\/+$/, '')
    const result = await hubGetProbe<HubHealthBody>('/api/health', 0, HUB_PROBE_TIMEOUT_MS)
    hub = viewFromProbe(result, Date.now() - started, base)
    cachedHubView = hub
    cachedHubViewAt = Date.now()
  } else {
    hub = { ...hub, fromCache: true }
  }

  const detail = allowsDetail(request)
  const degraded = !hub.ok

  return NextResponse.json(
    {
      ok: true,
      app: 'NavSphere',
      tier: 'web',
      status: degraded ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: uptimeSeconds(),
      hub: detail
        ? hub
        : { ok: hub.ok, probe: hub.probe, latencyMs: hub.latencyMs, reason: hub.reason, probedAt: hub.probedAt, fromCache: hub.fromCache },
      ...(detail ? { node: process.version, detail: true } : {}),
    },
    {
      status: degraded && params.get('strict') === '1' ? 503 : 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}
