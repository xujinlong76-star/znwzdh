/**
 * 开发者工具域：意图解析 / 配色和谐 / 联邦推荐 / 推测规则 / 动态工具合成。
 * 都是纯计算（不落库），输入来自 @navhub/core 的算法矩阵。
 */
import {
  analyzeColorPalette,
  compileSpeculationRules,
  generateFallbackLinkTags,
  parseOpenApiToSpecs,
  parseSpeculativeIntent,
  privatizeVector,
  rankItemsWithPrivacy,
  renderSpeculationRulesScript,
  synthesizeRestTool,
  synthesizeSiteSearchTool,
  type MinimalOpenApiSpec,
} from "@navhub/core";
import {
  AnalyzeColorHarmonyInput,
  CompileSpeculationRulesInput,
  EvaluateDeveloperIntentInput,
  GetFederatedRecommendationsInput,
  SynthesizeAgentToolInput,
  requireScope,
  type ToolContext,
} from "../tools.ts";
import { ok, type Handler, type HandlerDeps } from "./shared.ts";

export const developerToolHandlers = {
  async evaluate_developer_intent(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    requireScope(tc, "read");
    const input = EvaluateDeveloperIntentInput.parse(args ?? {});
    const result = parseSpeculativeIntent(input.input);
    if (!result) {
      return ok({
        matched: false,
        query: input.input,
        message: "未匹配到特定开发者意图语法模式（可尝试输入 JWT、Cron、Curl、颜色、时间戳或 Base64）",
      });
    }
    return ok({ matched: true, ...result });
  },

  async analyze_color_harmony(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    requireScope(tc, "read");
    const input = AnalyzeColorHarmonyInput.parse(args ?? {});
    const report = analyzeColorPalette(input.palette, input.foreground, input.background);
    return ok({ success: true, ...report });
  },

  async get_federated_recommendations(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    requireScope(tc, "read");
    const input = GetFederatedRecommendationsInput.parse(args ?? {});
    const globalVec = input.globalVector ?? input.localVector.map(() => 0);
    const results = rankItemsWithPrivacy(
      input.localVector,
      globalVec,
      input.candidates,
      input.personalWeight
    );
    const privatized = input.privatize ? privatizeVector(input.localVector, input.epsilon) : undefined;
    return ok({
      count: results.length,
      recommendations: results,
      privacy: input.privatize ? { epsilon: input.epsilon, privatizedVector: privatized } : undefined,
    });
  },

  async compile_speculation_rules(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    requireScope(tc, "read");
    const input = CompileSpeculationRulesInput.parse(args ?? {});
    const payload = compileSpeculationRules(input.candidates, {
      prerenderConfidenceThreshold: input.prerenderConfidenceThreshold,
      prefetchConfidenceThreshold: input.prefetchConfidenceThreshold,
      maxPrerenderCount: input.maxPrerenderCount,
      maxPrefetchCount: input.maxPrefetchCount,
    });
    if (!payload) {
      return ok({
        hasRules: false,
        rules: null,
        script: "",
        fallbackTags: [],
        message: "无符合阈值或安全过滤条件的推测预加载规则",
      });
    }
    return ok({
      hasRules: true,
      rules: payload,
      script: renderSpeculationRulesScript(payload),
      fallbackTags: generateFallbackLinkTags(payload),
    });
  },

  async synthesize_agent_tool(deps: HandlerDeps, args: unknown, tc: ToolContext) {
    requireScope(tc, "read");
    const input = SynthesizeAgentToolInput.parse(args ?? {});

    if (input.kind === "site_search" && input.siteSearchSpec) {
      const synthesized = synthesizeSiteSearchTool(input.siteSearchSpec);
      return ok({
        kind: "site_search",
        tool: synthesized.definition,
        exampleInvocation: synthesized.handler({ query: "example" }),
      });
    }

    if (input.kind === "openapi" && input.openApiSpec) {
      const specs = parseOpenApiToSpecs(input.openApiSpec as MinimalOpenApiSpec);
      const tools = specs.map((s) => synthesizeRestTool(s).definition);
      return ok({
        kind: "openapi",
        count: tools.length,
        tools,
      });
    }

    if (input.restSpec) {
      const synthesized = synthesizeRestTool(input.restSpec);
      return ok({
        kind: "rest",
        tool: synthesized.definition,
      });
    }

    return ok({
      kind: "unknown",
      message: "缺少 restSpec、siteSearchSpec 或 openApiSpec 有效配置",
    });
  },
} satisfies Record<string, Handler>;
