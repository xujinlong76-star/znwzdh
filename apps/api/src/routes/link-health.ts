/**
 * 链接巡检后台路由 (Link Health Admin Routes) —— A10
 *
 * 核心能力：
 * 1. GET  /api/admin/link-health            - 巡检覆盖总览 + 当前坏站清单
 *    （已确认 broken 与连续失败中的站点：失败次数、最近检测时间、错误类型），
 *    数据全部复用巡检本体落库的 health_checks 历史与 sites 健康列，不另起一套检测。
 * 2. POST /api/admin/link-health/visibility - 处置闭环：批量把坏站从前台隐藏 / 恢复展示。
 *    走的开关是 sites.enabled —— 与快照公开投影 isPubliclyVisibleSite 同一口径：
 *    enabled=false 的站点不进任何公开投影（分类、搜索、首页、合集全部消失），
 *    且该字段本就是管理员手动停用位，巡检自愈（status broken↔active）不会冲掉它，
 *    恢复展示必须由运营者显式执行，不会「网站活过来就自动回前台」。
 *
 * 与 /api/admin/audit/*（自治自愈：Wayback/平替提案）是两套系统，互不替代：
 * 那边管「怎么修」，这边管「现在哪些站死了、要不要先从前台拿掉」。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { HEALTH_FAIL_THRESHOLD } from "../jobs.ts";
import { badRequest } from "./shared.ts";
import type { AppContext } from "../context.ts";

/** 连续失败次数的统计上限：取最近 N 次巡检往前数，够区分「抖动」与「真死」。 */
const STREAK_SCAN_LIMIT = 30;

const VisibilityBody = z.object({
  siteIds: z.array(z.string().min(1)).min(1).max(200),
  visible: z.boolean(),
});

/** 把巡检的原始错误归到运营者能扫读的类型；归不进的保留原文（error 字段）。 */
function classifyError(error: string | null, httpStatus: number | null): string {
  if (error?.startsWith("伪健康识别")) return "parked_or_soft404";
  if (httpStatus !== null && httpStatus >= 400) return "http_error";
  if (error && /timeout|timed out|ETIMEDOUT|AbortError/i.test(error)) return "timeout";
  if (error && /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network/i.test(error)) return "network";
  if (error) return "other";
  return "unknown";
}

export const linkHealthRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.get("/api/admin/link-health", { config: { scope: "admin" } }, async () => {
    const [sites, patrol] = await Promise.all([
      ctx.repo.listSites({ limit: 1000 }),
      ctx.repo.countSitesByPatrolState().catch(() => ({ unchecked: 0, checked: 0 })),
    ]);

    const live = sites.filter((s) => s.status !== "archived" && s.status !== "pending");
    const brokenCount = live.filter((s) => s.status === "broken").length;

    // 候选 = 已确认 broken，或最近一次巡检失败（health_ok=false 且真被查过）。
    // 注意 health.ok 在从未巡检时默认 false，必须用 lastCheckedAt 区分「没查过」。
    const candidates = live.filter(
      (s) => s.status === "broken" || (s.health?.lastCheckedAt != null && s.health?.ok === false),
    );

    const items = [];
    for (const site of candidates) {
      const recent = await ctx.repo.recentHealthChecks(site.id, STREAK_SCAN_LIMIT).catch(() => []);
      let consecutiveFailures = 0;
      for (const r of recent) {
        if (r.ok) break;
        consecutiveFailures++;
      }
      // 历史被保留策略清过时 recent 可能为空：broken 站至少按阈值计，不报 0。
      if (consecutiveFailures === 0 && site.status === "broken") {
        consecutiveFailures = HEALTH_FAIL_THRESHOLD;
      }
      if (consecutiveFailures === 0) continue;
      items.push({
        siteId: site.id,
        title: site.title,
        url: site.url,
        categoryId: site.categoryId,
        status: site.status,
        enabled: site.enabled !== false,
        consecutiveFailures,
        lastCheckedAt: site.health?.lastCheckedAt ?? null,
        httpStatus: site.health?.httpStatus ?? null,
        error: site.health?.error ?? null,
        errorKind: classifyError(site.health?.error ?? null, site.health?.httpStatus ?? null),
      });
    }

    items.sort((a, b) => {
      const brokenDiff = Number(b.status === "broken") - Number(a.status === "broken");
      if (brokenDiff !== 0) return brokenDiff;
      if (b.consecutiveFailures !== a.consecutiveFailures) return b.consecutiveFailures - a.consecutiveFailures;
      return (b.lastCheckedAt ?? 0) - (a.lastCheckedAt ?? 0);
    });

    const checkedTotal = patrol.checked + patrol.unchecked;
    const lastPatrolAt = live.reduce<number | null>((max, s) => {
      const t = s.health?.lastCheckedAt ?? null;
      return t !== null && (max === null || t > max) ? t : max;
    }, null);

    return {
      ok: true,
      summary: {
        totalSites: live.length,
        checkedSites: patrol.checked,
        uncheckedSites: patrol.unchecked,
        coveragePct: checkedTotal > 0 ? Number(((patrol.checked / checkedTotal) * 100).toFixed(2)) : 100,
        brokenCount,
        failingCount: items.filter((i) => i.status !== "broken").length,
        failThreshold: HEALTH_FAIL_THRESHOLD,
        lastPatrolAt,
      },
      items,
    };
  });

  app.post("/api/admin/link-health/visibility", { config: { scope: "admin" } }, async (req, reply) => {
    const parsed = VisibilityBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return badRequest(reply, "参数无效", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { siteIds, visible } = parsed.data;
    const uniqueIds = [...new Set(siteIds)];

    const results = [];
    for (const siteId of uniqueIds) {
      const site = await ctx.repo.getSite(siteId).catch(() => null);
      if (!site) {
        results.push({ siteId, ok: false, reason: "not_found" });
        continue;
      }
      await ctx.repo.updateSite(siteId, { enabled: visible });
      results.push({ siteId, ok: true, enabled: visible });
    }

    const updated = results.filter((r) => r.ok).length;
    await ctx.repo
      .recordEvent("link_health_visibility", {
        meta: { visible, requested: uniqueIds.length, updated },
      })
      .catch(() => undefined);

    return { ok: true, updated, results };
  });
};
