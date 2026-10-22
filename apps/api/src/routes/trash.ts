/**
 * 回收站（软删除与恢复）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";

import { indexSite } from "../index-site.ts";
import type { AppContext } from "../context.ts";

export const trashRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ---------------------------- 回收站 ---------------------------- */

  /** 回收站列表（软删站点，倒序） */
  app.get("/api/trash", { config: { scope: "read" } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    return { items: await ctx.repo.listDeletedSites(limit) };
  });

  /** 恢复软删站点；URL 已被新站点占用时拒绝（避免恢复出重复 URL） */
  app.post("/api/trash/:id/restore", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await ctx.repo.getDeletedSite(id);
    if (!deleted) { reply.code(404); return { error: "回收站中不存在该站点（可能已恢复或已永久删除）" }; }

    const clash = await ctx.repo.findSiteByUrl(deleted.url);
    if (clash) {
      reply.code(409);
      return { error: "同网址已存在新站点，无法恢复（可先删除新站点）", existingSiteId: clash.id };
    }

    // 若原类目在软删期间已被物理删除，安全回退至未分类（防孤儿站点）
    let fallbackCatId: string | undefined;
    if (deleted.categoryId) {
      const cat = await ctx.repo.getCategory(deleted.categoryId);
      if (!cat) {
        fallbackCatId = await ctx.repo.ensureUncategorized();
      }
    }

    let site = await ctx.repo.restoreSite(id);
    if (fallbackCatId && site) {
      site = await ctx.repo.updateSite(id, { categoryId: fallbackCatId });
    }
    // 向量在软删期间保留，恢复即生效；保险起见重建一次（幂等）
    await indexSite(ctx, site!.id, site!.title, site!.description ?? null, site!.url);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.restore", target: id });
    return site;
  });

  /** 永久删除：从回收站彻底清除（不可撤销） */
  app.delete("/api/trash/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = await ctx.repo.getDeletedSite(id);
    if (!deleted) { reply.code(404); return { error: "回收站中不存在该站点" }; }

    await ctx.repo.purgeSite(id);
    await ctx.vectors.remove([id]).catch(() => undefined);   // 永久删除才清向量
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.purge", target: id, diff: { url: deleted.url, title: deleted.title } });
    reply.code(204);
    return null;
  });

};
