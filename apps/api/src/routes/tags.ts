/**
 * 标签管理
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { AppContext } from "../context.ts";

export const tagRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------- 标签 ------------------------- */

  /** 标签云（带计数，按热度降序） */
  app.get("/api/tags", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const minCount = Number(q.minCount);
    return ctx.repo.listTagsWithCounts(Number.isFinite(minCount) && minCount > 0 ? minCount : 1);
  });

  app.patch("/api/tags/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(1).max(24) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    try {
      await ctx.repo.renameTag(id, body.data.name);
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "tag.rename", target: id, diff: { name: body.data.name } });
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * 删除标签：解除与所有站点的关联后删除标签本身（不影响站点数据）。
   * 标签不存在时返回 404——脚本重试时把 404 视作「已删除」即可。
   */
  app.delete("/api/tags/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await ctx.repo.deleteTag(id);
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "tag.delete", target: id, diff: result });
      return { ok: true, ...result };
    } catch (err) {
      reply.code(/不存在/.test(String(err)) ? 404 : 400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post("/api/tags/merge", { config: { scope: "write" } }, async (req, reply) => {
    const body = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    try {
      const result = await ctx.repo.mergeTags(body.data.sourceId, body.data.targetId);
      await ctx.repo.audit({
        actor: req.auth.actor, actorKind: req.auth.kind, action: "tag.merge",
        target: body.data.sourceId, diff: { into: body.data.targetId, ...result },
      });
      return { ok: true, ...result };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

};
