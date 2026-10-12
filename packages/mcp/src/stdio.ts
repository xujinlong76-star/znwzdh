#!/usr/bin/env node
/**
 * MCP stdio 传输。
 *
 * 用于本地 AI 客户端（Claude Desktop、Cursor、DeepSeek 等）直接拉起，
 * 例如配置：
 *
 *   {
 *     "mcpServers": {
 *       "navhub": {
 *         "command": "node",
 *         "args": ["--experimental-strip-types", "packages/mcp/src/stdio.ts"],
 *         "env": { "NAVHUB_MODE": "lite", "NAVHUB_SQLITE_PATH": "./data/navhub.db",
 *                  "NAVHUB_MCP_SCOPES": "read,write" }
 *       }
 *     }
 *   }
 *
 * ⚠️ stdio 模式下进程由客户端直接启动，没有网络攻击面，
 * 权限由启动它的用户决定；因此 scope 默认给 read,write（仍可通过环境变量收紧）。
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createContext } from "@navhub/api";
import { loadConfig } from "@navhub/api";
import { TOOL_DEFS, type McpScope, type ToolContext } from "./tools.ts";
import { createHandlers } from "./handlers.ts";

function makeContext(): ToolContext {
  const names = (process.env.NAVHUB_MCP_SCOPES ?? "read,write").split(",").map((s) => s.trim()) as McpScope[];
  const scopes = new Set<McpScope>(names);
  return {
    actor: process.env.NAVHUB_MCP_ACTOR ?? "mcp:stdio",
    scopes: [...scopes],
    has: (s) => scopes.has(s),
  };
}

async function main() {
  const config = loadConfig();
  const ctx = await createContext(config);
  const handlers = createHandlers(ctx) as Record<string, (a: unknown, t: ToolContext) => Promise<unknown>>;
  const toolCtx = makeContext();

  const server = new Server(
    { name: "navhub", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS.map((t) => ({
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

  await server.connect(new StdioServerTransport());
}

/**
 * zod -> JSON Schema（MCP 用 JSON Schema 描述工具入参）。
 * zod v4 内置 z.toJSONSchema，无需额外依赖。
 */
function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema as never) as Record<string, unknown>;
  } catch {
    // 某些 schema（如 z.object({}) 的空对象）在严格模式下可能失败，退回宽松描述
    return { type: "object", additionalProperties: true };
  }
}

main().catch((err) => {
  console.error("[navhub-mcp] 启动失败：", err);
  process.exit(1);
});
