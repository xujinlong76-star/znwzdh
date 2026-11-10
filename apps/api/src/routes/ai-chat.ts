/**
 * 小猫猫 AI 助手（对话式）路由：POST /api/ai/chat
 *
 * 访客跟右下角的小猫猫自由聊天（找站、问分类、问场景包怎么用、打招呼），
 * 小猫猫以人设回复一段话，并把话里推荐的站内站点以可点击卡片一并下发。
 *
 * 硬约束（与 AI 智能找站同一立场）：
 *  - 能下发的站点只来自本次站内检索的真实召回；模型挑的候选外 siteId 被丢弃；
 *  - 无密钥 / 额度用完 / 模型出错都不崩：降级为本地检索 + 固定话术并如实标注 degraded；
 *  - 会话上下文只由客户端在请求里带最近几轮，服务端不落任何会话状态。
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { llmProviderReadyAny, resolveLlm } from "../llm-config.ts";
import { reserveLlmQuota, settleLlmQuota } from "../llm-quota.ts";
import { callLlm, INTERACTIVE_LLM_BUDGET_MS } from "../llm-usage.ts";
import { retrieveCopilotCandidates, retrievalQueryOf } from "./copilot.ts";
import { identityTrusted, requestIdentityOf } from "./shared.ts";
import {
  finderSiteOf,
  localReasonOf,
  suggestCategories,
  type FinderSite,
} from "../ai-finder.ts";
import {
  CHAT_SYSTEM_PROMPT,
  localChatReply,
  parseChatModelOutput,
  sanitizeHistory,
} from "../ai-chat.ts";

const chatSchema = z.object({
  message: z.string().min(1, "先跟小猫猫说句话").max(500, "这句话有点长，拆开慢慢说"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(1000),
      }),
    )
    .max(12)
    .optional(),
});

const CANDIDATE_LIMIT = 12;
const LOCAL_CARD_LIMIT = 4;

export const aiChatRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  app.post(
    "/api/ai/chat",
    { config: { scope: "public", rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: "INVALID_REQUEST", message: parsed.error.issues[0]?.message || "请求参数错误" };
      }
      const message = parsed.data.message.trim();
      const history = sanitizeHistory(parsed.data.history);
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

        // 检索锚定：无论走模型还是本地兜底，能下发的站点都只出自这次真实召回。
        const retrieval = await retrieveCopilotCandidates(ctx, retrievalQueryOf(message));
        const candidates = retrieval.sites.slice(0, CANDIDATE_LIMIT);
        const retrievalFailed = retrieval.failed;

        let mode: "ai" | "local" = "local";
        let degraded: "unconfigured" | "quota" | "error" | null =
          quotaInfo ? "quota" : llmProviderReadyAny(llm) ? null : "unconfigured";
        let replyText: string | null = null;
        let recommendations: FinderSite[] = [];

        if (!degraded) {
          try {
            const candidateBlock = candidates.length > 0
              ? candidates
                  .map((s) => `- [id:${s.id}] ${s.title}（${categoryTitle.get(s.categoryId) ?? "未分类"}）：${(s.description ?? "").slice(0, 60)}`)
                  .join("\n")
              : "（本次站内检索没有召回到候选站点：不要推荐任何网站，只做导览说明或礼貌回应。）";
            const res = await callLlm(ctx, llm, {
              scenario: "ai_chat",
              identity,
              messages: [
                { role: "system", content: `${CHAT_SYSTEM_PROMPT}\n\n候选站点：\n${candidateBlock}` },
                ...history.map((t) => ({ role: t.role, content: t.content })),
                { role: "user", content: message },
              ],
              json: true,
              temperature: 0.4,
              maxTokens: 700,
              deadlineAt: startedAt + INTERACTIVE_LLM_BUDGET_MS,
            });
            const output = parseChatModelOutput(res.content || "", candidates);
            if (output) {
              mode = "ai";
              replyText = output.reply;
              const byId = new Map(candidates.map((s) => [s.id, s]));
              recommendations = output.picks
                .map((p) => byId.get(p.siteId))
                .filter((s): s is NonNullable<typeof s> => Boolean(s))
                .map((s) => {
                  const pick = output.picks.find((p) => p.siteId === s.id);
                  return finderSiteOf(s, pick?.reason || localReasonOf(s, categoryTitle.get(s.categoryId)));
                });
            } else {
              degraded = "error";
            }
          } catch {
            degraded = "error";
          }
        }

        if (replyText === null) {
          // 本地兜底：固定话术 + （找站意图时）本地检索直配卡片，理由用本地拼装不冒充 AI。
          const local = localChatReply(message, {
            candidateCount: candidates.length,
            retrievalFailed,
          });
          replyText = local.reply;
          if (local.attachCards) {
            recommendations = candidates
              .slice(0, LOCAL_CARD_LIMIT)
              .map((s) => finderSiteOf(s, localReasonOf(s, categoryTitle.get(s.categoryId))));
          }
        }

        return {
          ok: true,
          mode,
          degraded,
          reply: replyText,
          recommendations,
          categorySuggestions: recommendations.length === 0
            ? suggestCategories(categories, message)
            : [],
          ...(quotaInfo ? { quota: quotaInfo } : {}),
        };
      } finally {
        await settleLlmQuota(ctx, quota.ok ? quota.hold : null);
      }
    },
  );
};
