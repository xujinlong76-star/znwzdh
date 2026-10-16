/**
 * 收藏夹（终端用户）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { identityOf } from "./shared.ts";

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
  });



  app.get("/api/favorites", async (req) => {
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    const items = await ctx.repo.listFavorites(identity);
    const folders = await ctx.repo.listFavoriteFolders(identity);
    // 批量取站点（同 runSearch 的 N+1 优化）
    const favSiteMap = await ctx.repo.getSitesByIds(items.map((f) => f.siteId));
    const sites = items.map((f) => favSiteMap.get(f.siteId) ?? null);
    return {
      items: items.map((f, i) => ({ ...f, site: sites[i] })),
      folders,
    };
  });

  app.post("/api/favorites", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    const body = favoriteInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const site = await ctx.repo.getSite(body.data.siteId);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    const { favorite, existed } = await ctx.repo.addFavorite({
      userId: identity,
      siteId: body.data.siteId,
      folderId: body.data.folderId ?? null,
      note: body.data.note ?? null,
    });
    await ctx.repo.recordEvent("favorite", { siteId: body.data.siteId, meta: { identity } }).catch(() => undefined);
    reply.code(existed ? 200 : 201);
    return { favorite, existed };
  });

  app.delete("/api/favorites/:siteId", async (req) => {
    const { siteId } = req.params as { siteId: string };
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    const removed = await ctx.repo.removeFavorite(identity, siteId);
    if (removed) {
      await ctx.repo.recordEvent("unfavorite", { siteId, meta: { identity } }).catch(() => undefined);
    }
    return { ok: true, removed };
  });

  app.post("/api/favorites/folders", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    const body = z.object({ name: z.string().min(1).max(30) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const folder = await ctx.repo.createFavoriteFolder(identity, body.data.name);
    reply.code(201);
    return folder;
  });

  app.delete("/api/favorites/folders/:id", async (req) => {
    const { id } = req.params as { id: string };
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    await ctx.repo.deleteFavoriteFolder(identity, id);
    return { ok: true };
  });

};
