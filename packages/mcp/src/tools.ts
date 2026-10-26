/**
 * MCP 工具定义（模型可调用的函数）。
 *
 * 安全模型（对齐 MCP 官方 Security Best Practices）：
 *
 *  1. **读 / 写分级**：只读工具（search_sites / get_site / list_categories / get_stats）
 *     不需要额外授权；写工具（create_site / update_site / set_status）需要 token 带 write scope。
 *  2. **危险操作默认 dryRun**：批量导入必须先以 dryRun=true 预览，
 *     让调用方（Agent）在真正落库前确认影响范围。
 *  3. **幂等键**：写工具接受 idempotencyKey，重复调用不会产生重复站点。
 *  4. **审计**：所有写操作落 audit_logs，actor 标记为 mcp:<tokenName>。
 *  5. **输入上限**：批量操作有条数上限，避免一次调用把库塞爆。
 *
 * 这些约束不是"文档里的建议"，而是写在代码里、有测试覆盖的硬边界。
 */
import { z } from "zod";

export type McpScope = "read" | "write" | "admin";

export interface ToolContext {
  /** 当前调用身份（token 名），用于审计 */
  actor: string;
  scopes: McpScope[];
  has(scope: McpScope): boolean;
  /**
   * 归属用户身份（B2 用户域工具）：个人令牌（api_tokens.owner_identity）非空，
   * 实例级令牌 / 静态引导 token 为 null。用户域工具据此限定数据可见范围。
   */
  ownerIdentity?: string | null;
}

export class McpAuthError extends Error {
  /** 显式字段（不用参数属性语法：Node 的 strip-only 模式不支持） */
  readonly requiredScope: McpScope;

  constructor(message: string, requiredScope: McpScope) {
    super(message);
    this.name = "McpAuthError";
    this.requiredScope = requiredScope;
  }
}

export function requireScope(ctx: ToolContext, scope: McpScope): void {
  if (!ctx.has(scope)) {
    throw new McpAuthError("缺少 " + scope + " 权限（当前身份：" + ctx.actor + "）", scope);
  }
}

/**
 * 输入 schema 的单一事实源在 @navhub/core（packages/core/src/mcp-schemas.ts）。
 * 放那里的原因：apps/api 要用同一份定义生成 OpenAPI，而 @navhub/mcp 依赖 @navhub/api，
 * 反向引用会成环；下沉到 core 后两边都能取到，且不会再长出第二份字段清单。
 */
import {
  MAX_BATCH_ITEMS,
  SearchSitesInput,
  GetSiteInput,
  ListCategoriesInput,
  CreateSiteInput,
  UpdateSiteInput,
  SetStatusInput,
  BatchImportInput,
  HealthCheckInput,
  GetTrendingInput,
  ListTagsInput,
  RefreshSiteInput,
  RunJobInput,
  ListJobsInput,
  ListCollectionsInput,
  GetCollectionInput,
  ListPluginsInput,
  InstallPluginInput,
  StarPluginInput,
  UpdatePluginInput,
  SearchPluginsInput,
  DeleteSiteInput,
  ExportSitesInput,
  GetArchitectureRecipeInput,
  CompareTechnologiesInput,
  HealBrokenSiteInput,
  FindTechPathInput,
  AnalyzeStackCompatibilityInput,
  ClusterSitesInput,
  SyncCrdtOperationsInput,
  EvaluateDeveloperIntentInput,
  AnalyzeColorHarmonyInput,
  GetFederatedRecommendationsInput,
  CompileSpeculationRulesInput,
  SynthesizeAgentToolInput,
  ExchangeP2pMeshInput,
  GetAlternativesInput,
  ResolveWaybackInput,
  ListFavoritesInput,
  ListSearchHistoryInput,
  GetProfileSummaryInput,
} from "@navhub/core";

export {
  MAX_BATCH_ITEMS,
  ListFavoritesInput,
  ListSearchHistoryInput,
  GetProfileSummaryInput,
  SearchSitesInput,
  GetSiteInput,
  ListCategoriesInput,
  CreateSiteInput,
  UpdateSiteInput,
  SetStatusInput,
  BatchImportInput,
  HealthCheckInput,
  GetTrendingInput,
  ListTagsInput,
  RefreshSiteInput,
  RunJobInput,
  ListJobsInput,
  ListCollectionsInput,
  GetCollectionInput,
  ListPluginsInput,
  InstallPluginInput,
  StarPluginInput,
  UpdatePluginInput,
  SearchPluginsInput,
  DeleteSiteInput,
  ExportSitesInput,
  GetArchitectureRecipeInput,
  CompareTechnologiesInput,
  HealBrokenSiteInput,
  FindTechPathInput,
  AnalyzeStackCompatibilityInput,
  ClusterSitesInput,
  SyncCrdtOperationsInput,
  EvaluateDeveloperIntentInput,
  AnalyzeColorHarmonyInput,
  GetFederatedRecommendationsInput,
  CompileSpeculationRulesInput,
  SynthesizeAgentToolInput,
  ExchangeP2pMeshInput,
  GetAlternativesInput,
  ResolveWaybackInput,
};

/** 工具元数据清单（同源：OpenAPI 的 x-mcp-tools 也取这一份） */
import { MCP_TOOL_DEFS, type ToolDefinition } from "@navhub/core";

export type { ToolDefinition };

/** 兼容旧导出名：历史代码与测试都以 TOOL_DEFS 取工具清单 */
export const TOOL_DEFS: ToolDefinition[] = MCP_TOOL_DEFS;


export function toolByName(name: string): ToolDefinition | undefined {
  return TOOL_DEFS.find((t) => t.name === name);
}
