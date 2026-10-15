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
];

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOL_DEFS.find((t) => t.name === name);
}
