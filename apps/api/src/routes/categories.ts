/**
 * 类目与层级分类管理路由 (Category & Taxonomy Management Routes)
 *
 * 负责分类树查询、分类创建、增强属性编辑（PATCH）、无损级联删除、跨层级移动与合并。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { assertCategoryName } from "@navhub/core";
import type { AppContext } from "../context.ts";
import { badRequest, created, notFound } from "./shared.ts";

/**
 * 写入层守卫报错的统一出口。
 *
 * 命名规则（宽度/禁用轴）、同级重名、slug 撞库都从仓储层或 assertCategoryName
 * 抛出。它们本质是「客户端输入不合规」，必须是 400 而不是 500 —— 之前
 * move/merge 已经这么处理，创建/改名漏了。
 */
function guardMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const categoryRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ------------------------------------------------------------------ *
   * 基础类目 CRUD (Basic Categories Operations)
   * ------------------------------------------------------------------ */

  /**
   * 全量类目列表（公开可读，支持 60s 缓存与 ETag 协商）
   *
   * 无分页 = 全表；SKOS 导出与快照构建确实需要整棵树，所以这个口径保留。
   * 只要「一页 + 总数」的调用方走 /api/categories/page。
   *
   * `sharedMaxAge`：类目树对匿名请求是全体同一份，允许 CDN/反代在 60s 内复用
   * （带身份头或 cookie 的请求由 onSend 自动降级回 private，见 server.ts 的守卫）。
   */
  app.get(
    "/api/categories",
    { config: { scope: "public", cache: { maxAge: 60, sharedMaxAge: 60, staleWhileRevalidate: 30, etag: true } } },
    async () => ctx.repo.listCategories()
  );

  /**
   * 分页读取类目（公开）。limit 默认 200、上限 500，超界值收敛而不是报错，
   * 免得调用方把 0 或负数传进来拿到一个 500。
   *
   * `parentId=null`（或空串）= 只要根：查询串里只有字符串，所以显式归一化。
   */
  app.get(
    "/api/categories/page",
    { config: { scope: "public", cache: { maxAge: 60, sharedMaxAge: 60, staleWhileRevalidate: 30, etag: true } } },
    async (req, reply) => {
      const query = z
        .object({
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
          level: z.coerce.number().optional(),
          parentId: z
            .string()
            .transform((v) => (v === "" || v === "null" ? null : v))
            .optional(),
        })
        .safeParse(req.query ?? {});
      if (!query.success) {
        return badRequest(reply, "参数无效", query.error.issues);
      }
      return ctx.repo.listCategoriesPage(query.data);
    }
  );

  /**
   * 类目 → 存活站点数（一次 GROUP BY）。
   *
   * 存在的理由：此前展示层要数「每个类目有几个站点」只能翻 /api/sites
   * （5 页 × 1000 条）在前端 JS 里累加，超过 5000 站点静默少算，
   * 而达标判定（进不进导航/站点地图）正是用这个数。
   */
  app.get(
    "/api/categories/counts",
    { config: { scope: "public", cache: { maxAge: 60, sharedMaxAge: 60, staleWhileRevalidate: 30, etag: true } } },
    async () => ({ counts: await ctx.repo.categorySiteCounts() })
  );

  /**
   * 导出符合 W3C SKOS 规范的概念模型集合（供语义网与跨平台知识交换）
   */
  app.get(
    "/api/categories/skos",
    { config: { scope: "public", cache: { maxAge: 300, etag: true } } },
    async (req) => {
      const origin = `${req.protocol}://${req.hostname}/category/`;
      return ctx.repo.exportSkosConcepts(origin);
    }
  );

  /**
   * 按 slug 取单个类目（公开）。
   *
   * slug 是类目的对外标识（URL `/category/{slug}`），uuid 留在库里当内部主键。
   * 这条口子单独存在，是为了让调用方不必先拉全表再自己找——`/api/categories/:id`
   * 按 id 查，混用两种标识只会让两边的 404 语义互相污染。
   */
  app.get("/api/categories/by-slug/:slug", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const cat = await ctx.repo.getCategoryBySlug(slug);
    if (!cat) {
      return notFound(reply, "类目不存在");
    }
    return cat;
  });

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
   * 停用影响预览（只读）：这个类目一旦 enabled=false，会牵动多少下级与站点。
   *
   * 计数口径与类目页同源：
   * - 树来自 `listCategories()`，子树用物化路径 `anchor` 前缀聚合；
   * - 站点数来自 `categorySiteCounts()`（单主指针、active + enabled、未删），
   *   与 `/category/{slug}` 页面的达标计数一致（search 的 categoryId 过滤会展开后代）。
   *
   * 只返回**事实**，不在这里判断「几个公开 URL 会 404」：收录门槛
   * （MIN_SITES_FOR_CATEGORY_INDEX）只存在于 web 侧，由调用方用同一个常量推。
   * 不设缓存：站点归类和类目状态随时在变，确认框里的数字必须是最新的。
   */
  app.get("/api/categories/:id/impact", { config: { scope: "public" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const category = await ctx.repo.getCategory(id);
    if (!category) {
      return notFound(reply, "类目不存在");
    }
    const [all, counts] = await Promise.all([
      ctx.repo.listCategories(),
      ctx.repo.categorySiteCounts(),
    ]);
    const siteCount = new Map(counts.map((row) => [row.categoryId, row.sites] as const));
    const inSubtree = (anchor: string) =>
      anchor === category.anchor || anchor.startsWith(category.anchor + "/");
    const subtree = all.filter((c) => inSubtree(c.anchor));
    return {
      category: {
        id: category.id,
        title: category.title,
        slug: category.slug ?? null,
        enabled: category.enabled,
        parentId: category.parentId ?? null,
        anchor: category.anchor,
      },
      childCategories: all.filter((c) => c.parentId === category.id).length,
      descendantCategories: Math.max(0, subtree.length - 1),
      directSites: siteCount.get(category.id) ?? 0,
      subtreeSites: subtree.reduce((sum, c) => sum + (siteCount.get(c.id) ?? 0), 0),
    };
  });

  /**
   * 创建类目。
   *
   * slug 由服务端按英文名/标题生成，**不接受客户端传入**：URL 是对外资产，
   * registry 播种走仓储层显式传 slug，HTTP 这条口子上没有那个映射表可校验。
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
        altLabels: z.array(z.string()).max(50).optional(),
        relatedCategories: z.array(z.string()).max(50).optional(),
      })
      .safeParse(req.body ?? {});

    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    try {
      assertCategoryName({ title: body.data.title, titleEn: body.data.titleEn });
    } catch (err) {
      return badRequest(reply, guardMessage(err));
    }

    let cat;
    try {
      cat = await ctx.repo.createCategory({ ...body.data, source: "api" });
    } catch (err) {
      return badRequest(reply, guardMessage(err));
    }
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
    altLabels: z.array(z.string()).max(50).optional(),
    relatedCategories: z.array(z.string()).max(50).optional(),
  });

  /**
   * 部分更新类目属性（标题/图标/描述/状态/排序）
   *
   * 改名不重写 slug（外链已发出），slug 也不可从这里改；命名规则只在
   * 动了 title / titleEn 时校验，改图标描述不该被命名规则挡住。
   */
  app.patch("/api/categories/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = categoryPatchSchema.safeParse(req.body ?? {});
    if (!body.success) {
      return badRequest(reply, "参数无效", body.error.issues);
    }

    const before = await ctx.repo.getCategory(id);
    if (!before) {
      return notFound(reply, "类目不存在");
    }

    if (body.data.title !== undefined || body.data.titleEn !== undefined) {
      try {
        assertCategoryName({
          title: body.data.title ?? before.title,
          titleEn: body.data.titleEn === undefined ? before.titleEn : body.data.titleEn,
        });
      } catch (err) {
        return badRequest(reply, guardMessage(err));
      }
    }

    let cat;
    try {
      cat = await ctx.repo.updateCategory(id, body.data);
    } catch (err) {
      return badRequest(reply, guardMessage(err));
    }
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
        ip: req.ip,
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
