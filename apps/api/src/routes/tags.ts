/**
 * 标签管理路由 (Tags Management Routes)
 *
 * 负责标签云热度聚合、标签重命名、解绑删除与跨标签批量合并。
 */
import type { FastifyPluginAsync } from "fastify";

import { TagAliasInput, TagMergeInput, TagUpdateInput } from "@navhub/core";
import type { AppContext } from "../context.ts";
import { safeDecodeParam, badRequest, notFound } from "./shared.ts";

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
      // limit 此前被静默忽略（web 端 tag-cloud 传了 limit=100 从未生效，report §七-4）。
      // 不分页会让标签云一次拉满全量标签；上限 200 防 SSR 一次拉爆。
      const lim = Number(q.limit);
      const limit = Number.isFinite(lim) && lim > 0 ? Math.min(200, Math.trunc(lim)) : undefined;
      const tags = await ctx.repo.listTagsWithCounts(
        Number.isFinite(minCount) && minCount > 0 ? minCount : 1,
        group,
      );
      return typeof limit === "number" ? tags.slice(0, limit) : tags;
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

  /**
   * 标签共现相关标签（修复标签页的浏览死胡同）。
   *
   * 之前整套代码对标签共现零实现：用户在「React」标签页看完站点后，
   * 没有任何路径通往「Vue / Next.js / 前端框架」这类相邻主题，标签页成了
   * 信息组织的终点。这里聚合 site_tags 的共现（见 store 的 listRelatedTags），
   * 按共享存活站点数降序返回 top-N。
   *
   * 入参接受 slug 或 id（与 /api/tags/resolve 同口径，但只读主表 id/slug，
   * 不踩别名）：页面 URL 段是 slug 形态，先 getRawTag 归一成 id 再聚合。
   * limit 上限 50（防 SSR 一次拉爆；默认 12 是标签页卡片一排的量级）。
   */
  app.get("/api/tags/:id/related", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const ref = String((req.params as { id: string }).id || "").trim();
    if (!ref) return badRequest(reply, "缺少标签标识");
    const tag = await ctx.repo.getRawTag(ref);
    if (!tag) return notFound(reply, "未找到该标签");
    const q = (req.query ?? {}) as Record<string, string>;
    const lim = Number(q.limit);
    const limit = Number.isFinite(lim) && lim > 0 ? Math.min(50, Math.trunc(lim)) : 12;
    const related = await ctx.repo.listRelatedTags(tag.id, limit);
    return { ok: true, tagId: tag.id, tagSlug: tag.slug, related };
  });


  /* ------------------------------------------------------------------ *
   * 标签修改与维护 (Tag Mutation & Lifecycle)
   * ------------------------------------------------------------------ */

  /**
   * 重命名或更新标签属性（维度分组、颜色、描述）
   */
  app.patch("/api/tags/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = TagUpdateInput.safeParse(req.body ?? {});

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
    const body = TagMergeInput.safeParse(req.body ?? {});

    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    try {
      const result = await ctx.repo.mergeTags(body.data.sourceId, body.data.targetId);
      await ctx.repo.audit({
        ip: req.ip,
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
    const body = TagAliasInput.safeParse(req.body ?? {});
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
      const decodedAlias = safeDecodeParam(alias);
      await ctx.repo.removeTagAlias(decodedAlias, id);
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
