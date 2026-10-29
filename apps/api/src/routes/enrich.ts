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
import { checkLlmQuota } from "../llm-quota.ts";
import { selectEnrichmentFields } from "../enrich-fields.ts";
import { requestIdentityOf, identityTrusted } from "./shared.ts";

import type { AppContext } from "../context.ts";

export const enrichRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 富化用的身份与额度。
   *
   * 两个口径都必须走这里，原因是历史上各错过一次：
   *  1. **第二轴**。`identityOf` 是调用方**自称**的身份；没过 `identityTrusted`
   *     就把它交给 `resolveLlm`，等价于「自称 `github:<别人>` 就能解出那个人存的
   *     个人 API Key 跑这次富化」，而且用量记在别人账上（ copilot 同一段教训）。
   *  2. **单次取值**。`requestIdentityOf(req)` 调两次（一次取 key、一次记账）在理论上
   *     可以拿到不同值——花的是 A 的 key、记的是 B 的账。收成一份。
   *
   * 额度不足时**不报错**：`enrichUrl` 的元数据抽取本来就能出标题/描述/图标，
   * 只是少了 AI 归纳的分类与标签。降级成「只用抓取」比拒绝整次提交有用得多，
   * 前提是响应里如实标出 `aiSkipped`。
   */
  async function enrichBudget(req: {
    query: Record<string, unknown>;
    body: unknown;
    headers?: Record<string, string | undefined>;
    auth?: { kind?: string };
  }): Promise<{ identity: string | null; llmBlocked: boolean; quotaInfo: Record<string, unknown> | null }> {
    const identity = identityTrusted(ctx, req as never) ? requestIdentityOf(req as never) : null;
    const quota = await checkLlmQuota(ctx, identity);
    if (quota.ok) return { identity, llmBlocked: false, quotaInfo: null };
    return {
      identity,
      llmBlocked: true,
      quotaInfo: {
        scope: quota.error.scope,
        metric: quota.error.metric,
        limit: quota.error.limit,
        used: quota.error.used,
        retryAfterSeconds: Math.max(1, Math.ceil(quota.error.retryAfterMs / 1000)),
      },
    };
  }

  /* ---------------------------- AI 富化 ---------------------------- */

  app.post("/api/enrich", { config: { rateLimit: { max: 20, timeWindow: "1 minute" }, scope: "write" } }, async (req, reply) => {
    const body = z.object({ url: httpUrl() }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const categories = await ctx.repo.listCategories();
    const budget = await enrichBudget(req as never);
    const resolved = await resolveLlm(ctx, budget.identity);
    const result = await enrichUrl(body.data.url, {
      llm: enrichLlmOf(resolved),
      guard: ctx.config.fetch,
      knownCategories: categories.map((c) => c.title),
      // 额度到顶：只用抓取，不碰模型（也就不再产生花费）
      heuristicOnly: budget.llmBlocked,
      onLlmCall: createEnrichUsageCallback(ctx, resolved.source, budget.identity),
    });
    // 遥测事件不阻断主操作（与其余 recordEvent 调用点保持一致的容错语义）
    await ctx.repo.recordEvent("enrich", { meta: { url: body.data.url, provenance: result.provenance } }).catch(() => undefined);
    return budget.llmBlocked ? { ...result, aiSkipped: "quota" as const, quota: budget.quotaInfo } : result;
  });

  /** 一步到位：抓取 + 富化 + 入库（AI 自动入库的核心接口） */
  app.post("/api/sites/auto", { config: { rateLimit: { max: 15, timeWindow: "1 minute" }, scope: "write" } }, async (req, reply) => {
    const body = z.object({
      // enrichUrl 抓失败不抛、原样回传 url，伪协议会绕过抓取直接落库 → 必须在入口拦
      url: httpUrl(),
      categoryId: z.string().optional(),
      tags: z.array(z.string()).max(50).optional(),
      // 建站必须有标题：取消 title 字段时必须自带标题（见 enrich-fields 的取舍说明）
      title: z.string().min(1).max(120).optional(),
      description: z.string().optional(),
      /** 只应用哪些富化字段；不传 = 全应用（旧行为） */
      enrichFields: z.array(z.string()).max(10).optional(),
    }).safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const dup = await ctx.repo.findSiteByUrl(body.data.url);
    if (dup) { return { created: false, reason: "已存在", site: dup }; }

    const categories = await ctx.repo.listCategories();
    const budget = await enrichBudget(req as never);
    const resolved = await resolveLlm(ctx, budget.identity);
    const enriched = await enrichUrl(body.data.url, {
      llm: enrichLlmOf(resolved),
      guard: ctx.config.fetch,
      knownCategories: categories.map((c) => c.title),
      heuristicOnly: budget.llmBlocked,
      onLlmCall: createEnrichUsageCallback(ctx, resolved.source, budget.identity),
    });

    // 分类解析：调用方指定 -> 富化建议匹配已有类目 -> 落「未分类」并产类目缺口提案。
    // 「富化建议」只有在调用方把 category 选进 enrichFields 时才参与：取消该字段
    // 就是不想让模型碰类目，这时也不该再拿它的建议去记一条类目缺口提案。
    const selection = selectEnrichmentFields(enriched, body.data.enrichFields);
    const titleToUse = body.data.title ?? selection.applied.title;
    if (!titleToUse) {
      reply.code(400);
      return { error: "取消 title 字段时必须显式提供 title", appliedFields: selection.appliedFields, skippedFields: selection.skipped };
    }

    let categoryId = body.data.categoryId ?? null;
    let gapTitle: string | null = null;
    let ambiguousCategoryIds: string[] = [];
    if (!categoryId && selection.applied.category) {
      const resolution = resolveCategoryTitleSuggestion(
        selection.applied.category,
        categories.map((c) => ({ id: c.id, title: c.title, altLabels: c.altLabels })),
      );
      if (resolution.status === "unique") categoryId = resolution.categoryId;
      else {
        gapTitle = selection.applied.category;
        if (resolution.status === "ambiguous") ambiguousCategoryIds = resolution.categoryIds;
      }
    }
    if (!categoryId) {
      categoryId = await ctx.repo.ensureUncategorized();
    }

    const site = await ctx.repo.createSite({
      url: enriched.url,
      title: titleToUse,
      description: body.data.description ?? selection.applied.description,
      categoryId,
      // 富化抓的是目标站自带的 icon 声明：若指向第三方图标服务（icon.horse 等）不落库
      iconKey: selection.applied.iconUrl ? sanitizeIconUrl(selection.applied.iconUrl) : null,
      tags: body.data.tags ?? selection.applied.tags,
      source: "ai",
    });
    // 建不建这个类目是编辑决策：模型自由发挥的名字直接进树 = 106 个平铺根的成因
    const categoryGap = gapTitle
      ? await ctx.repo.recordCategoryGap({ title: gapTitle, siteId: site.id, siteUrl: site.url, source: "AI 富化", ambiguousCategoryIds })
      : null;
    await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.auto", target: site.id, diff: { provenance: enriched.provenance, categoryGap: categoryGap?.proposalId ?? null, aiSkipped: budget.llmBlocked ? "quota" : null, appliedFields: selection.appliedFields, skippedFields: selection.skipped } });
    reply.code(201);
    return {
      created: true,
      site,
      enrichment: enriched,
      categoryGap,
      // 审核界面与调用方都要能对上账：哪些字段真的写进去了、哪些因为没值被跳过
      appliedFields: selection.appliedFields,
      skippedFields: selection.skipped,
      ignoredFields: selection.ignoredFields,
      ...(budget.llmBlocked ? { aiSkipped: "quota" as const, quota: budget.quotaInfo } : {}),
    };
  });

};
