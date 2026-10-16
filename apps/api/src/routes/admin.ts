import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  /* ------------------------ 审计日志 ------------------------ */
  /**
   * 谁在什么时候改了什么——与鉴权配套的可见性闭环。
   * 分页参数与 /api/search 一致（limit + offset + hasMore），
   * action/actor 过滤用于「只看 token 调用」「只看删除」这类排查。
   */
  app.get("/api/admin/audit", { config: { scope: "read", cache: { maxAge: 0 } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const offset = Math.max(0, Number(q.offset) || 0);
    const [page, actions] = await Promise.all([
      ctx.repo.listAuditLogs({ limit, offset, action: q.action || undefined, actor: q.actor || undefined }),
      ctx.repo.listAuditActions(50),
    ]);
    return { ...page, limit, offset, actions };
  });

  /* ------------------------ 运营统计 ------------------------ */

  /**
   * 健康巡检趋势：按天分桶（桶在 JS 里做，避开 SQLite/PG 的日期函数方言差异）。
   * 返回 `days` 天的 `{date, checked, failed, rate, avgLatencyMs}`——
   * 只要有历史数据就能画出曲线，没有检查记录时返回空数组（不是 404/500）。
   */
  app.get("/api/admin/health/trend", { config: { scope: "read", cache: { maxAge: 30 } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const days = Math.min(Math.max(Number(q.days) || 14, 1), 90);
    const since = Date.now() - days * 86_400_000;
    const series = await ctx.repo.healthCheckSeries(since);

    // 分桶：从今天往前推 days 天，缺数据的日期也要出现（否则曲线有洞）
    const buckets = new Map<string, { checked: number; failed: number; latencySum: number; latencyN: number }>();
    const pad = (n: number) => String(n).padStart(2, "0");
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      buckets.set(d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()), { checked: 0, failed: 0, latencySum: 0, latencyN: 0 });
    }
    for (const row of series) {
      const d = new Date(row.checkedAt);
      const key = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      const b = buckets.get(key);
      if (!b) continue;
      b.checked++;
      if (!row.ok) b.failed++;
      if (row.latencyMs !== null) { b.latencySum += row.latencyMs; b.latencyN++; }
    }

    const points = [...buckets.entries()].map(([date, b]) => ({
      date,
      checked: b.checked,
      failed: b.failed,
      // 成功率：该天没有检查时为 null（不要写 100%，那会把「没巡检」画成「很健康」）
      rate: b.checked > 0 ? Math.round(((b.checked - b.failed) / b.checked) * 1000) / 10 : null,
      avgLatencyMs: b.latencyN > 0 ? Math.round(b.latencySum / b.latencyN) : null,
    }));
    return { days, points, total: series.length };
  });

  app.get("/api/admin/stats/trends", { config: { scope: "read" } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const days = Math.min(Math.max(Number(q.days) || 30, 1), 365);
    const [top, zero, hot] = await Promise.all([
      ctx.repo.topQueries(days, 20),
      ctx.repo.zeroResultQueries(days, 20),
      ctx.repo.hotSites(20),
    ]);
    return { days, topQueries: top, zeroResultQueries: zero, hotSites: hot };
  });
}
