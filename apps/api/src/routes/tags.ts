/**
 * 标签管理路由 (Tags Management Routes)
 *
 * 负责标签云热度聚合、标签重命名、解绑删除与跨标签批量合并。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { AppContext } from "../context.ts";
import { badRequest, notFound } from "./shared.ts";

export const tagRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------------------------------------------------ *
   * 标签检索与热度云 (Tag Cloud Query)
   * ------------------------------------------------------------------ */

  /**
   * 标签云（带引用计数，按热度频次降序，支持 60s 缓存与 ETag 协商）
   */
  app.get(
    "/api/tags",
    { config: { scope: "public", cache: { maxAge: 60, etag: true } } },
    async (req) => {
      const q = (req.query ?? {}) as Record<string, string>;
      const minCount = Number(q.minCount);
      return ctx.repo.listTagsWithCounts(Number.isFinite(minCount) && minCount > 0 ? minCount : 1);
    }
  );

  /* ------------------------------------------------------------------ *
   * 标签修改与维护 (Tag Mutation & Lifecycle)
   * ------------------------------------------------------------------ */

  /**
   * 重命名标签
   */
  app.patch("/api/tags/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(1).max(24) }).safeParse(req.body ?? {});
    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    try {
      await ctx.repo.renameTag(id, body.data.name);
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "tag.rename",
        target: id,
        diff: { name: body.data.name },
      });
      return { ok: true };
    } catch (err) {
      return badRequest(reply, err instanceof Error ? err.message : String(err));
    }
  });

  /**
   * 删除标签：安全解除与全部关联站点的绑定后删除标签本身（不影响站点实体）
   */
  app.delete("/api/tags/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const result = await ctx.repo.deleteTag(id);
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "tag.delete",
        target: id,
        diff: result,
      });
      return { ok: true, ...result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/不存在/.test(msg)) {
        return notFound(reply, msg);
      }
      return badRequest(reply, msg);
    }
  });

  /**
   * 合并标签：将源标签下的所有站点关系归并到目标标签后删除源标签
   */
  app.post("/api/tags/merge", { config: { scope: "write" } }, async (req, reply) => {
    const body = z
      .object({ sourceId: z.string().min(1), targetId: z.string().min(1) })
      .safeParse(req.body ?? {});

    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    try {
      const result = await ctx.repo.mergeTags(body.data.sourceId, body.data.targetId);
      await ctx.repo.audit({
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "tag.merge",
        target: body.data.sourceId,
        diff: { into: body.data.targetId, ...result },
      });
      return { ok: true, ...result };
    } catch (err) {
      return badRequest(reply, err instanceof Error ? err.message : String(err));
    }
  });
};
