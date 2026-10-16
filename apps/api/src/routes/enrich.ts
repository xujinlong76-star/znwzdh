import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { enrichUrl } from "@navhub/ai";
import { type RetrievalChannel } from "@navhub/core";
import { readStoragePath, writeStoragePath } from "../storage.ts";
import { indexSite } from "../index-site.ts";
import { refreshUserProfile } from "../profile-service.ts";
import type { AppContext } from "../context.ts";

export function registerEnrichRoutes(app: FastifyInstance, ctx: AppContext): void {
  /* ---------------------------- AI 富化 ---------------------------- */

  app.post("/api/enrich", { config: { rateLimit: { max: 20, timeWindow: "1 minute" }, scope: "write" } }, async (req, reply) => {
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
  app.post("/api/sites/auto", { config: { rateLimit: { max: 15, timeWindow: "1 minute" }, scope: "write" } }, async (req, reply) => {
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
    await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.auto", target: site.id, diff: { provenance: enriched.provenance } });
    reply.code(201);
    return { created: true, site, enrichment: enriched };
  });

  /* ------------------------------ 统计 ------------------------------ */

  app.get("/api/stats", { config: { scope: "read" } }, async () => ctx.repo.stats());

  /**
   * 事件上报（前端点击/收藏等行为）。
   * kind 白名单：防止脏 kind 污染画像聚合与统计。
   * click 事件联动 visit_count（热度排序的原始信号）。
   */
  const EVENT_KINDS = ["click", "favorite", "unfavorite", "impression", "dismiss"] as const;

  app.post("/api/events", async (req, reply) => {
    const body = z.object({
      kind: z.enum(EVENT_KINDS),
      siteId: z.string().optional(),
      query: z.string().optional(),
      categoryId: z.string().optional(),
      channel: z.enum(["exact", "fts", "pinyin", "semantic", "personal"]).optional(),
      dwellSeconds: z.number().min(0).max(3600).optional(),
      interactionType: z.enum(["click", "copy", "bounce"]).optional(),
      /** 身份标识（登录 userId 或匿名 anonId），用于归属画像聚合 */
      userId: z.string().max(64).optional(),
      anonId: z.string().max(64).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
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
    // 在线强化学习闭环：若带有搜索词，实时反馈更新 Discounted-LinUCB 通道权重
    if (body.data.query && (body.data.kind === "click" || body.data.kind === "favorite" || body.data.kind === "dismiss")) {
      const targetChannel: RetrievalChannel = body.data.channel ?? "exact";
      const explicitReward =
        body.data.kind === "favorite" ? 2.0 : body.data.kind === "dismiss" ? -0.5 : undefined;
      ctx.search.recordFeedback(targetChannel, body.data.query, {
        reward: explicitReward,
        dwellSeconds: body.data.dwellSeconds,
        interactionType: body.data.interactionType,
      });
    }
    // 行为变化 -> 刷新个性化画像（节流 60s，失败静默）
    if (identity && (body.data.kind === "click" || body.data.kind === "favorite" || body.data.kind === "unfavorite")) {
      void refreshUserProfile(ctx, identity);
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
  app.get("/api/storage", { config: { scope: "read" } }, async (req, reply) => {
    const path = String((req.query as Record<string, string>)?.path ?? "");
    if (!path) { reply.code(400); return { error: "缺少 path 参数" }; }
    return readStoragePath(ctx, path);
  });

  app.put("/api/storage", { config: { scope: "write" } }, async (req, reply) => {
    const body = z.object({
      path: z.string().min(1),
      content: z.string(),
      message: z.string().optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    try {
      const result = await writeStoragePath(ctx, body.data.path, body.data.content);
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "storage.write", target: body.data.path, diff: { note: result.note } });
      return result;
    } catch (err) {
      reply.code(400);
      return { error: "写入失败", detail: err instanceof Error ? err.message : String(err) };
    }
  });
}
