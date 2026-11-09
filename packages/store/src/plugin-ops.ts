/**
 * 插件索引操作契约（宿主注入面）。
 *
 * 为什么放在 @navhub/store，而不是 @navhub/core 或 @navhub/mcp：
 *   - 载荷类型建立在 store 自己的 `PluginRecord` 之上（`Omit<PluginRecord, "manifest">`），
 *     而 core 处在 store **之下**，不可能引用它；
 *   - apps/api 不能 import @navhub/mcp（依赖方向是 mcp → api），把唯一事实源放在
 *     mcp 就等于把它锁在错误的一侧，api 只能继续手抄；
 *   - api 与 mcp **都**依赖 store，这里是双方唯一能共享、且不会形成环的层。
 *
 * 收敛前的问题（评审 P2-3）：packages/mcp 的 host-context.ts 与
 * apps/api 的 context.ts 各写一份，且 mcp 侧把 `mode` 放宽成 `string`、
 * 把返回载荷内联重述了一遍 —— 于是「api 改了结果形状」在 mcp 侧**永远**能通过
 * 结构检查，双写可以静默漂移。现在两侧共用同一份声明。
 */
import type { PluginSummary } from "@navhub/core";
import type { PluginRecord } from "./repository/records.ts";

/**
 * 卡片型插件载荷（REST 搜索面板、详情页相似区、MCP 共用）。
 *
 * site-pack 不下发完整清单：单包可达数十 KB，而消费方全部只读 summary，
 * 因此语义与 `GET /api/plugins` 的默认裁剪一致。
 */
export type PluginSearchItem = Omit<PluginRecord, "manifest"> & {
  manifest?: PluginRecord["manifest"];
  summary: PluginSummary;
  /** 语义模式的余弦相似度（1 - distance）；关键词回退时缺省 */
  score?: number | null;
};

export interface PluginSearchResult {
  items: PluginSearchItem[];
  total: number;
  mode: "semantic" | "keyword" | "hybrid";
  degraded: boolean;
}

/**
 * 插件向量索引操作（由宿主注入；apps/api createContext 是唯一装配点）。
 * REST 通道与 MCP 通道共用同一套实现（apps/api/src/plugins-search.ts）。
 */
export interface PluginOps {
  indexSitesBatch(sites: Array<{ id: string; title: string; description: string | null; url: string }>): Promise<void>;
  removePluginIndex(pluginId: string): Promise<void>;
  searchPluginsSemantic(query: string, limit: number): Promise<PluginSearchResult>;
}