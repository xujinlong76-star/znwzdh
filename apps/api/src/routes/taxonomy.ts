import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";

export function registerTaxonomyRoutes(app: FastifyInstance, ctx: AppContext): void {
  /* ------------------------------ 类目 ------------------------------ */

  app.get("/api/categories", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async () => ctx.repo.listCategories());

  app.get("/api/categories/:id", { config: { scope: "public" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cat = await ctx.repo.getCategory(id);
    if (!cat) { reply.code(404); return { error: "类目不存在" }; }
    return cat;
  });

  app.post("/api/categories", { config: { scope: "write" } }, async (req, reply) => {
    const body = z.object({
      title: z.string().min(1),
      parentId: z.string().nullable().optional(),
      icon: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      sort: z.number().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const cat = await ctx.repo.createCategory({ ...body.data, source: "api" });
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "category.create", target: cat.id });
    reply.code(201);
    return cat;
  });

  /* --------------------- 分类管理（增强） --------------------- */

  const categoryPatch = z.object({
    title: z.string().min(1).optional(),
    titleEn: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    sort: z.number().optional(),
  });

  app.patch("/api/categories/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = categoryPatch.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const before = await ctx.repo.getCategory(id);
    const cat = await ctx.repo.updateCategory(id, body.data);
    if (!cat) { reply.code(404); return { error: "类目不存在" }; }
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "category.update", target: id, diff: { before, after: body.data } });
    return cat;
  });

  /**
   * 删除类目：站点移入「未分类」（不级联删除），子类目提升到父级。
   * 这修正了旧行为——曾经删除类目会把它下面的站点一起删掉。
   */
  app.delete("/api/categories/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.repo.getCategory(id);
    if (!before) { reply.code(404); return { error: "类目不存在" }; }
    await ctx.repo.deleteCategory(id);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "category.delete", target: id, diff: { title: before.title } });
    reply.code(204);
    return null;
  });

  /** 移动类目（换父级，anchor 级联更新） */
  app.post("/api/categories/:id/move", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ parentId: z.string().nullable() }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    try {
      const cat = await ctx.repo.moveCategory(id, body.data.parentId);
      if (!cat) { reply.code(404); return { error: "类目不存在" }; }
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "category.move", target: id, diff: { parentId: body.data.parentId } });
      return cat;
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** 合并类目：源（含后代）站点迁入目标后删源子树 */
  app.post("/api/categories/merge", { config: { scope: "write" } }, async (req, reply) => {
    const body = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    try {
      const result = await ctx.repo.mergeCategories(body.data.sourceId, body.data.targetId);
      await ctx.repo.audit({
        actor: req.auth.actor, actorKind: req.auth.kind, action: "category.merge",
        target: body.data.sourceId, diff: { into: body.data.targetId, ...result },
      });
      return { ok: true, ...result };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

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

  /* ----------------------- 精选专题 ----------------------- */

  app.get("/api/collections", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async () => ctx.repo.listCollections());

  app.get("/api/collections/:slug", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const col = await ctx.repo.getCollectionBySlug(slug);
    if (!col) { reply.code(404); return { error: "专题不存在" }; }
    return { collection: col, sites: await ctx.repo.listCollectionSites(slug) };
  });
}
