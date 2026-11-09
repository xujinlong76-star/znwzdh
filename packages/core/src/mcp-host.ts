/**
 * MCP 宿主契约的**共享形状**（评审 P2-3：宿主契约手工对拷、无双写约束）。
 *
 * 背景：MCP 工具处理器不直接持有 AppContext（否则 packages/mcp 反向依赖
 * apps/api，破坏单向分层），而是依赖一个由启动器注入的宿主接口。该接口里
 * 「配置面」这一小块此前在两侧各写一份：packages/mcp 的 McpHostConfig 与
 * apps/api 的 AppConfig.fetch / AppConfig.embedding 各自声明，靠人肉对齐。
 *
 * 为什么这一块能收敛到 core：它只描述**纯数据形状**（超时 / 体积 / 跳数 /
 * UA / 嵌入模型与维度），不引用 Repository、EmbeddingService 之类上层类型，
 * 因此可以放在依赖方向最低的 core，被 api 与 mcp 同时依赖。
 *
 * 「双写约束」由 apps/api/src/config.ts 的编译期断言提供：AppConfig 的对应
 * 字段一旦满足不了本契约（少字段 / 改类型），tsc 直接报错，而不是等 MCP 侧
 * 运行期拿到 undefined。
 */
export interface McpHostFetchConfig {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  allowPrivateNetworks: boolean;
  userAgent: string;
}

export interface McpHostConfig {
  fetch: McpHostFetchConfig;
  embedding: { model: string; dim: number };
}