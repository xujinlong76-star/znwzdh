/**
 * 可用性巡检任务（health_check）。
 *
 * 职责：
 * 1. 批量安全探测站点连通性与 HTTP 状态；
 * 2. 识别软 404 与域名停靠；
 * 3. 统计连续失败判定 broken 状态，避免抖动误杀；
 * 4. 协作式限时退出（run.shouldStop()）与顺延。
 */

import { auditPageHealth } from "@navhub/core";
import type { AppContext } from "../../context.ts";
import {
  HEALTH_FAIL_THRESHOLD,
  shouldMarkBroken,
  type JobRunHandle,
} from "../../jobs.ts";

type SiteRow = Awaited<ReturnType<AppContext["repo"]["listSites"]>>[number];

/**
 * 本次失败是否足以把站点标为 broken。
 * 查该站点最近 threshold-1 次巡检，统计「从最近往前连续失败」的次数。
 */
export async function shouldBreak(ctx: AppContext, siteId: string): Promise<boolean> {
  const threshold = HEALTH_FAIL_THRESHOLD;
  if (threshold <= 1) return true;
  try {
    const recent = await ctx.repo.recentHealthChecks(siteId, threshold - 1);
    let consecutive = 0;
    for (const r of recent) {
      if (r.ok) break;
      consecutive++;
    }
    return shouldMarkBroken(false, consecutive, threshold);
  } catch {
    // 查不到历史（新库/表缺失）时保守处理：不标 broken，等下一轮
    return false;
  }
}

export async function handleHealthCheck(
  ctx: AppContext,
  payload: { siteId?: string; limit?: number },
  run: JobRunHandle,
  getTargets: (limit: number) => Promise<Array<SiteRow | null>>
): Promise<void> {
  const { guardedFetch } = await import("@navhub/ai");
  const limit = payload.limit ?? 50;
  const found: Array<SiteRow | null> = payload.siteId
    ? [await ctx.repo.getSite(payload.siteId)]
    : await getTargets(limit);
  const targets = found.filter((s): s is SiteRow => Boolean(s));
  let ok = 0;
  let checked = 0;

  for (const site of targets) {
    if (run.shouldStop()) break;
    checked++;
    const t0 = Date.now();
    try {
      const res = await guardedFetch(site!.url, { ...ctx.config.fetch });
      let healthy = res.status >= 200 && res.status < 400;
      let reason: string | null = null;

      if (healthy && res.body) {
        const audit = auditPageHealth(site!.url, res.body, undefined, undefined, { truncated: res.truncated });
        if (audit.status === "SUSPICIOUS_PARKED" || audit.status === "SOFT_404") {
          healthy = false;
          reason = `伪健康识别: ${audit.reason}`;
        }
      }

      if (healthy) ok++;
      const nextStatus = healthy && site!.status === "broken" ? "active" : site!.status;
      await ctx.repo.updateSiteHealth(site!.id, {
        httpStatus: res.status,
        ok: healthy,
        latencyMs: Date.now() - t0,
        redirectTo: res.redirects?.at(-1) ?? null,
        error: reason,
        currentStatus: nextStatus,
        markBroken: healthy ? undefined : await shouldBreak(ctx, site!.id),
      });
    } catch (err) {
      await ctx.repo.updateSiteHealth(site!.id, {
        httpStatus: null,
        ok: false,
        latencyMs: Date.now() - t0,
        redirectTo: null,
        error: err instanceof Error ? err.message : String(err),
        currentStatus: site!.status,
        markBroken: await shouldBreak(ctx, site!.id),
      });
    }
  }

  const deferred = targets.length - checked;
  if (deferred > 0) {
    console.warn("[navhub-job] health_check 预算到点，剩余站点顺延下一轮", {
      planned: targets.length,
      checked,
      deferred,
    });
  }
  await ctx.repo.recordEvent("health_check", { meta: { planned: targets.length, checked, ok, deferred } }).catch(() => undefined);
}
