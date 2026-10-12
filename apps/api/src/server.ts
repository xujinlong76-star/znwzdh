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

  const searchBody = z.object({
    q: z.string().default(""),
    limit: z.number().int().min(1).max(100).optional(),
    categoryId: z.string().optional(),
    tag: z.string().optional(),
    disableSemantic: z.boolean().optional(),
    disablePersonal: z.boolean().optional(),
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
    const result = await ctx.search.search(input);
    const hits = await Promise.all(result.hits.map(async (h) => ({
      ...h,
      site: await ctx.repo.getSite(h.siteId),
    })));
    if (input.q.trim()) {
      await ctx.repo.recordEvent("search", { query: input.q.trim() }).catch(() => undefined);
    }
    return { ...result, hits };
  }

  /* ------------------------------ 站点 ------------------------------ */

  app.get("/api/sites", async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    return ctx.repo.listSites({
      categoryId: q.categoryId,
      status: q.status as never,
      limit: q.limit ? Number(q.limit) : undefined,
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
    const cat = await ctx.repo.createCategory(body.data);
    await ctx.repo.audit({ actor: "api", action: "category.create", target: cat.id });
    reply.code(201);
    return cat;
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

  app.post("/api/events", async (req) => {
    const body = z.object({
      kind: z.string().min(1),
      siteId: z.string().optional(),
      query: z.string().optional(),
      categoryId: z.string().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) return { error: "参数无效" };
    await ctx.repo.recordEvent(body.data.kind, body.data);
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
