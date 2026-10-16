/**
 * 搜索历史
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { identityOf } from "./shared.ts";

import type { AppContext } from "../context.ts";

export const historyRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------ 搜索历史 ------------------------ */

  app.get("/api/search-history", async (req) => {
    const identity = identityOf(req as never);
    if (!identity) return { items: [] };
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 10, 50);
    return { items: await ctx.repo.listSearchHistory(identity, limit) };
  });

  app.delete("/api/search-history", async (req) => {
    const identity = identityOf(req as never);
    if (!identity) return { ok: false, error: "缺少 userId 或 anonId" };
    await ctx.repo.clearSearchHistory(identity);
    return { ok: true };
  });

};
