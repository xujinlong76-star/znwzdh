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
      const group = typeof q.group === "string" && q.group.trim() ? q.group.trim() : undefined;
      return ctx.repo.listTagsWithCounts(
        Number.isFinite(minCount) && minCount > 0 ? minCount : 1,
        group,
      );
    }
  );

  /**
   * 标签别名归一化解析 (SKOS Concept Resolver)
   */
  app.get("/api/tags/resolve", { config: { scope: "public" } }, async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const query = q.q?.trim();
    if (!query) return badRequest(reply, "缺少查询参数 q");
    const resolved = await ctx.repo.resolveTag(query);
    if (!resolved) return notFound(reply, `未找到与 "${query}" 匹配的规范标签`);
    return { ok: true, tag: resolved };
  });

  /* ------------------------------------------------------------------ *
   * 标签修改与维护 (Tag Mutation & Lifecycle)
   * ------------------------------------------------------------------ */

  /**
   * 重命名或更新标签属性（维度分组、颜色、描述）
   */
  app.patch("/api/tags/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).max(24).optional(),
        group: z.string().min(1).max(32).optional(),
        color: z.string().max(32).nullable().optional(),
        description: z.string().max(200).nullable().optional(),
      })
      .safeParse(req.body ?? {});

    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    try {
      await ctx.repo.updateTag(id, body.data);
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "tag.update",
        target: id,
        diff: body.data,
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

  /* ------------------------------------------------------------------ *
   * 标签别名管理 (Tag Aliases / SKOS altLabels)
   * ------------------------------------------------------------------ */

  /**
   * 为指定标签绑定别名（同义词/中英文变体/缩写）
   */
  app.post("/api/tags/:id/aliases", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ alias: z.string().min(1).max(40) }).safeParse(req.body ?? {});
    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    try {
      const result = await ctx.repo.addTagAlias(id, body.data.alias);
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "tag.alias.add",
        target: id,
        diff: { alias: result.alias },
      });
      return { ok: true, ...result };
    } catch (err) {
      return badRequest(reply, err instanceof Error ? err.message : String(err));
    }
  });

  /**
   * 解绑或删除指定标签别名
   */
  app.delete("/api/tags/:id/aliases/:alias", { config: { scope: "write" } }, async (req, reply) => {
    const { id, alias } = req.params as { id: string; alias: string };
    try {
      const decodedAlias = decodeURIComponent(alias);
      await ctx.repo.removeTagAlias(decodedAlias);
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "tag.alias.remove",
        target: id,
        diff: { alias: decodedAlias },
      });
      return { ok: true };
    } catch (err) {
      return badRequest(reply, err instanceof Error ? err.message : String(err));
    }
  });
};
