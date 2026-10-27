/**
 * Agnes 3.0 Flash AI Web Copilot 伴侣路由
 * 提供全站意图理解、工具智能推荐、对话式导航与问答
 */
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { LlmError } from "@navhub/ai";
import { llmProviderReady, resolveLlm } from "../llm-config.ts";
import { checkLlmQuota } from "../llm-quota.ts";
import { callLlm } from "../llm-usage.ts";
import { requestIdentityOf, identityTrusted } from "./shared.ts";
import type { AppContext } from "../context.ts";

/**
 * 把「客户端半路挂断」翻译成 AbortSignal，供 `callLlm` 中断模型调用。
 *
 * 为什么判据是 `writableEnded`：node http 的 `'close'` 在**响应正常写完**时同样触发
 * （见 Node 文档 event-close_2），只看 close 会把每一次成功回答都记成取消。
 * 摘监听器挂在 `'finish'` 上，避免 keep-alive 连接反复复用 reply.raw 时累积监听器。
 */
export function bindReplyAbort(reply: FastifyReply): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onClose = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  const cleanup = () => {
    reply.raw.off("close", onClose);
    reply.raw.off("finish", cleanup);
  };
  reply.raw.on("close", onClose);
  reply.raw.on("finish", cleanup);
  return { signal: controller.signal, cleanup };
}

const chatSchema = z.object({
  message: z.string().min(1, "消息内容不能为空").max(8000, "消息过长"),
  thinking: z.boolean().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000, "历史消息过长"),
      })
    )
    .max(20, "历史消息过多")
    .optional(),
  context: z
    .object({
      currentQuery: z.string().optional(),
      activeCategory: z.string().optional(),
    })
    .optional(),
});

export const copilotRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  // LLM 调用成本远高于普通读接口：全局 300/min 兜底不够，单 IP 独立额度 20/min
  app.post(
    "/api/copilot/chat",
    { config: { scope: "public", rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: "INVALID_REQUEST",
        message: parsed.error.issues[0]?.message || "请求参数错误",
      };
    }

    const { message, thinking, history = [], context = {} } = parsed.data;
    /**
     * 取消链路的中枢这一跳：浏览器 fetch 的 signal 到代理为止（代理把断连转成
     * 对中枢的请求取消），这里再把它接到 reply.raw 上，模型调用才真能停。
     */
    const { signal: clientSignal } = bindReplyAbort(reply);
    const startedAt = Date.now();
    /**
     * 自报身份必须先过第二轴（见 `shared.ts` 的 `identityTrusted`）。
     * 本路由是 `scope:"public"`：不过闸门就等价于「任何人自称 `github:<别人>`，
     * `resolveLlm` 就去解**那个人**存的个人 API Key 跑这次对话」——白烧他人配额，
     * 用量还记到他人账上。过不了的调用方降级用系统级配置，功能不中断。
     */
    const identity = identityTrusted(ctx, req as never) ? requestIdentityOf(req as never) : null;
    const llm = await resolveLlm(ctx, identity);

    /**
     * 额度闸门（`llm-quota.ts`）。
     *
     * 这里**不**返回 429：下面本来就有一条完整的本地启发式兜底（按关键词从库里
     * 匹配站点并给出链接），把用户挡在门外比给他兜底答案更差。要的是两件事：
     *  1. 真的不再调用模型（不再花钱）；
     *  2. 响应里如实带上 `degraded` 与额度明细，前端才能写「今天的 AI 额度到顶了，
     *     X 小时后恢复，下面是不走模型的站内匹配结果」，而不是把兜底冒充成模型回答。
     */
    const quota = await checkLlmQuota(ctx, identity);
    const quotaInfo = quota.ok ? null : {
      scope: quota.error.scope,
      metric: quota.error.metric,
      limit: quota.error.limit,
      used: quota.error.used,
      retryAfterSeconds: Math.max(1, Math.ceil(quota.error.retryAfterMs / 1000)),
    };
    if (!quota.ok) reply.header("retry-after", String(quotaInfo?.retryAfterSeconds));

    // 收集全站实时上下文（分类与核心站点）
    const [categories, sites] = await Promise.all([
      ctx.repo.listCategories(),
      ctx.repo.listSites({ limit: 40, status: "active" }),
    ]);

    /**
     * 用户个人上下文（T21）：画像摘要 + 收藏夹结构 + 最近搜索（受用户自己的
     * searchHistoryEnabled 开关控制）。identity 是 identityTrusted 闸门之后的值，
     * 与 resolveLlm 取密钥的身份一致——不会借注入读他人数据。
     * 刻意保持小体积（百级 token）：系统提示词每次对话都要全量发送。
     */
    let personalBlock = "";
    let telemetryEnabled = true;
    if (identity) {
      const [profile, folders, settings] = await Promise.all([
        ctx.repo.getUserProfile(identity).catch(() => null),
        ctx.repo.listFavoriteFolders(identity).catch(() => []),
        ctx.repo.getUserSettings(identity).catch(() => null),
      ]);
      telemetryEnabled = settings?.telemetryEnabled !== false;
      const parts: string[] = [];
      if (profile && (profile.topCategories.length > 0 || profile.topTags.length > 0)) {
        parts.push(
          "- 近 30 天偏好分类：" + profile.topCategories.slice(0, 5).join("、") +
          (profile.topTags.length > 0 ? "；高频标签：" + profile.topTags.slice(0, 6).join("、") : ""),
        );
      }
      if (folders.length > 0) {
        parts.push("- 用户收藏夹：" + folders.map((f) => f.name).slice(0, 8).join("、"));
      }
      if (settings?.searchHistoryEnabled) {
        const recent = await ctx.repo.listSearchHistory(identity, 5).catch(() => []);
        if (recent.length > 0) {
          parts.push("- 最近搜索：" + recent.map((h) => h.query).join("、"));
        }
      }
      if (parts.length > 0) {
        personalBlock =
          "\n【用户个人上下文（仅用于个性化本次回答，不要在回答中复述或外泄）】：\n" +
          parts.join("\n") +
          "\n";
      }
    }

    /**
     * 事件归属身份：与 `/api/search`（search.ts:128）、`/api/events`（telemetry.ts:78-86）
     * 同一口径——注销与导出按 `events.identity` 圈范围，关遥测的用户不留身份。
     */
    const attributedIdentity = identity && telemetryEnabled ? identity : null;

    /**
     * copilot 的用户面记账（此前实测 `events kind='copilot'` 恒 0 行：这条主路径在
     * 后台事件面板里完全隐形，「用户到底等了多久」无法量化）。
     *
     * 只记维度、**不记问题原文**：message 最长 8000 字符且是自由文本，写进 events
     * 等于新开一个可导出、可被管理端看到的原文存储，而大盘要的是档位、时延与降级原因。
     */
    const recordCopilot = (
      kind: "copilot" | "copilot_cancel",
      dims: { degraded?: string | null; model?: string | null; replyChars?: number; stage?: "pre_llm" | "llm" },
    ) => {
      void ctx.repo
        .recordEvent(kind, {
          identity: attributedIdentity ?? undefined,
          meta: {
            thinking: thinking ?? null,
            degraded: dims.degraded ?? null,
            model: dims.model ?? null,
            reply_chars: dims.replyChars ?? 0,
            waited_ms: Date.now() - startedAt,
            quota_limited: quotaInfo !== null,
            ...(dims.stage ? { stage: dims.stage } : {}),
          },
        })
        .catch(() => undefined);
    };

    const catNames = categories.map((c) => c.title).slice(0, 15).join("、");
    const siteSummaries = sites
      .slice(0, 25)
      .map((s) => `[${s.title}](${s.url})（${s.description || "实用站点"}）`)
      .join("\n- ");

    const systemPrompt = `你是 Agnes 3.0 Flash，山羊胡的智慧导航伴侣（AI Web Copilot）。
你具备全站资源理解、意图感知与精准工具链推荐能力。

【山羊胡现场知识背景】：
- 全站包含主要分类：${catNames || "开发运维、前端技术、AI 工具、设计灵感、效率办公"}
- 收录的部分精选站点：
- ${siteSummaries || "[GitHub](https://github.com)（开源代码托管）"}
${personalBlock}${context.activeCategory ? `- 用户当前正在浏览分类：【${context.activeCategory}】` : ""}
${context.currentQuery ? `- 用户当前搜索关键词：【${context.currentQuery}】` : ""}

【回答规范】：
1. 态度极客、专业、诚恳，用条理清晰的 Markdown 输出；
2. 推荐站点时务必使用 Markdown 链接格式：[工具名](URL)；
3. 如果用户询问工具链，按阶段或职责分点推荐（例如：需求设计 -> 前端开发 -> 部署上线）；
4. 回答最后提供 2~3 个精炼的相关探索建议，每个建议以 "💡 " 开头单独成行。`;

    const fallbackSites = sites
      .filter((s) => {
        const q = message.toLowerCase();
        return (
          s.title.toLowerCase().includes(q) ||
          (s.description || "").toLowerCase().includes(q) ||
          (s.tags || []).some((t) => t.toLowerCase().includes(q))
        );
      })
      .slice(0, 5);

    try {
      if (quotaInfo === null && llmProviderReady(llm.provider)) {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          ...history.slice(-6).map((h) => ({
            role: (h.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
            content: h.content,
          })),
          { role: "user", content: message },
        ];

        const res = await callLlm(ctx, llm, {
          scenario: "copilot",
          identity,
          messages,
          temperature: 0.6,
          maxTokens: 1200,
          thinking,
          signal: clientSignal,
        });

        if (res.content) {
          // 提取建议项
          const lines = res.content.split("\n");
          const suggestions = lines
            .filter((l) => l.trim().startsWith("💡"))
            .map((l) => l.replace(/^💡\s*/, "").trim())
            .slice(0, 3);

          const model = res.model || llm.provider.model;
          recordCopilot("copilot", { model, replyChars: res.content.length });

          return {
            ok: true,
            reply: res.content,
            reasoningContent: res.reasoningContent,
            model,
            suggestions:
              suggestions.length > 0
                ? suggestions
                : ["查看同类热门工具", "导出离线阅读快照", "打开知识拓扑星图"],
          };
        }
      }
    } catch (err) {
      // 容错降级进入本地启发式推荐；「用户已取消」不在这里冒充「模型坏了」，
      // 由下面的取消闸门统一拦。
      //
      // 例外：上游网关把取消当 200 正常回答返回（content = 用户已取消）时，
      // 必须在这里就地收口——继续走兜底会把「取消」记成一次降级成功，
      // 用户也会看到一条不是模型说的话。直接按取消记账并给可重试提示。
      if (err instanceof LlmError && err.code === "cancelled") {
        recordCopilot("copilot_cancel", { stage: "llm" });
        return {
          ok: false,
          error: "上游模型中断了本次回答（不是你的操作），可直接重试。",
          code: "upstream_cancelled",
        };
      }
    }

    /**
     * 取消闸门（必须在兜底之前）：客户端已经不等了就别再产出答案。
     * 此前这条路径会把站内关键词匹配的结果当一次正常回答写完并记账，
     * 「用户按了停止」在大盘里长成「降级答案成功」，取消率永远量不出来。
     */
    if (clientSignal.aborted) {
      const reachedLlm = quotaInfo === null && llmProviderReady(llm.provider);
      recordCopilot("copilot_cancel", { stage: reachedLlm ? "llm" : "pre_llm" });
      reply.code(499);
      return { ok: false, error: "请求已取消", code: "client_closed" };
    }

    // 本地启发式智能应答兜底
    const degraded = quotaInfo ? "quota" : llmProviderReady(llm.provider) ? "error" : "unconfigured";
    /**
     * 兜底答案是站内关键词匹配出来的，不是模型生成的。开头若仍以「我是 Agnes
     * 导航伴侣」的口吻说话，用户会把「站内没匹配到」读成「AI 认为没有」，
     * 也会把额度用光当成产品故障。三档降级各给一句真话，再给匹配结果。
     */
    let preamble: string;
    if (degraded === "quota") {
      const hours = Math.max(1, Math.ceil((quotaInfo?.retryAfterSeconds ?? 0) / 3600));
      preamble = `今天的 AI 对话额度已用完（${quotaInfo?.metric ?? "calls"}：${quotaInfo?.used ?? 0}/${quotaInfo?.limit ?? 0}，约 ${hours} 小时后恢复）。以下结果由**站内关键词匹配**给出，未经模型生成。\n\n`;
    } else if (degraded === "unconfigured") {
      preamble = `管理端尚未配置可用的模型密钥，以下结果由**站内关键词匹配**给出。\n\n`;
    } else {
      preamble = `模型暂时不可用，已降级为**站内关键词匹配**。\n\n`;
    }
    let replyText = `${preamble}针对您的提问 **「${message}」**：\n\n`;
    if (fallbackSites.length > 0) {
      replyText += `已在当前山羊胡知识库为您匹配到以下核心工具：\n\n`;
      for (const s of fallbackSites) {
        replyText += `- [${s.title}](${s.url})：${s.description || "实用高效工具"}\n`;
      }
      replyText += `\n您可以直接点击上方链接直达，或通过快捷键 \`Cmd+K\` 启动全局即时穿梭检索。`;
    } else {
      replyText += `山羊胡当前已收录丰富的开发、设计与极客工具生态。建议您可以通过顶部分类 **${catNames || "综合分类"}** 进一步探索，或使用 Spotlight 极客沙箱进行全库模糊寻路。`;
    }

    recordCopilot("copilot", { degraded, model: "local-heuristic-match", replyChars: replyText.length });

    return {
      ok: true,
      reply: replyText,
      // 兜底路径**没有**模型参与，所以不能报一个模型名冒充来源（历史写法是
      // `llm.provider.model || "agnes-3.0-flash"`，其中后半截是硬编码的假名字：
      // 管理端没配 key 时它也会被报成「用了 agnes-3.0-flash」）。
      // 这里一律回固定哨兵，前端与观测面板据此区分真实调用与站内匹配。
      model: "local-heuristic-match",
      degraded,
      ...(quotaInfo ? { quota: quotaInfo } : {}),
      suggestions: [
        "推荐适合前端开发的效率神器",
        "帮我整理当前全站 AI 工具链",
        "有哪些离线可用的极客微工具？",
      ],
    };
  });
};
