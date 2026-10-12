/**
 * NavHub 中枢服务（Fastify）。
 *
 * 设计原则：
 *  - 所有响应都带 capability 信息，让前端能如实提示「语义检索是否可用」，
 *    而不是在缺模型时静默返回更差的结果。
 *  - 写操作全部走 zod 校验 + 审计落库。
 *  - MCP 与 REST 共用同一套仓储与检索引擎（见 packages/mcp）。
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { enrichUrl } from "@navhub/ai";
import type { AppContext } from "./context.ts";
import { createContext } from "./context.ts";
import { loadConfig } from "./config.ts";
import { readStoragePath, writeStoragePath } from "./storage.ts";

export async function buildServer(ctx: AppContext) {
  // 测试里默认静音，避免日志淹没断言输出；生产用 NAVHUB_LOG_LEVEL 控制
  const logLevel = process.env.NAVHUB_LOG_LEVEL ?? (process.env.VITEST ? "silent" : "info");
  const app = Fastify({ logger: { level: logLevel }, bodyLimit: 4 * 1024 * 1024 });

  await app.register(cors, {
    origin: ctx.config.corsOrigins.includes("*") ? true : ctx.config.corsOrigins,
    credentials: true,
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  /* ---------------------------- 健康与能力 ---------------------------- */

  app.get("/api/health", async () => ({
    ok: true,
    mode: ctx.config.mode,
    capabilities: ctx.capabilities,
    stats: await ctx.repo.stats(),
  }));

  /**
   * 显式预热 embedding 模型。
   * 默认惰性加载（不拖慢启动），需要时可主动调用（例如部署完成后预热）。
   */
  app.post("/api/warmup", async () => {
    const t0 = Date.now();
    if (!ctx.embedding) return { ok: false, reason: "embedding 未启用" };
    const ok = await ctx.embedding.warmup();
    return { ok, tookMs: Date.now() - t0, model: ctx.config.embedding.model, dim: ctx.config.embedding.dim };
  });

  /* ------------------------------ 检索 ------------------------------ */

  /**
   * 注意：同一个 schema 要同时服务于 GET（query string，值全是字符串）
   * 和 POST（JSON，值有原生类型）。
   * 因此数字与布尔必须用 coerce 解析，否则 GET /api/search?limit=3 会因为
   * "expected number, received string" 被直接拒绝 —— 这是最容易漏掉的坑。
   */
  const queryBool = z.union([z.boolean(), z.enum(["true", "false", "1", "0"])]).transform((v) => v === true || v === "true" || v === "1");

  const searchBody = z.object({
    q: z.string().default(""),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    categoryId: z.string().optional(),
    tag: z.string().optional(),
    disableSemantic: queryBool.optional(),
    disablePersonal: queryBool.optional(),
    /** 身份标识：登录用户传 canonical userId，匿名传 anonId（前端 localStorage 生成）。
     *  服务端据此解析个性化信号——调用方不传 signals，避免伪造与多端不一致。 */
    userId: z.string().max(64).optional(),
    anonId: z.string().max(64).optional(),
    personalize: z.object({
      topCategories: z.array(z.string()).optional(),
      topTags: z.array(z.string()).optional(),
      visitedSiteIds: z.array(z.string()).optional(),
    }).optional(),
  });

  app.get("/api/search", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const parsed = searchBody.safeParse(req.query ?? {});
    if (!parsed.success) return { error: "参数无效", detail: parsed.error.issues };
    return runSearch(parsed.data);
  });

  app.post("/api/search", async (req) => {
    const parsed = searchBody.safeParse(req.body ?? {});
    if (!parsed.success) return { error: "参数无效", detail: parsed.error.issues };
    return runSearch(parsed.data);
  });

  async function runSearch(input: z.infer<typeof searchBody>) {
    // 个性化信号服务端解析：身份 -> user_profiles -> personalize。
    // 显式传 personalize 的调用方（测试 / MCP）优先，保持向后兼容。
    let personalize = input.personalize;
    const identity = input.userId ?? input.anonId ?? null;
    if (!personalize && identity) {
      const profile = await ctx.repo.getUserProfile(identity);
      if (profile && (profile.topCategories.length > 0 || profile.topTags.length > 0 || profile.visitedSiteIds.length > 0)) {
        personalize = {
          topCategories: profile.topCategories,
          topTags: profile.topTags,
          visitedSiteIds: profile.visitedSiteIds,
        };
      }
    }

    const result = await ctx.search.search({ ...input, personalize });
    const hits = await Promise.all(result.hits.map(async (h) => ({
      ...h,
      site: await ctx.repo.getSite(h.siteId),
    })));

    const q = input.q.trim();
    if (q) {
      // 搜索事件（现有行为）+ 零结果事件（指导补录）+ 搜索历史（匿名也可）
      await ctx.repo.recordEvent("search", { query: q }).catch(() => undefined);
      if (result.hits.length === 0) {
        await ctx.repo.recordEvent("zero_result", { query: q }).catch(() => undefined);
      }
      if (identity) {
        await ctx.repo.recordSearch(identity, q, result.hits.length).catch(() => undefined);
      }
    }
    return { ...result, hits };
  }

  /* ------------------------------ 站点 ------------------------------ */

  app.get("/api/sites", async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    return ctx.repo.listSites({
      categoryId: q.categoryId,
      status: q.status as never,
      limit: q.limit && Number.isFinite(Number(q.limit)) ? Number(q.limit) : undefined,
    });
  });

  app.get("/api/sites/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    return site;
  });

  const siteInput = z.object({
    url: z.string().url(),
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    categoryId: z.string().min(1),
    subCategoryId: z.string().nullable().optional(),
    iconKey: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    status: z.enum(["active", "pending", "broken", "archived"]).optional(),
    featured: z.boolean().optional(),
    source: z.string().nullable().optional(),
  });

  app.post("/api/sites", async (req, reply) => {
    const parsed = siteInput.safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400); return { error: "参数无效", detail: parsed.error.issues }; }

    // URL 去重：导航站最常见的脏数据来源
    const dup = await ctx.repo.findSiteByUrl(parsed.data.url);
    if (dup) { reply.code(409); return { error: "该网址已存在", siteId: dup.id, site: dup }; }

    const site = await ctx.repo.createSite({
      ...parsed.data,
      title: parsed.data.title ?? parsed.data.url,
    });
    await indexSite(site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ actor: "api", action: "site.create", target: site.id, diff: parsed.data });
    reply.code(201);
    return site;
  });

  app.patch("/api/sites/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = siteInput.partial().safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400); return { error: "参数无效", detail: parsed.error.issues }; }
    const before = await ctx.repo.getSite(id);
    const site = await ctx.repo.updateSite(id, parsed.data);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    await indexSite(site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ actor: "api", action: "site.update", target: id, diff: { before, after: parsed.data } });
    return site;
  });

  app.delete("/api/sites/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await ctx.repo.deleteSite(id);
    await ctx.vectors.remove([id]).catch(() => undefined);
    await ctx.repo.audit({ actor: "api", action: "site.delete", target: id });
    reply.code(204);
    return null;
  });

  /* ------------------------------ 类目 ------------------------------ */

  app.get("/api/categories", async () => ctx.repo.listCategories());

  app.post("/api/categories", async (req, reply) => {
    const body = z.object({
      title: z.string().min(1),
      parentId: z.string().nullable().optional(),
      icon: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      sort: z.number().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const cat = await ctx.repo.createCategory({ ...body.data, source: "api" });
    await ctx.repo.audit({ actor: "api", action: "category.create", target: cat.id });
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

  app.patch("/api/categories/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = categoryPatch.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const before = await ctx.repo.getCategory(id);
    const cat = await ctx.repo.updateCategory(id, body.data);
    if (!cat) { reply.code(404); return { error: "类目不存在" }; }
    await ctx.repo.audit({ actor: "api", action: "category.update", target: id, diff: { before, after: body.data } });
    return cat;
  });

  /**
   * 删除类目：站点移入「未分类」（不级联删除），子类目提升到父级。
   * 这修正了旧行为——曾经删除类目会把它下面的站点一起删掉。
   */
  app.delete("/api/categories/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await ctx.repo.getCategory(id);
    if (!before) { reply.code(404); return { error: "类目不存在" }; }
    await ctx.repo.deleteCategory(id);
    await ctx.repo.audit({ actor: "api", action: "category.delete", target: id, diff: { title: before.title } });
    reply.code(204);
    return null;
  });

  /** 移动类目（换父级，anchor 级联更新） */
  app.post("/api/categories/:id/move", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ parentId: z.string().nullable() }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    try {
      const cat = await ctx.repo.moveCategory(id, body.data.parentId);
      if (!cat) { reply.code(404); return { error: "类目不存在" }; }
      await ctx.repo.audit({ actor: "api", action: "category.move", target: id, diff: { parentId: body.data.parentId } });
      return cat;
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** 合并类目：源（含后代）站点迁入目标后删源子树 */
  app.post("/api/categories/merge", async (req, reply) => {
    const body = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    try {
      const result = await ctx.repo.mergeCategories(body.data.sourceId, body.data.targetId);
      await ctx.repo.audit({
        actor: "api", action: "category.merge",
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
  app.get("/api/tags", async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const minCount = Number(q.minCount);
    return ctx.repo.listTagsWithCounts(Number.isFinite(minCount) && minCount > 0 ? minCount : 1);
  });

  app.patch("/api/tags/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(1).max(24) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    try {
      await ctx.repo.renameTag(id, body.data.name);
      await ctx.repo.audit({ actor: "api", action: "tag.rename", target: id, diff: { name: body.data.name } });
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post("/api/tags/merge", async (req, reply) => {
    const body = z.object({ sourceId: z.string().min(1), targetId: z.string().min(1) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    try {
      const result = await ctx.repo.mergeTags(body.data.sourceId, body.data.targetId);
      await ctx.repo.audit({
        actor: "api", action: "tag.merge",
        target: body.data.sourceId, diff: { into: body.data.targetId, ...result },
      });
      return { ok: true, ...result };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /* ----------------------- 精选专题 ----------------------- */

  app.get("/api/collections", async () => ctx.repo.listCollections());

  app.get("/api/collections/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const col = await ctx.repo.getCollectionBySlug(slug);
    if (!col) { reply.code(404); return { error: "专题不存在" }; }
    return { collection: col, sites: await ctx.repo.listCollectionSites(slug) };
  });

  /* --------------------- 收藏夹（终端用户） --------------------- */

  /**
   * 身份由调用方传入（登录用户的 canonical userId，或前端 localStorage 里的 anonId）。
   * 说明：这是个人导航站的轻量方案——不引入终端用户鉴权体系；
   * 多用户公开场景应改为 Bearer token（api_tokens 表已具备能力）。
   */
  const favoriteInput = z.object({
    siteId: z.string().min(1),
    folderId: z.string().nullable().optional(),
    note: z.string().max(200).nullable().optional(),
  });

  function identityOf(req: { query: Record<string, unknown>; body: unknown }): string | null {
    const fromQuery = (req.query ?? {}) as Record<string, string>;
    const fromBody = (req.body ?? {}) as Record<string, string>;
    return fromQuery.userId ?? fromQuery.anonId ?? fromBody.userId ?? fromBody.anonId ?? null;
  }

  app.get("/api/favorites", async (req) => {
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    const items = await ctx.repo.listFavorites(identity);
    const folders = await ctx.repo.listFavoriteFolders(identity);
    const sites = await Promise.all(items.map((f) => ctx.repo.getSite(f.siteId)));
    return {
      items: items.map((f, i) => ({ ...f, site: sites[i] })),
      folders,
    };
  });

  app.post("/api/favorites", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    const body = favoriteInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const site = await ctx.repo.getSite(body.data.siteId);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    const { favorite, existed } = await ctx.repo.addFavorite({
      userId: identity,
      siteId: body.data.siteId,
      folderId: body.data.folderId ?? null,
      note: body.data.note ?? null,
    });
    await ctx.repo.recordEvent("favorite", { siteId: body.data.siteId, meta: { identity } }).catch(() => undefined);
    reply.code(existed ? 200 : 201);
    return { favorite, existed };
  });

  app.delete("/api/favorites/:siteId", async (req) => {
    const { siteId } = req.params as { siteId: string };
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    const removed = await ctx.repo.removeFavorite(identity, siteId);
    if (removed) {
      await ctx.repo.recordEvent("unfavorite", { siteId, meta: { identity } }).catch(() => undefined);
    }
    return { ok: true, removed };
  });

  app.post("/api/favorites/folders", async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) { reply.code(400); return { error: "缺少 userId 或 anonId" }; }
    const body = z.object({ name: z.string().min(1).max(30) }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const folder = await ctx.repo.createFavoriteFolder(identity, body.data.name);
    reply.code(201);
    return folder;
  });

  app.delete("/api/favorites/folders/:id", async (req) => {
    const { id } = req.params as { id: string };
    const identity = identityOf(req as never);
    if (!identity) return { error: "缺少 userId 或 anonId" };
    await ctx.repo.deleteFavoriteFolder(identity, id);
    return { ok: true };
  });

  /* ------------------------ 推荐排序 ------------------------ */

  /** 热度榜（trend_score 由 recompute_rank 任务重算） */
  app.get("/api/rank/trending", async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 20, 100);
    const sites = await ctx.repo.hotSites(limit);
    return {
      hits: sites.map((s) => ({
        site: s,
        // 可解释的热度分量：前端 tooltip 展示「为什么排在这儿」
        trend: { visits: s.visitCount ?? 0, trendScore: s.trendScore ?? 0, lastVisitedAt: s.lastVisitedAt ?? null },
      })),
    };
  });

  /** 新品榜 */
  app.get("/api/rank/new", async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 20, 100);
    return { hits: (await ctx.repo.newestSites(limit)).map((s) => ({ site: s })) };
  });

  /** 相似站点（向量 KNN，零新依赖的相关推荐） */
  app.get("/api/rank/similar/:siteId", async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 6, 20);
    if (!ctx.embedding || !ctx.vectors) {
      return { hits: [], semanticAvailable: false, reason: "语义检索不可用" };
    }
    try {
      const vec = await ctx.repo.getEmbedding(siteId);
      if (!vec) return { hits: [], semanticAvailable: true, reason: "该站点暂无向量" };
      const matches = await ctx.vectors.search(vec, limit + 1);
      const hits = await Promise.all(
        matches
          .filter((m) => m.siteId !== siteId)
          .slice(0, limit)
          .map(async (m) => ({ site: await ctx.repo.getSite(m.siteId), distance: m.distance })),
      );
      return { hits: hits.filter((h) => h.site), semanticAvailable: true };
    } catch {
      // 模型不可用不该让推荐端点 5xx
      return { hits: [], semanticAvailable: false, reason: "向量检索失败" };
    }
  });

  /* ------------------------ 搜索历史 ------------------------ */

  app.get("/api/search-history", async (req) => {
    const identity = identityOf(req as never);
    if (!identity) return { items: [] };
    const q = (req.query ?? {}) as Record<string, string>;
    const limit = Math.min(Number(q.limit) || 10, 50);
    return { items: await ctx.repo.listSearchHistory(identity, limit) };
  });

  app.delete("/api/search-history", async (req) => {
    const identity = identityOf(req as never);
    if (!identity) return { ok: false, error: "缺少 userId 或 anonId" };
    await ctx.repo.clearSearchHistory(identity);
    return { ok: true };
  });

  /* --------------------- 终端用户身份同步 --------------------- */

  /**
   * OAuth 登录后由 Web 前端调用：把 GitHub 身份 upsert 进 users 表，
   * 返回 canonical userId（后续收藏夹 / 画像都用它，保证多端一致）。
   */
  app.post("/api/users/sync", async (req, reply) => {
    const body = z.object({
      provider: z.string().min(1).default("github"),
      providerId: z.string().min(1),
      username: z.string().min(1).max(64),
      email: z.string().email().nullable().optional(),
      avatar: z.string().url().nullable().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const user = await ctx.repo.upsertOauthUser({
      id: body.data.provider + ":" + body.data.providerId,
      username: body.data.username,
      email: body.data.email ?? null,
      avatar: body.data.avatar ?? null,
    });
    return user;
  });

  /* ------------------------ 运营统计 ------------------------ */

  app.get("/api/admin/stats/trends", async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const days = Math.min(Math.max(Number(q.days) || 30, 1), 365);
    const [top, zero, hot] = await Promise.all([
      ctx.repo.topQueries(days, 20),
      ctx.repo.zeroResultQueries(days, 20),
      ctx.repo.hotSites(20),
    ]);
    return { days, topQueries: top, zeroResultQueries: zero, hotSites: hot };
  });

  /* ---------------------------- AI 富化 ---------------------------- */

  app.post("/api/enrich", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({ url: z.string().url() }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const categories = await ctx.repo.listCategories();
    const result = await enrichUrl(body.data.url, {
      llm: ctx.config.llm,
      guard: ctx.config.fetch,
      knownCategories: categories.map((c) => c.title),
    });
    await ctx.repo.recordEvent("enrich", { meta: { url: body.data.url, provenance: result.provenance } });
    return result;
  });

  /** 一步到位：抓取 + 富化 + 入库（AI 自动入库的核心接口） */
  app.post("/api/sites/auto", { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({
      url: z.string().url(),
      categoryId: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const dup = await ctx.repo.findSiteByUrl(body.data.url);
    if (dup) { return { created: false, reason: "已存在", site: dup }; }

    const categories = await ctx.repo.listCategories();
    const enriched = await enrichUrl(body.data.url, {
      llm: ctx.config.llm,
      guard: ctx.config.fetch,
      knownCategories: categories.map((c) => c.title),
    });

    // 分类解析：调用方指定 -> 富化建议匹配已有类目 -> 自动新建
    let categoryId = body.data.categoryId ?? null;
    if (!categoryId && enriched.suggestedCategory) {
      categoryId = categories.find((c) => c.title === enriched.suggestedCategory)?.id ?? null;
    }
    if (!categoryId) {
      const created = await ctx.repo.createCategory({ title: enriched.suggestedCategory ?? "未分类" });
      categoryId = created.id;
    }

    const site = await ctx.repo.createSite({
      url: enriched.url,
      title: enriched.title,
      description: enriched.description,
      categoryId,
      iconKey: enriched.iconUrl,
      tags: body.data.tags ?? enriched.tags,
      source: "ai",
    });
    await indexSite(site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ actor: "api", action: "site.auto", target: site.id, diff: { provenance: enriched.provenance } });
    reply.code(201);
    return { created: true, site, enrichment: enriched };
  });

  /* ------------------------------ 统计 ------------------------------ */

  app.get("/api/stats", async () => ctx.repo.stats());

  /**
   * 事件上报（前端点击/收藏等行为）。
   * kind 白名单：防止脏 kind 污染画像聚合与统计。
   * click 事件联动 visit_count（热度排序的原始信号）。
   */
  const EVENT_KINDS = ["click", "favorite", "unfavorite", "impression", "dismiss"] as const;

  app.post("/api/events", async (req) => {
    const body = z.object({
      kind: z.enum(EVENT_KINDS),
      siteId: z.string().optional(),
      query: z.string().optional(),
      categoryId: z.string().optional(),
      /** 身份标识（登录 userId 或匿名 anonId），用于归属画像聚合 */
      userId: z.string().max(64).optional(),
      anonId: z.string().max(64).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) return { error: "参数无效", detail: body.error.issues };
    const identity = body.data.userId ?? body.data.anonId ?? null;
    await ctx.repo.recordEvent(body.data.kind, {
      siteId: body.data.siteId,
      query: body.data.query,
      categoryId: body.data.categoryId,
      meta: identity ? { identity } : undefined,
    });
    if (body.data.kind === "click" && body.data.siteId) {
      await ctx.repo.bumpVisit(body.data.siteId).catch(() => undefined);
    }
    return { ok: true };
  });

  /* ------------------- NavSphere 兼容存储 API ------------------- */
  /**
   * 这两个端点就是「不修改前端 69 处调用点」的全部秘密。
   *
   * NavSphere 的 getFileContent(path) / commitFile(path, content) 只要改成打这里，
   * 整个后台（增删改查、拖拽排序、投稿审核）就自动落到真实数据库上。
   * path 沿用它的原值（如 src/navsphere/content/navigation.json），前端连常量都不用改。
   */
  app.get("/api/storage", async (req, reply) => {
    const path = String((req.query as Record<string, string>)?.path ?? "");
    if (!path) { reply.code(400); return { error: "缺少 path 参数" }; }
    return readStoragePath(ctx, path);
  });

  app.put("/api/storage", async (req, reply) => {
    const body = z.object({
      path: z.string().min(1),
      content: z.string(),
      message: z.string().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    try {
      const result = await writeStoragePath(ctx, body.data.path, body.data.content);
      await ctx.repo.audit({ actor: "web", action: "storage.write", target: body.data.path, diff: { note: result.note } });
      return result;
    } catch (err) {
      reply.code(400);
      return { error: "写入失败", detail: err instanceof Error ? err.message : String(err) };
    }
  });

  /* --------------------------- 内部工具 --------------------------- */

  /**
   * 为站点建立检索线索：拼音 + 向量。
   * 向量写入失败不算错误（模型可能不可用），但要在 notes 里可见，避免静默失效。
   */
  async function indexSite(id: string, title: string, description: string | null, url: string) {
    if (!ctx.embedding) return;
    try {
      const { siteEmbeddingText } = await import("@navhub/ai");
      const { hashSiteId } = await import("@navhub/store");
      const vec = await ctx.embedding.encode(siteEmbeddingText({ title, description, url }));
      await ctx.vectors.upsert([{ key: hashSiteId(id), siteId: id, vector: vec }]);
      await ctx.repo.saveEmbedding(id, ctx.config.embedding.model, vec);
    } catch (err) {
      ctx.capabilities.notes.push("站点 " + id + " 向量化失败：" + (err instanceof Error ? err.message : String(err)));
    }
  }

  return app;
}

/* ------------------------------------------------------------------ */

if (import.meta.url === ("file://" + process.argv[1]?.replace(/\\/g, "/"))) {
  const config = loadConfig();
  const ctx = await createContext(config);
  const app = await buildServer(ctx);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "正在关闭");
    await app.close();
    await ctx.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.port, host: config.host });
  app.log.info({ mode: config.mode, capabilities: ctx.capabilities }, "NavHub 已启动");
}
