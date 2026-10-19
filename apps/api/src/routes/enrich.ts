/**
 * AI 富化与自动入库
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { enrichUrl } from "@navhub/ai";
import { sanitizeIconUrl } from "@navhub/core";
import { indexSite } from "../index-site.ts";
import { enrichLlmOf, resolveLlm } from "../llm-config.ts";
import { identityOf } from "./shared.ts";

import type { AppContext } from "../context.ts";

export const enrichRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ---------------------------- AI 富化 ---------------------------- */

  app.post("/api/enrich", { config: { rateLimit: { max: 20, timeWindow: "1 minute" }, scope: "write" } }, async (req, reply) => {
    const body = z.object({ url: z.string().url() }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const categories = await ctx.repo.listCategories();
    const resolved = await resolveLlm(ctx, identityOf(req as never));
    const result = await enrichUrl(body.data.url, {
      llm: enrichLlmOf(resolved),
      guard: ctx.config.fetch,
      knownCategories: categories.map((c) => c.title),
    });
    // 遥测事件不阻断主操作（与其余 recordEvent 调用点保持一致的容错语义）
    await ctx.repo.recordEvent("enrich", { meta: { url: body.data.url, provenance: result.provenance } }).catch(() => undefined);
    return result;
  });

  /** 一步到位：抓取 + 富化 + 入库（AI 自动入库的核心接口） */
  app.post("/api/sites/auto", { config: { rateLimit: { max: 15, timeWindow: "1 minute" }, scope: "write" } }, async (req, reply) => {
    const body = z.object({
      url: z.string().url(),
      categoryId: z.string().optional(),
      tags: z.array(z.string()).max(50).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const dup = await ctx.repo.findSiteByUrl(body.data.url);
    if (dup) { return { created: false, reason: "已存在", site: dup }; }

    const categories = await ctx.repo.listCategories();
    const resolved = await resolveLlm(ctx, identityOf(req as never));
    const enriched = await enrichUrl(body.data.url, {
      llm: enrichLlmOf(resolved),
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
      // 富化抓的是目标站自带的 icon 声明：若指向第三方图标服务（icon.horse 等）不落库
      iconKey: sanitizeIconUrl(enriched.iconUrl),
      tags: body.data.tags ?? enriched.tags,
      source: "ai",
    });
    await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.auto", target: site.id, diff: { provenance: enriched.provenance } });
    reply.code(201);
    return { created: true, site, enrichment: enriched };
  });

};
