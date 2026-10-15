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
} from "@navhub/core";

export {
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
};

export interface ToolDefinition {
  name: string;
  description: string;
  /** 需要的最小权限；读工具为 read */
  scope: McpScope;
  inputSchema: z.ZodTypeAny;
  /** 是否会产生持久化副作用（用于让宿主决定是否需要人工确认） */
  mutating: boolean;
}

export const TOOL_DEFS: ToolDefinition[] = [
  {
    name: "search_sites",
    description: "在网址导航库中检索站点。支持中文语义、拼音、首字母与关键词混合检索，返回带相关度解释的结果。适合回答「帮我找一个做 X 的网站」这类问题。",
    scope: "read", inputSchema: SearchSitesInput, mutating: false,
  },
  {
    name: "get_site",
    description: "按 id 或网址获取单个站点的完整信息（描述、标签、健康状态）。",
    scope: "read", inputSchema: GetSiteInput, mutating: false,
  },
  {
    name: "list_categories",
    description: "列出所有导航类目，可选返回每类站点数量。用于了解导航库结构。",
    scope: "read", inputSchema: ListCategoriesInput, mutating: false,
  },
  {
    name: "get_stats",
    description: "获取导航库总体统计（站点数、类目数、失效与待审核数量）。",
    scope: "read", inputSchema: z.object({}), mutating: false,
  },
  {
    name: "create_site",
    description: "新增一个站点。可选自动抓取元数据并用 AI 富化（分类、标签、描述）。支持幂等键；若网址已存在会返回已存在站点而不是报错。",
    scope: "write", inputSchema: CreateSiteInput, mutating: true,
  },
  {
    name: "update_site",
    description: "更新已有站点的标题、描述、类目或标签。",
    scope: "write", inputSchema: UpdateSiteInput, mutating: true,
  },
  {
    name: "set_status",
    description: "修改站点状态（active / pending / broken / archived），常用于审核投稿或标记失效链接。",
    scope: "write", inputSchema: SetStatusInput, mutating: true,
  },
  {
    name: "batch_import",
    description: "批量导入站点。默认 dryRun=true，只预览将要创建的内容；确认无误后再以 dryRun=false 真正执行。",
    scope: "write", inputSchema: BatchImportInput, mutating: true,
  },
  {
    name: "health_check",
    description: "对站点执行可用性巡检（HTTP 状态、响应耗时、重定向），并写回健康状态。lite(SQLite) 与 full(PostgreSQL) 模式均可用。",
    scope: "write", inputSchema: HealthCheckInput, mutating: true,
  },
  {
    name: "delete_site",
    description: "删除一个站点（软删除，进回收站，可恢复）。站点不存在时默认返回成功（幂等），便于 Agent 重试。",
    scope: "write", inputSchema: DeleteSiteInput, mutating: true,
  },
  {
    name: "export_sites",
    description: "导出站点清单（JSON 或 CSV），可按类目/状态过滤。适合备份、迁移到别处或交给用户下载。",
    scope: "read", inputSchema: ExportSitesInput, mutating: false,
  },
  {
    name: "get_trending",
    description: "获取热度榜（近 7 天点击 + 收藏 − 年龄惩罚，由 recompute_rank 任务重算）。适合回答「最近什么网站最热门」。",
    scope: "read", inputSchema: GetTrendingInput, mutating: false,
  },
  {
    name: "list_tags",
    description: "列出全部标签及关联站点数（按热度降序）。适合了解导航库的话题分布。",
    scope: "read", inputSchema: ListTagsInput, mutating: false,
  },
  {
    name: "refresh_site",
    description: "刷新单个站点的元数据（标题/描述/图标）：入队 refetch_metadata 任务，由 Runner 异步执行。可选 LLM 富化。",
    scope: "write", inputSchema: RefreshSiteInput, mutating: true,
  },
  {
    name: "run_job",
    description: "入队一个后台任务（health_check / refetch_metadata / recompute_rank / reindex）。任务由 Runner 异步执行，不会立即返回结果。",
    scope: "admin", inputSchema: RunJobInput, mutating: true,
  },
  {
    name: "get_architecture_recipe",
    description: "基于 Graph-RAG 子图匹配端到端技术栈链路配方 (Architecture Recipe)，获取分层选型、替代方案与快速启动代码。",
    scope: "read", inputSchema: GetArchitectureRecipeInput, mutating: false,
  },
  {
    name: "compare_technologies",
    description: "结构化技术选型对比矩阵 (Side-by-Side Comparison Matrix)，原地对比两项技术的优缺点、权衡点、多维参数与选型裁决。",
    scope: "read", inputSchema: CompareTechnologiesInput, mutating: false,
  },
  {
    name: "heal_broken_site",
    description: "对故障/失效站点执行智能自愈诊断：分析失效根因，调用 Wayback 提取归档快照，并基于图谱推荐同生态健康替代品。",
    scope: "write", inputSchema: HealBrokenSiteInput, mutating: true,
  },
  {
    name: "find_tech_path",
    description: "在技术栈知识图谱中通过双向 Dijkstra 寻路，查找任意两项技术之间的协同演进链路与组合桥梁。",
    scope: "read", inputSchema: FindTechPathInput, mutating: false,
  },
  {
    name: "analyze_stack_compatibility",
    description: "分析技术选型方案的协同契合度、已覆盖与缺失的基础设施分层，并推断推荐补齐组件。",
    scope: "read", inputSchema: AnalyzeStackCompatibilityInput, mutating: false,
  },
  {
    name: "cluster_sites",
    description: "基于 K-Means++ 与语义词袋向量对站点进行自适应聚类，自动提取高频技术特征并合成可解释的类目名称与凝聚度打分。",
    scope: "read", inputSchema: ClusterSitesInput, mutating: false,
  },
  {
    name: "sync_crdt_operations",
    description: "合流多端本地优先原子操作日志 (Local-First CRDT)，具备交换律与因果收敛，无冲突同步自定义分类、站点置顶与拖拽排序。",
    scope: "write", inputSchema: SyncCrdtOperationsInput, mutating: true,
  },
  {
    name: "evaluate_developer_intent",
    description: "原地推测并计算开发者输入的技术意图（秒级解析 JWT、Cron 人类语言翻译、Curl 语法转 Fetch 代码、时间戳/颜色/Base64/JSON 实时转换），0 外部网络耗时。",
    scope: "read", inputSchema: EvaluateDeveloperIntentInput, mutating: false,
  },
  {
    name: "analyze_color_harmony",
    description: "分析 UI 调色板的美学和谐度、WCAG 2.1 对比度评级 (AAA/AA/Fail)、视觉情绪风格与改进建议。",
    scope: "read", inputSchema: AnalyzeColorHarmonyInput, mutating: false,
  },
  {
    name: "get_federated_recommendations",
    description: "基于客户端本地差分隐私 (LDP Laplace) 与群体脱敏趋势向量的协同排序推荐引擎。",
    scope: "read", inputSchema: GetFederatedRecommendationsInput, mutating: false,
  },
  {
    name: "compile_speculation_rules",
    description: "根据意图轨迹预测置信度与抵达耗时，编译原生 W3C Speculation Rules 预渲染与预取规则负载及 HTML 脚本标签。",
    scope: "read", inputSchema: CompileSpeculationRulesInput, mutating: false,
  },
  {
    name: "synthesize_agent_tool",
    description: "动态将外部 REST 端点、站点检索动作或 OpenAPI 规范合成为具备 SSRF 防护的 WebMCP 智能体工具。",
    scope: "read", inputSchema: SynthesizeAgentToolInput, mutating: false,
  },
  {
    name: "exchange_p2p_mesh",
    description: "通过无中心 WebRTC / DataChannel 网格消息协议交换多端书签 CRDT 增量并实现因果收敛。",
    scope: "read", inputSchema: ExchangeP2pMeshInput, mutating: false,
  },
];

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOL_DEFS.find((t) => t.name === name);
}
