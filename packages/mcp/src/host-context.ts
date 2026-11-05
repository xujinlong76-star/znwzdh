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
import type { EmbeddingService } from "@navhub/ai";
import type { ResolvedLlm } from "@navhub/core";

export interface McpHostConfig {
  fetch: {
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
    allowPrivateNetworks: boolean;
    userAgent: string;
  };
  embedding: { model: string; dim: number };
}

export interface McpHostContext {
  repo: Repository;
  search: SearchEngine;
  embedding: EmbeddingService;
  vectors: VectorStore;
  config: McpHostConfig;
  capabilities?: { mcp: string[]; embed: string[] };

  // 可选能力：插件索引操作（由应用层注入）
  pluginOps?: {
    indexSitesBatch: (sites: Array<{ title: string; description: string | null; url: string }>) => Promise<void>;
    removePluginIndex: (pluginId: string) => Promise<void>;
    searchPluginsSemantic: (query: string, limit: number) => Promise<{
      items: Array<{ slug: string; kind: string; name: string; description: string | null; version: string; author: string; tags: string[]; installCount: number; starCount: number; reviewCount: number; ratingAvg: number; featured: boolean; publishedAt: number | null; score: number | null; summary: string | null }>;
      total: number;
      mode: string;
      degraded: boolean;
    }>;
  };

  // 可选能力：LLM 解析（由应用层注入）
  resolveLlm?: (identity?: string | null) => Promise<ResolvedLlm>;
}
