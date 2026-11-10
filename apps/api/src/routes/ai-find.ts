/**
 * AI 智能找站（结构化）路由：POST /api/ai/find
 *
 * 访客一句话说需求 → 返回一组可直接点开的站内站点卡片（一句理由 + 直达链接），
 * 可选 sceneId 则按「场景包」分步骤返回配套站点与建议使用顺序。
 *
 * 硬约束（与 Copilot 的引用校验同一立场）：
 *  - 推荐只能来自站内混合检索的真实召回；模型只负责在候选里挑站、排序、写理由，
 *    它给出的候选外 siteId 会被 validateModelPicks 丢掉；
 *  - 查不到就如实回 mode:"none" + 最接近的分类入口，不编造站外 URL；
 *  - 没配密钥 / 额度用完 / 模型出错都不报错崩页：降级为本地检索结果并如实标注。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Site as NavSite } from "@navhub/core";
import type { AppContext } from "../context.ts";
import { llmProviderReadyAny, resolveLlm } from "../llm-config.ts";
import { reserveLlmQuota, settleLlmQuota } from "../llm-quota.ts";
import { callLlm, INTERACTIVE_LLM_BUDGET_MS } from "../llm-usage.ts";
import { retrieveCopilotCandidates, retrievalQueryOf } from "./copilot.ts";
import { identityTrusted, requestIdentityOf } from "./shared.ts";
import {
  finderSiteOf,
  localReasonOf,
  scenePackById,
  suggestCategories,
  validateModelPicks,
  type FinderSite,
  type FinderStep,
} from "../ai-finder.ts";

const findSchema = z.object({
  query: z.string().min(1, "先说说你想找什么").max(500, "需求描述太长了"),
  sceneId: z.string().max(64).optional(),
});

const PER_STEP_LIMIT = 4;
const FLAT_LIMIT = 6;

interface CandidateGroup {
  label: string | null;
  sites: NavSite[];
}

export const aiFindRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.post(
    "/api/ai/find",
    { config: { scope: "public", rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = findSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: "INVALID_REQUEST", message: parsed.error.issues[0]?.message || "请求参数错误" };
      }
      const query = parsed.data.query.trim();
      const scene = scenePackById(parsed.data.sceneId);
      const startedAt = Date.now();

      const identity = identityTrusted(ctx, req as never) ? requestIdentityOf(req as never) : null;
      const llm = await resolveLlm(ctx, identity);
      const quota = await reserveLlmQuota(ctx, identity, { source: llm.source });
      const quotaInfo = quota.ok ? null : {
        scope: quota.error.scope,
        metric: quota.error.metric,
        limit: quota.error.limit,
        used: quota.error.used,
        retryAfterSeconds: Math.max(1, Math.ceil(quota.error.retryAfterMs / 1000)),
      };
      if (!quota.ok) reply.header("retry-after", String(quotaInfo?.retryAfterSeconds));

      try {
        const categories = await ctx.repo.listCategories();
        const categoryTitle = new Map(categories.map((c) => [c.id, c.title]));

        // 召回：场景包按步骤逐组检索（步骤顺序即建议使用顺序）；普通找站单次检索。
        const groups: CandidateGroup[] = [];
        let retrievalFailed = false;
        if (scene) {
          for (const step of scene.steps) {
            const seen = new Set<string>();
            const sites: NavSite[] = [];
            for (const q of step.queries) {
              const r = await retrieveCopilotCandidates(ctx, retrievalQueryOf(q));
              if (r.failed) retrievalFailed = true;
              for (const s of r.sites) {
                if (!seen.has(s.id)) { seen.add(s.id); sites.push(s); }
              }
              if (sites.length >= PER_STEP_LIMIT) break;
            }
            if (sites.length > 0) groups.push({ label: step.label, sites: sites.slice(0, PER_STEP_LIMIT) });
          }
        } else {
          const r = await retrieveCopilotCandidates(ctx, retrievalQueryOf(query));
          retrievalFailed = r.failed;
          if (r.sites.length > 0) groups.push({ label: null, sites: r.sites.slice(0, 12) });
        }

        const allSites = [...new Map(groups.flatMap((g) => g.sites).map((s) => [s.id, s])).values()];
        const categorySuggestions = suggestCategories(categories, scene ? scene.title : query);

        if (retrievalFailed || allSites.length === 0) {
          return {
            ok: true,
            mode: "none" as const,
            degraded: retrievalFailed ? ("error" as const) : null,
            notice: retrievalFailed
              ? "站内检索暂时不可用（不代表站内没有），可以先从下面这些分类找找。"
              : "站内暂时还没有收录完全对得上的站点，先给你最接近的分类入口。",
            query,
            ...(scene ? { scene: { id: scene.id, title: scene.title } } : {}),
            recommendations: [] as FinderSite[],
            steps: [] as FinderStep[],
            categorySuggestions,
          };
        }

        // 模型挑站+写理由（只在候选内）；不可用/超额/出错一律本地兜底，不冒充 AI。
        let reasons = new Map<string, string>();
        let aiOrder: string[] = [];
        let mode: "ai" | "local" = "local";
        let degraded: "unconfigured" | "quota" | "error" | null =
          quotaInfo ? "quota" : llmProviderReadyAny(llm) ? null : "unconfigured";

        if (!degraded) {
          try {
            const candidateBlock = allSites
              .map((s) => `- [id:${s.id}] ${s.title}（${categoryTitle.get(s.categoryId) ?? "未分类"}）：${(s.description ?? "").slice(0, 60)}`)
              .join("\n");
            const res = await callLlm(ctx, llm, {
              scenario: "ai_find",
              identity,
              messages: [
                {
                  role: "system",
                  content:
                    "你是网址导航站的找站助手。只能从用户给出的候选站点里挑选，禁止推荐候选之外的站点或编造链接。" +
                    "按与需求的相关程度排序，为每个入选站点写一句 25 字内的推荐理由。" +
                    '严格只返回 JSON：{"picks":[{"siteId":"候选id","reason":"一句理由"}]}，最多 8 个。',
                },
                { role: "user", content: `需求：${scene ? `场景「${scene.title}」：${query}` : query}\n\n候选站点：\n${candidateBlock}` },
              ],
              json: true,
              temperature: 0.3,
              maxTokens: 800,
              deadlineAt: startedAt + INTERACTIVE_LLM_BUDGET_MS,
            });
            let rawPicks: unknown = null;
            try {
              rawPicks = JSON.parse((res.content || "").replace(/```json/gi, "").replace(/```/g, "").trim());
            } catch { rawPicks = null; }
            if (rawPicks) {
              const { picks } = validateModelPicks(rawPicks, allSites.map((s) => ({
                siteId: s.id, title: s.title, url: s.url, description: s.description ?? null,
              })));
              if (picks.length > 0) {
                reasons = new Map(picks.map((p) => [p.siteId, p.reason ?? ""]));
                aiOrder = picks.map((p) => p.siteId);
                mode = "ai";
              } else {
                degraded = "error";
              }
            } else {
              degraded = "error";
            }
          } catch {
            degraded = "error";
          }
        }

        const toFinder = (s: NavSite): FinderSite =>
          finderSiteOf(s, reasons.get(s.id) || localReasonOf(s, categoryTitle.get(s.categoryId)));

        const steps: FinderStep[] = groups
          .filter((g) => g.label)
          .map((g) => ({ label: g.label!, sites: g.sites.map(toFinder) }));

        let recommendations: FinderSite[];
        if (scene) {
          recommendations = steps.flatMap((s) => s.sites);
        } else if (mode === "ai" && aiOrder.length > 0) {
          const byId = new Map(allSites.map((s) => [s.id, s]));
          recommendations = aiOrder.map((id) => byId.get(id)).filter((s): s is NavSite => Boolean(s)).map(toFinder);
          // 模型没挑满时把其余高相关候选补在后面（仍是站内真实站点）
          for (const s of allSites) {
            if (recommendations.length >= FLAT_LIMIT) break;
            if (!aiOrder.includes(s.id)) recommendations.push(toFinder(s));
          }
          recommendations = recommendations.slice(0, FLAT_LIMIT);
        } else {
          recommendations = allSites.slice(0, FLAT_LIMIT).map(toFinder);
        }

        const notice =
          mode === "ai"
            ? "AI 已从站内收录里为你挑好了，下面每个链接都能直接打开。"
            : degraded === "quota"
              ? "今天的 AI 额度已用完，下面是站内检索直接匹配的结果（未经 AI 挑选）。"
              : degraded === "unconfigured"
                ? "AI 还没配置密钥，下面是站内检索直接匹配的结果。"
                : "AI 暂时不可用，下面是站内检索直接匹配的结果。";

        return {
          ok: true,
          mode,
          degraded,
          notice,
          query,
          ...(scene ? { scene: { id: scene.id, title: scene.title } } : {}),
          recommendations,
          steps,
          categorySuggestions: [] as ReturnType<typeof suggestCategories>,
          ...(quotaInfo ? { quota: quotaInfo } : {}),
        };
      } finally {
        await settleLlmQuota(ctx, quota.ok ? quota.hold : null);
      }
    },
  );
};
