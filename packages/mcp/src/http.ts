/**
 * MCP HTTP 传输启动入口。
 *
 * 实现细节在 ./http-server.ts（标准 MCP Streamable HTTP 传输 + 兼容 REST 端点），
 * 这里只负责：读环境变量 -> 装配上下文 -> 校验生产安全约束 -> 监听。
 *
 * 安全约束（HTTP 模式暴露在网络里，因此必须显式鉴权）：
 *  1. 默认只监听 127.0.0.1，不默认对外暴露；要对外必须显式改 HOST。
 *  2. 必须提供 Bearer token（NAVHUB_MCP_TOKEN），除非显式设置
 *     NAVHUB_MCP_ALLOW_INSECURE=true（仅供本地调试，且只放行只读能力）。
 *  3. 校验 Origin：不在白名单的浏览器跨站请求一律拒绝，防 DNS rebinding / CSRF。
 *  4. token 的 scope 决定可调用的工具集合。
 */
import { createContext, loadConfig } from "@navhub/api";
import { createMcpHttpServer, mcpHttpOptionsFromEnv } from "./http-server.ts";
import { TOOL_DEFS } from "./tools.ts";

const HOST = process.env.NAVHUB_MCP_HTTP_HOST ?? "127.0.0.1";
const PORT = Number(process.env.NAVHUB_MCP_HTTP_PORT ?? 8790);
const TOKEN = process.env.NAVHUB_MCP_TOKEN ?? "";
const ALLOW_INSECURE = process.env.NAVHUB_MCP_ALLOW_INSECURE === "true";

async function main() {
  if (TOKEN === "" && !ALLOW_INSECURE) {
    console.error("[navhub-mcp] 拒绝启动：HTTP 模式必须设置 NAVHUB_MCP_TOKEN。");
    console.error("[navhub-mcp] 仅本地调试可设 NAVHUB_MCP_ALLOW_INSECURE=true。");
    process.exit(2);
  }

  const ctx = await createContext(loadConfig());
  const server = createMcpHttpServer(mcpHttpOptionsFromEnv(ctx));

  server.listen(PORT, HOST, () => {
    console.error("[navhub-mcp] HTTP 传输监听 http://" + HOST + ":" + PORT);
    console.error("[navhub-mcp] 标准端点：POST/GET/DELETE /mcp（MCP Streamable HTTP）");
    console.error("[navhub-mcp] 鉴权：" + (TOKEN ? "Bearer token 已启用" : "未启用（insecure 模式）"));
    if (!TOKEN) {
      console.error("[navhub-mcp] ⚠️ 警告：ALLOW_INSECURE 调试模式已放行全部只读能力且无 token 鉴权，仅限本地回环使用，公网部署必须设置 NAVHUB_MCP_TOKEN！");
    }
    console.error("[navhub-mcp] 工具数：" + TOOL_DEFS.length + "；能力：" + JSON.stringify(ctx.capabilities));
  });
}

main().catch((err) => {
  console.error("[navhub-mcp] 启动失败：", err);
  process.exit(1);
});
