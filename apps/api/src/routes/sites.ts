/**
 * 站点 CRUD
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { canonicalizeUrl, sanitizeIconUrl, SiteCreateBody } from "@navhub/core";
import { enrichUrl } from "@navhub/ai";
import { indexSite } from "../index-site.ts";
import { enrichLlmOf, resolveLlm } from "../llm-config.ts";
import { createEnrichUsageCallback } from "../llm-usage.ts";
import { identityOf } from "./shared.ts";
import type { AppContext } from "../context.ts";

export const siteRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * status 查询白名单：与 core 的 SiteStatus 取值保持一致。
   * 此前 `status: q.status as never` 把任意字符串直接透进仓储过滤条件——既无意义
   * 也绕过了类型约束，这里收敛为「命中白名单才生效，否则视为不过滤」。
   */
  const SITE_STATUS_FILTERS = ["active", "pending", "broken", "archived"] as const;
  const parseStatusFilter = (v: unknown): (typeof SITE_STATUS_FILTERS)[number] | undefined =>
    typeof v === "string" && (SITE_STATUS_FILTERS as readonly string[]).includes(v)
      ? (v as (typeof SITE_STATUS_FILTERS)[number])
      : undefined;

  /* ------------------------------ 站点 ------------------------------ */

  // 注意：保持返回数组（不包 {items,hasMore}）：前端多处按数组消费，改结构会破坏兼容。
  // 默认 limit 100、上限 1000 防全表扫；offset 分页支持。
  app.get("/api/sites", { config: { scope: "read", cache: { maxAge: 60, etag: true } } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 1000);
    const offset = Math.max(0, Number(q.offset) || 0);
    let facets: Record<string, string[]> | undefined = undefined;
    if (q.facets) {
      try {
        facets = typeof q.facets === "string"
          ? (JSON.parse(q.facets) as Record<string, string[]>)
          : (q.facets as Record<string, string[]>);
      } catch {
        // ignore
      }
    }
    return ctx.repo.listSites({
      categoryId: typeof q.categoryId === "string" ? q.categoryId : undefined,
      status: parseStatusFilter(q.status),
      source: typeof q.source === "string" ? q.source : undefined,
      facets,
      limit,
      offset,
    });
  });

  // 说明：URL 形态查询走本路由即可，前提是调用方对 URL 做 encodeURIComponent
  // （实测 `/api/sites/https%3A%2F%2Fchatgpt.com` → 200；不编码的原始 URL
  //  `/api/sites/https://chatgpt.com` 会被切成多段 → 404，属 HTTP 路由固有行为）。
  app.get("/api/sites/:id", { config: { scope: "public" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    return site;
  });

  /**
   * 站点写入体不再本地手写：与 MCP 的 create_site 工具共用同一份 zod 契约
   * （packages/core/src/mcp-schemas.ts 的 SiteCreateBody，由 CreateSiteInput 派生）。
   * OpenAPI 的 requestBody 也从同一份契约生成，三处不会再各自漂移。
   */
  const siteInput = SiteCreateBody;

  app.post("/api/sites", { config: { scope: "write" } }, async (req, reply) => {
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    // 兼容客户端（如浏览器插件）在 POST /api/sites 时传入 enrich: true 且未指定有效 categoryId 的自动富化入库调用
    if (rawBody.enrich === true && (!rawBody.categoryId || typeof rawBody.categoryId !== "string")) {
      const url = typeof rawBody.url === "string" ? rawBody.url.trim() : "";
      if (!url) { reply.code(400); return { error: "缺少 URL 参数" }; }
      const dup = await ctx.repo.findSiteByUrl(url);
      if (dup) { reply.code(409); return { error: "该网址已存在", siteId: dup.id, site: dup, created: false, reason: "已存在" }; }
      const categories = await ctx.repo.listCategories();
      const resolved = await resolveLlm(ctx, identityOf(req as never));
      const enriched = await enrichUrl(url, {
        llm: enrichLlmOf(resolved),
        guard: ctx.config.fetch,
        knownCategories: categories.map((c) => c.title),
        onLlmCall: createEnrichUsageCallback(ctx, resolved.source, identityOf(req as never)),
      });
      let categoryId = enriched.suggestedCategory
        ? categories.find((c) => c.title === enriched.suggestedCategory)?.id ?? null
        : null;
      if (!categoryId) {
        const created = await ctx.repo.createCategory({ title: enriched.suggestedCategory ?? "未分类" });
        categoryId = created.id;
      }
      const site = await ctx.repo.createSite({
        url: enriched.url,
        title: (typeof rawBody.title === "string" && rawBody.title.trim()) ? rawBody.title.trim() : enriched.title,
        description: enriched.description,
        categoryId,
        // 富化抓的是目标站自带的 icon 声明：若指向第三方图标服务（icon.horse 等）不落库
        iconKey: sanitizeIconUrl(enriched.iconUrl),
        tags: Array.isArray(rawBody.tags) ? (rawBody.tags as string[]) : enriched.tags,
        source: "ai",
      });
      await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.auto", target: site.id, diff: { provenance: enriched.provenance } });
      reply.code(201);
      return site;
    }

    const parsed = siteInput.safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400); return { error: "参数无效", detail: parsed.error.issues }; }

    // URL 去重：导航站最常见的脏数据来源
    const dup = await ctx.repo.findSiteByUrl(parsed.data.url);
    if (dup) { reply.code(409); return { error: "该网址已存在", siteId: dup.id, site: dup }; }

    const site = await ctx.repo.createSite({
      ...parsed.data,
      title: parsed.data.title ?? parsed.data.url,
    });
    await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.create", target: site.id, diff: parsed.data });
    reply.code(201);
    return site;
  });

  app.patch("/api/sites/:id", { config: { scope: "write" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = siteInput.partial().safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400); return { error: "参数无效", detail: parsed.error.issues }; }
    const before = await ctx.repo.getSite(id);
    const site = await ctx.repo.updateSite(id, parsed.data);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.update", target: id, diff: { before, after: parsed.data } });
    return site;
  });

  /** 删除 = 软删除（进回收站）。向量与标签都保留，恢复时无需重建索引 */
  app.delete("/api/sites/:id", { config: { scope: "admin" } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await ctx.repo.deleteSite(id);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.delete", target: id });
    reply.code(204);
    return null;
  });

  /**
   * 批量操作：移动类目 / 改状态 / 删除（软删）。
   *
   * 语义对齐 MCP 的 batch_import：**dryRun 默认 true**，先返回将要做出的改动，
   * 确认后再以 dryRun=false 执行——批量删除是不可逆面最大的操作，默认不落库。
   * scope 用 admin（≥ write）：操作集含删除，按最危险的成员定级。
   */
  app.post("/api/sites/bulk", { config: { scope: "admin" } }, async (req, reply) => {
    const body = z.object({
      op: z.enum(["delete", "setCategory", "setStatus"]),
      ids: z.array(z.string().min(1)).min(1).max(200),
      categoryId: z.string().optional(),
      status: z.enum(["active", "pending", "broken", "archived"]).optional(),
      dryRun: z.boolean().default(true),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const { op, ids, dryRun } = body.data;
    if (op === "setCategory" && !body.data.categoryId) { reply.code(400); return { error: "setCategory 需要 categoryId" }; }
    if (op === "setStatus" && !body.data.status) { reply.code(400); return { error: "setStatus 需要 status" }; }

    // 逐个解析存在性：不存在的 id 计入 plan 的 skip，不整批失败——
    // 批量场景下部分目标已被人删掉是常态，报错会让操作方无法完成剩余部分
    // 批量存在性检查一次 IN 查询（原逐个 getSite 是 N+1）
    const plan: Array<{ id: string; action: "apply" | "skip"; reason?: string }> = [];
    const targets: string[] = [];
    const existMap = await ctx.repo.getSitesByIds(ids);
    for (const id of ids) {
      if (!existMap.has(id)) { plan.push({ id, action: "skip", reason: "站点不存在或已在回收站" }); continue; }
      plan.push({ id, action: "apply" });
      targets.push(id);
    }
    if (dryRun) {
      return { dryRun: true, op, total: ids.length, wouldApply: targets.length, plan };
    }

    let applied = 0;
    // 事务包裹批量写：中途失败整体回滚，避免半删半改；软删保留向量（恢复无需重建）。
    await ctx.repo.withTransaction(async () => {
    for (const id of targets) {
      if (op === "delete") {
        await ctx.repo.deleteSite(id);
      } else if (op === "setCategory") {
        await ctx.repo.updateSite(id, { categoryId: body.data.categoryId });
      } else {
        await ctx.repo.updateSite(id, { status: body.data.status });
      }
      applied++;
    }
    });
    await ctx.repo.audit({
      ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind,
      action: "site.bulk", diff: { op, requested: ids.length, applied, skipped: ids.length - applied },
    });
    return { dryRun: false, op, applied, skipped: ids.length - applied, plan };
  });

  /**
   * 批量创建/导入站点（供书签导入器与批量脚本使用）。
   * 内部自动处理 URL 去重与分类回退，大幅降低并发 HTTP 往返与限流风险。
   */
  app.post("/api/sites/batch", { config: { scope: "write", rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({
      sites: z.array(z.object({
        url: z.string().url(),
        title: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        categoryId: z.string().optional(),
        tags: z.array(z.string()).max(50).optional(),
        source: z.string().optional(),
      })).min(1).max(200),
      defaultCategoryId: z.string().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const cats = await ctx.repo.listCategories();
    const catIdSet = new Set(cats.map((c) => c.id));
    let fallback = (body.data.defaultCategoryId && catIdSet.has(body.data.defaultCategoryId))
      ? body.data.defaultCategoryId
      : (cats[0]?.id ?? (await ctx.repo.createCategory({ title: "未分类" })).id);
    // 若新建了“未分类”，把新分类 id 加入集合
    catIdSet.add(fallback);

    let created = 0;
    let duplicates = 0;
    const createdSites: Array<Awaited<ReturnType<typeof ctx.repo.createSite>>> = [];

    // DB 写入包事务（去重检查 + 创建原子提交）；向量索引在提交后补做，避免长事务持有写锁。
    await ctx.repo.withTransaction(async () => {
    for (const item of body.data.sites) {
      const cleanUrl = canonicalizeUrl(item.url);
      const dup = await ctx.repo.findSiteByUrl(cleanUrl);
      if (dup) {
        duplicates++;
        continue;
      }
      const categoryId = (item.categoryId && catIdSet.has(item.categoryId)) ? item.categoryId : fallback;
      const site = await ctx.repo.createSite({
        url: cleanUrl,
        title: item.title ?? item.url,
        description: item.description ?? null,
        categoryId,
        tags: item.tags ?? [],
        source: item.source ?? "import",
      });
      createdSites.push(site);
      created++;
    }
    });
    for (const site of createdSites) {
      await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    }

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "site.batch",
      diff: { total: body.data.sites.length, created, duplicates },
    });

    reply.code(201);
    return { success: true, created, duplicates, sites: createdSites };
  });

};
