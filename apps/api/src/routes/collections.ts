/**
 * 精选专题与条目管理路由 (Collections & Curated Topics Routes)
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { badRequest, conflict, created, notFound } from "./shared.ts";

export const collectionRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ----------------------- 精选专题列表与详情 ----------------------- */

  /**
   * 专题列表
   * 公开只读，默认只返回启用中的专题；all=1 (或 all=true) 返回全部（含停用草稿），此模式下关闭缓存
   */
  app.get("/api/collections", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const showAll = q.all === "1" || q.all === "true";
    if (showAll) {
      reply.header("cache-control", "no-store");
      return ctx.repo.listCollections(false);
    }
    return ctx.repo.listCollections(true);
  });

  /**
   * 按 ID 获取专题详情及关联条目（供管理端专用）
   */
  app.get("/api/collections/by-id/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const col = await ctx.repo.getCollectionById(id);
    if (!col) return notFound(reply, "专题不存在");
    const items = await ctx.repo.listCollectionItemsDetail(id);
    return { collection: col, items };
  });

  /**
   * 按 slug 获取公开专题详情及包含的站点列表
   */
  app.get("/api/collections/:slug", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const col = await ctx.repo.getCollectionBySlug(slug);
    if (!col || !col.enabled) {
      return notFound(reply, "专题不存在或已下架");
    }
    const sites = await ctx.repo.listCollectionSites(slug);
    return { collection: col, sites };
  });

  /**
   * 查询指定站点所属的精选专题
   */
  app.get("/api/sites/:id/collections", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req) => {
    const { id } = req.params as { id: string };
    return ctx.repo.listSiteCollections(id, true);
  });

  /* ----------------------- 精选专题管理 (写操作) ----------------------- */

  const collectionCreateSchema = z.object({
    slug: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().nullable().optional(),
    kind: z.enum(["topic", "geo", "roadmap"]).optional(),
    icon: z.string().nullable().optional(),
    sort: z.number().optional(),
    enabled: z.boolean().optional(),
    sites: z.array(z.string()).optional(),
  });

  app.post("/api/collections", { config: { scope: "write" } }, async (req, reply) => {
    const parsed = collectionCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return badRequest(reply, "参数无效", parsed.error.issues);
    }

    const slug = parsed.data.slug.toLowerCase();
    const existing = await ctx.repo.getCollectionBySlug(slug);
    if (existing) {
      return conflict(reply, `专题 slug「${slug}」已存在`);
    }

    const col = await ctx.repo.upsertCollection({
      ...parsed.data,
      slug,
    });

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "collection.create",
      target: col.id,
    });

    return created(reply, col);
  });

  const collectionPatchSchema = z.object({
    slug: z.string().trim().min(1).max(100).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().nullable().optional(),
    kind: z.enum(["topic", "geo", "roadmap"]).optional(),
    icon: z.string().nullable().optional(),
    sort: z.number().optional(),
    enabled: z.boolean().optional(),
  });

  app.patch("/api/collections/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = collectionPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return badRequest(reply, "参数无效", parsed.error.issues);
    }

    const before = await ctx.repo.getCollectionById(id);
    if (!before) {
      return notFound(reply, "专题不存在");
    }

    try {
      const updated = await ctx.repo.updateCollection(id, parsed.data);
      if (!updated) return notFound(reply, "专题不存在");

      await ctx.repo.audit({
        ip: req.ip,
        actor: req.auth.actor,
        actorKind: req.auth.kind,
        action: "collection.update",
        target: id,
      });

      return updated;
    } catch (err) {
      return badRequest(reply, err instanceof Error ? err.message : String(err));
    }
  });

  app.delete("/api/collections/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.repo.getCollectionById(id);
    if (!before) {
      return notFound(reply, "专题不存在");
    }

    await ctx.repo.deleteCollection(id);

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "collection.delete",
      target: id,
    });

    return { ok: true, id };
  });

  /* ----------------------- 专题内站点条目管理 ----------------------- */

  const itemAddSchema = z.object({
    siteId: z.string().trim().min(1),
    note: z.string().trim().nullable().optional(),
    sort: z.number().optional(),
  });

  app.post("/api/collections/:id/items", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const col = await ctx.repo.getCollectionById(id);
    if (!col) return notFound(reply, "专题不存在");

    const parsed = itemAddSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return badRequest(reply, "参数无效", parsed.error.issues);
    }

    let siteId = parsed.data.siteId;
    const site = await ctx.repo.getSite(siteId);
    if (!site) {
      return notFound(reply, `未找到目标站点：${siteId}`);
    }
    siteId = site.id;

    await ctx.repo.addCollectionItem(id, siteId, parsed.data.note, parsed.data.sort);

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "collection.item.add",
      target: `${id}:${siteId}`,
    });

    return { ok: true, collectionId: id, siteId };
  });

  const itemPatchSchema = z.object({
    note: z.string().trim().nullable().optional(),
    sort: z.number().optional(),
  });

  app.patch("/api/collections/:id/items/:siteId", { config: { scope: "write" } }, async (req, reply) => {
    const { id, siteId } = req.params as { id: string; siteId: string };
    const col = await ctx.repo.getCollectionById(id);
    if (!col) return notFound(reply, "专题不存在");

    const parsed = itemPatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return badRequest(reply, "参数无效", parsed.error.issues);
    }

    const ok = await ctx.repo.updateCollectionItem(id, siteId, parsed.data);
    if (!ok) return notFound(reply, "专题条目不存在");

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "collection.item.update",
      target: `${id}:${siteId}`,
    });

    return { ok: true, collectionId: id, siteId };
  });

  app.delete("/api/collections/:id/items/:siteId", { config: { scope: "write" } }, async (req, reply) => {
    const { id, siteId } = req.params as { id: string; siteId: string };
    const col = await ctx.repo.getCollectionById(id);
    if (!col) return notFound(reply, "专题不存在");

    await ctx.repo.removeCollectionItem(id, siteId);

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "collection.item.remove",
      target: `${id}:${siteId}`,
    });

    return { ok: true, collectionId: id, siteId };
  });
};
