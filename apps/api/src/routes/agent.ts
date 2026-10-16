import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  analyzeColorPalette,
  compileSpeculationRules,
  computeGraphCentrality,
  findMatchingArchitectureRecipe,
  findShortestTechPath,
  generateFallbackLinkTags,
  parseOpenApiToSpecs,
  parseSpeculativeIntent,
  parseTechComparisonQuery,
  analyzeStackCompatibility,
  PRESET_TECH_GRAPH,
  privatizeVector,
  rankItemsWithPrivacy,
  renderSpeculationRulesScript,
  synthesizeRestTool,
  synthesizeSiteSearchTool,
  WebMcpBridge,
  P2PMeshNode,
  type JsonRpcRequest,
  type MinimalOpenApiSpec,
  type P2PMessage,
} from "@navhub/core";
import { identityAllowed } from "./shared.ts";
import { registerIdentityRoutes } from "./identity.ts";
import { registerRankRoutes } from "./rank.ts";
import type { AppContext } from "../context.ts";

export function registerAgentRoutes(app: FastifyInstance, ctx: AppContext): void {
  /* --------------------- Next-Gen 7.0 视觉设计与 WebMCP --------------------- */

  /**
   * 视觉指纹与调色板 WCAG 对比度/美学和谐度审计端点
   */
  app.post("/api/design/harmony", { config: { scope: "public", cache: { maxAge: 60 } } }, async (req, reply) => {
    const body = z.object({
      palette: z.array(z.string()).min(1),
      foreground: z.string().optional().default("#ffffff"),
      background: z.string().optional().default("#0f172a"),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    const report = analyzeColorPalette(body.data.palette, body.data.foreground, body.data.background);
    return { ok: true, report };
  });

  const webMcp = new WebMcpBridge();

  webMcp.registerTool({
    name: "get_architecture_recipe",
    description: "端到端技术栈架构链路配方查询",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "架构目标或技术栈关键词" } },
      required: ["query"],
    },
  }, (args) => findMatchingArchitectureRecipe(String(args.query ?? "")));

  webMcp.registerTool({
    name: "compare_technologies",
    description: "结构化技术选型对比与裁决矩阵",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "对比查询，如 react vs vue" } },
      required: ["query"],
    },
  }, (args) => parseTechComparisonQuery(String(args.query ?? "")));

  webMcp.registerTool({
    name: "evaluate_developer_intent",
    description: "开发者输入技术意图原地推测计算",
    inputSchema: {
      type: "object",
      properties: { input: { type: "string", description: "技术文本（JWT/Cron/Curl/颜色/时间戳）" } },
      required: ["input"],
    },
  }, (args) => parseSpeculativeIntent(String(args.input ?? "")) ?? { matched: false });

  webMcp.registerTool({
    name: "analyze_color_harmony",
    description: "UI 调色板美学与 WCAG 2.1 对比度审计",
    inputSchema: {
      type: "object",
      properties: {
        palette: { type: "array", items: { type: "string" }, description: "调色板颜色列表" },
        foreground: { type: "string", description: "前景文字色" },
        background: { type: "string", description: "背景色" },
      },
      required: ["palette"],
    },
  }, (args) => analyzeColorPalette(
    Array.isArray(args.palette) ? args.palette as string[] : ["#3b82f6"],
    typeof args.foreground === "string" ? args.foreground : "#ffffff",
    typeof args.background === "string" ? args.background : "#0f172a"
  ));

  webMcp.registerTool({
    name: "find_tech_path",
    description: "技术栈知识图谱寻路演进链路",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "起始技术" },
        to: { type: "string", description: "目标技术" },
      },
      required: ["from", "to"],
    },
  }, (args) => findShortestTechPath(String(args.from ?? ""), String(args.to ?? ""), PRESET_TECH_GRAPH));

  webMcp.registerTool({
    name: "analyze_stack_compatibility",
    description: "技术选型协同契合度诊断与组件补齐建议",
    inputSchema: {
      type: "object",
      properties: {
        techs: { type: "array", items: { type: "string" }, description: "已选技术列表" },
      },
      required: ["techs"],
    },
  }, (args) => analyzeStackCompatibility(
    Array.isArray(args.techs) ? args.techs.map(String) : [],
    PRESET_TECH_GRAPH
  ));

  webMcp.registerTool({
    name: "list_categories",
    description: "获取全部导航类目清单",
    inputSchema: { type: "object", properties: {} },
  }, async () => ctx.repo.listCategories());

  webMcp.registerTool({
    name: "get_federated_recommendations",
    description: "客户端本地差分隐私 (LDP Laplace) 联邦协同推荐排序",
    inputSchema: {
      type: "object",
      properties: {
        localVector: { type: "array", items: { type: "number" }, description: "本地私有偏好向量" },
        globalVector: { type: "array", items: { type: "number" }, description: "脱敏群体趋势向量" },
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              featureVector: { type: "array", items: { type: "number" } },
            },
            required: ["id", "name", "featureVector"],
          },
          description: "候选推荐列表",
        },
        personalWeight: { type: "number", description: "本地偏好权重占比" },
        privatize: { type: "boolean", description: "是否差分隐私加噪" },
        epsilon: { type: "number", description: "隐私预算" },
      },
      required: ["localVector", "candidates"],
    },
  }, (args) => {
    const localVec = Array.isArray(args.localVector) ? (args.localVector as unknown[]).map(Number) : [1, 0];
    const globalVec = Array.isArray(args.globalVector) ? (args.globalVector as unknown[]).map(Number) : localVec.map(() => 0);
    const candidates = Array.isArray(args.candidates) ? args.candidates as any[] : [];
    const personalWeight = typeof args.personalWeight === "number" ? args.personalWeight : 0.6;
    const privatize = Boolean(args.privatize);
    const epsilon = typeof args.epsilon === "number" && args.epsilon > 0 ? args.epsilon : 1.0;
    const results = rankItemsWithPrivacy(localVec, globalVec, candidates, personalWeight);
    const privatized = privatize ? privatizeVector(localVec, epsilon) : undefined;
    return {
      count: results.length,
      recommendations: results,
      privacy: privatize ? { epsilon, privatizedVector: privatized } : undefined,
    };
  });

  webMcp.registerTool({
    name: "compile_speculation_rules",
    description: "编译原生 W3C Speculation Rules 预渲染/预取规则负载与 HTML 标签",
    inputSchema: {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string" },
              confidence: { type: "number" },
              predictedArrivalMs: { type: "number" },
            },
            required: ["url", "confidence", "predictedArrivalMs"],
          },
        },
        prerenderConfidenceThreshold: { type: "number" },
        prefetchConfidenceThreshold: { type: "number" },
        maxPrerenderCount: { type: "number" },
        maxPrefetchCount: { type: "number" },
      },
      required: ["candidates"],
    },
  }, (args) => {
    const candidates = Array.isArray(args.candidates) ? args.candidates as any[] : [];
    const payload = compileSpeculationRules(candidates, {
      prerenderConfidenceThreshold: typeof args.prerenderConfidenceThreshold === "number" ? args.prerenderConfidenceThreshold : 0.82,
      prefetchConfidenceThreshold: typeof args.prefetchConfidenceThreshold === "number" ? args.prefetchConfidenceThreshold : 0.45,
      maxPrerenderCount: typeof args.maxPrerenderCount === "number" ? args.maxPrerenderCount : 2,
      maxPrefetchCount: typeof args.maxPrefetchCount === "number" ? args.maxPrefetchCount : 5,
    });
    return {
      hasRules: Boolean(payload),
      rules: payload,
      script: payload ? renderSpeculationRulesScript(payload) : "",
      fallbackTags: payload ? generateFallbackLinkTags(payload) : [],
    };
  });

  webMcp.registerTool({
    name: "synthesize_agent_tool",
    description: "动态将外部 REST 端点、站点检索动作或 OpenAPI 规范合成为具备 SSRF 防护的 WebMCP 智能体工具",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["rest", "site_search", "openapi"] },
        restSpec: { type: "object" },
        siteSearchSpec: { type: "object" },
        openApiSpec: { type: "object" },
      },
    },
  }, (args) => {
    const kind = args.kind ?? "rest";
    if (kind === "site_search" && args.siteSearchSpec) {
      const syn = synthesizeSiteSearchTool(args.siteSearchSpec as any);
      return { kind: "site_search", tool: syn.definition };
    }
    if (kind === "openapi" && args.openApiSpec) {
      const specs = parseOpenApiToSpecs(args.openApiSpec as MinimalOpenApiSpec);
      return { kind: "openapi", count: specs.length, tools: specs.map((s) => synthesizeRestTool(s).definition) };
    }
    if (args.restSpec) {
      const syn = synthesizeRestTool(args.restSpec as any);
      return { kind: "rest", tool: syn.definition };
    }
    return { kind: "unknown", message: "缺少配置" };
  });

  webMcp.registerTool({
    name: "exchange_p2p_mesh",
    description: "通过无中心 WebRTC / DataChannel 网格消息协议交换多端书签 CRDT 增量",
    inputSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        message: { type: "object" },
      },
      required: ["nodeId", "message"],
    },
  }, (args) => {
    const nodeId = String(args.nodeId ?? "node_anon");
    const msg = (args.message ?? {}) as P2PMessage<any>;
    const node = new P2PMeshNode(nodeId);
    const outgoing = node.handleIncomingMessage(msg);
    return {
      nodeId,
      receivedType: msg.type,
      peerState: node.getPeer(msg.senderId)?.state ?? "READY",
      outgoingResponse: outgoing,
      vectorClock: node.store.getVectorClock(),
    };
  });

  /**
   * Next-Gen 7.0 浏览器端 Model Context Protocol (WebMCP) 标准 HTTP JSON-RPC 2.0 端点
   */
  app.post("/api/mcp", { config: { scope: "public" } }, async (req, reply) => {
    const rpcRes = await webMcp.handleRpc(req.body as JsonRpcRequest);
    return rpcRes;
  });

  // identity 路由（收藏夹/历史/画像/金库/CRDT/users）：实现见 routes/identity.ts
  registerIdentityRoutes(app, ctx);

  registerRankRoutes(app, ctx);

  /**
   * 原生 W3C Speculation Rules 预渲染与预取规则编译器端点
   */
  app.post("/api/speculation/rules", { config: { scope: "public" } }, async (req, reply) => {
    const body = z.object({
      candidates: z.array(z.object({
        url: z.string(),
        confidence: z.number().min(0).max(1),
        predictedArrivalMs: z.number().nonnegative(),
      })).min(1),
      prerenderConfidenceThreshold: z.number().min(0).max(1).optional(),
      prefetchConfidenceThreshold: z.number().min(0).max(1).optional(),
      maxPrerenderCount: z.number().int().min(1).max(5).optional(),
      maxPrefetchCount: z.number().int().min(1).max(10).optional(),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    const payload = compileSpeculationRules(body.data.candidates, {
      prerenderConfidenceThreshold: body.data.prerenderConfidenceThreshold,
      prefetchConfidenceThreshold: body.data.prefetchConfidenceThreshold,
      maxPrerenderCount: body.data.maxPrerenderCount,
      maxPrefetchCount: body.data.maxPrefetchCount,
    });

    return {
      ok: true,
      hasRules: Boolean(payload),
      rules: payload,
      script: payload ? renderSpeculationRulesScript(payload) : "",
      fallbackTags: payload ? generateFallbackLinkTags(payload) : [],
    };
  });

  /**
   * 动态 WebMCP 智能体工具合成器端点 (支持 REST 单端点、站点检索动作与 OpenAPI 规格合成)
   */
  app.post("/api/tools/synthesize", { config: { scope: "public" } }, async (req, reply) => {
    // 公共写入面：开放模式保持可用；开启鉴权后必须带有效 token（防注册表被匿名滥用）。
    if (!identityAllowed(ctx, req as never)) { reply.code(401); return { error: "需要 Bearer token" }; }
    const body = z.object({
      kind: z.enum(["rest", "site_search", "openapi"]).default("rest"),
      restSpec: z.object({
        name: z.string(),
        description: z.string(),
        url: z.string(),
        method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
        headers: z.record(z.string()).optional(),
        parameters: z.array(z.object({
          name: z.string(),
          type: z.enum(["string", "number", "boolean"]),
          description: z.string().optional(),
          required: z.boolean().optional(),
          in: z.enum(["query", "path", "body", "header"]),
          default: z.union([z.string(), z.number(), z.boolean()]).optional(),
        })).optional(),
        bodyType: z.enum(["json", "form"]).optional(),
      }).optional(),
      siteSearchSpec: z.object({
        siteId: z.string(),
        siteName: z.string(),
        searchUrlTemplate: z.string().optional(),
        apiEndpoint: z.string().optional(),
        category: z.string().optional(),
      }).optional(),
      openApiSpec: z.record(z.unknown()).optional(),
    }).safeParse(req.body ?? {});

    if (!body.success) {
      reply.code(400);
      return { error: "参数无效", detail: body.error.issues };
    }

    if (body.data.kind === "site_search" && body.data.siteSearchSpec) {
      const syn = synthesizeSiteSearchTool(body.data.siteSearchSpec);
      if (!webMcp.registerTool(syn.definition, (p) => syn.handler(p))) {
        reply.code(429);
        return { error: "工具注册表已满（上限 " + webMcp.maxToolCount + "），请联系管理员清理" };
      }
      return {
        ok: true,
        kind: "site_search",
        tool: syn.definition,
        registered: true,
      };
    }

    if (body.data.kind === "openapi" && body.data.openApiSpec) {
      const specs = parseOpenApiToSpecs(body.data.openApiSpec as MinimalOpenApiSpec);
      const tools = [];
      for (const s of specs) {
        const syn = synthesizeRestTool(s);
        if (!webMcp.registerTool(syn.definition, (p) => syn.handler(p))) break;
        tools.push(syn.definition);
      }
      return {
        ok: true,
        kind: "openapi",
        count: tools.length,
        tools,
        registered: tools.length > 0,
        capped: tools.length < specs.length,
      };
    }

    if (body.data.restSpec) {
      const syn = synthesizeRestTool(body.data.restSpec);
      if (!webMcp.registerTool(syn.definition, (p) => syn.handler(p))) {
        reply.code(429);
        return { error: "工具注册表已满（上限 " + webMcp.maxToolCount + "），请联系管理员清理" };
      }
      return {
        ok: true,
        kind: "rest",
        tool: syn.definition,
        registered: true,
      };
    }

    reply.code(400);
    return { error: "缺少 restSpec、siteSearchSpec 或 openApiSpec 有效配置" };
  });
}
