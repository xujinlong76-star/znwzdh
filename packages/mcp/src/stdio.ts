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
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "@navhub/api";
import { loadConfig } from "@navhub/api";
import { scopeSatisfies } from "@navhub/api";
import { TOOL_DEFS, type McpScope, type ToolContext } from "./tools.ts";
import { createMcpServer } from "./mcp-server.ts";

function makeContext(): ToolContext {
  const names = (process.env.NAVHUB_MCP_SCOPES ?? "read,write").split(",").map((s) => s.trim()) as McpScope[];
  const scopes = [...new Set<McpScope>(names)];
  return {
    actor: process.env.NAVHUB_MCP_ACTOR ?? "mcp:stdio",
    scopes,
    // 层级鉴权：admin ⊇ write ⊇ read（与 apps/api/src/auth.ts 的 scopeSatisfies 同语义）
    has: (s) => scopeSatisfies(scopes, s),
  };
}

async function main() {
  const config = loadConfig();
  const ctx = await createContext(config);
  const server = createMcpServer(ctx, makeContext());

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("[navhub-mcp] 启动失败：", err);
  process.exit(1);
});
