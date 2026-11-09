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
  type PatrolSelection,
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
  getTargets: (limit: number) => Promise<PatrolSelection>
): Promise<void> {
  const { guardedFetch } = await import("@navhub/ai");
  const limit = payload.limit ?? 50;
  let selection: PatrolSelection;
  if (payload.siteId) {
    // 单站点巡检：不走队列，配额与基数没有意义，显式置空而不是伪造。
    const one = await ctx.repo.getSite(payload.siteId);
    selection = {
      targets: one ? [one] : [],
      quota: { backfill: 0, refresh: 0 },
      picked: { backfill: 0, refresh: 0 },
      depth: { unchecked: 0, checked: 0 },
    };
  } else {
    selection = await getTargets(limit);
  }
  const targets = selection.targets.filter((s): s is SiteRow => Boolean(s));
  let ok = 0;
  let checked = 0;

  /**
   * 抓取并发度（窗口大小）。
   *
   * 原实现是**串行**抓取：50 个站点 × 每次最长 fetch 超时 = 最坏数百秒，而任务预算
   * 只有 240s、单实例锁心跳 TTL 120s（见 DEFAULT_SCHEDULES / LOCK_HEARTBEAT），
   * 于是"一轮巡检跑不完"本身就成了常态（剩余顺延）。
   * 现在按窗口**并发抓取**、**落库仍串行**：
   *   - 抓取是 IO 密集，并发能近似线性缩短总时长（默认 6；NAVHUB_HEALTH_POOL 可调，钳在 1..16）；
   *   - 写必须串行：存储层是单写者（见 DbAccessGate），且 shouldBreak 要按站点读历史。
   * 协作式取消语义不变：每个窗口前后都检查 run.shouldStop()，到点后不再开新窗口。
   */
  const pool = (() => {
    const raw = Number(process.env.NAVHUB_HEALTH_POOL ?? 6);
    return Number.isFinite(raw) ? Math.min(16, Math.max(1, Math.floor(raw))) : 6;
  })();

  for (let i = 0; i < targets.length; i += pool) {
    if (run.shouldStop()) break;
    const window = targets.slice(i, i + pool);
    const fetched = await Promise.all(
      window.map(async (site) => {
        const startedAt = Date.now();
        try {
          const res = await guardedFetch(site!.url, { ...ctx.config.fetch });
          return { site: site!, res, error: null as unknown, elapsedMs: Date.now() - startedAt };
        } catch (err) {
          return { site: site!, res: null, error: err, elapsedMs: Date.now() - startedAt };
        }
      }),
    );

    for (const item of fetched) {
      checked++;
      const site = item.site;
      if (item.res) {
        const res = item.res;
        let healthy = res.status >= 200 && res.status < 400;
        let reason: string | null = null;

        if (healthy && res.body) {
          const audit = auditPageHealth(site.url, res.body, undefined, undefined, { truncated: res.truncated });
          if (audit.status === "SUSPICIOUS_PARKED" || audit.status === "SOFT_404") {
            healthy = false;
            reason = `伪健康识别: ${audit.reason}`;
          }
        }

        if (healthy) ok++;
        const nextStatus = healthy && site.status === "broken" ? "active" : site.status;
        await ctx.repo.updateSiteHealth(site.id, {
          httpStatus: res.status,
          ok: healthy,
          latencyMs: item.elapsedMs,
          redirectTo: res.redirects?.at(-1) ?? null,
          error: reason,
          currentStatus: nextStatus,
          markBroken: healthy ? undefined : await shouldBreak(ctx, site.id),
        });
      } else {
        await ctx.repo.updateSiteHealth(site.id, {
          httpStatus: null,
          ok: false,
          latencyMs: item.elapsedMs,
          redirectTo: null,
          error: item.error instanceof Error ? item.error.message : String(item.error),
          currentStatus: site.status,
          markBroken: await shouldBreak(ctx, site.id),
        });
      }
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

  // 覆盖面指标：补探队列排在 targets 最前面（见 JobRunner#patrolTargets），
  // 所以「实际尝试过的补探数」= min(已巡检数, 补探选中数)，不会把被 shouldStop
  // 截断的部分算成已覆盖 —— 报一个偏乐观的覆盖率比不报更糟。
  const attemptedBackfill = Math.min(checked, selection.picked.backfill);
  const uncheckedAfter = Math.max(0, selection.depth.unchecked - attemptedBackfill);
  const total = selection.depth.unchecked + selection.depth.checked;
  const coveragePct = total > 0 ? Number((((total - uncheckedAfter) / total) * 100).toFixed(2)) : 100;
  await ctx.repo
    .recordEvent("health_check", {
      meta: {
        planned: targets.length,
        checked,
        ok,
        deferred,
        // 名额怎么分的：quota 是计划，picked 是实际选中（队列不足时两者不同）
        quota: selection.quota,
        picked: selection.picked,
        // 整库基数与投影：未知状态是在下降还是在原地打转，看这两个数
        depthBefore: selection.depth,
        uncheckedAfter,
        coveragePct,
        projectedDaysToFullCoverage:
          attemptedBackfill > 0 ? Math.ceil(uncheckedAfter / attemptedBackfill) : null,
      },
    })
    .catch(() => undefined);
}
