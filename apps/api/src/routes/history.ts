/**
 * 搜索历史
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { MAX_SEARCH_QUERY_LENGTH } from "@navhub/core";
import {identityTrusted, parsePagination, resolveCanonicalIdentity, requestIdentityOf, userDomainWriteAllowed } from "./shared.ts";

import type { AppContext } from "../context.ts";

export const historyRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------ 搜索历史 ------------------------ */

  app.get("/api/search-history", async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
    if (!rawIdentity) return { items: [], hasMore: false, nextOffset: 0, lastHistoryCleanupAt: null };
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    // 合并后的旧 id 仍会从扩展/旧标签页发来：读也要落到 canonical，否则看不到已合并的数据
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    const { limit, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });
    const page = await ctx.repo.listSearchHistoryPage(identity, limit, offset);
    return {
      items: page.items,
      hasMore: page.hasMore,
      nextOffset: offset + page.items.length,
      // U-373：历史页脚的上次清理时间（真实清理审计，无记录为 null，不编造）
      lastHistoryCleanupAt: await ctx.repo.getLastHistoryCleanupAt(identity),
    };
  });

  /**
   * 只记历史、不跑检索：页内即时筛选框（分类/热榜/标签/目录/合集）
   * 是本机过滤、从不走 /api/search，用户在里面搜「考研」「微信」就永远进不了
   * 搜索历史。调用方在停手提交时把「当时实际展示的命中数」一起带上——
   * resultCount 的口径与 /api/search 的 total 一致，都是调用方当时能看到的
   * 真实命中数，不是写死的占位。
   *
   * 不写 search 事件：本机筛选是页内导航，不是全站检索，写进去会把「大家在
   * 搜」灌进页内筛选词。去重走 recordSearch 同一窗口（5 分钟内同查询只刷新）。
   * 开关口径与 /api/search 一致：云端设置与请求带的本机开关取 AND，任一关
   * 都不记（只返回 recorded:false，不报错——调用方是 fire-and-forget，不该
   * 因为用户关了历史就收到错误）。
   *
   * scope 显式声明 public：匿名入口，真正的闸是处理器里的 identityTrusted
   * 与 userDomainWriteAllowed（与 /api/search 同级）；漏写会进隐式基线红闸。
   */
  app.post("/api/search-history", { config: { scope: "public" } }, async (req, reply) => {
    const rawIdentity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { ok: false, error: "当前令牌为只读，无法执行写操作" }; }
    if (!rawIdentity) { reply.code(400); return { ok: false, error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { ok: false, error: "需要 Bearer token" }; }
    const body = (req.body ?? {}) as { q?: unknown; query?: unknown; resultCount?: unknown; searchHistoryEnabled?: unknown };
    const q = typeof body.q === "string" ? body.q.trim() : typeof body.query === "string" ? body.query.trim() : "";
    if (!q) { reply.code(400); return { ok: false, error: "缺少查询词" }; }
    if (q.length > MAX_SEARCH_QUERY_LENGTH) { reply.code(400); return { ok: false, error: "查询词超长" }; }
    const countRaw = Number(body.resultCount ?? 0);
    const resultCount = Number.isFinite(countRaw) ? Math.max(0, Math.trunc(countRaw)) : 0;
    const localEnabled =
      body.searchHistoryEnabled === undefined
        ? true
        : body.searchHistoryEnabled === true || body.searchHistoryEnabled === "true" || body.searchHistoryEnabled === "1" || body.searchHistoryEnabled === 1;
    const identity = await resolveCanonicalIdentity(ctx, rawIdentity);
    const settings = await ctx.repo.getUserSettings(identity);
    if (settings.searchHistoryEnabled === false || !localEnabled) return { ok: true, recorded: false };
    await ctx.repo.recordSearch(identity, q, resultCount);
    return { ok: true, recorded: true };
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
