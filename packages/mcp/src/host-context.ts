/**
 * McpHostContext —— MCP 工具调用的宿主依赖抽象接口。
 *
 * 为什么需要这一层：packages/mcp 是 MCP 协议工具包，不应反向依赖
 * apps/api 的应用层实现。此前 MCP 处理器直接持有 AppContext，导致
 * packages/mcp 反向依赖 @navhub/api，破坏 Monorepo 单向分层。
 *
 * 解耦策略：将工具处理器实际用到的存储 / 检索 / 向量 / 配置依赖
 * 收敛为接口，由应用层（apps/mcp）或启动器在运行时注入。
 * 纯处理器代码只依赖本接口，不再触碰 @navhub/api。
 */
import type { Repository } from "@navhub/store";
import type { SearchEngine } from "@navhub/store";
import type { VectorStore } from "@navhub/store";
import type { PluginOps } from "@navhub/store";
import type { EmbeddingService } from "@navhub/ai";
import type { ResolvedLlm, McpHostConfig } from "@navhub/core";

/**
 * 配置面与插件索引操作**不再在本文件声明**（评审 P2-3）：
 *   - 配置面 → `@navhub/core` 的 `mcp-host.ts`；
 *   - 插件索引操作 → `@navhub/store` 的 `plugin-ops.ts`。
 * 二者都由 api 与 mcp 共用同一份定义，本文件只保留 MCP 侧真正独占的宿主接口，
 * 并原样转出 `McpHostConfig`，避免既有引用点被迫改导入路径。
 */
export type { McpHostConfig };

export interface McpHostContext {
  repo: Repository;
  search: SearchEngine;
  embedding: EmbeddingService;
  vectors: VectorStore;
  config: McpHostConfig;
  capabilities?: { mcp: string[]; embed: string[] };

  // 可选能力：插件索引操作（由应用层注入；apps/api createContext 是唯一装配点）。
  // 类型 = @navhub/store 的 PluginOps：与 REST 通道同一份声明，不再手工对拷。
  pluginOps?: PluginOps;

  // 可选能力：LLM 解析（由应用层注入）
  resolveLlm?: (identity?: string | null) => Promise<ResolvedLlm>;
}
