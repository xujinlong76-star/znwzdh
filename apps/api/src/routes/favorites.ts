/**
 * 收藏夹（终端用户）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {identityTrusted, parseIntParam, resolveCanonicalIdentity, requestIdentityOf, userDomainWriteAllowed } from "./shared.ts";

import type { AppContext } from "../context.ts";

export const favoriteRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* --------------------- 收藏夹（终端用户） --------------------- */

  /**
   * 身份由调用方传入（登录用户的 canonical userId，或前端 localStorage 里的 anonId）。
   * 说明：这是个人导航站的轻量方案——不引入终端用户鉴权体系；
   * 多用户公开场景应改为 Bearer token（api_tokens 表已具备能力）。
   */
  const favoriteInput = z.object({
    siteId: z.string().min(1),
    folderId: z.string().nullable().optional(),
    note: z.string().max(200).nullable().optional(),
    // 标签（T22）：数组形状在这里校验，元素级清洗/上限在 normalizeFavoriteTags
    tags: z.array(z.string()).max(8).nullable().optional(),
  });



  /**
   * 收藏列表。
   *
   * 两种模式（同一端点，靠参数区分，保证旧客户端不受影响）：
   *  - **无 `limit`**：全量返回（历史行为）。匿名通道与旧标签页仍走这条，
   *    少一条就是"收藏丢了"，不能默认分页。
   *  - **带 `limit`**：分页 + 检索（`q` 匹配备注/标题/地址）+ 排序（`created`/`title`），
   *    额外返回 `total` / `hasMore`。收藏上万条时列表页靠这条。
   *
   * 身份先解析别名（canonical）：合并后旧 id 仍可能从扩展 / 旧标签页打进来，
   * 不解析就会读到"空收藏"并在旧 id 上写孤儿行。
   */
  /**
   * 收藏变更水位（B3 多端一致性轮询）：
   * 只返回当前 MAX(updated_at)（与增量同步的 version 同一口径），不拉任何行。
   * 供多标签页 / 扩展做低成本变更探测（1/5 成本的 SSE 替代，见升级方案 T18.3）；
   * 写路径都会刷新 updated_at，因此水位不前进 = 云端无变化。
   */
  app.get(
    "/api/favorites/version",
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const identity = requestIdentityOf(req as never);
      if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
      if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
      const canonical = await resolveCanonicalIdentity(ctx, identity);
      const version = await ctx.repo.getFavoritesVersion(canonical);
      return { identity: canonical, version };
    },
  );

  app.get(
    "/api/favorites",
    { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const identity = requestIdentityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const query = (req.query ?? {}) as Record<string, unknown>;
    const folders = await ctx.repo.listFavoriteFolders(canonical);

    // 未带 limit = 全量（旧语义）
    if (query.limit === undefined) {
      const items = await ctx.repo.listFavorites(canonical);
      const favSiteMap = await ctx.repo.getSitesByIds(items.map((f) => f.siteId));
      const sites = items.map((f) => favSiteMap.get(f.siteId) ?? null);
      return {
        items: items.map((f, i) => ({ ...f, site: sites[i] })),
        folders,
      };
    }

    const sortRaw = String(query.sort ?? "created");
    const sort = sortRaw === "title" ? "title" : "created";
    const page = await ctx.repo.listFavoritesPage(canonical, {
      q: typeof query.q === "string" ? query.q : undefined,
      folderId: typeof query.folderId === "string" && query.folderId ? query.folderId : null,
      sort,
      limit: parseIntParam(query.limit, 50, 1, 200),
      offset: parseIntParam(query.offset, 0, 0, 1_000_000),
    });
    const pageSiteMap = await ctx.repo.getSitesByIds(page.items.map((f) => f.siteId));
    return {
      items: page.items.map((f) => ({ ...f, site: pageSiteMap.get(f.siteId) ?? null })),
      folders,
      total: page.total,
      hasMore: page.hasMore,
      identity: canonical,
    };
  });

  app.post(
    "/api/favorites",
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const identity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const body = favoriteInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const site = await ctx.repo.getSite(body.data.siteId);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    const { favorite, existed } = await ctx.repo.addFavorite({
      userId: canonical,
      siteId: body.data.siteId,
      folderId: body.data.folderId ?? null,
      note: body.data.note ?? null,
      tags: body.data.tags ?? null,
    });
    await ctx.repo.recordEvent("favorite", { siteId: body.data.siteId, meta: { identity: canonical } }).catch(() => undefined);
    reply.code(existed ? 200 : 201);
    return { favorite, existed };
  });

  app.delete(
    "/api/favorites/:siteId",
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    const identity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const removed = await ctx.repo.removeFavorite(canonical, siteId);
    if (removed) {
      await ctx.repo.recordEvent("unfavorite", { siteId, meta: { identity: canonical } }).catch(() => undefined);
    }
    return { ok: true, removed };
  });

  /**
   * 收藏管理的编辑入口：移动到文件夹 / 改备注。
   * 两个字段都可单独出现；folderId 为 null 表示移出文件夹。
   */
  app.patch("/api/favorites/:siteId", async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    const identity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const body = z.object({
      folderId: z.string().min(1).nullable().optional(),
      note: z.string().max(200).nullable().optional(),
      tags: z.array(z.string()).max(8).nullable().optional(),
    }).refine((v) => v.folderId !== undefined || v.note !== undefined || v.tags !== undefined, {
      message: "至少要修改 folderId、note 或 tags 之一",
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const result = await ctx.repo.updateFavorite(canonical, siteId, body.data);
    if (!result.ok) {
      if (result.reason === "folder_not_found") { reply.code(400); return { error: "收藏夹不存在" }; }
      reply.code(404);
      return { error: "收藏不存在" };
    }
    return { ok: true, favorite: result.favorite };
  });

  /** 清空云端收藏（本地缓存由前端同步清掉） */
  app.delete("/api/favorites", async (req, reply) => {
    const identity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const removed = await ctx.repo.clearFavorites(canonical);
    return { ok: true, removed };
  });

  app.post("/api/favorites/folders", async (req, reply) => {
    const identity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const body = z.object({ name: z.string().min(1).max(30) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    // 同名去重（T16）：库里没有 (user_id,name) 唯一约束，直接建会产生重名夹；
    // 备份导入按名称复用既有夹，这里与导入语义对齐——同名返回既有夹并标记 existed。
    const normalizedName = body.data.name.trim().toLowerCase();
    const existing = (await ctx.repo.listFavoriteFolders(canonical)).find(
      (f) => f.name.trim().toLowerCase() === normalizedName,
    );
    if (existing) {
      return { ...existing, existed: true };
    }
    const folder = await ctx.repo.createFavoriteFolder(canonical, body.data.name);
    reply.code(201);
    return folder;
  });

  app.delete("/api/favorites/folders/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const identity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    await ctx.repo.deleteFavoriteFolder(canonical, id);
    return { ok: true };
  });

  /** 收藏夹改名 / 排序（收藏管理页拖拽重排与重命名共用） */
  app.patch("/api/favorites/folders/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const identity = requestIdentityOf(req as never);
    // 个人令牌写守卫（T20）：自建令牌 v1 只发 read，写自己的数据需 write scope
    if (!userDomainWriteAllowed(req as never)) { reply.code(403); return { error: "当前令牌为只读，无法执行写操作" }; }
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    if (!identityTrusted(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const canonical = await resolveCanonicalIdentity(ctx, identity);
    const body = z.object({
      name: z.string().trim().min(1).max(30).optional(),
      sort: z.number().int().optional(),
    }).refine((v) => v.name !== undefined || v.sort !== undefined, {
      message: "至少要修改 name 或 sort 之一",
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const result = await ctx.repo.updateFavoriteFolder(canonical, id, body.data);
    if (!result.ok) { reply.code(404); return { error: "收藏夹不存在" }; }
    return { ok: true, folder: result.folder };
  });

};
