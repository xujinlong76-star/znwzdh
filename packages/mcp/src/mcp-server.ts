/**
 * MCP Server 工厂（stdio 与 Streamable HTTP 传输共用）。
 *
 * 把「工具清单 + 工具调用」的协议层装配收敛到一处：
 *  - ListTools：按 toolCtx 的 scope 过滤（只读 token 看不到写工具，
 *    避免 AI 客户端列出一堆必然 403 的工具）；inputSchema 用 zod-to-json-schema 转换。
 *  - CallTool：查工具定义 -> 查处理器 -> 调用；异常统一转 isError 结果，
 *    不让单次调用失败炸掉传输连接。
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema as zodToJsonSchemaImpl } from "zod-to-json-schema";
import type { AppContext } from "@navhub/api";
import { TOOL_DEFS, type ToolContext } from "./tools.ts";
import { createHandlers } from "./handlers.ts";

/**
 * zod -> JSON Schema（MCP 用 JSON Schema 描述工具入参）。
 *
 * 全仓 zod 固定在 v3（原因见 pnpm-workspace.yaml），v3 没有内置的
 * toJSONSchema，因此使用官方社区实现 zod-to-json-schema。
 * 转换失败时退回宽松描述，保证工具仍可被发现与调用。
 */
function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  try {
    return zodToJsonSchemaImpl(schema as never, { $refStrategy: "none" }) as Record<string, unknown>;
  } catch {
    return { type: "object", additionalProperties: true };
  }
}

export function createMcpServer(ctx: AppContext, toolCtx: ToolContext): Server {
  const handlers = createHandlers(ctx) as Record<string, (a: unknown, t: ToolContext) => Promise<unknown>>;

  const server = new Server(
    { name: "navhub", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS.filter((t) => toolCtx.has(t.scope)).map((t) => ({
      name: t.name,
      description: t.description + (t.mutating ? "（写操作，会修改数据）" : ""),
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const def = TOOL_DEFS.find((t) => t.name === req.params.name);
    if (!def) {
      return { content: [{ type: "text", text: "未知工具：" + req.params.name }], isError: true };
    }
    const handler = handlers[def.name];
    if (!handler) {
      return { content: [{ type: "text", text: "工具未实现：" + def.name }], isError: true };
    }
    try {
      return await handler(req.params.arguments ?? {}, toolCtx) as never;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: "调用失败：" + message }], isError: true };
    }
  });

  return server;
}
