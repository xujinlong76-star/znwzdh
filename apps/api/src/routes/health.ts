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

  app.get("/api/health", { config: { cache: { maxAge: 15 } } }, async () => ({
    ok: true,
    mode: ctx.config.mode,
    capabilities: ctx.capabilities,
    stats: await ctx.repo.stats(),
    embedding: ctx.embedding?.stats ? { cache: ctx.embedding.stats() } : undefined,
  }));

  // 就绪探针：compose depends_on 应指 /ready（迁移水位+embedding 就绪），/health 仅表进程存活
  app.get("/api/ready", async () => {
    const embeddingReady = ctx.embedding ? ctx.embedding.ready() : false;
    const semantic = Boolean(ctx.embedding && ctx.vectors && embeddingReady);
    return { ok: true, mode: ctx.config.mode, semantic, embeddingReady, fts: Boolean(ctx.fts) };
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
