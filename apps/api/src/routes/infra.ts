import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildOpenApiDoc, renderDocsHtml, type RouteEntry } from "../openapi.ts";
import type { AppContext } from "../context.ts";

export function registerInfraRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  deps: { routeEntries: RouteEntry[]; renderMetrics: () => Promise<string> },
): void {
  const { routeEntries, renderMetrics } = deps;
  app.get("/api/openapi.json", { config: { scope: "public", cache: { maxAge: 60 } } }, async () =>
    buildOpenApiDoc(routeEntries.filter((r) => r.url !== "/api/openapi.json" && r.url !== "/api/docs")),
  );
  app.get("/api/docs", { config: { scope: "public", cache: { maxAge: 60 } } }, async (_req, reply) => {
    const doc = buildOpenApiDoc(routeEntries.filter((r) => r.url !== "/api/openapi.json" && r.url !== "/api/docs"));
    reply.header("content-type", "text/html; charset=utf-8");
    return renderDocsHtml(doc);
  });

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
    return renderMetrics();
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
}
