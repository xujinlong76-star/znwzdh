/**
 * 站点 CRUD
 *
 * 由 server.ts 单体按域拆分而来（升级改造方案 P1-3，行为与原实现逐字节一致）。
 */
import type { FastifyPluginAsync } from "fastify";

import {
  canonicalizeUrl,
  httpUrl,
  resolveCategoryTitleSuggestion,
  sanitizeIconUrl,
  SiteBatchInput,
  SiteBulkInput,
  SiteCreateBody,
  UNCATEGORIZED_CATEGORY_ID,
} from "@navhub/core";
import { AGNES_IMAGE_MODEL, enrichUrl, generateImage } from "@navhub/ai";
import { indexSite, indexSitesBatch } from "../index-site.ts";
import { enrichLlmOf, resolveLlm } from "../llm-config.ts";
import { callLlm, createEnrichUsageCallback } from "../llm-usage.ts";
import { reserveLlmQuota, settleLlmQuota } from "../llm-quota.ts";
import { selectEnrichmentFields } from "../enrich-fields.ts";
import { badRequest, canSeeUnpublishedSites, clampFacets, requestIdentityOf, identityTrusted } from "./shared.ts";
import { isPubliclyVisibleSite } from "../storage.ts";
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
  app.get("/api/sites", { config: { scope: "read", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 1000);
    const offset = Math.max(0, Number(q.offset) || 0);
    const facetFilter = clampFacets(q.facets);
    if (facetFilter.error) return badRequest(reply, "参数无效", facetFilter.error);
    const requestedStatus = parseStatusFilter(q.status);
    /**
     * 数据面最小化：只读集成方看不到 pending / archived。
     *
     * 待审与已归档是编辑工作面的中间态（可能还没上线、或已下架），
     * 不属于 read 令牌应有的可见范围。显式指定这两种状态时返回空集
     * 而不是报错：调用方无权知道它们是否存在，404/403 会反过来泄露存在性。
     */
    const maySeeUnpublished = canSeeUnpublishedSites(ctx, req as never);
    if (!maySeeUnpublished && requestedStatus && requestedStatus !== "active" && requestedStatus !== "broken") {
      return [];
    }
    return ctx.repo.listSites({
      categoryId: typeof q.categoryId === "string" ? q.categoryId : undefined,
      status: requestedStatus,
      excludeStatuses: maySeeUnpublished ? undefined : ["pending", "archived"],
      source: typeof q.source === "string" ? q.source : undefined,
      facets: facetFilter.facets,
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
    /**
     * 数据面最小化（P1-2）：与列表侧同口径。pending/archived 是编辑工作面的
     * 中间态——列表把它们藏起来了，但此前凭 id 直接 GET 仍能读到详情，
     * 知道 id 就绕过了列表的过滤。回 404 而不是 403：与列表「显式查 pending
     * 返回空集」同一理由，不向无权方泄露存在性。
     */
    if (!isPubliclyVisibleSite(site) && !canSeeUnpublishedSites(ctx, req as never)) {
      reply.code(404);
      return { error: "站点不存在" };
    }
    return site;
  });

  /**
   * 基于共享标签发现相似站点（详情页相似推荐增强）
   */
  app.get("/api/sites/:id/similar", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = (req.query ?? {}) as Record<string, unknown>;
    const limit = Math.min(Math.max(Number(q.limit) || 6, 1), 24);
    const site = await ctx.repo.getSite(id);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    return ctx.repo.listSimilarSitesByTags(site.id, limit);
  });

  /**
   * 站点健康历史（详情页健康趋势 sparkline 用）。
   *
   * 此前详情页只有「最近一次巡检」的即时徽标，用户无法判断这个站点是偶发抖动
   * 还是长期不稳。这里返回最近 N 次巡检的 ok/checkedAt（按时间正序，旧→新），
   * 前端可直接画折线；与 /api/sites/:id 的即时健康字段同源（health_checks 表）。
   */
  app.get("/api/sites/:id/health-history", { config: { scope: "public", cache: { maxAge: 60, etag: true } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = (req.query ?? {}) as Record<string, unknown>;
    const limit = Math.min(Math.max(Number(q.limit) || 30, 1), 90);
    const site = await ctx.repo.getSite(id);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    const recent = await ctx.repo.recentHealthChecks(site.id, limit);
    // recentHealthChecks 返回新→旧；sparkline 需要旧→新，直接反转
    return { checks: recent.reverse() };
  });

  /**
   * 站点写入体不再本地手写：与 MCP 的 create_site 工具共用同一份 zod 契约
   * （packages/core/src/mcp-schemas.ts 的 SiteCreateBody，由 CreateSiteInput 派生）。
   * OpenAPI 的 requestBody 也从同一份契约生成，三处不会再各自漂移。
   */
  const siteInput = SiteCreateBody;

  /**
   * 站点 AI 深度透视雷达 (AI Deep Radar)
   * 运用 Agnes 3.0 Flash 智能分析站点的核心定位、收费政策排雷、优劣势与精选平替
   */
  app.get("/api/sites/:id/radar", { config: { scope: "public", cache: { maxAge: 3600, etag: true } } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const site = await ctx.repo.getSite(id);
    if (!site) {
      reply.code(404);
      return { error: "站点不存在" };
    }

    const llm = await resolveLlm(ctx);

    // 读穿缓存：一次透视结论只取决于站点的标题/网址/描述。
    // 命中就立刻返回，不再打模型；换了模型视为未命中（判据在 getSiteRadar）。
    const cached = await ctx.repo.getSiteRadar(site.id, llm.provider.model);
    if (cached) {
      return { success: true, radar: cached.radar, cached: true };
    }

    // 检索同分类下的真实馆藏平替候选，杜绝大模型“凭空编造站内不存在的工具”
    const peers = (await ctx.repo.listSites({ categoryId: site.categoryId, status: "active", limit: 12 }))
      .filter((p) => p.id !== site.id)
      .slice(0, 8);
    const peerLookup = new Map<string, { id: string; title: string; url: string }>();
    for (const p of peers) {
      peerLookup.set(p.title.toLowerCase(), { id: p.id, title: p.title, url: p.url });
    }
    if (Array.isArray(site.relations)) {
      for (const rel of site.relations) {
        if (rel.targetTitle && rel.targetUrl) {
          peerLookup.set(rel.targetTitle.toLowerCase(), {
            id: rel.targetSiteId || "",
            title: rel.targetTitle,
            url: rel.targetUrl,
          });
        }
      }
    }

    const peerContext =
      peers.length > 0
        ? peers.map((p) => `- ${p.title} (${p.url}): ${(p.description || "").slice(0, 60)}`).join("\n")
        : "暂无同分类候选";
    const facetsInfo = site.facets ? JSON.stringify(site.facets) : "未标注";
    const tagsInfo = Array.isArray(site.tags) && site.tags.length > 0 ? site.tags.join("、") : "未标注";

    const prompt = `你是全球顶级数字中枢与生产力避坑专家。请针对以下网站进行全景专业深度透视，重点排查其收费暗坑、登录/网络门槛及平替方案：
【目标网站】
- 网站标题: ${site.title}
- 网站网址: ${site.url}
- 网站描述: ${site.description || "无"}
- 标签: ${tagsInfo}
- 已知属性: ${facetsInfo}
- 是否开源: ${site.liveMetrics?.openSource ? "开源项目" : "未知/商业"}

【站内同领域候选工具（可从中挑选平替）】
${peerContext}

请严格按以下 JSON 结构返回分析：
{
  "summary": "一句话核心定位与最适合的使用人群（45字内）",
  "pricingType": "完全开源免费" | "免登录可用" | "基础免费+进阶订阅" | "仅限付费试用" | "企业级商业定价",
  "pricingWarning": "关于收费排雷的温馨提示（例如：'核心去水印需开通会员' 或 '完全免费无套路'，50字内）",
  "accessRequirement": "免登录直连" | "需注册账号" | "需海外网络环境" | "支持本地私有部署",
  "bestForScenarios": ["适用高频场景1", "适用高频场景2"],
  "pros": ["核心优势1", "核心优势2", "核心优势3"],
  "cons": ["局限或痛点1", "局限或痛点2"],
  "directAlternatives": ["推荐平替工具1", "推荐平替工具2"]
}`;

    try {
      const res = await callLlm(ctx, llm, {
        scenario: "site_radar",
        messages: [{ role: "user", content: prompt }],
        json: true,
        thinking: false,
        temperature: 0.2,
        maxTokens: 900,
      });

      let parsed: Record<string, unknown> | null = null;
      try {
        const raw = (res.content || "").replace(/```json/gi, "").replace(/```/g, "").trim();
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        const match = (res.content || "").match(/\{[\s\S]*\}/);
        if (match) {
          try { parsed = JSON.parse(match[0]) as Record<string, unknown>; } catch {}
        }
      }
      if (!parsed || typeof parsed !== "object") {
        // 解析不出来 = 这一轮并没有真正产出。回给用户，但**不落库**：
        // 写进去就是把一次抖动固化成永久文案，之后再也纠不回来。
        return {
          success: true,
          radar: {
            summary: site.description || site.title,
            pricingType: "基础免费+进阶订阅",
            pricingWarning: "请留意官方最新收费与额度政策",
            accessRequirement: "需注册账号",
            bestForScenarios: site.tags?.slice(0, 2) || ["高效工作流"],
            pros: ["功能全面", "交互流畅"],
            cons: ["高级特性需订阅"],
            directAlternatives: peers.slice(0, 2).map((p) => p.title),
            peerLinks: peers.slice(0, 2).map((p) => ({ id: p.id, title: p.title, url: p.url })),
          },
          fallback: true,
        };
      }

      // 将 AI 推荐平替与站内真实工具链接对齐
      const rawAlts = Array.isArray(parsed.directAlternatives)
        ? parsed.directAlternatives.map((x) => String(x).trim()).filter(Boolean)
        : [];
      const peerLinks: Array<{ id: string; title: string; url: string }> = [];
      for (const altName of rawAlts) {
        const lower = altName.toLowerCase();
        const exact = peerLookup.get(lower);
        if (exact) {
          peerLinks.push(exact);
          continue;
        }
        for (const [k, v] of peerLookup.entries()) {
          if (k.includes(lower) || lower.includes(k)) {
            if (!peerLinks.some((pl) => pl.url === v.url)) {
              peerLinks.push(v);
            }
            break;
          }
        }
      }
      if (peerLinks.length === 0 && peers.length > 0) {
        for (const p of peers.slice(0, 2)) {
          peerLinks.push({ id: p.id, title: p.title, url: p.url });
        }
      }
      parsed.peerLinks = peerLinks;

      let healthBadge = { type: "healthy", label: "健康直连" };
      if (parsed.accessRequirement === "需海外网络环境") {
        healthBadge = { type: "geo_limited", label: "需海外网络" };
      } else if (parsed.pricingType === "仅限付费试用" || parsed.pricingType === "企业级商业定价") {
        healthBadge = { type: "paid_only", label: "商业付费" };
      } else if (parsed.pricingType === "完全开源免费") {
        healthBadge = { type: "open_free", label: "完全免费开源" };
      }
      parsed.healthBadge = healthBadge;
      if (peerLinks.length > 0) {
        parsed.bestAlternative = peerLinks[0];
      }

      // 键用 llm.provider.model 而不是 res.model：读取侧比对的就是前者，
      // 供应商回显一个略不一样的 model 串会让缓存永远命不中。
      // 落库失败也不能把已经付过几十秒的结果丢掉，单独吞掉异常只留告警。
      try {
        await ctx.repo.saveSiteRadar(site.id, parsed, llm.provider.model);
      } catch (err) {
        req.log.warn({ err: String(err) }, "站点 AI 透视落库失败");
      }

      return {
        success: true,
        radar: parsed,
        latencyMs: res.latencyMs,
        model: res.model,
      };
    } catch (err) {
      req.log.warn({ err: String(err) }, "站点 AI 透视生成降级");
      return {
        success: true,
        radar: {
          summary: site.description || site.title,
          pricingType: "免登录可用",
          pricingWarning: "基于本地启发式规则分析，建议以官网实际为准",
          accessRequirement: "免登录直连",
          bestForScenarios: site.tags?.slice(0, 2) || ["高效工作流"],
          pros: ["即开即用", "界面直观"],
          cons: ["海外节点可能偶有网络延迟"],
          directAlternatives: peers.slice(0, 2).map((p) => p.title),
          peerLinks: peers.slice(0, 2).map((p) => ({ id: p.id, title: p.title, url: p.url })),
        },
        fallback: true,
      };
    }
  });

  /**
   * 站点场景灵感与视觉生成 (AI Visual Generation)
   * 运用 Agnes Image 2.5 Flash 结合站点定位生成高清场景海报/封面视觉
   */
  app.post(
    "/api/sites/:id/visual",
    {
      config: {
        scope: "public",
        rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 20, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const site = await ctx.repo.getSite(id);
      if (!site) {
        reply.code(404);
        return { error: "站点不存在" };
      }

      const body = (req.body ?? {}) as { prompt?: string };
      const llm = await resolveLlm(ctx);
      if (!llm.provider.apiKey) {
        reply.code(400);
        return { error: "未配置可用 AI 密钥" };
      }

      const basePrompt =
        body.prompt?.trim() ||
        `Clean technical architecture blueprint and dataflow cheatsheet for "${site.title}" (${site.description || "software tool"}). Minimalist system diagram layout: left input boxes, center core engine labeled "${site.title}", right output artifacts. Dark mode developer theme, crisp typography, clean vector lines, high readability, technical flowchart aesthetic, 16:9 aspect ratio`;

      try {
        const result = await generateImage({
          prompt: basePrompt,
          apiKey: llm.provider.apiKey,
          baseUrl: llm.provider.baseUrl,
          model: AGNES_IMAGE_MODEL,
        });

        return {
          success: true,
          imageUrl: result.url,
          prompt: basePrompt,
          model: result.model,
          taskId: result.taskId,
        };
      } catch (err) {
        req.log.warn({ err: String(err) }, "站点场景视觉生成失败");
        reply.code(502);
        return {
          error: "图像生成服务暂时不可用，请稍后重试",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  // 建站默认会抓取并走 AI 富化：单 IP 30/min，避免全局 300/min 把模型调用放大
  app.post(
    "/api/sites",
    { config: { scope: "write", rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    // 兼容客户端（如浏览器插件）在 POST /api/sites 时传入 enrich: true 且未指定有效 categoryId 的自动富化入库调用
    if (rawBody.enrich === true && (!rawBody.categoryId || typeof rawBody.categoryId !== "string")) {
      const url = typeof rawBody.url === "string" ? rawBody.url.trim() : "";
      if (!url) { reply.code(400); return { error: "缺少 URL 参数" }; }
      // 本分支绕过了 siteInput：不校验协议的话，enrichUrl 抓失败仍会把伪协议原样落库
      const shape = httpUrl().safeParse(url);
      if (!shape.success) { reply.code(400); return { error: "参数无效", detail: shape.error.issues }; }
      const dup = await ctx.repo.findSiteByUrl(url);
      if (dup) { reply.code(409); return { error: "该网址已存在", siteId: dup.id, site: dup, created: false, reason: "已存在" }; }
      const categories = await ctx.repo.listCategories();
      // 身份必须过第二轴（否则「自称别人」= 花别人的 key、记别人的账），
      // 并且这一次写库前的富化也要受额度闸门约束：额度到顶就只用抓取结果。
      const identity = identityTrusted(ctx, req as never) ? requestIdentityOf(req as never) : null;
      const resolved = await resolveLlm(ctx, identity);
      // 闸门放在 resolveLlm 之后：source 决定这次预留占不占运维者预算
      // （用户自带 key 的富化不该把系统档吃满，口径与 recordLlmUsage 一致）。
      const quota = await reserveLlmQuota(ctx, identity, { source: resolved.source });
      const hold = quota.ok ? quota.hold : null;
      const enriched = await enrichUrl(url, {
        llm: enrichLlmOf(resolved),
        guard: ctx.config.fetch,
        knownCategories: categories.map((c) => c.title),
        heuristicOnly: !quota.ok,
        onLlmCall: createEnrichUsageCallback(ctx, resolved.source, identity),
      }).finally(() => settleLlmQuota(ctx, hold));
      // 字段级取舍：没选 category 就不拿模型/规则的建议去解析类目，也不记类目缺口
      const selection = selectEnrichmentFields(
        enriched,
        Array.isArray(rawBody.enrichFields) ? (rawBody.enrichFields as string[]) : undefined,
      );
      const titleToUse =
        (typeof rawBody.title === "string" && rawBody.title.trim()) || selection.applied.title || "";
      if (!titleToUse) {
        reply.code(400);
        return { error: "取消 title 字段时必须显式提供 title", appliedFields: selection.appliedFields, skippedFields: selection.skipped };
      }
      const categorySuggestion = selection.applied.category ?? "";
      const resolution = categorySuggestion
        ? resolveCategoryTitleSuggestion(
            categorySuggestion,
            categories.map((c) => ({ id: c.id, title: c.title, altLabels: c.altLabels })),
          )
        : ({ status: "none" } as const);
      // 建议名在树里不存在/有歧义 → 兜底类目 + 记账成 category_gap 提案。
      // P1 之前这里会按建议直接建一个**根**类目（106 平铺根的成因之一）。
      const categoryId =
        resolution.status === "unique" ? resolution.categoryId : await ctx.repo.ensureUncategorized();
      const gapTitle = categorySuggestion && resolution.status !== "unique" ? categorySuggestion : null;
      const site = await ctx.repo.createSite({
        url: enriched.url,
        title: titleToUse,
        description: selection.applied.description,
        categoryId,
        // 富化抓的是目标站自带的 icon 声明：若指向第三方图标服务（icon.horse 等）不落库
        iconKey: selection.applied.iconUrl ? sanitizeIconUrl(selection.applied.iconUrl) : null,
        tags: Array.isArray(rawBody.tags) ? (rawBody.tags as string[]) : selection.applied.tags,
        source: "ai",
      });
      if (gapTitle) {
        await ctx.repo.recordCategoryGap({
          title: gapTitle,
          siteId: site.id,
          siteUrl: site.url,
          source: "AI 富化（enrich:true）",
          ambiguousCategoryIds: resolution.status === "ambiguous" ? resolution.categoryIds : [],
        });
      }
      await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
      await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.auto", target: site.id, diff: { provenance: enriched.provenance, appliedFields: selection.appliedFields, skippedFields: selection.skipped, ignoredFields: selection.ignoredFields } });
      reply.code(201);
      return site;
    }

    const parsed = siteInput.safeParse(req.body ?? {});
    if (!parsed.success) { reply.code(400); return { error: "参数无效", detail: parsed.error.issues }; }

    // 站点只能挂叶子（一级根只作导航）：这条规矩在边界拦，仓储层保持宽松
    const attach = await ctx.repo.checkSiteCategoryAttachment(parsed.data.categoryId);
    if (!attach.ok) { reply.code(400); return { error: attach.error }; }

    // URL 去重：导航站最常见的脏数据来源
    const dup = await ctx.repo.findSiteByUrl(parsed.data.url);
    if (dup) { reply.code(409); return { error: "该网址已存在", siteId: dup.id, site: dup }; }

    const site = await ctx.repo.createSite({
      ...parsed.data,
      // 校验器允许传 slug，落库必须是解析后的真实 id，否则 category_id 直接悬空
      ...(attach.categoryId ? { categoryId: attach.categoryId } : {}),
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
    let patch = parsed.data;
    if (patch.categoryId !== undefined) {
      const attach = await ctx.repo.checkSiteCategoryAttachment(patch.categoryId);
      if (!attach.ok) { reply.code(400); return { error: attach.error }; }
      // 校验器允许传 slug，落库必须是解析后的真实 id，否则 category_id 悬空
      if (attach.categoryId) patch = { ...patch, categoryId: attach.categoryId };
    }
    const before = await ctx.repo.getSite(id);
    if (!before) { reply.code(404); return { error: "站点不存在" }; }
    if (patch.url !== undefined && patch.url !== before.url) {
      const dup = await ctx.repo.findSiteByUrl(patch.url);
      if (dup && dup.id !== id) {
        reply.code(409);
        return { error: "该网址已存在", siteId: dup.id, site: dup };
      }
    }
    const site = await ctx.repo.updateSite(id, patch);
    if (!site) { reply.code(404); return { error: "站点不存在" }; }
    await indexSite(ctx, site.id, site.title, site.description ?? null, site.url);
    await ctx.repo.audit({ ip: req.ip, actor: req.auth.actor, actorKind: req.auth.kind, action: "site.update", target: id, diff: { before, after: patch } });
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
    const body = SiteBulkInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }
    const { op, ids, dryRun } = body.data;
    if (op === "setCategory" && !body.data.categoryId) { reply.code(400); return { error: "setCategory 需要 categoryId" }; }
    // 目标必须能挂站点；校验允许传 slug，落库要用解析后的真实 id，否则 category_id 悬空
    let targetCategoryId = body.data.categoryId;
    if (op === "setCategory") {
      const attach = await ctx.repo.checkSiteCategoryAttachment(body.data.categoryId);
      if (!attach.ok) { reply.code(400); return { error: attach.error }; }
      targetCategoryId = attach.categoryId ?? body.data.categoryId;
    }
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
        await ctx.repo.updateSite(id, { categoryId: targetCategoryId });
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
  app.post("/api/sites/batch", { config: { scope: "write", rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = SiteBatchInput.safeParse(req.body ?? {});
    if (!body.success) { reply.code(400); return { error: "参数无效", detail: body.error.issues }; }

    const cats = await ctx.repo.listCategories();
    // 可挂集合 = 有父级的类目 + 兜底「未分类」，id 和 slug 都认（与 MCP batch_import 同口径）。
    // 一级根不进集合：批量导入没有 400 可退（一次上千条，报错等于整批失败），
    // 所以根一律降级到未分类而不是照收。
    const attachable = new Map<string, string>();
    for (const c of cats) {
      if (!c.parentId && c.id !== UNCATEGORIZED_CATEGORY_ID) continue;
      attachable.set(c.id, c.id);
      if (c.slug) attachable.set(c.slug, c.id);
    }
    let fallback = (body.data.defaultCategoryId && attachable.get(body.data.defaultCategoryId))
      ? attachable.get(body.data.defaultCategoryId)!
      // 兜底是「未分类」而不是 cats[0]：按 sort 取第一个类目等于把没指定分类的
      // 导入站点随机塞进某个真实领域（实测是 AI 工具），运营事后完全看不出。
      : await ctx.repo.ensureUncategorized();
    attachable.set(fallback, fallback);

    let created = 0;
    let duplicates = 0;
    // 传了类目但没挂上（不存在 / 一级根）的条数：书签导入器要靠它判断
    // 「这批是不是其实没归类成功」，否则站点静默堆进未分类没人知道。
    let degraded = 0;
    const createdSites: Array<Awaited<ReturnType<typeof ctx.repo.createSite>>> = [];

    /**
     * 去重前置：一次 IN 查询拿到全部已存在 URL，替代循环里 200 次 findSiteByUrl。
     *
     * 必须在事务**外**取（只读，不需要写锁）；批次内部重复由 `known` 集合就地补登，
     * 与原实现「第二条被前一条已插入的行挡下」的语义一致。
     */
    const known = await ctx.repo.findExistingSiteUrls(body.data.sites.map((s) => s.url));

    // DB 写入包事务（去重检查 + 创建原子提交）；向量索引在提交后补做，避免长事务持有写锁。
    await ctx.repo.withTransaction(async () => {
    for (const item of body.data.sites) {
      const cleanUrl = canonicalizeUrl(item.url);
      if (known.has(cleanUrl) || known.has(item.url)) {
        duplicates++;
        continue;
      }
      known.add(cleanUrl);
      const resolved = item.categoryId ? attachable.get(item.categoryId) : undefined;
      if (item.categoryId && !resolved) degraded++;
      const categoryId = resolved ?? fallback;
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

    /**
     * 向量索引批量重建：原实现逐条 `await indexSite`，200 条就是 200 次
     * ONNX 推理往返 + 200 个事务。indexSitesBatch 内部走 encodeBatch，且自带
     * 失败降级（只记 capabilities.notes，不让主写入失败），这里按片喂给它。
     * 片大小 32 是推理批与单条失败影响面的折中：一片失败最多丢 32 条的向量，
     * 而这些站点仍可被 exact/fts/pinyin 通道检索到。
     */
    const INDEX_CHUNK = 32;
    for (let i = 0; i < createdSites.length; i += INDEX_CHUNK) {
      await indexSitesBatch(
        ctx,
        createdSites.slice(i, i + INDEX_CHUNK).map((site) => ({
          id: site.id,
          title: site.title,
          description: site.description ?? null,
          url: site.url,
        })),
      );
    }

    await ctx.repo.audit({
      ip: req.ip,
      actor: req.auth.actor,
      actorKind: req.auth.kind,
      action: "site.batch",
      diff: { total: body.data.sites.length, created, duplicates, categoryDegraded: degraded },
    });

    reply.code(201);
    return { success: true, created, duplicates, categoryDegraded: degraded, sites: createdSites };
  });

  /**
   * 书签批量智能归类与简介补全（AI Batch Bookmark Classifier）
   * 解决痛点：用户导入数百个浏览器书签时，超过半数书签无分类或仅有简短标题，手动逐条分类极其耗时。
   * 运用 Agnes 3.0 Flash 一次性对齐权威叶子分类并生成简明中文功能简介。
   */
  app.post(
    "/api/sites/batch-classify",
    {
      config: {
        scope: "public",
        rateLimit: { max: process.env.NODE_ENV === "test" ? 10_000 : 20, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const body = (req.body ?? {}) as {
        items?: Array<{ id?: string; title?: string; url?: string; folder?: string }>;
        categories?: Array<{ slug?: string; label?: string }>;
      };
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return badRequest(reply, "缺少待归类书签列表");
      }

      const items = body.items.slice(0, 35).map((item, idx) => ({
        id: String(item.id ?? `bm-${idx}`),
        title: String(item.title ?? "").trim().slice(0, 120),
        url: String(item.url ?? "").trim().slice(0, 300),
        folder: String(item.folder ?? "").trim().slice(0, 80),
      }));

      // 汇总合法叶子分类列表（数据库叶子分类 ∪ 前端传入的候选分类）
      const dbCats = await ctx.repo.listCategories();
      const validSlugs = new Map<string, string>();
      for (const c of dbCats) {
        if (!c.parentId || c.enabled === false) continue;
        const slug = String(c.slug ?? c.id).trim();
        if (slug) validSlugs.set(slug, c.title);
      }
      if (Array.isArray(body.categories)) {
        for (const c of body.categories) {
          const slug = String(c.slug ?? "").trim();
          const label = String(c.label ?? "").trim();
          if (slug && label && !validSlugs.has(slug)) {
            validSlugs.set(slug, label);
          }
        }
      }

      const categorySpec = Array.from(validSlugs.entries())
        .map(([slug, label]) => `${slug}: ${label}`)
        .join("\n");

      const bookmarkLines = items
        .map((it) => `ID=${it.id} | 标题=${it.title} | URL=${it.url}${it.folder ? ` | 原文件夹=${it.folder}` : ""}`)
        .join("\n");

      const llm = await resolveLlm(ctx);
      const prompt = `你是专业的网址导航分类架构师。请将以下浏览器书签精准归入给定的【合法分类编码】中，并为每条书签补充一句简明实用的中文功能简介（15~35字）。

【合法分类编码 (categorySlug: 分类名称)】
${categorySpec}

【待归类书签】
${bookmarkLines}

请严格返回以下 JSON 格式：
{
  "results": [
    {
      "id": "与输入完全一致的ID",
      "categorySlug": "必须严格从上方合法分类编码中选择一个最匹配的slug",
      "description": "一句话中文核心用途简介（15-35字）",
      "tags": ["标签1", "标签2"]
    }
  ]
}`;

      try {
        const res = await callLlm(ctx, llm, {
          scenario: "batch_bookmark_classify",
          messages: [{ role: "user", content: prompt }],
          json: true,
          thinking: false,
          temperature: 0.1,
          maxTokens: 2048,
        });

        let parsed: { results?: Array<Record<string, unknown>> } | null = null;
        try {
          const raw = (res.content || "").replace(/```json/gi, "").replace(/```/g, "").trim();
          parsed = JSON.parse(raw);
        } catch {
          const match = (res.content || "").match(/\{[\s\S]*\}/);
          if (match) {
            try { parsed = JSON.parse(match[0]); } catch {}
          }
        }

        const rawResults = Array.isArray(parsed?.results) ? parsed!.results : [];
        const normalized = rawResults
          .map((r) => {
            const id = String(r.id ?? "").trim();
            let slug = String(r.categorySlug ?? "").trim();
            if (!validSlugs.has(slug)) {
              // 模糊修正：若模型填了中文名或相近 slug
              for (const [k, label] of validSlugs.entries()) {
                if (label.includes(slug) || slug.includes(label) || k.includes(slug.toLowerCase())) {
                  slug = k;
                  break;
                }
              }
              if (!validSlugs.has(slug)) slug = "";
            }
            const description = String(r.description ?? "").trim().slice(0, 120);
            const tags = Array.isArray(r.tags)
              ? r.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 4)
              : [];
            return { id, categorySlug: slug, description, tags };
          })
          .filter((r) => r.id);

        return {
          success: true,
          results: normalized,
          model: res.model,
          latencyMs: res.latencyMs,
        };
      } catch (err) {
        req.log.warn({ err: String(err) }, "AI 批量书签归类失败");
        reply.code(502);
        return {
          error: "AI 批量归类暂时不可用，已保留本地智能规则匹配结果",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

};
