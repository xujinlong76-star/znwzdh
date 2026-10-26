/**
 * AI 模型配置路由（管理端系统级 + 用户级个人配置）。
 *
 * - 管理端：读/写/重置系统默认模型 + 连通性测试（scope: admin）
 * - 用户端：读/写/删除个人模型 + 连通性测试（按身份隔离，不暴露他人配置）
 *
 * 密钥任何情况下都不回显明文；写操作失败时只透出可读原因，不抛出内部堆栈。
 */
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { LlmError } from "@navhub/ai";
import { callLlm } from "../llm-usage.ts";
import { z } from "zod";
import {
  LlmProviderInputSchema,
  SystemLlmConfigInputSchema,
  deleteUserLlmConfig,
  getLlmCostUnitPriceRmb,
  getSystemLlmConfigView,
  getUserLlmConfigView,
  llmProviderReady,
  resetSystemLlmConfig,
  resolveLlm,
  saveSystemLlmConfig,
  saveUserLlmConfig,
  testLlmProvider,
} from "../llm-config.ts";
import {
  validatePluginManifestWithCatalog,
  summarizePluginManifest,
  BUILTIN_WIDGET_CATALOG,
  WIDGET_TYPE_NAMES,
} from "@navhub/core";
import { identityTrusted, requestIdentityOf, unauthorized, resolveCanonicalIdentity } from "./shared.ts";
import { checkLlmQuota, replyQuotaBlocked } from "../llm-quota.ts";
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
    // 区间上界取查询开始的那一瞬间：聚合要扫全表，若不固定 until，请求返回前新落库的
    // 调用会只进总额、不进任何时间分桶，大盘尾部凭空少一段。
    const now = Date.now();
    const since = now - windowDays * 24 * 3600 * 1000;

    const agg = await ctx.repo.aggregateLlmUsage({ since, until: now });
    const recent = await ctx.repo.listRecentLlmUsage(20);

    const SCENARIO_NAMES: Record<string, string> = {
      ai_chat: "AI Web Copilot 对话",
      copilot: "智能导航伴侣对话",
      ai_canvas_generate: "自然语言工作台规划生成",
      canvas: "自然语言工作台规划生成",
      ai_config_test: "模型连通性探测",
      plugin_generate: "AI 插件工坊生成",
      plugin_audit: "插件合规审理",
      enrich: "站点智能元数据富化",
      health_audit: "站点自治健康巡检",
      job_enrich: "后台元数据批量刷新",
    };

    const byScenario = agg.byScenario.map((sc) => ({
      scenario: sc.scenario,
      name: SCENARIO_NAMES[sc.scenario] || sc.scenario,
      count: sc.count,
      tokens: sc.tokens,
      avgLatencyMs: sc.avgLatencyMs,
      errorCalls: sc.errorCalls,
    }));

    const hourlyTrend = agg.hourly.map((h) => ({
      time: `${String(h.hour).padStart(2, "0")}:00`,
      calls: h.calls,
      tokens: h.tokens,
      latencyMs: h.avgLatencyMs,
    }));

    const recentLogs = recent.map((r) => ({
      id: `ai-log-${r.id}`,
      timestamp: r.createdAt,
      scenario: r.scenario,
      model: r.model,
      source: r.source,
      latencyMs: r.latencyMs,
      tokens: r.promptTokens + r.completionTokens,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      status: r.ok ? ("success" as const) : ("error" as const),
      error: r.errorCode || undefined,
      thinking: r.thinking,
    }));

    const resolved = await resolveLlm(ctx);
    // 单价必须由运维者显式给出（管理端配置优先，其次环境变量）：以前这里硬编码
    // 0.001 元/1K token，既不是任何厂商的报价，也不区分 prompt/completion，
    // 等于在运维面板上放假账。
    const unitPrice = await getLlmCostUnitPriceRmb(ctx);
    const estimatedCostRmb =
      unitPrice > 0 ? Number(((agg.totalTokens / 1000) * unitPrice).toFixed(4)) : null;

    // 额度闸门：三档里只有「无身份合池」与「运维 key」能整体计量，
    // 单身份档是按人分别限的，聚合出一个总数没有意义 → used 留 null。
    const quotaSince = now - 24 * 3600 * 1000;
    const [systemPool, anonymousPool] = await Promise.all([
      ctx.repo.sumLlmUsage({ since: quotaSince, excludeUserSource: true }),
      ctx.repo.sumLlmUsage({ since: quotaSince, identity: null }),
    ]);
    const qc = ctx.config.llmQuota;

    return {
      window: `${windowDays}d`,
      hasData: agg.totalCalls > 0,
      totalCalls: agg.totalCalls,
      successCalls: agg.successCalls,
      errorCalls: agg.errorCalls,
      successRate: agg.successRate ?? 0,
      avgLatencyMs: agg.avgLatencyMs ?? 0,
      p95LatencyMs: agg.p95LatencyMs ?? 0,
      totalTokens: agg.totalTokens,
      promptTokens: agg.promptTokens,
      completionTokens: agg.completionTokens,
      thinkingCalls: agg.thinkingCalls,
      estimatedCostRmb,
      costUnitPriceRmb: unitPrice > 0 ? unitPrice : null,
      activeModel: resolved.provider.model?.trim() || null,
      quota: {
        windowHours: 24,
        identity: {
          calls: { limit: qc.identityDailyCalls, used: null },
          tokens: { limit: qc.identityDailyTokens, used: null },
        },
        anonymous: {
          calls: { limit: qc.anonymousDailyCalls, used: anonymousPool.calls },
          tokens: { limit: qc.anonymousDailyTokens, used: anonymousPool.tokens },
        },
        system: {
          calls: { limit: qc.systemDailyCalls, used: systemPool.calls },
          tokens: { limit: qc.systemDailyTokens, used: systemPool.tokens },
        },
      },
      byScenario,
      hourlyTrend,
      recentLogs,
    };
  });

  /* ------------------------------ 用户端 ------------------------------ */

  app.get("/api/user/ai/config", { config: { scope: "public" } }, async (req, reply) => {
    const identity = requestIdentityOf(req as never);
    if (!identity) {
      reply.code(400);
      return { error: "缺少 userId 或 anonId" };
    }
    if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
    return { config: await getUserLlmConfigView(ctx, identity) };
  });

  app.put("/api/user/ai/config", { config: { scope: "public" } }, async (req, reply) => {
    const identity = requestIdentityOf(req as never);
    if (!identity) {
      reply.code(400);
      return { error: "缺少 userId 或 anonId" };
    }
    if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

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
    const identity = requestIdentityOf(req as never);
    if (!identity) {
      reply.code(400);
      return { error: "缺少 userId 或 anonId" };
    }
    if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
    const config = await deleteUserLlmConfig(ctx, identity, req.ip);
    return { config };
  });

  app.post(
    "/api/user/ai/config/test",
    { config: { scope: "public", rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const identity = requestIdentityOf(req as never);
      if (!identity) {
        reply.code(400);
        return { error: "缺少 userId 或 anonId" };
      }
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

      const body = LlmProviderInputSchema.safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }
      try {
        const result = await testLlmProvider(ctx, { ...body.data, allowPrivateNetwork: false }, identity);
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
    thinking: z.boolean().optional(),
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
      const identity = requestIdentityOf(req as never);
      if (!identity) {
        reply.code(400);
        return { error: "缺少 userId 或 anonId" };
      }
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

      const body = ChatBody.safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }

      const quota = await checkLlmQuota(ctx, identity);
      if (!quota.ok) return replyQuotaBlocked(reply, quota.error);

      const resolved = await resolveLlm(ctx, identity);
      if (!llmProviderReady(resolved.provider)) {
        reply.code(400);
        return { error: "尚未配置可用的模型密钥", code: "config" };
      }

      // 组装消息：安全注入系统角色指引（客户端无法伪造 system 角色）
      const systemPromptParts = [
        "你是一名高效的个人生产力与导航专家（山羊胡 Web Copilot）。你的任务是协助用户管理收藏、规划工作台、推荐优质技术工具与回答日常问题。",
        "请使用条理清晰、友好且专业的中文回答，重要链接和工具名称请加粗或使用 Markdown 格式。",
      ];
      if (body.data.context?.categories?.length) {
        systemPromptParts.push(
          `用户现有的导航分类包含：${body.data.context.categories
            .slice(0, 15)
            .map((c) => c.replace(/[\r\n]/g, " "))
            .join("、")}`,
        );
      }
      if (body.data.context?.activeTab) {
        systemPromptParts.push(
          `用户当前所在界面为：${body.data.context.activeTab.replace(/[\r\n]/g, " ")}`,
        );
      }

      const messages = [
        { role: "system" as const, content: systemPromptParts.join("\n") },
        ...body.data.messages,
      ];

      try {
        const result = await callLlm(ctx, resolved, {
          scenario: "ai_chat",
          identity,
          messages,
          maxTokens: body.data.maxTokens ?? 512,
          thinking: body.data.thinking,
        });

        return {
          reply: result.content,
          reasoningContent: result.reasoningContent,
          model: result.model,
          source: resolved.source,
          usage: result.usage,
          latencyMs: result.latencyMs,
        };
      } catch (err) {
        const lastError = err instanceof LlmError ? err : null;
        reply.code(502);
        return {
          error: "模型调用失败",
          code: lastError?.code ?? "network",
          detail: err instanceof Error ? err.message : "未知错误",
        };
      }
    },
  );

  /* ---------------------------- AI 画布规划生成 ---------------------------- */

  const CanvasGenerateBody = z.object({
    prompt: z.string().min(1).max(500),
    categories: z.array(z.string().max(100)).max(30).optional(),
  });

  /**
   * 合法模块类型以 core 的模块目录为唯一真相。
   *
   * 此前这里手写了一份 14 项清单，其中 6 项（clock / notes / metrics / trending /
   * weather / iframe）是早已改名的旧标识，而前端真正认识的 trending-radar、
   * markdown-notes、system-metrics、weather-clock、iframe-embed、clock-pomodoro、
   * live-api、declarative-widget 全部缺失。模型按提示词里的旧名输出后，
   * 卡片会被下面的 `.filter(VALID_WIDGET_TYPES.has(...))` 静默丢掉——
   * 用户只看到「AI 生成的排版比规划的少几张」，没有任何错误线索。
   */
  const VALID_WIDGET_TYPES = new Set(Object.keys(BUILTIN_WIDGET_CATALOG));

  /**
   * 提示词里的组件清单同样由 core 模块目录派生。
   * 手写清单正是上一轮漂移的源头：模型被教了 6 个前端根本不认识的类型名。
   */
  function widgetCatalogPromptLines(): string[] {
    return Object.values(BUILTIN_WIDGET_CATALOG).map((meta) => {
      const span = `建议 colSpan ${meta.minColSpan}~${meta.maxColSpan}、rowSpan ${meta.minRowSpan}~${meta.maxRowSpan}`;
      const schema = meta.configSchema ?? [];
      if (schema.length === 0) {
        return `  - ${meta.type}：${meta.title}。${meta.description}${span}，无需配置（config 传 {}）。`;
      }
      const config = schema
        .map((item) => `${item.key}（${item.label}${item.description ? `：${item.description}` : ""}）`)
        .join("；");
      return `  - ${meta.type}：${meta.title}。${meta.description}${span}，配置字段 ${config}。`;
    });
  }

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
      const identity = requestIdentityOf(req as never);
      if (!identity) {
        reply.code(400);
        return { error: "缺少 userId 或 anonId" };
      }
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");

      const body = CanvasGenerateBody.safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }

      const quota = await checkLlmQuota(ctx, identity);
      if (!quota.ok) return replyQuotaBlocked(reply, quota.error);

      const resolved = await resolveLlm(ctx, identity);
      if (!llmProviderReady(resolved.provider)) {
        reply.code(400);
        return { error: "尚未配置可用的模型密钥", code: "config" };
      }

      // 获取系统或用户已知分类辅助规划
      let knownCategories = body.data.categories ?? [];
      if (knownCategories.length === 0) {
        try {
          const list = await ctx.repo.listCategories();
          const hasChild = new Set(list.map((c) => c.parentId).filter((id): id is string => Boolean(id)));
          // 站点只挂叶子类目：给模型推荐根类目等于推荐一张恒为 0 的空卡。
          // 卡片按 slug → id → 唯一标题解析，slug 是跨环境最稳的标识。
          knownCategories = list
            .filter((c) => c.enabled !== false && !hasChild.has(c.id))
            .map((c) => (typeof c.slug === "string" && c.slug.trim() ? c.slug.trim() : c.id))
            .slice(0, 40);
        } catch {
          // 尽力而为
        }
      }

      const systemPrompt = [
        "你是一名顶级个人工作台与生产力仪表盘架构师。",
        "用户希望根据自然语言需求规划一个「模块化工作台画布（Modular Canvas）」。",
        "工作台采用 12 列栅格系统（桌面端），每行宽度总和应尽量配比为 12 或填满视窗。",
        "支持的微组件类型（type）清单如下，type 必须逐字取自下划线标识，不要自创或翻译：",
        ...widgetCatalogPromptLines(),
        "",
        knownCategories.length > 0
          ? `custom-category 卡片的 config.categoryId 请从以下中枢类目标识中挑选（均为叶子类目，留空则自动选站点最多的类目）：${knownCategories.join("、")}`
          : "custom-category 卡片的 config.categoryId 留空即可，卡片会自动选中枢里存活站点最多的叶子类目。",
        "",
        "只规划上面清单里真实存在的类型；一张卡片需要外部输入（如 RSS 地址、GitHub 账号、内嵌网址）而用户没给时，" +
          "仍要输出该卡片，但把对应 config 字段留空字符串——卡片会明确提示用户如何配置，不会展示示例数据。",
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

      try {
        const result = await callLlm(ctx, resolved, {
          scenario: "canvas",
          identity,
          messages,
          maxTokens: 1024,
          temperature: 0.3,
          json: true,
          timeoutMs: 45_000,
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
        const legalWidgets = rawWidgets.filter(
          (w: any) => w && typeof w === "object" && VALID_WIDGET_TYPES.has(String(w.type)),
        );
        // 丢掉非法类型时留下名字：静默丢卡只会让用户以为模型「规划得少」
        const droppedTypes = Array.from(
          new Set(
            rawWidgets
              .filter((w: any) => w && typeof w === "object" && !VALID_WIDGET_TYPES.has(String(w.type)))
              .map((w: any) => String(w.type).trim() || "(空类型)"),
          ),
        ).slice(0, 12);
        const widgets = legalWidgets.map((w: any, index: number) => {
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
            { id: `ai-widget-${now}-3`, type: "markdown-notes", customTitle: "备忘随手记", colSpan: 4, rowSpan: 2, config: {}, createdAt: now },
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

        return {
          success: true,
          layout,
          droppedTypes,
          model: result.model,
          usage: result.usage,
          latencyMs: result.latencyMs,
        };
      } catch (err) {
        const lastError = err instanceof LlmError ? err : null;
        reply.code(502);
        return {
          error: "生成工作台画布失败",
          code: lastError?.code ?? "network",
          detail: err instanceof Error ? err.message : "未知错误",
        };
      }
    },
  );

  /* ---------------------- AI 自然语言插件生成 ---------------------- */

  const PluginGenerateBody = z.object({
    prompt: z.string().min(2, "需求描述至少2个字符").max(1000, "需求描述最多1000字符"),
    kind: z.enum(["auto", "site-pack", "workspace-preset", "theme", "search-pack", "bundle"]).default("auto"),
    thinking: z.boolean().optional(),
    existingManifest: z.record(z.string(), z.unknown()).optional(),
    changelogNote: z.string().optional(),
  });

  app.post(
    "/api/user/ai/plugin/generate",
    { config: { scope: "public", rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const rawIdentity = requestIdentityOf(req as never);
      if (!rawIdentity) {
        reply.code(400);
        return { error: "缺少 userId 或 anonId" };
      }
      if (!identityTrusted(ctx, req as never)) return unauthorized(reply, "需要 Bearer token");
      const identity = await resolveCanonicalIdentity(ctx, rawIdentity);

      const body = PluginGenerateBody.safeParse(req.body ?? {});
      if (!body.success) {
        reply.code(400);
        return { error: "参数无效", detail: body.error.issues };
      }

      const quota = await checkLlmQuota(ctx, identity);
      if (!quota.ok) return replyQuotaBlocked(reply, quota.error);

      const resolved = await resolveLlm(ctx, identity);
      if (!llmProviderReady(resolved.provider)) {
        reply.code(400);
        return { error: "尚未配置可用的模型密钥", code: "config" };
      }

      // 获取系统已知分类与精选站点辅助规划
      let knownCategories: string[] = [];
      let sampleSites: string[] = [];
      try {
        const [cats, sites] = await Promise.all([
          ctx.repo.listCategories().catch(() => []),
          ctx.repo.listSites({ limit: 30, status: "active" }).catch(() => []),
        ]);
        knownCategories = cats.map((c) => c.title).slice(0, 15);
        sampleSites = sites.slice(0, 15).map((s) => `${s.title} (${s.url})`);
      } catch {
        // 容错降级
      }

      const isIncremental = Boolean(body.data.existingManifest);

      const systemPrompt = [
        "你是一名顶级导航生态架构师与插件设计师。",
        isIncremental
          ? "【增量修饰微调模式】：用户提供了一份已有的插件清单 (existingManifest)，本次任务是在保持该清单合理结构的基础上，根据用户的修改指令进行针对性增量修改或扩充（例如添加新站点、修改主题强调色、调整版本号、修改名称描述等）。"
          : "【全新插件规划模式】：用户希望根据自然语言需求规划并生成一份 100% 声明式的 山羊胡插件清单 (PluginManifest)。",
        `目标插件类型 (kind)：${body.data.kind === "auto" ? "由你根据用户意图判断最合适的类型（site-pack / theme / search-pack / workspace-preset / bundle），并在 manifest.kind 中指定" : body.data.kind}`,
        "",
        "【山羊胡声明式规范约束】：",
        "1. 顶级结构必须为：",
        "{",
        '  "rationale": "简要设计理念与规划理由（1-2句话）",',
        '  "manifest": {',
        '    "manifestVersion": 1,',
        '    "kind": "site-pack" | "workspace-preset" | "theme" | "search-pack" | "bundle",',
        '    "name": "插件名称（简明扼要，≤40字符）",',
        '    "description": "插件详细描述（≤200字符）",',
        '    "icon": "Emoji 或小图标（如 🌐 / ⚡ / 🎨 / 🚀 / 🛠️）",',
        '    "author": "作者昵称",',
        '    "version": "1.0.0",',
        '    "license": "MIT",',
        '    "tags": ["标签1", "标签2"],',
        '    "payload": { ... }',
        "  }",
        "}",
        "2. 各类型 payload 规范（根据 manifest.kind 选择）：",
        "  - site-pack: { categories?: [{ title, description? }], sites: [{ url: '必须为有效的 https:// 绝对地址', title: '站点名称', description: '功能描述（简明，≤30字）', category: '所属分类', tags: ['标签'] }] }，站点数量精选 5~8 个核心站点。",
        "  - theme: { accent?: 'violet' | 'emerald' | 'amber' | 'rose', tokens?: { '--radius': '0.75rem', '--primary': '262 83% 58%' } }",
        "  - search-pack: { engines: [{ name: '引擎名称', prefix: '!前缀（如 !gh、!npm，必须以!开头）', searchUrl: '必须包含 {q} 占位符的有效 https 链接，例如 https://github.com/search?q={q}', icon: '图标', description: '描述' }] }",
        `  - workspace-preset: { boards: [{ name: '看板名称', widgets: [{ type: '模块标识，只能逐字取这些真实类型之一：${WIDGET_TYPE_NAMES.join(" / ")}', customTitle: '自定义标题', colSpan: 4, rowSpan: 2, config: {} }] }] }`,
        "    工作台模块的 config 字段：写外部输入型模块（rss-feed 要 feedUrl、github-heatmap 要 username、iframe-embed 要 url、live-api 要 apiUrl、custom-category 要 categoryId、hyperbolic-radar 要 site）时，用户没给值就留空字符串——卡片会明确提示怎么配置；其他模块 config 传 {} 即可。",
        "  - bundle: { items: [{ slug: '已有插件slug', kind: 'site-pack'|'search-pack'|'theme' }] }",
        "",
        knownCategories.length > 0 ? `全站已有分类参考：${knownCategories.join("、")}` : "",
        sampleSites.length > 0 ? `优质站点参考：${sampleSites.join("，")}` : "",
        "",
        "思考规划要求：在思考中快速提炼核心决策与分类，确保站点真实有效，随后直接输出完整的 JSON 清单（不要包含任何多余文字或额外说明）。",
      ]
        .filter(Boolean)
        .join("\n");

      const userContent = isIncremental
        ? `已有插件清单如下：\n\`\`\`json\n${JSON.stringify(body.data.existingManifest, null, 2)}\n\`\`\`\n\n请根据以下指令进行增量微调：${body.data.prompt}`
        : `请为我规划生成插件：${body.data.prompt}`;

      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userContent },
      ];

      try {
        const result = await callLlm(ctx, resolved, {
          scenario: "plugin_generate",
          identity,
          messages,
          maxTokens: 1800,
          temperature: 0.3,
          json: true,
          thinking: body.data.thinking,
          timeoutMs: 60_000,
        });

        const rawJson = extractJson(result.content);
        let parsed: any;
        try {
          parsed = JSON.parse(rawJson);
        } catch (jsonErr) {
          throw new LlmError("invalid_response", "模型返回的 JSON 解析失败", 200, rawJson);
        }

        const rawManifest =
          parsed.manifest && typeof parsed.manifest === "object" ? parsed.manifest : parsed;

        // 基础自愈与默认字段修补
        rawManifest.manifestVersion = 1;
        if (typeof rawManifest.name !== "string" || !rawManifest.name.trim()) {
          rawManifest.name = "AI 创意插件";
        }
        if (typeof rawManifest.version !== "string" || !/^\d+\.\d+\.\d+/.test(rawManifest.version)) {
          rawManifest.version = "1.0.0";
        }
        if (typeof rawManifest.description !== "string" || !rawManifest.description.trim()) {
          rawManifest.description = "由 Agnes 3.0 Flash 规划生成的 NavHub 声明式插件";
        }
        if (typeof rawManifest.author !== "string" || !rawManifest.author.trim()) {
          rawManifest.author = identity !== "anonymous" ? identity : "NavHub 创作者";
        }
        if (typeof rawManifest.license !== "string" || !rawManifest.license.trim()) {
          rawManifest.license = "MIT";
        }

        // 针对 site-pack URL 自动修补协议
        if (rawManifest.kind === "site-pack" && rawManifest.payload?.sites && Array.isArray(rawManifest.payload.sites)) {
          for (const s of rawManifest.payload.sites) {
            if (s && typeof s.url === "string") {
              const u = s.url.trim();
              if (!u.startsWith("http://") && !u.startsWith("https://")) {
                s.url = `https://${u}`;
              }
            }
          }
        }

        // 针对 search-pack 自动修补 {q} 与前缀 !
        if (rawManifest.kind === "search-pack" && rawManifest.payload?.engines && Array.isArray(rawManifest.payload.engines)) {
          for (let idx = 0; idx < rawManifest.payload.engines.length; idx++) {
            const e = rawManifest.payload.engines[idx];
            if (e && typeof e === "object") {
              if (typeof e.prefix === "string" && !e.prefix.startsWith("!")) {
                e.prefix = `!${e.prefix.replace(/[^a-zA-Z0-9_-]/g, "") || `s${idx + 1}`}`;
              }
              if (typeof e.searchUrl === "string" && !e.searchUrl.includes("{q}")) {
                e.searchUrl = e.searchUrl.includes("?") ? `${e.searchUrl}&q={q}` : `${e.searchUrl}?q={q}`;
              }
            }
          }
        }

        const validated = validatePluginManifestWithCatalog(rawManifest);
        if (!validated.ok) {
          reply.code(400);
          return {
            success: false,
            error: "插件清单校验失败",
            errors: validated.errors,
            manifest: rawManifest,
            rationale: parsed.rationale || "模型生成的内容格式存在偏差，请重试或微调提示词",
          };
        }

        const summary = summarizePluginManifest(validated.manifest);
        return {
          success: true,
          manifest: validated.manifest,
          summary,
          rationale: parsed.rationale || "根据您的提示词规划生成",
          reasoningContent: result.reasoningContent,
          model: result.model,
          usage: result.usage,
          latencyMs: result.latencyMs,
        };
      } catch (err) {
        const lastError = err instanceof LlmError ? err : null;
        reply.code(502);
        return {
          error: "AI 生成插件失败",
          code: lastError?.code ?? "network",
          detail: err instanceof Error ? err.message : "未知错误",
        };
      }
    },
  );
};
