/**
 * 健康检查与能力探针（/api/health /ready /metrics /warmup）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { renderMetrics } from "../metrics.ts";

import type { AppContext } from "../context.ts";

export const healthRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ---------------------------- 健康与能力 ---------------------------- */

  app.get("/api/health", { config: { cache: { maxAge: 15 } } }, async () => {
    // 存活探针不依赖数据库：DB 故障时这里返回 500 会让容器被反复重启，
    // 而重启解决不了数据库问题，只会放大抖动。DB 状态交给 /ready 与 db 字段。
    let dbOk = true;
    let stats: Awaited<ReturnType<typeof ctx.repo.stats>> | null = null;
    try {
      stats = await ctx.repo.stats();
    } catch {
      dbOk = false;
    }
    return {
      ok: true,
      mode: ctx.config.mode,
      capabilities: ctx.capabilities,
      db: { ok: dbOk },
      stats,
      embedding: ctx.embedding?.stats ? { cache: ctx.embedding.stats() } : undefined,
    };
  });

  /**
   * 就绪探针：compose healthcheck / depends_on 应指 /ready。
   *
   * 旧实现恒返回 ok:true，只报告 embedding/fts 的装配状态——数据库文件被删、
   * PG 断连、连接池耗尽时容器仍显示 healthy，restart 策略永远不会触发。
   * 现在真实 ping 一次数据库；失败返回 503，让编排层把流量摘走并触发重启。
   * embedding 是可选能力（首次部署要下载模型），不参与就绪判定。
   */
  app.get("/api/ready", async (_req, reply) => {
    const started = Date.now();
    let dbOk = false;
    let dbError: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ctx.repo.raw("SELECT 1 AS ok"),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("数据库探测超时（2s）")), 2_000);
        }),
      ]);
      dbOk = true;
    } catch (err) {
      dbError = err instanceof Error ? err.message : String(err);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const embeddingReady = ctx.embedding ? ctx.embedding.ready() : false;
    const semantic = Boolean(ctx.embedding && ctx.vectors && embeddingReady);
    if (!dbOk) reply.code(503);
    return {
      ok: dbOk,
      mode: ctx.config.mode,
      db: { ok: dbOk, latencyMs: Date.now() - started, ...(dbError ? { error: dbError } : {}) },
      semantic,
      embeddingReady,
      fts: Boolean(ctx.fts),
    };
  });

  /**
   * Prometheus 指标（文本格式）。
   * 权限位 read：开放模式（默认）与 /api/health 一样可匿名抓取；
   * 一旦开启 NAVHUB_AUTH_REQUIRED，抓取方需带 read 及以上 scope 的 Bearer token。
   * 刻意只暴露有界基数的维度与聚合计数，不含任何站点内容/身份信息。
   */
  app.get("/api/metrics", { config: { scope: "read" } }, async (_req, reply) => {
    reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8");
    return renderMetrics(ctx);
  });

  /**
   * 显式预热 embedding 模型。
   * 默认惰性加载（不拖慢启动），需要时可主动调用（例如部署完成后预热）。
   */
  app.post("/api/warmup", { config: { scope: "write" } }, async () => {
    const t0 = Date.now();
    if (!ctx.embedding) return { ok: false, reason: "embedding 未启用" };
    const ok = await ctx.embedding.warmup();
    return { ok, tookMs: Date.now() - t0, model: ctx.config.embedding.model, dim: ctx.config.embedding.dim };
  });
};
