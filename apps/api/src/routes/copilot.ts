/**
 * Agnes 3.0 Flash AI Web Copilot 伴侣路由
 * 提供全站意图理解、工具智能推荐、对话式导航与问答
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { llmProviderReady, resolveLlm } from "../llm-config.ts";
import { callLlm } from "../llm-usage.ts";
import { identityOf, identityTrusted } from "./shared.ts";
import type { AppContext } from "../context.ts";

const chatSchema = z.object({
  message: z.string().min(1, "消息内容不能为空").max(8000, "消息过长"),
  thinking: z.boolean().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
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
     * 自报身份必须先过第二轴（见 `shared.ts` 的 `identityTrusted`）。
     * 本路由是 `scope:"public"`：不过闸门就等价于「任何人自称 `github:<别人>`，
     * `resolveLlm` 就去解**那个人**存的个人 API Key 跑这次对话」——白烧他人配额，
     * 用量还记到他人账上。过不了的调用方降级用系统级配置，功能不中断。
     */
    const identity = identityTrusted(ctx, req as never) ? identityOf(req as never) : null;
    const llm = await resolveLlm(ctx, identity);

    // 收集全站实时上下文（分类与核心站点）
    const [categories, sites] = await Promise.all([
      ctx.repo.listCategories(),
      ctx.repo.listSites({ limit: 40, status: "active" }),
    ]);

    const catNames = categories.map((c) => c.title).slice(0, 15).join("、");
    const siteSummaries = sites
      .slice(0, 25)
      .map((s) => `[${s.title}](${s.url})（${s.description || "实用站点"}）`)
      .join("\n- ");

    const systemPrompt = `你是 Agnes 3.0 Flash，NavHub 的智慧导航伴侣（AI Web Copilot）。
你具备全站资源理解、意图感知与精准工具链推荐能力。

【NavHub 现场知识背景】：
- 全站包含主要分类：${catNames || "开发运维、前端技术、AI 工具、设计灵感、效率办公"}
- 收录的部分精选站点：
- ${siteSummaries || "[GitHub](https://github.com)（开源代码托管）"}
${context.activeCategory ? `- 用户当前正在浏览分类：【${context.activeCategory}】` : ""}
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
      if (llmProviderReady(llm.provider)) {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          ...history.slice(-6).map((h) => ({
            role: h.role as "user" | "assistant",
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
        });

        if (res.content) {
          // 提取建议项
          const lines = res.content.split("\n");
          const suggestions = lines
            .filter((l) => l.trim().startsWith("💡"))
            .map((l) => l.replace(/^💡\s*/, "").trim())
            .slice(0, 3);

          return {
            ok: true,
            reply: res.content,
            reasoningContent: res.reasoningContent,
            model: res.model || llm.provider.model,
            suggestions:
              suggestions.length > 0
                ? suggestions
                : ["查看同类热门工具", "导出离线阅读快照", "打开知识拓扑星图"],
          };
        }
      }
    } catch {
      // 容错降级进入本地启发式推荐
    }

    // 本地启发式智能应答兜底
    let replyText = `您好！我是 **Agnes 3.0 Flash** 导航伴侣。\n\n针对您的提问 **「${message}」**：\n\n`;
    if (fallbackSites.length > 0) {
      replyText += `已在当前 NavHub 知识库为您匹配到以下核心工具：\n\n`;
      for (const s of fallbackSites) {
        replyText += `- [${s.title}](${s.url})：${s.description || "实用高效工具"}\n`;
      }
      replyText += `\n您可以直接点击上方链接直达，或通过快捷键 \`Cmd+K\` 启动全局即时穿梭检索。`;
    } else {
      replyText += `NavHub 当前已收录丰富的开发、设计与极客工具生态。建议您可以通过顶部分类 **${catNames || "综合分类"}** 进一步探索，或使用 Spotlight 极客沙箱进行全库模糊寻路。`;
    }

    return {
      ok: true,
      reply: replyText,
      model: llm.provider.model || "agnes-3.0-flash",
      suggestions: [
        "推荐适合前端开发的效率神器",
        "帮我整理当前全站 AI 工具链",
        "有哪些离线可用的极客微工具？",
      ],
    };
  });
};
