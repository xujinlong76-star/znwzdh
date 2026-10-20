/**
 * 插件 URL 体检 API（P0-1）。
 *
 * 与既有链路的分工（刻意不重复造轮子）：
 *   - **已安装**插件的站点：由 `jobs.ts` 的 `health_check`（24h / Weibull 抽样）覆盖，
 *     结果写回 `sites` 健康字段 + `health_checks` 历史 —— 本路由不重复做这件事；
 *   - **未安装**插件包里的 URL：此前从未被验活 —— 本路由提供「按包抽样探活」，
 *     返回可达率与不可达明细，供管理端出质量报告、上架前复核。
 *
 * 探活复用 `@navhub/ai` 的 `guardedFetch`：逐跳 SSRF 校验 + 超时 + 响应体上限
 * （默认不放行私网，因此内网目标会以 SSRF 拒绝的形式记为不可达）。
 */
import type { FastifyPluginAsync } from "fastify";
import { guardedFetch } from "@navhub/ai";
import type { SitePackPayload } from "@navhub/core";
import {
  auditPluginUrls,
  PLUGIN_AUDIT_DEFAULTS,
  type UrlProbeResult,
  type UrlProber,
} from "../plugin-audit.ts";
import type { AppContext } from "../context.ts";
import { badRequest, notFound } from "./shared.ts";

/** 单次体检抽样上限（防滥用：一次打几百条外部请求会伤人也伤己） */
const MAX_SAMPLE = 200
/** 单条探活兜底超时区间 */
const MIN_TIMEOUT_MS = 500
const MAX_TIMEOUT_MS = 30_000

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(max, Math.max(min, n))
}

/** 生产探活器：只关心状态码/落点/耗时，不读正文（maxBytes 设小，避免真把大页面拉回来） */
function createGuardedProber(): UrlProber {
  return async (url, timeoutMs): Promise<UrlProbeResult> => {
    const started = Date.now()
    try {
      const res = await guardedFetch(url, { timeoutMs, maxBytes: 8 * 1024, maxRedirects: 3 })
      return {
        url,
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        finalUrl: res.finalUrl,
        latencyMs: Date.now() - started,
      }
    } catch (err) {
      return {
        url,
        ok: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}

export const pluginAuditRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, { ctx }) => {
  /**
   * 对一个插件包做抽样 URL 体检。
   *
   * 只对有 URL 可测的 `site-pack` 开放；sample 默认 30、上限 200。
   * 结果**不落库**（体检是即时快照，避免引入新表），但会写一条审计留痕。
   */
  app.post("/api/plugins/:slug/audit", { config: { scope: "write" } }, async (req, reply) => {
    const slug = decodeURIComponent((req.params as { slug: string }).slug)
    const plugin = await ctx.repo.getPluginBySlug(slug)
    if (!plugin) return notFound(reply, `插件不存在: ${slug}`)
    if (plugin.manifest.kind !== "site-pack") {
      return badRequest(reply, "只有网址包（site-pack）的清单里才有 URL 可体检")
    }

    const body = (req.body ?? {}) as { limit?: unknown; timeoutMs?: unknown }
    const sample = clampInt(body.limit, PLUGIN_AUDIT_DEFAULTS.sample, 1, MAX_SAMPLE)
    const timeoutMs = clampInt(body.timeoutMs, PLUGIN_AUDIT_DEFAULTS.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)
    const urls = (plugin.manifest.payload as SitePackPayload).sites.map((s) => s.url)

    const { summary } = await auditPluginUrls(urls, createGuardedProber(), { sample, timeoutMs })

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "audit.plugin_url_audit",
      diff: {
        slug,
        declared: urls.length,
        sampled: summary.total,
        ok: summary.ok,
        broken: summary.broken,
        reachability: summary.reachability,
      },
    })

    return {
      ok: true,
      slug,
      declared: urls.length,
      sampled: summary.total,
      okCount: summary.ok,
      brokenCount: summary.broken,
      redirected: summary.redirected,
      reachability: summary.reachability,
      brokenItems: summary.brokenItems,
      params: { sample, timeoutMs },
    }
  })
}
