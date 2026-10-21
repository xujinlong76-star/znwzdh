/**
 * 搜索历史
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { identityAllowed, identityOf, parsePagination } from "./shared.ts";

import type { AppContext } from "../context.ts";

export const historyRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------ 搜索历史 ------------------------ */

  app.get("/api/search-history", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) return { items: [], hasMore: false, nextOffset: 0 };
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });
    const page = await ctx.repo.listSearchHistoryPage(identity, limit, offset);
    return {
      items: page.items,
      hasMore: page.hasMore,
      nextOffset: offset + page.items.length,
    };
  });

  app.delete("/api/search-history/:id", async (req, reply) => {
    const raw = (req.params as { id: string }).id;
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) { reply.code(400); return { ok: false, error: "id 无效" }; }
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { ok: false, error: "缺少 userId 或 anonId" }; }
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { ok: false, error: "需要 Bearer token" }; }
    const removed = await ctx.repo.deleteSearchHistoryItem(identity, Math.trunc(id));
    if (!removed) { reply.code(404); return { ok: false, error: "记录不存在" }; }
    return { ok: true };
  });

  app.delete("/api/search-history", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { ok: false, error: "缺少 userId 或 anonId" }; }
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { ok: false, error: "需要 Bearer token" }; }
    await ctx.repo.clearSearchHistory(identity);
    return { ok: true };
  });

};
