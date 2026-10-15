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
  kind: z.enum(["health_check", "refetch_metadata", "recompute_rank", "reindex"]).describe("任务类型"),
  payload: z.record(z.unknown()).optional().describe("任务参数（如 refetch_metadata 需要 siteId）"),
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
};

/**
 * REST 站点写入体：与 MCP 的 CreateSiteInput / UpdateSiteInput 同源派生，
 * 只在 REST 侧收紧/补齐（categoryId 必填、允许 nullable 的字段、REST 特有的
 * subCategoryId / iconKey / source / status / featured）。
 *
 * 这样两边不会再各自长出一版字段清单：MCP 加字段，REST 自动跟着有。
 */
export const SiteStatusSchema = z.enum(["active", "pending", "broken", "archived"]);

export const SiteCreateBody = CreateSiteInput.omit({ enrich: true, idempotencyKey: true }).extend({
  description: z.string().nullable().optional().describe("描述；null 表示清空"),
  categoryId: z.string().min(1).describe("类目 id（REST 侧必填）"),
  subCategoryId: z.string().nullable().optional(),
  iconKey: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  status: SiteStatusSchema.optional(),
  featured: z.boolean().optional(),
});

export const SiteUpdateBody = UpdateSiteInput.omit({ id: true }).extend({
  description: z.string().nullable().optional().describe("描述；null 表示清空"),
  categoryId: z.string().min(1).optional(),
  status: SiteStatusSchema.optional(),
});

/**
 * REST 端点 -> 契约 schema 的绑定表。
 * key 必须是 OpenAPI 路径模板（`:id` 已转成 `{id}`）+ 大写方法。
 * 未绑定的端点退回"通用 object"，不会谎报字段。
 */
export const REST_SCHEMA_BINDINGS: Record<string, { schema: ZodSchemaLike; in: "body" | "query" }> = {
  "POST /api/sites": { schema: SiteCreateBody, in: "body" },
  "PATCH /api/sites/{id}": { schema: SiteUpdateBody, in: "body" },
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
  "GET /api/tags": { schema: ListTagsInput, in: "query" },
  "GET /api/rank/trending": { schema: GetTrendingInput, in: "query" },
};
