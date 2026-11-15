/**
 * 问问我的收藏（POST /api/ask + GET /api/ask/status）。
 *
 * 调用链（与 ai-chat 路由同构）：
 *   身份解析 → reserveLlmQuota（失败直接回 quota degraded）
 *   → 问答检索（0 命中 → 「不知道」分支，不调模型）
 *   → resolveLlm 未就绪 → degraded: unconfigured + 本地兜底（只列检索到的收藏卡片）
 *   → callLlmStream（scenario "ask_collection"）→ 流式回前端
 *   → 终稿做引用校验 → settleLlmQuota（finally）。
 *
 * v1 只答登录用户的收藏：匿名（只有 anonId、没有 userId/ownerIdentity）
 * 一律 401；服务端不存问答内容，追问上下文由客户端带最近 3 轮。
 *
 * 流式协议（与 Copilot 同一套 delta/reasoning/done 帧）：
 *  - 模型输出是严格 JSON（提示词强制；流式调用没有 JSON 模式等价物，
 *    见 llm-usage 的说明），逐字下发原始 JSON 等于把未经引用校验的文本
 *    与候选外 id 先行泄露到流里——因此本路由不下发 delta/reasoning 文本，
 *    流式只推 `: progress` 注释帧（retrieved/generating 两段）与终稿 done；
 *    done 是唯一权威终稿，前端必须以 done 的 answer 覆盖一切草稿。
 *    这是 JSON 结构化输出与逐字流式正文不可兼得时的取舍：宁可不要逐字
 *    动画，也不要让未校验的引用先行出场。
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { isUpstreamCancelNotice, LlmError } from "@navhub/ai";
import type { CopilotFrame } from "@navhub/core";
import type { AppContext } from "../context.ts";
import { llmProviderReadyAny, resolveLlm } from "../llm-config.ts";
import { reserveLlmQuota, settleLlmQuota } from "../llm-quota.ts";
import { callLlmStream, INTERACTIVE_LLM_BUDGET_MS } from "../llm-usage.ts";
import {
  ASK_SYSTEM_PROMPT,
  buildAskCandidateBlock,
  parseAskModelOutput,
  sanitizeAskHistory,
  suggestFollowups,
  UNKNOWN_ASK_REPLY,
  type AskAnswerSegment,
  type AskCandidate,
} from "../ask.ts";
import { retrieveAskCandidates, type AskRetrieval } from "../ask-retrieval.ts";
import {
  identityTrusted,
  resolveCanonicalIdentity,
  setupSseStream,
  startSseHeartbeat,
} from "./shared.ts";
import { bindReplyAbort } from "./copilot.ts";

/** 收藏 <5 条时不开放提问（按钮置灰 + 说明 + 去逛逛/去导入入口）。 */
export const ASK_MIN_FAVORITES = 5;
/** 本地兜底 / 降级时最多附几张收藏卡片。 */
const LOCAL_CARD_LIMIT = 8;

const askSchema = z.object({
  question: z.string().min(1, "先问点什么").max(500, "问题有点长，拆开慢慢问"),
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

/** 引用卡片：只渲染服务端返回的引用表，不渲染模型原文里的任何链接。 */
export interface AskCitationCard {
  siteId: string;
  title: string;
  url: string;
  description: string | null;
  note: string | null;
  tags: string[];
  createdAt: number;
  /** 仅供参考，不是答案依据（「不知道」分支与本地兜底的卡片带此标记） */
  referenceOnly?: boolean;
}

function cardOf(c: AskCandidate, referenceOnly = false): AskCitationCard {
  return {
    siteId: c.siteId,
    title: c.title,
    url: c.url,
    description: c.description,
    note: c.note,
    tags: c.tags,
    createdAt: c.createdAt,
    ...(referenceOnly ? { referenceOnly: true } : {}),
  };
}

function retrievalSummary(r: AskRetrieval) {
  return {
    totalFavorites: r.totalFavorites,
    matched: r.candidates.length,
    lexical: r.lexicalCount,
    semantic: r.semanticCount,
    correction: r.correction,
    semanticAvailable: r.semanticAvailable,
  };
}

/**
 * v1 仅登录用户可问。
 *
 * 只认两类身份：令牌 ownerIdentity，或 x-navhub-user-id 头（hub 代理在
 * 有会话时替登录用户签发，匿名请求只会带 anonId）。匿名访客的收藏不在
 * 服务端、也没有可信身份，v1 直接 401（匿名问答后续再议）。
 * 开放模式（authRequired=false）下本地操作者同样走这条：没带 userId 头
 * 的请求分不清是谁的收藏，一律不放行。
 */
export function askIdentityOf(req: FastifyRequest): string | null {
  const auth = (req as { auth?: { ownerIdentity?: string | null } }).auth;
  if (auth?.ownerIdentity) return auth.ownerIdentity;
  const headers = req.headers as Record<string, unknown>;
  const userId = headers["x-navhub-user-id"] ?? headers["x-user-id"];
  if (typeof userId === "string" && userId.trim()) return userId.trim().slice(0, 64);
  return null;
}

export async function requireAskIdentity(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const identity = askIdentityOf(req);
  if (!identity) {
    reply.code(401);
    return null;
  }
  // 可信判定走 identityTrusted（签名/持票轴）；业务身份用 askIdentityOf。
  if (!identityTrusted(ctx, req as never)) {
    reply.code(401);
    return null;
  }
  if (ctx.config.authRequired && (req as { auth?: { kind?: string } }).auth?.kind === "anonymous") {
    reply.code(401);
    return null;
  }
  return resolveCanonicalIdentity(ctx, identity);
}

function unauthorizedBody() {
  return {
    ok: false,
    error: "UNAUTHORIZED",
    message: "问问我的收藏只对登录用户开放，请先登录后再提问。",
  };
}

export const askRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /**
   * 问答前置状态：收藏条数（够不够 5 条开问）、模型是否就绪、3 条动态示例标题。
   * 只读，不占额度；示例标题取自用户真实收藏，不写死假例子。
   */
  app.get(
    "/api/ask/status",
    { config: { scope: "public", rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const identity = await requireAskIdentity(ctx, req, reply);
      if (!identity) return unauthorizedBody();
      const favorites = await ctx.repo.listFavorites(identity);
      const sites = await ctx.repo.getSitesByIds(favorites.map((f) => f.siteId));
      const titles: string[] = [];
      let count = 0;
      for (const fav of favorites) {
        const site = sites.get(fav.siteId);
        if (!site) continue;
        count += 1;
        if (titles.length < 3) titles.push(site.title);
      }
      const llm = await resolveLlm(ctx, identity);
      return {
        favoritesCount: count,
        canAsk: count >= ASK_MIN_FAVORITES,
        llmReady: llmProviderReadyAny(llm),
        samples: titles,
      };
    },
  );

  app.post(
    "/api/ask",
    { config: { scope: "public", rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const parsed = askSchema.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return {
          error: "INVALID_REQUEST",
          message: parsed.error.issues[0]?.message || "请求参数错误",
        };
      }
      const question = parsed.data.question.trim();
      const history = sanitizeAskHistory(parsed.data.history);
      const startedAt = Date.now();

      const identity = await requireAskIdentity(ctx, req, reply);
      if (!identity) return unauthorizedBody();

      const llm = await resolveLlm(ctx, identity);
      const quota = await reserveLlmQuota(ctx, identity, { source: llm.source });
      if (!quota.ok) {
        const retryAfterSeconds = Math.max(1, Math.ceil(quota.error.retryAfterMs / 1000));
        reply.header("retry-after", String(retryAfterSeconds));
        return {
          ok: true,
          mode: "local",
          degraded: "quota",
          answer: null as AskAnswerSegment[] | null,
          citations: [] as AskCitationCard[],
          suggestions: [] as string[],
          message: "今天的 AI 提问额度用完了，明天再来问，或者先去收藏里翻翻。",
          quota: {
            scope: quota.error.scope,
            metric: quota.error.metric,
            limit: quota.error.limit,
            used: quota.error.used,
            retryAfterSeconds,
          },
        };
      }

      try {
        // 检索锚定：能下发的引用只出自这次真实召回。
        let retrieval: AskRetrieval;
        try {
          retrieval = await retrieveAskCandidates(ctx, identity, question);
        } catch {
          return {
            ok: true,
            mode: "local",
            degraded: "error",
            answer: null as AskAnswerSegment[] | null,
            citations: [] as AskCitationCard[],
            suggestions: [] as string[],
            message: "收藏检索这会儿有点忙，没能帮你翻目录，等会儿再问我一次。",
          };
        }
        const candidates = retrieval.candidates;

        // 召回为 0 时不调模型，直接走「不知道」分支（附最接近的收藏卡片，仅供参考）。
        if (candidates.length === 0) {
          return {
            ok: true,
            mode: "local",
            degraded: null,
            unknown: true,
            answer: [{ text: UNKNOWN_ASK_REPLY, citations: [] }],
            citations: retrieval.closest.map((c) => cardOf(c, true)),
            suggestions: suggestFollowups(retrieval.closest),
            retrieval: retrievalSummary(retrieval),
          };
        }

        // 模型未就绪：本地兜底，只列检索到的收藏卡片，不编造答案。
        if (!llmProviderReadyAny(llm)) {
          return {
            ok: true,
            mode: "local",
            degraded: "unconfigured",
            answer: null as AskAnswerSegment[] | null,
            citations: candidates.slice(0, LOCAL_CARD_LIMIT).map((c) => cardOf(c, true)),
            suggestions: suggestFollowups(candidates),
            retrieval: retrievalSummary(retrieval),
            message: "AI 还没配好，我先按你的收藏翻到了这几条，配好密钥后就能直接问答案了。",
          };
        }

        return await streamAskReply(ctx, reply, {
          identity,
          llm,
          question,
          history,
          candidates,
          retrieval,
          startedAt,
        });
      } finally {
        await settleLlmQuota(ctx, quota.ok ? quota.hold : null);
      }
    },
  );
};

interface AskStreamPrep {
  identity: string | null;
  llm: Awaited<ReturnType<typeof resolveLlm>>;
  question: string;
  history: ReturnType<typeof sanitizeAskHistory>;
  candidates: AskCandidate[];
  retrieval: AskRetrieval;
  startedAt: number;
}

async function streamAskReply(
  ctx: AppContext,
  reply: FastifyReply,
  prep: AskStreamPrep,
): Promise<FastifyReply> {
  setupSseStream(reply);
  const { signal: clientSignal, cleanup: cleanupAbort } = bindReplyAbort(reply);
  let closed = false;
  const write = (payload: CopilotFrame) => {
    if (closed) return;
    try {
      reply.raw.write("data: " + JSON.stringify(payload) + "\n\n");
    } catch {
      closed = true;
    }
  };
  const comment = (text: string) => {
    if (closed) return;
    try {
      reply.raw.write(": " + text + "\n\n");
    } catch {
      closed = true;
    }
  };
  const progress = (stage: string, extra: Record<string, unknown> = {}) => {
    comment(`progress ${JSON.stringify({ stage, ...extra })}`);
  };
  const heartbeat = startSseHeartbeat(comment);

  // 两段诚实加载：检索结果先行下发，前端据此展示「找到 M 条相关」。
  progress("retrieved", {
    total: prep.retrieval.totalFavorites,
    matched: prep.retrieval.candidates.length,
  });

  let rawContent = "";
  let model = prep.llm.provider.model;
  let failure: unknown = null;

  try {
    progress("generating");
    const candidateBlock = buildAskCandidateBlock(prep.candidates);
    for await (const event of callLlmStream(ctx, prep.llm, {
      scenario: "ask_collection",
      identity: prep.identity,
      messages: [
        {
          role: "system",
          content: `${ASK_SYSTEM_PROMPT}\n\n候选收藏（只可引用这些 id）：\n${candidateBlock}`,
        },
        ...prep.history.map((t) => ({ role: t.role, content: t.content })),
        { role: "user", content: prep.question },
      ],
      temperature: 0.35,
      maxTokens: 800,
      thinking: false,
      signal: clientSignal,
      deadlineAt: prep.startedAt + INTERACTIVE_LLM_BUDGET_MS,
    })) {
      if (event.type === "delta") {
        // 只累积、不下发：原始 JSON 文本未经引用校验，下发即泄露未验证的引用。
        rawContent += event.text;
      } else if (event.type === "reasoning") {
        // 思考链同样不下发：不是答案，且可能含未校验的候选外内容。
      } else {
        model = event.model || model;
      }
      if (clientSignal.aborted) break;
    }
  } catch (err) {
    failure = err;
  }

  try {
    if (clientSignal.aborted) return reply;

    const localCards = prep.candidates.slice(0, LOCAL_CARD_LIMIT).map((c) => cardOf(c, true));
    if (failure) {
      if (failure instanceof LlmError && failure.code === "cancelled") {
        write({
          type: "done",
          ok: false,
          error: "上游模型中断了本次回答（不是你的操作），可直接重试。",
          code: "upstream_cancelled",
        });
        return reply;
      }
      write({
        type: "done",
        ok: false,
        degraded: "error",
        error: "模型这会儿出了点问题，没能整理出答案；下面是按你的收藏翻到的相关卡片。",
        citations: localCards,
        suggestions: suggestFollowups(prep.candidates),
        retrieval: retrievalSummary(prep.retrieval),
      });
      return reply;
    }

    if (isUpstreamCancelNotice(rawContent)) {
      write({
        type: "done",
        ok: false,
        error: "上游模型中断了本次回答（不是你的操作），可直接重试。",
        code: "upstream_cancelled",
      });
      return reply;
    }

    const parsed = parseAskModelOutput(rawContent, prep.candidates);
    if (!parsed) {
      // 模型输出无法解析成带引用的答案：不透传原文，按模型错误降级并附本地卡片。
      write({
        type: "done",
        ok: false,
        degraded: "error",
        error: "模型返回的内容无法解析成带引用的答案，请换个说法再试一次。",
        citations: localCards,
        suggestions: suggestFollowups(prep.candidates),
        retrieval: retrievalSummary(prep.retrieval),
      });
      return reply;
    }

    // 终稿引用表：只含答案实际引用的候选，按首次出现顺序，前端只渲染这张表。
    const citedOrder: string[] = [];
    for (const seg of parsed.answer) {
      for (const id of seg.citations) {
        if (!citedOrder.includes(id)) citedOrder.push(id);
      }
    }
    const byId = new Map(prep.candidates.map((c) => [c.siteId, c]));
    const citations = citedOrder
      .map((id) => byId.get(id))
      .filter((c): c is AskCandidate => Boolean(c))
      .map((c) => cardOf(c));
    write({
      type: "done",
      ok: true,
      mode: "ai",
      degraded: null,
      model,
      answer: parsed.answer,
      citations,
      suggestions: suggestFollowups(prep.candidates),
      retrieval: retrievalSummary(prep.retrieval),
      droppedCitations: parsed.droppedCitations,
      unverifiedLinks: parsed.unverifiedLinks,
      droppedSegments: parsed.droppedSegments,
    });
    return reply;
  } finally {
    heartbeat.stop();
    cleanupAbort();
    if (!reply.raw.writableEnded) {
      try {
        reply.raw.end();
      } catch {
        // 客户端已断开：end 失败无需处理
      }
    }
    closed = true;
  }
}
