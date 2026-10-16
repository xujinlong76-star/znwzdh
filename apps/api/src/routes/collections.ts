/**
 * 精选专题
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";

import type { AppContext } from "../context.ts";

export const collectionRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ----------------------- 精选专题 ----------------------- */

  app.get("/api/collections", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async () => ctx.repo.listCollections());

  app.get("/api/collections/:slug", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const col = await ctx.repo.getCollectionBySlug(slug);
    if (!col) { reply.code(404); return { error: "专题不存在" }; }
    return { collection: col, sites: await ctx.repo.listCollectionSites(slug) };
  });

};
