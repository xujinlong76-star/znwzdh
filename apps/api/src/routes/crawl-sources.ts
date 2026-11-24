import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { deleteCrawlSource, listCrawlSources, updateCrawlSource, upsertCrawlSource } from "@navhub/store";
import type { AppContext } from "../context.ts";

const sourceInput = z.object({
  url: z.string().trim().url().max(2048),
  kind: z.enum(["sitemap", "rss", "page"]),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  intervalMs: z.number().int().min(300_000).max(2_592_000_000).optional(),
  nextRunAt: z.number().int().nonnegative().optional(),
});
export const crawlSourceRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;
  app.get("/api/admin/crawl-sources", { config: { scope: "admin" } }, async (req, reply) => {
    const query = z.object({
      enabled: z.enum(["true", "false"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
      offset: z.coerce.number().int().min(0).max(100_000).default(0),
    }).safeParse(req.query ?? {});
    if (!query.success) { reply.code(400); return { ok: false, error: "筛选参数无效", details: query.error.issues }; }
    const items = await listCrawlSources(ctx.repo, {
      ...(query.data.enabled === undefined ? {} : { enabled: query.data.enabled === "true" }),
      limit: query.data.limit, offset: query.data.offset,
    });
    return { ok: true, items, limit: query.data.limit, offset: query.data.offset };
  });
  app.post("/api/admin/crawl-sources", { config: { scope: "admin" } }, async (req, reply) => {
    const parsed = sourceInput.safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400); return { ok: false, error: "采集来源参数无效", details: parsed.error.issues }; }
    try {
      const source = await upsertCrawlSource(ctx.repo, parsed.data);
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "crawl.source_upsert", target: source.id, diff: { kind: source.kind, enabled: source.enabled, intervalMs: source.intervalMs } });
      reply.code(201); return { ok: true, source };
    } catch (error) {
      reply.code(400); return { ok: false, error: error instanceof Error ? error.message : "采集来源保存失败" };
    }
  });
  app.patch("/api/admin/crawl-sources/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const params = z.object({ id: z.string().min(1).max(64) }).safeParse(req.params ?? {});
    const patchSchema = sourceInput.partial().refine(value => Object.keys(value).length > 0, "至少提供一个更新字段");
    const parsed = patchSchema.safeParse(req.body ?? {});
    if (!params.success || !parsed.success) { reply.code(400); return { ok: false, error: "更新参数无效", details: parsed.success ? params.error.issues : parsed.error.issues }; }
    try {
      const source = await updateCrawlSource(ctx.repo, params.data.id, parsed.data);
      if (!source) { reply.code(404); return { ok: false, error: "采集来源不存在" }; }
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "crawl.source_update", target: source.id, diff: parsed.data });
      return { ok: true, source };
    } catch (error) { reply.code(400); return { ok: false, error: error instanceof Error ? error.message : "采集来源更新失败" }; }
  });
  app.delete("/api/admin/crawl-sources/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const params = z.object({ id: z.string().min(1).max(64) }).safeParse(req.params ?? {});
    if (!params.success) { reply.code(400); return { ok: false, error: "来源 ID 无效" }; }
    const deleted = await deleteCrawlSource(ctx.repo, params.data.id);
    if (!deleted) { reply.code(404); return { ok: false, error: "采集来源不存在" }; }
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "crawl.source_delete", target: params.data.id, diff: { deleted: true } });
    return { ok: true, deleted: true };
  });
};
