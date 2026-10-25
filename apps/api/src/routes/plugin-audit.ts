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
  isBlockedByBotStatus,
  PLUGIN_AUDIT_DEFAULTS,
  type ProbeFailureKind,
  type UrlProbeResult,
  type UrlProber,
} from "../plugin-audit.ts";
import type { AppContext } from "../context.ts";
import { safeDecodeParam, badRequest, notFound } from "./shared.ts";

/** 单次体检抽样上限（防滥用：一次打几百条外部请求会伤人也伤己） */
const MAX_SAMPLE = 200
/** 单条探活兜底超时区间 */
const MIN_TIMEOUT_MS = 500
const MAX_TIMEOUT_MS = 30_000

/**
 * 体检专用 UA：浏览器风格，可用 NAVHUB_AUDIT_USER_AGENT 覆盖。
 *
 * 为什么不用项目默认的 NavHubBot/0.1：首轮真实体检发现，前端包的「不可达」全是 403
 * （webpagetest.org / wails.io）、政务包大量 412 —— 那是 WAF 在拒绝爬虫 UA，
 * 站点本身在浏览器里完全正常。体检的目的是判断「用户能不能打开」，故用浏览器风格 UA；
 * 拦不住的那部分会被归入 blocked（存活但拒绝爬虫），仍然计入可达，不会误杀。
 */
const AUDIT_USER_AGENT =
  process.env.NAVHUB_AUDIT_USER_AGENT?.trim() ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

/**
 * 报告口径声明（随响应返回，避免调用方把「本机测不到」误读成「站点挂了」）。
 *
 * 真实教训：政务包 30 条抽样里的 8 条「真不可达」全是超时/抓取失败
 * （si.12333.gov.cn、gaj.tj.gov.cn、beijing.chinatax.gov.cn…），而这类 .gov.cn 站点
 * 在国内网络通常是正常的 —— 地域或网络限制很容易被误当成死链。
 * 做成响应字段而非 UI 文案：管理端面板与将来的全市场体检脚本共用同一口径。
 */
const REACHABILITY_CAVEAT =
  "可达性为「从本机网络测得」的即时快照：超时与抓取失败可能是地域/网络限制或目标站风控，不等于死链，需人工复核；" +
  "401/403/405/412/418/429 属于「存活但拒绝爬虫」（站点本身可用），已计入可达率。"

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback
  return Math.min(max, Math.max(min, n))
}

/** 生产探活器：只关心状态码/落点/耗时，不读正文（maxBytes 设小，避免真把大页面拉回来） */
function createGuardedProber(): UrlProber {
  return async (url, timeoutMs): Promise<UrlProbeResult> => {
    const started = Date.now()
    try {
      const res = await guardedFetch(url, {
        timeoutMs,
        maxBytes: 8 * 1024,
        maxRedirects: PLUGIN_AUDIT_DEFAULTS.maxRedirects,
        userAgent: AUDIT_USER_AGENT,
      })
      return {
        url,
        ok: res.status >= 200 && res.status < 400,
        blocked: isBlockedByBotStatus(res.status),
        status: res.status,
        finalUrl: res.finalUrl,
        latencyMs: Date.now() - started,
      }
    } catch (err) {
      const elapsed = Date.now() - started
      const message = err instanceof Error ? err.message : String(err)
      // 原因归类，顺序要紧：
      //  1) 超时按「耗时逼近上限」判定 —— 比猜错误文案可靠（AbortError 的文案会随运行时变）；
      //  2) 重定向超限与 SSRF 拦截都能从 guardedFetch 的文案稳定识别；
      //  3) 其余归 connect（DNS/连接/TLS 层失败）。
      const failureKind: ProbeFailureKind =
        elapsed >= timeoutMs * 0.95 || message === "timeout"
          ? "timeout"
          : message.includes("重定向")
            ? "redirect-limit"
            : message.includes("受保护") || message.includes("SSRF") || message.includes("blocked")
              ? "ssrf-blocked"
              : "connect"
      return { url, ok: false, latencyMs: elapsed, error: message, failureKind }
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
    const slug = safeDecodeParam((req.params as { slug: string }).slug)
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
      // target 必填：详情页徽标要按 slug 取「最近一次体检」，只靠 diff 里的 slug
      // 就得全表扫 JSON；写进 target 后是一次点查。
      target: slug,
      diff: {
        slug,
        declared: urls.length,
        sampled: summary.total,
        ok: summary.ok,
        blocked: summary.blocked,
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
      blockedCount: summary.blocked,
      brokenCount: summary.broken,
      redirected: summary.redirected,
      reachability: summary.reachability,
      brokenItems: summary.brokenItems,
      blockedItems: summary.blockedItems,
      brokenByReason: summary.brokenByReason,
      caveat: REACHABILITY_CAVEAT,
      params: { sample, timeoutMs, maxRedirects: PLUGIN_AUDIT_DEFAULTS.maxRedirects },
    }
  })

  /**
   * 读取某个插件**最近一次 URL 体检**结果（详情页徽标用）。
   *
   * 路径为什么是 `/url-health` 而不是 `/audit`：`GET /api/plugins/:slug/audit`
   * 已被市场侧的「AI 安全扫描评估」占用（作者认证/协议检查，与本路由是两件事）。
   * Fastify 不允许同方法同路径重复注册，且两者语义不同，故这里显式带 url-。
   *
   * 刻意不复用 POST：POST 会真的去探测 30 条外部 URL，耗时数秒且对目标站有压力；
   * 详情页每被打开一次就跑一遍既慢又失礼。这里只读审计留痕里的历史结果，
   * 没有记录时如实返回 checked=false（徽标不显示），绝不拿 0 冒充「全挂」。
   *
   * 公开只读：徽标就在公开详情页上，数据本身也只是一份聚合比例。
   */
  app.get(
    "/api/plugins/:slug/url-health",
    { config: { scope: "public", rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const slug = safeDecodeParam((req.params as { slug: string }).slug)
      const plugin = await ctx.repo.getPluginBySlug(slug)
      if (!plugin) return notFound(reply, `插件不存在: ${slug}`)

      const rows = await ctx.repo.raw(
        "SELECT created_at, diff FROM audit_logs WHERE action = ? AND target = ? ORDER BY id DESC LIMIT 1",
        ["audit.plugin_url_audit", slug],
      )
      const row = rows[0]
      if (!row) return { ok: true, slug, checked: false }

      // diff 是历史 JSON，可能被人工改坏或来自旧版本格式：解析失败按「无记录」处理，
      // 不让一条脏审计把详情页整页打挂。
      let diff: Record<string, unknown> | null = null
      try {
        const parsed = typeof row.diff === "string" ? JSON.parse(row.diff) : row.diff
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          diff = parsed as Record<string, unknown>
        }
      } catch {
        diff = null
      }
      if (!diff) return { ok: true, slug, checked: false }

      const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
      return {
        ok: true,
        slug,
        checked: true,
        auditedAt: Number(row.created_at ?? 0),
        declared: num(diff.declared),
        sampled: num(diff.sampled),
        okCount: num(diff.ok),
        blockedCount: num(diff.blocked),
        brokenCount: num(diff.broken),
        reachability: num(diff.reachability),
        caveat: REACHABILITY_CAVEAT,
      }
    },
  )
}
