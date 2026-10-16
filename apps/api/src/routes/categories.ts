/**
 * 类目管理（含增强分类）
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { AppContext } from "../context.ts";

export const categoryRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

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

};
