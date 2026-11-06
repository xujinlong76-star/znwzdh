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
 *                  "NAVHUB_MCP_SCOPES": "read" }
 *       }
 *     }
 *   }
 *
 * ⚠️ 最小权限（2026-11-06 深扫 P2-12）：stdio 虽无网络监听，但「被诱导粘贴一段
 * 恶意 mcpServers 配置」正是它的主要攻击面——客户端配置文件由用户/第三方内容
 * 决定，不等于用户本人显式授权写操作。默认只给 read；需要 create_site /
 * update_site 等写工具时由运维显式设置 NAVHUB_MCP_SCOPES=read,write。
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "@navhub/api";
import { loadConfig } from "@navhub/api";
import { scopeSatisfies } from "@navhub/api";
import { TOOL_DEFS, type McpScope, type ToolContext } from "../../../packages/mcp/src/tools.ts";
import { createMcpServer } from "../../../packages/mcp/src/mcp-server.ts";

function makeContext(): ToolContext {
  const names = (process.env.NAVHUB_MCP_SCOPES ?? "read").split(",").map((s) => s.trim()) as McpScope[];
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
