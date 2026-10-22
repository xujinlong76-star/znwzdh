/**
 * AI 富化与自动入库
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { enrichUrl } from "@navhub/ai";
import { httpUrl, resolveCategoryTitleSuggestion, sanitizeIconUrl } from "@navhub/core";
import { indexSite } from "../index-site.ts";
import { enrichLlmOf, resolveLlm } from "../llm-config.ts";
import { createEnrichUsageCallback } from "../llm-usage.ts";
import { identityOf } from "./shared.ts";

import type { AppContext } from "../context.ts";

export const enrichRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /* ---------------------------- AI 富化 ---------------------------- */

  app.post("/api/enrich", { config: { rateLimit: { max: 20, timeWindow: "1 minute" }, scope: "write" } }, async (req, reply) => {
    const body = z.object({ url: httpUrl() }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const categories = await ctx.repo.listCategories();
    const resolved = await resolveLlm(ctx, identityOf(req as never));
    const result = await enrichUrl(body.data.url, {
      llm: enrichLlmOf(resolved),
      guard: ctx.config.fetch,
      knownCategories: categories.map((c) => c.title),
      onLlmCall: createEnrichUsageCallback(ctx, resolved.source, identityOf(req as never)),
    });
    // 遥测事件不阻断主操作（与其余 recordEvent 调用点保持一致的容错语义）
    await ctx.repo.recordEvent("enrich", { meta: { url: body.data.url, provenance: result.provenance } }).catch(() => undefined);
    return result;
  });

  /** 一步到位：抓取 + 富化 + 入库（AI 自动入库的核心接口） */
  app.post("/api/sites/auto", { config: { rateLimit: { max: 15, timeWindow: "1 minute" }, scope: "write" } }, async (req, reply) => {
    const body = z.object({
      // enrichUrl 抓失败不抛、原样回传 url，伪协议会绕过抓取直接落库 → 必须在入口拦
      url: httpUrl(),
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
      onLlmCall: createEnrichUsageCallback(ctx, resolved.source, identityOf(req as never)),
    });

    // 分类解析：调用方指定 -> 富化建议匹配已有类目 -> 落「未分类」并产类目缺口提案
    let categoryId = body.data.categoryId ?? null;
    let gapTitle: string | null = null;
    let ambiguousCategoryIds: string[] = [];
    if (!categoryId && enriched.suggestedCategory) {
      const resolution = resolveCategoryTitleSuggestion(
        enriched.suggestedCategory,
        categories.map((c) => ({ id: c.id, title: c.title, altLabels: c.altLabels })),
      );
      if (resolution.status === "unique") categoryId = resolution.categoryId;
      else {
        gapTitle = enriched.suggestedCategory;
        if (resolution.status === "ambiguous") ambiguousCategoryIds = resolution.categoryIds;
      }
    }
    if (!categoryId) {
      categoryId = await ctx.repo.ensureUncategorized();
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
    // 建不建这个类目是编辑决策：模型自由发挥的名字直接进树 = 106 个平铺根的成因
    const categoryGap = gapTitle
      ? await ctx.repo.recordCategoryGap({ title: gapTitle, siteId: site.id, siteUrl: site.url, source: "AI 富化", ambiguousCategoryIds })
      : null;
    await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.auto", target: site.id, diff: { provenance: enriched.provenance, categoryGap: categoryGap?.proposalId ?? null } });
    reply.code(201);
    return { created: true, site, enrichment: enriched, categoryGap };
  });

};
