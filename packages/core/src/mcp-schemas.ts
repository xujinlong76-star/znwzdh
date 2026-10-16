/**
 * MCP / REST 共用的输入契约（zod 单一事实源）
 *
 * 为什么放在 core：
 *   apps/api 不能 import @navhub/mcp —— @navhub/mcp 反过来依赖 @navhub/api
 *   （它要复用 api 的仓储与业务函数），反向引用会成环。
 *   把 zod 定义下沉到 core 之后，MCP 工具与 REST 端点都从这一份定义取，
 *   OpenAPI 文档再用 zod-to-json-schema 从同一份定义生成 —— 不存在第二份手写清单。
 */

import { z } from "zod";

/** 批量写入的硬上限，防止单次调用造成不可控影响 */
export const MAX_BATCH_ITEMS = 100;

export type McpScope = "read" | "write" | "admin";

export const SearchSitesInput = z.object({
  query: z.string().describe("检索关键词，支持中文、拼音、首字母与语义检索"),
  limit: z.number().int().min(1).max(50).default(10).describe("返回条数上限"),
  categoryId: z.string().optional().describe("限定类目（含其子类目）"),
  tag: z.string().optional().describe("限定标签"),
});

export const GetSiteInput = z.object({
  idOrUrl: z.string().describe("站点 id 或完整网址"),
});

export const ListCategoriesInput = z.object({
  includeCounts: z.boolean().default(true).describe("是否返回每个类目下的站点数"),
});

export const CreateSiteInput = z.object({
  url: z.string().url().describe("站点网址"),
  title: z.string().min(1).optional().describe("标题；留空则自动抓取"),
  description: z.string().optional().describe("描述；留空则自动抓取"),
  categoryId: z.string().optional().describe("类目 id；留空则按 AI 建议自动归类"),
  tags: z.array(z.string()).max(8).optional().describe("标签"),
  enrich: z.boolean().default(true).describe("是否自动抓取元数据并用 AI 富化"),
  idempotencyKey: z.string().optional().describe("幂等键；重复调用不会重复创建"),
});

export const UpdateSiteInput = z.object({
  id: z.string().describe("站点 id"),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  categoryId: z.string().optional(),
  tags: z.array(z.string()).max(8).optional(),
  featured: z.boolean().optional(),
});

export const SetStatusInput = z.object({
  id: z.string().describe("站点 id"),
  status: z.enum(["active", "pending", "broken", "archived"]).describe("目标状态"),
});

export const BatchImportInput = z.object({
  sites: z.array(z.object({
    url: z.string().url(),
    title: z.string().optional(),
    description: z.string().optional(),
    categoryId: z.string().optional(),
    tags: z.array(z.string()).max(8).optional(),
  })).min(1).max(MAX_BATCH_ITEMS).describe("待导入站点"),
  defaultCategoryId: z.string().optional().describe("未指定类目时的兜底类目"),
  dryRun: z.boolean().default(true).describe("默认 true，只返回将要做出的改动而不落库"),
  idempotencyKey: z.string().optional(),
});

export const HealthCheckInput = z.object({
  limit: z.number().int().min(1).max(200).default(50).describe("本次检查的站点数上限"),
  onlyUnchecked: z.boolean().default(false).describe("只检查从未检查过的站点"),
});

/* ---- Phase 4 新增工具 ---- */

export const GetTrendingInput = z.object({
  limit: z.number().int().min(1).max(50).default(10).describe("返回条数上限"),
});

export const ListTagsInput = z.object({
  minCount: z.number().int().min(1).default(1).describe("最少关联站点数"),
  limit: z.number().int().min(1).max(200).default(50).describe("返回条数上限"),
});

export const RefreshSiteInput = z.object({
  idOrUrl: z.string().describe("站点 id 或完整网址"),
  llm: z.boolean().default(false).describe("是否用 LLM 富化（默认 false，只走启发式，不消耗额度）"),
});

export const RunJobInput = z.object({
  kind: z.enum([
    "health_check",
    "refetch_metadata",
    "recompute_rank",
    "reindex",
    "site_self_healing",
    "token_audit",
    "purge_trash",
  ]).describe("任务类型：health_check (健康巡检), refetch_metadata (重抓元数据), recompute_rank (重排热度), reindex (重建检索索引), site_self_healing (死链自愈诊断), token_audit (API 凭据过期与闲置巡检), purge_trash (过期回收站物理清理)"),
  payload: z.record(z.unknown()).optional().describe("任务参数（如 refetch_metadata/site_self_healing 需要 siteId，token_audit 可选 expiringDays/dormantDays，purge_trash 可选 olderThanDays）"),
});

export const ListJobsInput = z.object({
  status: z.enum(["pending", "running", "done", "failed", "cancelled"]).optional().describe("按状态过滤；缺省返回最近的全部任务"),
  limit: z.number().int().min(1).max(100).default(20).describe("返回条数上限"),
});

export const ListCollectionsInput = z.object({
  all: z.boolean().default(false).describe("true 时包含已停用专题（默认只看启用中的）"),
});

export const DeleteSiteInput = z.object({
  idOrUrl: z.string().describe("站点 id 或完整网址"),
  idempotencyKey: z.string().optional().describe("幂等键；重复调用不会重复处理"),
});

export const ExportSitesInput = z.object({
  categoryId: z.string().optional().describe("限定类目"),
  status: z.enum(["active", "pending", "broken", "archived"]).optional().describe("限定状态"),
  format: z.enum(["json", "csv"]).default("json").describe("导出格式"),
  limit: z.number().int().min(1).max(1000).default(200).describe("导出条数上限"),
});

export const GetArchitectureRecipeInput = z.object({
  query: z.string().describe("架构目标或技术栈关键词（如 '协同编辑', '本地大模型', '全栈Web', '微前端'）"),
});

export const CompareTechnologiesInput = z.object({
  query: z.string().describe("技术选型对比查询（如 'react vs vue', 'cursor vs vscode', 'pnpm vs bun', 'ollama vs vllm'）"),
});

export const HealBrokenSiteInput = z.object({
  idOrUrl: z.string().describe("故障/失效站点的 ID 或完整网址"),
});

export const GetAlternativesInput = z.object({
  idOrUrl: z.string().describe("目标站点 ID 或完整网址"),
  limit: z.number().int().min(1).max(20).default(6).describe("返回条数上限"),
});

export const ResolveWaybackInput = z.object({
  url: z.string().describe("待查询或自愈的目标网址或站点 ID"),
  timestamp: z.string().optional().describe("期望的历史快照时间戳（如 20240101，可选，默认取最近一次可用快照）"),
});

export const FindTechPathInput = z.object({
  from: z.string().describe("起始技术名称或 ID (如 'react', 'vue', 'fastify')"),
  to: z.string().describe("目标技术名称或 ID (如 'postgres', 'docker', 'ollama')"),
});

export const AnalyzeStackCompatibilityInput = z.object({
  techs: z.array(z.string()).min(1).describe("已选技术栈名称或 ID 列表 (如 ['react', 'nextjs', 'drizzle'])"),
});

export const ClusterSitesInput = z.object({
  categoryId: z.string().optional().describe("限定要聚类的类目 ID（不传则聚类全库站点）"),
  targetK: z.number().int().min(1).max(10).default(3).describe("目标聚类簇数 K"),
});

export const SyncCrdtOperationsInput = z.object({
  userId: z.string().describe("用户身份 ID (如 anon_xxx 或 user_xxx)"),
  operations: z.array(z.object({
    id: z.string(),
    type: z.enum([
      "SET_CATEGORY_PIN",
      "REORDER_CATEGORIES",
      "PIN_SITE_IN_CATEGORY",
      "UNPIN_SITE_IN_CATEGORY",
      "UPSERT_CUSTOM_CATEGORY",
      "DELETE_CUSTOM_CATEGORY",
      "UPSERT_CUSTOM_SITE",
      "DELETE_CUSTOM_SITE",
    ]),
    entityId: z.string(),
    payload: z.unknown(),
    timestamp: z.number(),
    clientId: z.string(),
  })).min(1).max(200).describe("待合流的 CRDT 操作日志列表"),
});

export const EvaluateDeveloperIntentInput = z.object({
  input: z.string().describe("开发者输入的原始技术文本（如 Cron 表达式、JWT Token、Curl 命令、十六进制颜色、时间戳、JSON 字符串、Base64 或数学算式）"),
});

export const AnalyzeColorHarmonyInput = z.object({
  palette: z.array(z.string()).min(1).describe("调色板 HEX 颜色数组，例如 ['#0f172a', '#3b82f6', '#10b981']"),
  foreground: z.string().default("#ffffff").describe("文本/前景 HEX 颜色，默认 #ffffff"),
  background: z.string().default("#0f172a").describe("页面/背景 HEX 颜色，默认 #0f172a"),
});

export const GetFederatedRecommendationsInput = z.object({
  localVector: z.array(z.number()).describe("本地私有偏好向量"),
  globalVector: z.array(z.number()).optional().describe("脱敏全局偏好趋势向量（可选）"),
  candidates: z.array(z.object({
    id: z.string(),
    name: z.string(),
    featureVector: z.array(z.number()),
  })).min(1).describe("候选推荐项列表"),
  personalWeight: z.number().min(0).max(1).default(0.6).describe("私有偏好权重占比 (0.0 ~ 1.0)"),
  privatize: z.boolean().default(false).describe("是否对偏好向量进行 Laplace 差分隐私加噪"),
  epsilon: z.number().positive().default(1.0).describe("差分隐私预算 epsilon"),
});

export const CompileSpeculationRulesInput = z.object({
  candidates: z.array(z.object({
    url: z.string().describe("推测目标 URL"),
    confidence: z.number().min(0).max(1).describe("意图置信度 (0.0 ~ 1.0)"),
    predictedArrivalMs: z.number().nonnegative().describe("预计抵达耗时 (ms)"),
  })).min(1).describe("推测预加载候选列表"),
  prerenderConfidenceThreshold: z.number().min(0).max(1).default(0.82).describe("触发 Prerender 最小置信度阈值"),
  prefetchConfidenceThreshold: z.number().min(0).max(1).default(0.45).describe("触发 Prefetch 最小置信度阈值"),
  maxPrerenderCount: z.number().int().min(1).max(5).default(2).describe("允许最大预渲染数"),
  maxPrefetchCount: z.number().int().min(1).max(10).default(5).describe("允许最大预取数"),
});

export const SynthesizeAgentToolInput = z.object({
  kind: z.enum(["rest", "site_search", "openapi"]).default("rest").describe("合成源类型：rest (单端点), site_search (站点站内检索), openapi (OpenAPI 3.0 规范)"),
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
  }).optional().describe("REST 单端点参数规格（kind=rest 时生效）"),
  siteSearchSpec: z.object({
    siteId: z.string(),
    siteName: z.string(),
    searchUrlTemplate: z.string().optional(),
    apiEndpoint: z.string().optional(),
    category: z.string().optional(),
  }).optional().describe("站点站内检索动作规格（kind=site_search 时生效）"),
  openApiSpec: z.record(z.unknown()).optional().describe("OpenAPI 规范 JSON（kind=openapi 时生效）"),
});

export const ExchangeP2pMeshInput = z.object({
  nodeId: z.string().describe("当前节点的唯一身份 ID (如 peer_xxx)"),
  message: z.object({
    type: z.enum(["HELLO", "SYNC_REQUEST", "DELTA_BATCH", "ACK", "HEARTBEAT"]),
    senderId: z.string(),
    targetId: z.string().optional(),
    seq: z.number().int().nonnegative(),
    timestamp: z.number().int().positive(),
    payload: z.unknown(),
  }).describe("传入的 P2P 网格报文"),
});


/* ------------------------------------------------------------------ *
 * 契约注册表：OpenAPI 文档与 MCP 工具清单都从这里取，杜绝第二份手写清单
 * ------------------------------------------------------------------ */

export type ZodSchemaLike = z.ZodTypeAny;

/** 工具名 -> 输入 schema（顺序与 TOOL_DEFS 对齐；缺失的工具视为无入参） */
export const MCP_INPUT_SCHEMAS: Record<string, ZodSchemaLike> = {
  search_sites: SearchSitesInput,
  get_site: GetSiteInput,
  list_categories: ListCategoriesInput,
  create_site: CreateSiteInput,
  update_site: UpdateSiteInput,
  set_status: SetStatusInput,
  batch_import: BatchImportInput,
  health_check: HealthCheckInput,
  delete_site: DeleteSiteInput,
  export_sites: ExportSitesInput,
  get_trending: GetTrendingInput,
  list_tags: ListTagsInput,
  refresh_site: RefreshSiteInput,
  run_job: RunJobInput,
  list_jobs: ListJobsInput,
  list_collections: ListCollectionsInput,
  get_architecture_recipe: GetArchitectureRecipeInput,
  compare_technologies: CompareTechnologiesInput,
  heal_broken_site: HealBrokenSiteInput,
  find_tech_path: FindTechPathInput,
  analyze_stack_compatibility: AnalyzeStackCompatibilityInput,
  cluster_sites: ClusterSitesInput,
  sync_crdt_operations: SyncCrdtOperationsInput,
  evaluate_developer_intent: EvaluateDeveloperIntentInput,
  analyze_color_harmony: AnalyzeColorHarmonyInput,
  get_federated_recommendations: GetFederatedRecommendationsInput,
  compile_speculation_rules: CompileSpeculationRulesInput,
  synthesize_agent_tool: SynthesizeAgentToolInput,
  exchange_p2p_mesh: ExchangeP2pMeshInput,
  get_alternatives: GetAlternativesInput,
  resolve_wayback: ResolveWaybackInput,
};

/**
 * REST 站点写入体：与 MCP 的 CreateSiteInput / UpdateSiteInput 同源派生，
 * 只在 REST 侧收紧/补齐（categoryId 必填、允许 nullable 的字段、REST 特有的
 * subCategoryId / iconKey / source / status / featured）。
 *
 * 这样两边不会再各自长出一版字段清单：MCP 加字段，REST 自动跟着有。
 */
export const SiteStatusSchema = z.enum(["active", "pending", "broken", "archived"]);

export const SiteActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  urlTemplate: z.string(),
  placeholder: z.string().optional(),
  icon: z.string().optional(),
});

export const SiteRelationSchema = z.object({
  targetTitle: z.string(),
  targetUrl: z.string(),
  relationType: z.enum(["alternative", "ecosystem", "upstream", "mirror"]),
  isFreeOrOpenSource: z.boolean().optional(),
  note: z.string().optional(),
});

export const SiteLiveMetricsSchema = z.object({
  githubStars: z.number().optional(),
  latestVersion: z.string().optional(),
  openSource: z.boolean().optional(),
  license: z.string().optional(),
  latencyMs: z.number().optional(),
});

export const SiteCreateBody = CreateSiteInput.omit({ enrich: true, idempotencyKey: true }).extend({
  description: z.string().nullable().optional().describe("描述；null 表示清空"),
  categoryId: z.string().min(1).describe("类目 id（REST 侧必填）"),
  subCategoryId: z.string().nullable().optional(),
  iconKey: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  status: SiteStatusSchema.optional(),
  featured: z.boolean().optional(),
  actions: z.array(SiteActionSchema).optional().describe("快捷动作列表"),
  relations: z.array(SiteRelationSchema).optional().describe("技术关联图谱"),
  liveMetrics: SiteLiveMetricsSchema.optional().describe("实时指标/星数"),
  workspaces: z.array(z.string()).optional().describe("关联工作区 ID 列表"),
  metadata: z.record(z.unknown()).optional().describe("动态扩展元数据"),
});

export const SiteUpdateBody = UpdateSiteInput.omit({ id: true }).extend({
  description: z.string().nullable().optional().describe("描述；null 表示清空"),
  categoryId: z.string().min(1).optional(),
  status: SiteStatusSchema.optional(),
  actions: z.array(SiteActionSchema).optional().describe("快捷动作列表"),
  relations: z.array(SiteRelationSchema).optional().describe("技术关联图谱"),
  liveMetrics: SiteLiveMetricsSchema.optional().describe("实时指标/星数"),
  workspaces: z.array(z.string()).optional().describe("关联工作区 ID 列表"),
  metadata: z.record(z.unknown()).optional().describe("动态扩展元数据"),
});

export const CreateApiTokenInput = z.object({
  name: z.string().min(1).max(64).describe("凭据名称标识"),
  scopes: z.string().default("read").describe("权限范围，英文逗号分隔（如 'read,write' 或 'admin'）"),
  expiresAt: z.number().int().positive().nullable().optional().describe("过期时间戳（毫秒）；省略落策略上限，显式 null 请求永久"),
});

export const UpdateApiTokenInput = z.object({
  name: z.string().min(1).max(64).optional().describe("凭据名称"),
  scopes: z.string().optional().describe("权限范围"),
  expiresAt: z.number().int().positive().nullable().optional().describe("过期时间戳（毫秒）"),
});

/**
 * REST 端点 -> 契约 schema 的绑定表。
 * key 必须是 OpenAPI 路径模板（`:id` 已转成 `{id}`）+ 大写方法。
 * 未绑定的端点退回"通用 object"，不会谎报字段。
 */
export const REST_SCHEMA_BINDINGS: Record<string, { schema: ZodSchemaLike; in: "body" | "query" }> = {
  "POST /api/sites": { schema: SiteCreateBody, in: "body" },
  "PATCH /api/sites/{id}": { schema: SiteUpdateBody, in: "body" },
  "POST /api/tokens": { schema: CreateApiTokenInput, in: "body" },
  "PATCH /api/tokens/{id}": { schema: UpdateApiTokenInput, in: "body" },
  "POST /api/search": { schema: SearchSitesInput, in: "body" },
  "GET /api/search": { schema: SearchSitesInput, in: "query" },
  "POST /api/crdt/sync": { schema: SyncCrdtOperationsInput, in: "body" },
  "POST /api/design/harmony": { schema: AnalyzeColorHarmonyInput, in: "body" },
  "POST /api/speculation/rules": { schema: CompileSpeculationRulesInput, in: "body" },
  "POST /api/rank/federated": { schema: GetFederatedRecommendationsInput, in: "body" },
  "POST /api/graph/path": { schema: FindTechPathInput, in: "body" },
  "POST /api/graph/compatibility": { schema: AnalyzeStackCompatibilityInput, in: "body" },
  "POST /api/sites/cluster": { schema: ClusterSitesInput, in: "body" },
  "POST /api/comparisons": { schema: CompareTechnologiesInput, in: "body" },
  "POST /api/recipes": { schema: GetArchitectureRecipeInput, in: "body" },
  "POST /api/tools/synthesize": { schema: SynthesizeAgentToolInput, in: "body" },
  "POST /api/p2p/signal": { schema: ExchangeP2pMeshInput, in: "body" },
  "POST /api/jobs": { schema: RunJobInput, in: "body" },
  "POST /api/sites/heal": { schema: HealBrokenSiteInput, in: "body" },
  "POST /api/sites/alternatives": { schema: GetAlternativesInput, in: "body" },
  "POST /api/wayback": { schema: ResolveWaybackInput, in: "body" },
  "GET /api/tags": { schema: ListTagsInput, in: "query" },
  "GET /api/rank/trending": { schema: GetTrendingInput, in: "query" },
};

/* ------------------------------------------------------------------ *
 * 工具元数据清单：与上面的 schema 同源，OpenAPI 的 x-mcp-tools 也用它
 * ------------------------------------------------------------------ */

export interface ToolDefinition {
  name: string;
  description: string;
  /** 需要的最小权限；读工具为 read */
  scope: McpScope;
  inputSchema: z.ZodTypeAny;
  /** 是否会产生持久化副作用（用于让宿主决定是否需要人工确认） */
  mutating: boolean;
}

export const MCP_TOOL_DEFS: ToolDefinition[] = [
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
    name: "list_jobs",
    description: "查询后台任务队列（可按状态过滤，按创建时间倒序）。run_job 只负责入队、执行是异步的：用本工具确认任务是否已执行、失败原因是什么。",
    scope: "read", inputSchema: ListJobsInput, mutating: false,
  },
  {
    name: "list_collections",
    description: "列出精选专题（合集）及其条目数与排序，默认只返回启用中的专题。适合回答「有哪些专题推荐」。",
    scope: "read", inputSchema: ListCollectionsInput, mutating: false,
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
  {
    name: "get_alternatives",
    description: "在洛伦兹/庞加莱双曲空间中推导目标站点的最佳平替与同生态技术，返回双曲测地线距离、同分类判定与多维替代得分。适合回答「有什么能替代 X 的工具」。",
    scope: "read", inputSchema: GetAlternativesInput, mutating: false,
  },
  {
    name: "resolve_wayback",
    description: "查询 Internet Archive Wayback 历史归档快照，为失效/下线/404 站点提供时间机器历史快照拯救链接，实现全网永久可用。",
    scope: "read", inputSchema: ResolveWaybackInput, mutating: false,
  },
];
