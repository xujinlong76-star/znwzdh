/**
 * 运营统计与全景仪表盘路由 (Operation Stats & Dashboard Routes)
 *
 * 提供全景运营指标、性能遥测、安全态势、LinUCB 模型权重演进、
 * SSE 实时流推流以及存储引擎在线维护端点。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { getHttpMetricsSummary } from "../metrics.ts";
import { parseTimeWindow, setupSseStream } from "./shared.ts";

export const statsRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------------------------------------------------ *
   * 仪表盘全景端点 (Dashboard Panorama Endpoints)
   * ------------------------------------------------------------------ */

  /**
   * 仪表盘全景总览：聚合站点状态、24h 核心指标、数据库容量、运行时 QPS/延迟及分类分布
   */
  app.get(
    "/api/admin/dashboard/overview",
    { config: { scope: "read", cache: { maxAge: 5 } } },
    async () => {
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
    }
  );

  /**
   * 安全与审计态势：近指定小时未授权拦截分布、Token 风险评估与最新审计日志
   */
  app.get(
    "/api/admin/dashboard/security",
    { config: { scope: "read", cache: { maxAge: 10 } } },
    async (req) => {
      const hours = parseTimeWindow(req.query as Record<string, unknown>, "hours", 24, 1, 720);
      return ctx.repo.securityOverview(hours);
    }
  );

  /**
   * 搜索与 AI 强化学习遥测：LinUCB 5 通道权重、转化率与搜索关键词趋势
   */
  app.get(
    "/api/admin/dashboard/search-ai",
    { config: { scope: "read", cache: { maxAge: 10 } } },
    async (req) => {
      const days = parseTimeWindow(req.query as Record<string, unknown>, "days", 30, 1, 365);
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
    }
  );

  /**
   * 仪表盘实时 SSE 遥测通道：推送运行时 QPS、内存、任务队列运行深度与最新计数
   */
  app.get("/api/admin/dashboard/stream", { config: { scope: "read" } }, async (req, reply) => {
    setupSseStream(reply);

    const sendEvent = (event: string, data: unknown) => {
      if (reply.raw.writableEnded || reply.raw.destroyed) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // 初始快照推送
    try {
      const stats = await ctx.repo.stats();
      sendEvent("init", {
        timestamp: Date.now(),
        runtime: getHttpMetricsSummary(),
        stats,
      });
    } catch {
      // 容错降级
    }

    // 3s 心跳周期遥测推送
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

  /* ------------------------------------------------------------------ *
   * 运营趋势与数据洞察 (Operational Trends & Insights)
   * ------------------------------------------------------------------ */

  /**
   * 健康巡检趋势：按天分桶（在 JS 层完成归纳，兼容 SQLite 与 PG 方言差异）
   */
  app.get(
    "/api/admin/health/trend",
    { config: { scope: "admin", cache: { maxAge: 30 } } },
    async (req) => {
      const days = parseTimeWindow(req.query as Record<string, unknown>, "days", 14, 1, 90);
      const since = Date.now() - days * 86_400_000;
      const series = await ctx.repo.healthCheckSeries(since);

      // 分桶：从当前日期往前推 days 天，即便该天无数据也生成基准桶，防止折线图产生断洞
      const buckets = new Map<
        string,
        { checked: number; failed: number; latencySum: number; latencyN: number }
      >();
      const pad = (n: number) => String(n).padStart(2, "0");

      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86_400_000);
        const dateKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        buckets.set(dateKey, { checked: 0, failed: 0, latencySum: 0, latencyN: 0 });
      }

      for (const row of series) {
        const d = new Date(row.checkedAt);
        const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const b = buckets.get(key);
        if (!b) continue;
        b.checked++;
        if (!row.ok) b.failed++;
        if (row.latencyMs !== null) {
          b.latencySum += row.latencyMs;
          b.latencyN++;
        }
      }

      const points = [...buckets.entries()].map(([date, b]) => ({
        date,
        checked: b.checked,
        failed: b.failed,
        rate: b.checked > 0 ? Math.round(((b.checked - b.failed) / b.checked) * 1000) / 10 : null,
        avgLatencyMs: b.latencyN > 0 ? Math.round(b.latencySum / b.latencyN) : null,
      }));

      return { days, points, total: series.length };
    }
  );

  /**
   * 综合热度与搜索趋势（热门词、零结果词与高频站点）
   */
  app.get("/api/admin/stats/trends", { config: { scope: "read" } }, async (req) => {
    const days = parseTimeWindow(req.query as Record<string, unknown>, "days", 30, 1, 365);
    const [top, zero, hot] = await Promise.all([
      ctx.repo.topQueries(days, 20),
      ctx.repo.zeroResultQueries(days, 20),
      ctx.repo.hotSites(20),
    ]);
    return { days, topQueries: top, zeroResultQueries: zero, hotSites: hot };
  });

  /* ------------------------------------------------------------------ *
   * 存储引擎健康自检与在线维护 (Storage Maintenance)
   * ------------------------------------------------------------------ */

  /**
   * 数据库健康自检与完整性校验（PRAGMA integrity_check）
   */
  app.get("/api/admin/maintenance/status", { config: { scope: "admin" } }, async () => {
    return ctx.repo.maintenanceCheck();
  });

  /**
   * 强制执行 SQLite WAL 预写日志同步刷盘（PASSIVE / FULL / RESTART / TRUNCATE）
   */
  app.post("/api/admin/maintenance/checkpoint", { config: { scope: "admin" } }, async (req) => {
    const body = z
      .object({
        mode: z.enum(["passive", "full", "restart", "truncate"]).default("passive"),
      })
      .safeParse(req.body ?? {});

    const mode = body.success ? body.data.mode : "passive";
    const res = await ctx.repo.checkpointWal(mode);
    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "db.checkpoint",
      diff: { mode, ...res },
    });
    return res;
  });

  /**
   * 触发全文检索 FTS5 段合并与索引优化（optimize）
   */
  app.post("/api/admin/maintenance/optimize", { config: { scope: "admin" } }, async (req) => {
    const res = await ctx.repo.optimizeFts();
    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "db.optimize_fts",
      diff: res,
    });
    return res;
  });

  /**
   * 整理数据库物理存储碎片并回收空闲页（VACUUM）
   */
  app.post("/api/admin/maintenance/vacuum", { config: { scope: "admin" } }, async (req) => {
    const res = await ctx.repo.vacuumDatabase();
    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "db.vacuum",
      diff: res,
    });
    return res;
  });
};
