/**
 * 运营统计与全景仪表盘
 *
 * 提供全景运营指标、性能遥测、安全态势、LinUCB 模型权重演进与 SSE 实时流。
 */
import type { FastifyPluginAsync } from "fastify";
import type { AppContext } from "../context.ts";
import { getHttpMetricsSummary } from "../metrics.ts";

export const statsRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------ 仪表盘全景端点 ------------------------ */

  /**
   * 仪表盘全景总览：聚合站点状态、24h 核心指标、数据库容量、运行时 QPS/延迟及分类分布。
   */
  app.get("/api/admin/dashboard/overview", { config: { scope: "read", cache: { maxAge: 5 } } }, async () => {
    const [overview, categoryDistribution] = await Promise.all([
      ctx.repo.dashboardOverview(),
      ctx.repo.categorySiteDistribution(8),
    ]);

    const runtime = getHttpMetricsSummary();

    return {
      overview: overview.overview,
      metrics24h: overview.metrics24h,
      storage: overview.storage,
      runtime,
      capabilities: ctx.capabilities,
      categoryDistribution,
    };
  });

  /**
   * 安全与审计态势：近 24 小时未授权拦截分布、Token 风险评估与最新审计日志。
   */
  app.get("/api/admin/dashboard/security", { config: { scope: "read", cache: { maxAge: 10 } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const hours = Math.min(Math.max(Number(q.hours) || 24, 1), 720);
    return ctx.repo.securityOverview(hours);
  });

  /**
   * 搜索与 AI 强化学习遥测：LinUCB 5 通道权重、转化率与搜索关键词趋势。
   */
  app.get("/api/admin/dashboard/search-ai", { config: { scope: "read", cache: { maxAge: 10 } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const days = Math.min(Math.max(Number(q.days) || 30, 1), 365);
    const [top, zero, hot] = await Promise.all([
      ctx.repo.topQueries(days, 20),
      ctx.repo.zeroResultQueries(days, 20),
      ctx.repo.hotSites(20),
    ]);
    const linucb = ctx.search.getLinUCBTelemetry();

    return {
      days,
      linucb,
      topQueries: top,
      zeroResultQueries: zero,
      hotSites: hot,
    };
  });

  /**
   * 仪表盘实时 SSE 遥测通道：推送运行时 QPS、内存、任务运行深度与最新计数。
   */
  app.get("/api/admin/dashboard/stream", { config: { scope: "read" } }, async (req, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      if (reply.raw.writableEnded || reply.raw.destroyed) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // 初始快照
    try {
      const stats = await ctx.repo.stats();
      sendEvent("init", {
        timestamp: Date.now(),
        runtime: getHttpMetricsSummary(),
        stats,
      });
    } catch {
      // 容错
    }

    // 3s 心跳定时遥测
    const interval = setInterval(async () => {
      if (reply.raw.writableEnded || reply.raw.destroyed) {
        clearInterval(interval);
        return;
      }
      try {
        const [stats, queue] = await Promise.all([
          ctx.repo.stats(),
          ctx.repo.jobsQueueDepth(),
        ]);
        sendEvent("tick", {
          timestamp: Date.now(),
          runtime: getHttpMetricsSummary(),
          stats,
          queue,
        });
      } catch {
        // 心跳容错
      }
    }, 3000);

    req.raw.on("close", () => {
      clearInterval(interval);
    });
  });

  /* ------------------------ 运营统计（向后兼容） ------------------------ */

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
};
