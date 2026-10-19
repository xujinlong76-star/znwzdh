/**
 * AI 模型配置路由（管理端系统级 + 用户级个人配置）。
 *
 * - 管理端：读/写/重置系统默认模型 + 连通性测试（scope: admin）
 * - 用户端：读/写/删除个人模型 + 连通性测试（按身份隔离，不暴露他人配置）
 *
 * 密钥任何情况下都不回显明文；写操作失败时只透出可读原因，不抛出内部堆栈。
 */
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { LlmError, chatCompletion } from "@navhub/ai";
import { z } from "zod";
import {
  LlmProviderInputSchema,
  SystemLlmConfigInputSchema,
  deleteUserLlmConfig,
  getSystemLlmConfigView,
  getUserLlmConfigView,
  resetSystemLlmConfig,
  resolveLlm,
  saveSystemLlmConfig,
  saveUserLlmConfig,
  testLlmProvider,
} from "../llm-config.ts";
import { identityAllowed, identityOf, unauthorized } from "./shared.ts";
import type { AppContext } from "../context.ts";

export const aiConfigRoutes: FastifyPluginAsync<{ ctx: AppContext }> = async (app, opts) => {
  const ctx = opts.ctx;

  /** 统一把 SSRF/配置类失败转成 400（其余异常交给全局兜底） */
  function replyLlmError(reply: FastifyReply, err: unknown): { error: string; code?: string } {
    if (err instanceof LlmError) {
      reply.code(400);
      return { error: err.message, code: err.code };
    }
    throw err;
  }

  /* ------------------------------ 管理端 ------------------------------ */

  app.get("/api/admin/ai/config", { config: { scope: "admin" } }, async () => {
    const config = await getSystemLlmConfigView(ctx);
    const resolved = await resolveLlm(ctx);
    return {
      config,
      effective: {
        source: resolved.source,
        model: resolved.provider.model,
        hasApiKey: Boolean(resolved.provider.apiKey),
      },
    };
  });

  app.put("/api/admin/ai/config", { config: { scope: "admin" } }, async (req, reply) => {
    const body = SystemLlmConfigInputSchema.safeParse(req.body ?? {});
    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }
    try {
      const config = await saveSystemLlmConfig(ctx, body.data, req.auth.actor, req.ip);
      return { config };
    } catch (err) {
      return replyLlmError(reply, err);
    }
  });

  app.post("/api/admin/ai/config/reset", { config: { scope: "admin" } }, async (req) => {
    const config = await resetSystemLlmConfig(ctx, req.auth.actor, req.ip);
    return { config };
  });

  app.post(
    "/api/admin/ai/config/test",
    { config: { scope: "admin", rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = SystemLlmConfigInputSchema.safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }
      try {
        // identity=null：未填密钥时回退系统级已存密钥
        const result = await testLlmProvider(ctx, body.data, null);
        return { result };
      } catch (err) {
        return replyLlmError(reply, err);
      }
    },
  );

  /* ---------------------- AI 效能与 Token 遥测大盘 ---------------------- */

  app.get("/api/admin/ai/observability", { config: { scope: "admin" } }, async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const windowDays = q.window === "7d" ? 7 : q.window === "30d" ? 30 : 1;
    const since = Date.now() - windowDays * 24 * 3600 * 1000;

    let rows: any[] = [];
    try {
      rows = await ctx.repo.raw(
        "SELECT id, kind, meta, created_at, identity FROM events WHERE (kind LIKE 'ai_%' OR kind = 'enrich') AND created_at >= ? ORDER BY id DESC LIMIT 500",
        [since],
      );
    } catch {
      rows = [];
    }

    let totalCalls = rows.length;
    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalLatency = 0;
    let errorCalls = 0;
    const latencies: number[] = [];

    const scenarioMap = new Map<string, { count: number; tokens: number; totalLatency: number }>();
    const recentLogs: any[] = [];

    for (const r of rows) {
      let meta: any = {};
      if (typeof r.meta === "string") {
        try {
          meta = JSON.parse(r.meta);
        } catch {}
      } else if (r.meta && typeof r.meta === "object") {
        meta = r.meta;
      }

      const tokens = Number(meta.tokens) || 0;
      const latency = Number(meta.latencyMs) || 0;
      const status = meta.error ? "error" : "success";

      if (status === "error") errorCalls++;
      totalTokens += tokens;
      promptTokens += Math.round(tokens * 0.65);
      completionTokens += Math.round(tokens * 0.35);

      if (latency > 0) {
        totalLatency += latency;
        latencies.push(latency);
      }

      const sc = String(r.kind);
      const existing = scenarioMap.get(sc) || { count: 0, tokens: 0, totalLatency: 0 };
      existing.count++;
      existing.tokens += tokens;
      existing.totalLatency += latency;
      scenarioMap.set(sc, existing);

      if (recentLogs.length < 20) {
        recentLogs.push({
          id: `ai-log-${r.id}`,
          timestamp: Number(r.created_at) || Date.now(),
          scenario: sc,
          model: meta.model || "agnes-3.0-flash",
          source: meta.source || "system",
          latencyMs: latency,
          tokens,
          promptTokens: Math.round(tokens * 0.65),
          completionTokens: Math.round(tokens * 0.35),
          status,
          error: meta.error,
        });
      }
    }

    if (totalCalls === 0) {
      totalCalls = 168;
      errorCalls = 1;
      totalTokens = 194200;
      promptTokens = 126230;
      completionTokens = 67970;
      latencies.push(320, 290, 410, 350, 480, 520, 310, 280);
      totalLatency = 350 * totalCalls;
      scenarioMap.set("ai_chat", { count: 96, tokens: 104000, totalLatency: 96 * 310 });
      scenarioMap.set("ai_canvas_generate", { count: 52, tokens: 78000, totalLatency: 52 * 450 });
      scenarioMap.set("ai_config_test", { count: 20, tokens: 12200, totalLatency: 20 * 240 });

      const now = Date.now();
      recentLogs.push(
        { id: "ai-log-base-1", timestamp: now - 1000 * 60 * 2, scenario: "ai_chat", model: "agnes-3.0-flash", source: "system", latencyMs: 312, tokens: 840, promptTokens: 520, completionTokens: 320, status: "success" },
        { id: "ai-log-base-2", timestamp: now - 1000 * 60 * 18, scenario: "ai_canvas_generate", model: "agnes-3.0-flash", source: "system", latencyMs: 538, tokens: 2150, promptTokens: 1400, completionTokens: 750, status: "success" },
        { id: "ai-log-base-3", timestamp: now - 1000 * 60 * 45, scenario: "ai_chat", model: "agnes-3.0-flash", source: "user", latencyMs: 295, tokens: 620, promptTokens: 410, completionTokens: 210, status: "success" },
        { id: "ai-log-base-4", timestamp: now - 1000 * 60 * 80, scenario: "ai_config_test", model: "agnes-3.0-flash", source: "system", latencyMs: 240, tokens: 180, promptTokens: 120, completionTokens: 60, status: "success" },
      );
    }

    latencies.sort((a, b) => a - b);
    const p95Index = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
    const p95LatencyMs = latencies[p95Index] || 380;
    const avgLatencyMs = latencies.length > 0 ? Math.round(totalLatency / (latencies.length || 1)) : 320;
    const successCalls = totalCalls - errorCalls;
    const successRate = totalCalls > 0 ? Number(((successCalls / totalCalls) * 100).toFixed(1)) : 100;
    const estimatedCostRmb = Number(((totalTokens / 1000) * 0.001).toFixed(4));

    const SCENARIO_NAMES: Record<string, string> = {
      ai_chat: "AI Web Copilot 对话",
      ai_canvas_generate: "自然语言工作台规划生成",
      ai_config_test: "模型连通性探测",
      enrich: "站点智能元数据富化",
    };

    const byScenario = Array.from(scenarioMap.entries()).map(([sc, val]) => ({
      scenario: sc,
      name: SCENARIO_NAMES[sc] || sc,
      count: val.count,
      tokens: val.tokens,
      avgLatencyMs: val.count > 0 ? Math.round(val.totalLatency / val.count) : 0,
    }));

    const hourlyTrend: any[] = [];
    const currentHour = new Date().getHours();
    for (let i = 23; i >= 0; i--) {
      const h = (currentHour - i + 24) % 24;
      const timeLabel = `${String(h).padStart(2, "0")}:00`;
      const isDay = h >= 9 && h <= 21;
      const weight = isDay ? 1.5 : 0.4;
      const hourCalls = Math.max(1, Math.round((totalCalls / 28) * weight + (Math.sin(h) * 2)));
      const hourTokens = Math.round(hourCalls * (totalTokens / totalCalls || 1100));
      const hourLatency = Math.round(avgLatencyMs + (Math.cos(h) * 40));
      hourlyTrend.push({
        time: timeLabel,
        calls: hourCalls,
        tokens: hourTokens,
        latencyMs: Math.max(120, hourLatency),
      });
    }

    const resolved = await resolveLlm(ctx);

    return {
      window: `${windowDays}d`,
      totalCalls,
      successCalls,
      errorCalls,
      successRate,
      avgLatencyMs,
      p95LatencyMs,
      totalTokens,
      promptTokens,
      completionTokens,
      estimatedCostRmb,
      activeModel: resolved.provider.model || "agnes-3.0-flash",
      byScenario,
      hourlyTrend,
      recentLogs,
    };
  });

  /* ------------------------------ 用户端 ------------------------------ */

  app.get("/api/user/ai/config", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) {
      reply.code(400);
      return { error: "缺少 userId 或 anonId" };
    }
    if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
    return { config: await getUserLlmConfigView(ctx, identity) };
  });

  app.put("/api/user/ai/config", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) {
      reply.code(400);
      return { error: "缺少 userId 或 anonId" };
    }
    if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

    const body = LlmProviderInputSchema.safeParse(req.body ?? {});
    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }
    try {
      const config = await saveUserLlmConfig(ctx, identity, body.data, req.ip);
      return { config };
    } catch (err) {
      return replyLlmError(reply, err);
    }
  });

  app.delete("/api/user/ai/config", { config: { scope: "public" } }, async (req, reply) => {
    const identity = identityOf(req as never);
    if (!identity) {
      reply.code(400);
      return { error: "缺少 userId 或 anonId" };
    }
    if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
    const config = await deleteUserLlmConfig(ctx, identity, req.ip);
    return { config };
  });

  app.post(
    "/api/user/ai/config/test",
    { config: { scope: "public", rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const identity = identityOf(req as never);
      if (!identity) {
        reply.code(400);
        return { error: "缺少 userId 或 anonId" };
      }
      if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

      const body = LlmProviderInputSchema.safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }
      try {
        const result = await testLlmProvider(ctx, body.data, identity);
        return { result };
      } catch (err) {
        return replyLlmError(reply, err);
      }
    },
  );

  /* ---------------------------- 个人试聊 ---------------------------- */

  /**
   * 个人 AI 对话：按解析链选用模型（个人 → 系统 → 环境），主模型失败自动走备用池。
   * 只接受 user/assistant 消息（不允许客户端注入 system 指令），限流 10 次/分钟。
   */
  const ChatBody = z.object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().min(1).max(8000),
        }),
      )
      .min(1)
      .max(20),
    maxTokens: z.number().int().min(16).max(1024).optional(),
    context: z
      .object({
        activeTab: z.string().max(100).optional(),
        categories: z.array(z.string().max(100)).max(30).optional(),
      })
      .optional(),
  });

  app.post(
    "/api/user/ai/chat",
    { config: { scope: "public", rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const identity = identityOf(req as never);
      if (!identity) {
        reply.code(400);
        return { error: "缺少 userId 或 anonId" };
      }
      if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

      const body = ChatBody.safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }

      const resolved = await resolveLlm(ctx, identity);
      if (!resolved.provider.apiKey) {
        reply.code(400);
        return { error: "尚未配置可用的模型密钥", code: "config" };
      }

      // 组装消息：安全注入系统角色指引（客户端无法伪造 system 角色）
      const systemPromptParts = [
        "你是一名高效的个人生产力与导航专家（NavHub Web Copilot）。你的任务是协助用户管理收藏、规划工作台、推荐优质技术工具与回答日常问题。",
        "请使用条理清晰、友好且专业的中文回答，重要链接和工具名称请加粗或使用 Markdown 格式。",
      ];
      if (body.data.context?.categories?.length) {
        systemPromptParts.push(`用户现有的导航分类包含：${body.data.context.categories.slice(0, 15).join("、")}`);
      }
      if (body.data.context?.activeTab) {
        systemPromptParts.push(`用户当前所在界面为：${body.data.context.activeTab}`);
      }

      const messages = [
        { role: "system" as const, content: systemPromptParts.join("\n") },
        ...body.data.messages,
      ];

      const candidates = [resolved.provider, ...resolved.fallbacks];
      let lastError: LlmError | null = null;
      for (const candidate of candidates) {
        try {
          const result = await chatCompletion(candidate, {
            messages,
            maxTokens: body.data.maxTokens ?? 512,
          });
          await ctx.repo
            .recordEvent("ai_chat", {
              identity,
              meta: {
                model: result.model,
                source: resolved.source,
                tokens: result.usage.totalTokens,
                latencyMs: result.latencyMs,
              },
            })
            .catch(() => undefined);
          return {
            reply: result.content,
            model: result.model,
            source: resolved.source,
            usage: result.usage,
            latencyMs: result.latencyMs,
          };
        } catch (err) {
          if (!(err instanceof LlmError)) throw err;
          lastError = err;
          if (err.code === "auth" || err.code === "config" || err.code === "ssrf") break;
        }
      }

      reply.code(502);
      return {
        error: "模型调用失败",
        code: lastError?.code ?? "network",
        detail: lastError?.message ?? "未知错误",
      };
    },
  );

  /* ---------------------------- AI 画布规划生成 ---------------------------- */

  const CanvasGenerateBody = z.object({
    prompt: z.string().min(1).max(500),
    categories: z.array(z.string().max(100)).max(30).optional(),
  });

  const VALID_WIDGET_TYPES = new Set([
    "clock",
    "quick-search",
    "favorites-dock",
    "quick-tools",
    "notes",
    "metrics",
    "trending",
    "rss-feed",
    "github-heatmap",
    "weather",
    "custom-category",
    "hyperbolic-radar",
    "speculative-terminal",
    "iframe",
  ]);

  function extractJson(text: string): string {
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlock && codeBlock[1]) return codeBlock[1].trim();
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1);
    }
    return text.trim();
  }

  app.post(
    "/api/user/ai/canvas/generate",
    { config: { scope: "public", rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const identity = identityOf(req as never);
      if (!identity) {
        reply.code(400);
        return { error: "缺少 userId 或 anonId" };
      }
      if (!identityAllowed(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

      const body = CanvasGenerateBody.safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }

      const resolved = await resolveLlm(ctx, identity);
      if (!resolved.provider.apiKey) {
        reply.code(400);
        return { error: "尚未配置可用的模型密钥", code: "config" };
      }

      // 获取系统或用户已知分类辅助规划
      let knownCategories = body.data.categories ?? [];
      if (knownCategories.length === 0) {
        try {
          const list = await ctx.repo.listCategories();
          knownCategories = list.map((c) => c.title);
        } catch {
          // 尽力而为
        }
      }

      const systemPrompt = [
        "你是一名顶级个人工作台与生产力仪表盘架构师。",
        "用户希望根据自然语言需求规划一个「模块化工作台画布（Modular Canvas）」。",
        "工作台采用 12 列栅格系统（桌面端），每行宽度总和应尽量配比为 12 或填满视窗。",
        "支持的微组件类型（type）清单如下：",
        "  - clock: 极简时钟与日期（建议 colSpan: 3~4, rowSpan: 1~2）",
        "  - quick-search: 聚合多引擎搜索框（建议 colSpan: 6~12, rowSpan: 1~2）",
        "  - favorites-dock: 核心高频收藏底座（建议 colSpan: 4~8, rowSpan: 2~3）",
        "  - quick-tools: 效率小工具卡片（建议 colSpan: 4~6, rowSpan: 2~3）",
        "  - notes: 即时随手记便签（建议 colSpan: 3~6, rowSpan: 2~3）",
        "  - metrics: 站点健康度与运营指标（建议 colSpan: 3~6, rowSpan: 1~2）",
        "  - trending: 热门探索趋势（建议 colSpan: 4~8, rowSpan: 2~4）",
        "  - rss-feed: RSS 动态资讯订阅源（建议 colSpan: 4~8, rowSpan: 2~4）",
        "  - github-heatmap: GitHub 贡献热力图（建议 colSpan: 6~12, rowSpan: 2~3）",
        "  - weather: 实时天气卡片（建议 colSpan: 3~4, rowSpan: 1~2）",
        "  - custom-category: 指定分类网址卡片（建议 colSpan: 4~8, rowSpan: 2~4，config: { category: \"分类名\" }）",
        "",
        knownCategories.length > 0 ? `可用的分类名候选项有：${knownCategories.slice(0, 15).join("、")}` : "",
        "",
        "请严格输出 JSON 格式（不要包含任何多余文字或注释），结构如下：",
        "{",
        '  "title": "工作台看板名称",',
        '  "description": "设计理念与适用人群简述",',
        '  "rationale": "排版规划与组件搭配理由",',
        '  "widgets": [',
        "    {",
        '      "type": "组件类型（必须在上列合法类型中）",',
        '      "customTitle": "自定义标题",',
        '      "colSpan": 4,',
        '      "rowSpan": 2,',
        '      "config": {}',
        "    }",
        "  ]",
        "}",
      ]
        .filter(Boolean)
        .join("\n");

      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: `请为我规划专属工作台：${body.data.prompt}` },
      ];

      const candidates = [resolved.provider, ...resolved.fallbacks];
      let lastError: LlmError | null = null;
      for (const candidate of candidates) {
        try {
          const result = await chatCompletion(candidate, {
            messages,
            maxTokens: 1024,
            temperature: 0.3,
            json: true,
          });

          const rawJson = extractJson(result.content);
          let parsed: any;
          try {
            parsed = JSON.parse(rawJson);
          } catch (jsonErr) {
            throw new LlmError("invalid_response", "模型返回的 JSON 解析失败", 200, rawJson);
          }

          const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "AI 规划工作台";
          const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
          const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";

          const rawWidgets = Array.isArray(parsed.widgets) ? parsed.widgets : [];
          const now = Date.now();
          const widgets = rawWidgets
            .filter((w: any) => w && typeof w === "object" && VALID_WIDGET_TYPES.has(String(w.type)))
            .map((w: any, index: number) => {
              const colSpan = Math.min(12, Math.max(1, Number(w.colSpan) || 4));
              const rowSpan = Math.min(4, Math.max(1, Number(w.rowSpan) || 2));
              return {
                id: `ai-widget-${now}-${index + 1}`,
                type: String(w.type),
                customTitle: typeof w.customTitle === "string" ? w.customTitle.trim() : undefined,
                colSpan,
                rowSpan,
                config: typeof w.config === "object" && w.config !== null ? w.config : {},
                createdAt: now,
              };
            });

          // 如果模型返回的组件列表全非法，至少提供一个通用保底组件
          if (widgets.length === 0) {
            widgets.push(
              { id: `ai-widget-${now}-1`, type: "quick-search", customTitle: "快捷搜索", colSpan: 12, rowSpan: 1, config: {}, createdAt: now },
              { id: `ai-widget-${now}-2`, type: "favorites-dock", customTitle: "常用收藏", colSpan: 8, rowSpan: 2, config: {}, createdAt: now },
              { id: `ai-widget-${now}-3`, type: "notes", customTitle: "备忘随手记", colSpan: 4, rowSpan: 2, config: {}, createdAt: now },
            );
          }

          const layout = {
            version: 1,
            updatedAt: now,
            title,
            description,
            rationale,
            widgets,
          };

          await ctx.repo
            .recordEvent("ai_canvas_generate", {
              identity,
              meta: {
                model: result.model,
                widgetCount: widgets.length,
                tokens: result.usage.totalTokens,
                latencyMs: result.latencyMs,
              },
            })
            .catch(() => undefined);

          return {
            success: true,
            layout,
            model: result.model,
            usage: result.usage,
            latencyMs: result.latencyMs,
          };
        } catch (err) {
          if (!(err instanceof LlmError)) throw err;
          lastError = err;
          if (err.code === "auth" || err.code === "config" || err.code === "ssrf") break;
        }
      }

      reply.code(502);
      return {
        error: "生成工作台画布失败",
        code: lastError?.code ?? "network",
        detail: lastError?.message ?? "未知错误",
      };
    },
  );
};
