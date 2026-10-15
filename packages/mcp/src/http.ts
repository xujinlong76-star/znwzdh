/**
 * MCP Streamable HTTP 传输。
 *
 * 与 stdio 的区别（也是安全要求的来源）：HTTP 模式暴露在网络里，
 * 因此必须显式鉴权。
 *
 * 安全措施（对齐 MCP 官方 Security Best Practices 中的本地/远程服务建议）：
 *  1. **默认只监听 127.0.0.1**，不默认对外暴露；要对外必须显式改 HOST。
 *  2. **必须提供 Bearer token**（NAVHUB_MCP_TOKEN），除非显式设置
 *     NAVHUB_MCP_ALLOW_INSECURE=true（仅供本地调试）。
 *  3. **校验 Origin**：浏览器发起的跨站请求一律拒绝，防 DNS rebinding / CSRF。
 *  4. token 的 scope 决定可调用的工具集合。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createContext, loadConfig, hashToken, parseScopes } from "@navhub/api";
import type { AppContext } from "@navhub/api";
import { createHandlers } from "./handlers.ts";
import { TOOL_DEFS, type McpScope, type ToolContext } from "./tools.ts";

const HOST = process.env.NAVHUB_MCP_HTTP_HOST ?? "127.0.0.1";
const PORT = Number(process.env.NAVHUB_MCP_HTTP_PORT ?? 8790);
/** 静态引导 token：视同 admin，用于首次配置；与 REST 的 NAVHUB_BOOTSTRAP_TOKEN 同性质 */
const TOKEN = process.env.NAVHUB_MCP_TOKEN ?? "";
const ALLOW_INSECURE = process.env.NAVHUB_MCP_ALLOW_INSECURE === "true";
const ALLOWED_ORIGINS = (process.env.NAVHUB_MCP_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
/** 静态 token 命中时赋予的 scope（缺省全权，便于 bootstrap） */
const STATIC_SCOPES = (process.env.NAVHUB_MCP_SCOPES ?? "read,write,admin").split(",").map((s) => s.trim()).filter(Boolean) as McpScope[];

function secureEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * MCP HTTP 鉴权。
 *
 * 与 REST 共用同一套凭据体系（api_tokens 表）：
 *   1. 静态 NAVHUB_MCP_TOKEN（若设置）命中 → 视同 admin（bootstrap，与 REST 一致）。
 *   2. 否则把 Bearer 值做 sha256 后查 api_tokens 表，命中且未过期 → 用其 scope 与名称。
 * 这样在管理页（/admin/tokens）签发的 token，即可同时用于 REST 与 MCP HTTP——
 * 修复此前「凭据管理页声称 token 供 MCP 使用，但 MCP 实际只看环境变量」的脱节。
 */
async function auth(req: IncomingMessage, ctx: AppContext): Promise<ToolContext | null> {
  // Origin 校验：只有在显式配置了允许来源时才接受浏览器请求
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return null;

  if (ALLOW_INSECURE && TOKEN === "") {
    return { actor: "mcp:insecure", scopes: ["read"], has: (s) => s === "read" };
  }

  const header = req.headers.authorization ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const bearer = match?.[1]?.trim();
  if (!bearer) return null;

  // 1) 静态引导 token（内存比对，视同 admin）
  if (TOKEN !== "" && secureEqual(bearer, TOKEN)) {
    const set = new Set<McpScope>(STATIC_SCOPES.length ? STATIC_SCOPES : ["read", "write", "admin"]);
    return { actor: process.env.NAVHUB_MCP_ACTOR ?? "mcp:static", scopes: [...set], has: (s) => set.has(s) };
  }

  // 2) 查 api_tokens 表（与 REST 同源同逻辑）
  try {
    const record = await ctx.repo.findApiTokenByHash(hashToken(bearer));
    if (!record) return null;
    const scopes = parseScopes(record.scopes.join(","));
    if (scopes.length === 0) return null;
    const set = new Set<McpScope>(scopes as McpScope[]);
    return { actor: "mcp:" + record.name, scopes: [...set], has: (s) => set.has(s) };
  } catch {
    // DB 查询失败（如只读打开）——不让整条 MCP 链路崩掉，退回静态路径
    return null;
  }
}

async function main() {
  const ctx = await createContext(loadConfig());
  const handlers = createHandlers(ctx) as Record<string, (a: unknown, t: ToolContext) => Promise<unknown>>;

  // 无静态 token 且未显式允许 insecure 时，校验库里是否有表内 token。
  // 若两边都没有，HTTP MCP 将完全无鉴权 —— 拒绝启动（安全底线），并给出 bootstrap 指引。
  if (TOKEN === "" && !ALLOW_INSECURE) {
    const tableTokens = await ctx.repo.listApiTokens();
    if (tableTokens.length === 0) {
      console.error("[navhub-mcp] 拒绝启动：既无 NAVHUB_MCP_TOKEN，api_tokens 表也为空 —— HTTP MCP 将无鉴权暴露。");
      console.error("[navhub-mcp] 引导：在管理页 /admin/tokens 签发表内 token，或设 NAVHUB_MCP_TOKEN，或仅本地调试设 NAVHUB_MCP_ALLOW_INSECURE=true。");
      await ctx.close();
      process.exit(2);
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (code: number, body: unknown) => {
      const text = JSON.stringify(body);
      res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
      res.end(text);
    };

    const url = new URL(req.url ?? "/", "http://" + (req.headers.host ?? "localhost"));

    if (req.method === "GET" && url.pathname === "/health") {
      return send(200, { ok: true, capabilities: ctx.capabilities, tools: TOOL_DEFS.length });
    }

    const toolCtx = await auth(req, ctx);
    if (!toolCtx) {
      res.setHeader("WWW-Authenticate", "Bearer");
      return send(401, { error: "未授权：需要有效的 Bearer token，且来源必须被允许" });
    }

    // 工具清单（便于 AI 客户端发现能力）
    if (req.method === "GET" && url.pathname === "/tools") {
      return send(200, {
        tools: TOOL_DEFS.filter((t) => toolCtx.has(t.scope) || t.scope === "read").map((t) => ({
          name: t.name, description: t.description, scope: t.scope, mutating: t.mutating,
        })),
      });
    }

    // 调用工具：POST /tools/<name>
    if (req.method === "POST" && url.pathname.startsWith("/tools/")) {
      const name = url.pathname.slice("/tools/".length);
      const def = TOOL_DEFS.find((t) => t.name === name);
      if (!def) return send(404, { error: "未知工具：" + name });
      const handler = handlers[name];
      if (!handler) return send(501, { error: "工具未实现：" + name });

      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 1_000_000) return send(413, { error: "请求体过大" });
      }
      let args: unknown = {};
      if (raw.trim()) {
        try { args = JSON.parse(raw); } catch { return send(400, { error: "请求体不是合法 JSON" }); }
      }

      try {
        return send(200, await handler(args, toolCtx));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes("权限") ? 403 : 400;
        return send(status, { error: message });
      }
    }

    return send(404, { error: "未知路径", hint: "GET /health | GET /tools | POST /tools/<name>" });
  });

  server.listen(PORT, HOST, () => {
    console.error("[navhub-mcp] HTTP 传输监听 http://" + HOST + ":" + PORT);
    console.error("[navhub-mcp] 鉴权：" + (TOKEN ? "静态 token + 表内 token" : ALLOW_INSECURE ? "insecure 模式" : "表内 token（api_tokens）"));
    console.error("[navhub-mcp] 工具数：" + TOOL_DEFS.length + "；能力：" + JSON.stringify(ctx.capabilities));
  });
}

main().catch((err) => {
  console.error("[navhub-mcp] 启动失败：", err);
  process.exit(1);
});
