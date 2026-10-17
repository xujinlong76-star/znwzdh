/**
 * 类目与层级分类管理路由 (Category & Taxonomy Management Routes)
 *
 * 负责分类树查询、分类创建、增强属性编辑（PATCH）、无损级联删除、跨层级移动与合并。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { AppContext } from "../context.ts";
import { badRequest, created, notFound } from "./shared.ts";

export const categoryRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------------------------------------------------ *
   * 基础类目 CRUD (Basic Categories Operations)
   * ------------------------------------------------------------------ */

  /**
   * 全量类目列表（公开可读，支持 60s 缓存与 ETag 协商）
   */
  app.get(
    "/api/categories",
    { config: { scope: "public", cache: { maxAge: 60, etag: true } } },
    async () => ctx.repo.listCategories()
  );

  /**
   * 导出符合 W3C SKOS 规范的概念模型集合（供语义网与跨平台知识交换）
   */
  app.get(
    "/api/categories/skos",
    { config: { scope: "public", cache: { maxAge: 300, etag: true } } },
    async (req) => {
      const origin = `${req.protocol}://${req.hostname}/categories/`;
      return ctx.repo.exportSkosConcepts(origin);
    }
  );

  /**
   * 获取单个类目详情
   */
  app.get("/api/categories/:id", { config: { scope: "public" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cat = await ctx.repo.getCategory(id);
    if (!cat) {
      return notFound(reply, "类目不存在");
    }
    return cat;
  });

  /**
   * 获取类目的语义关联概念（打破单一树形孤岛）
   */
  app.get("/api/categories/:id/related", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const semantic = await ctx.repo.getCategoryWithSemantic(id);
    if (!semantic) {
      return notFound(reply, "类目不存在");
    }
    return semantic;
  });

  /**
   * 创建类目
   */
  app.post("/api/categories", { config: { scope: "write" } }, async (req, reply) => {
    const body = z
      .object({
        title: z.string().min(1),
        titleEn: z.string().nullable().optional(),
        parentId: z.string().nullable().optional(),
        icon: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        sort: z.number().optional(),
        altLabels: z.array(z.string()).optional(),
        relatedCategories: z.array(z.string()).optional(),
      })
      .safeParse(req.body ?? {});

    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    const cat = await ctx.repo.createCategory({ ...body.data, source: "api" });
    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "category.create",
      target: cat.id,
    });

    return created(reply, cat);
  });

  /* ------------------------------------------------------------------ *
   * 分类增强与树形重排 (Taxonomy Refactor & Movements)
   * ------------------------------------------------------------------ */

  const categoryPatchSchema = z.object({
    title: z.string().min(1).optional(),
    titleEn: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    sort: z.number().optional(),
    altLabels: z.array(z.string()).optional(),
    relatedCategories: z.array(z.string()).optional(),
  });

  /**
   * 部分更新类目属性（标题/图标/描述/状态/排序）
   */
  app.patch("/api/categories/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = categoryPatchSchema.safeParse(req.body ?? {});
    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    const before = await ctx.repo.getCategory(id);
    const cat = await ctx.repo.updateCategory(id, body.data);
    if (!cat) {
      return notFound(reply, "类目不存在");
    }

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "category.update",
      target: id,
      diff: { before, after: body.data },
    });

    return cat;
  });

  /**
   * 安全删除类目：旗下站点自动移入「未分类」（不级联删除），子类目提升至父级
   */
  app.delete("/api/categories/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.repo.getCategory(id);
    if (!before) {
      return notFound(reply, "类目不存在");
    }

    await ctx.repo.deleteCategory(id);
    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "category.delete",
      target: id,
      diff: { title: before.title },
    });

    reply.code(204);
    return null;
  });

  /**
   * 移动类目（变更父级节点，锚点自动级联更新）
   */
  app.post("/api/categories/:id/move", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ parentId: z.string().nullable() }).safeParse(req.body ?? {});
    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    try {
      const cat = await ctx.repo.moveCategory(id, body.data.parentId);
      if (!cat) {
        return notFound(reply, "类目不存在");
      }
      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "category.move",
        target: id,
        diff: { parentId: body.data.parentId },
      });
      return cat;
    } catch (err) {
      return badRequest(reply, err instanceof Error ? err.message : String(err));
    }
  });

  /**
   * 合并类目：将源类目（含其子树）站点整体迁入目标类目后安全删除源分类
   */
  app.post("/api/categories/merge", { config: { scope: "write" } }, async (req, reply) => {
    const body = z
      .object({ sourceId: z.string().min(1), targetId: z.string().min(1) })
      .safeParse(req.body ?? {});

    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    try {
      const result = await ctx.repo.mergeCategories(body.data.sourceId, body.data.targetId);
      await ctx.repo.audit({
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "category.merge",
        target: body.data.sourceId,
        diff: { into: body.data.targetId, ...result },
      });
      return { ok: true, ...result };
    } catch (err) {
      return badRequest(reply, err instanceof Error ? err.message : String(err));
    }
  });
};
