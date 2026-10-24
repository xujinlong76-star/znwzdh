/**
 * 搜索历史
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import {identityTrusted, parsePagination, resolveCanonicalIdentity, requestIdentityOf, userDomainWriteAllowed } from "./shared.ts";

import type { AppContext } from "../context.ts";

export const historyRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------ 搜索历史 ------------------------ */

  app.get("/api/search-history", async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
    if (!rawIdentity) return { items: [], hasMore: false, nextOffset: 0 };
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    // 合并后的旧 id 仍会从扩展/旧标签页发来：读也要落到 canonical，否则看不到已合并的数据
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
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
    const rawIdentity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    if (!rawIdentity) { reply.code(400); return { ok: false, error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { ok: false, error: "需要 Bearer token" }; }
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    const removed = await ctx.repo.deleteSearchHistoryItem(identity, Math.trunc(id));
    if (!removed) { reply.code(404); return { ok: false, error: "记录不存在" }; }
    return { ok: true };
  });

  app.delete("/api/search-history", async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    if (!rawIdentity) { reply.code(400); return { ok: false, error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { ok: false, error: "需要 Bearer token" }; }
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    await ctx.repo.clearSearchHistory(identity);
    return { ok: true };
  });

  /**
   * 批量删除（T4）：body 二选一——ids[]（≤200）或 filter:"zero_results" 服务端筛选。
   * 替代前端「逐条 DELETE 串行循环」：几十条零结果记录的清理从 N 次往返变 1 次。
   * 归属校验与单删同口径（user_id 过滤），不属于该身份的 id 静默不计入删除数。
   */
  app.post("/api/search-history/batch-delete", async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    if (!rawIdentity) { reply.code(400); return { ok: false, error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { ok: false, error: "需要 Bearer token" }; }
    const body = (req.body ?? {}) as { ids?: unknown; filter?: unknown };
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    if (body.filter === "zero_results") {
      const removed = await ctx.repo.deleteZeroResultSearchHistory(identity);
      return { ok: true, removed };
    }
    if (Array.isArray(body.ids)) {
      if (body.ids.length > 200) { reply.code(400); return { ok: false, error: "单次最多删除 200 条" }; }
      const ids = body.ids.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
      const removed = await ctx.repo.deleteSearchHistoryItems(identity, ids);
      return { ok: true, removed };
    }
    reply.code(400);
    return { ok: false, error: "需要 ids 数组或 filter=zero_results" };
  });

};
