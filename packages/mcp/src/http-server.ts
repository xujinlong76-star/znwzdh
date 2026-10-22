/**
 * MCP Streamable HTTP 传输（标准协议实现）+ 兼容的 REST 便捷端点。
 *
 * ## 为什么要有这一层
 *
 * 旧实现只提供 `POST /tools/<name>` 这种"自定义 REST"，任何标准 MCP 客户端
 * （Claude Desktop 的 mcp-remote、Cursor、各种 SDK）都连不上——它们说的是
 * JSON-RPC 的 `initialize` / `tools/list` / `tools/call`。
 * 本文件用官方 SDK 的 `StreamableHTTPServerTransport` 实现 **MCP Streamable
 * HTTP 传输规范**（有状态会话 + SSE），同时保留旧端点不破坏既有脚本。
 *
 * ## 路由
 *
 *   GET    /health       进程存活（鉴权前，不泄露能力枚举）
 *   POST   /mcp          标准 MCP：客户端 -> 服务端 JSON-RPC（initialize/tools/list/tools/call…）
 *   GET    /mcp          标准 MCP：服务端 -> 客户端 SSE 流
 *   DELETE /mcp          标准 MCP：结束会话
 *   GET    /tools        兼容端点：工具清单
 *   POST   /tools/<name> 兼容端点：调用单个工具
 *
 * ## 安全措施（对齐 MCP Security Best Practices）
 *
 *  1. **默认只监听 127.0.0.1**（见 http.ts），不默认对外暴露。
 *  2. **必须提供 Bearer token**（NAVHUB_MCP_TOKEN），除非显式
 *     NAVHUB_MCP_ALLOW_INSECURE=true（仅供本地调试，且只放行 read）。
 *  3. **校验 Origin**：不在白名单的浏览器跨站请求一律拒绝，防 DNS rebinding / CSRF。
 *  4. token 的 scope 决定可见/可调用的工具集合，且**每个请求**都重新校验 token，
 *     token 一旦失效，已建立的会话也随之失效。
 *  5. 会话空闲超时自动回收，避免内存泄漏；请求体上限 1MB。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AppContext } from "@navhub/api";
import { scopeSatisfies, hashToken, parseScopes } from "@navhub/api";
import { createHandlers } from "./handlers.ts";
import { createMcpServer } from "./mcp-server.ts";
import { TOOL_DEFS, type McpScope, type ToolContext } from "./tools.ts";

export interface McpHttpOptions {
  /** 应用上下文（数据库 / 检索 / AI），由调用方装配以便测试注入 */
  ctx: AppContext;
  /** Bearer token；为空且 allowInsecure 时进入只读调试模式 */
  token?: string;
  /** 允许的浏览器 Origin；为空表示拒绝一切带 Origin 的跨站请求（CLI 客户端无 Origin） */
  allowedOrigins?: string[];
  /** 已授权 token 的 scope（默认 read,write） */
  scopes?: McpScope[];
  /** 审计身份（默认 mcp:http） */
  actor?: string;
  /** 本地调试：无 token 时放行只读能力（默认关闭） */
  allowInsecure?: boolean;
  /** 会话空闲回收阈值（默认 30 分钟） */
  sessionIdleMs?: number;
}

/** MCP 规范：请求体大小上限（与旧 REST 端点一致） */
const MAX_BODY_BYTES = 1_000_000;

interface McpSession {
  transport: StreamableHTTPServerTransport;
  /** 会话建立时的身份（token 未变则后续请求复用；每请求仍会重新校验 token） */
  toolCtx: ToolContext;
  lastSeen: number;
  /** 进行中的 GET SSE 流数量：有活跃流时不回收会话 */
  activeStreams: number;
}

function secureEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function isValidJsonRpcMessage(body: unknown): boolean {
  if (Array.isArray(body)) return body.length > 0 && body.every(isValidJsonRpcMessage);
  if (typeof body !== "object" || body === null) return false;
  const m = body as { jsonrpc?: unknown; method?: unknown };
  // 响应消息没有 method，但有 result/error；只要 jsonrpc 版本对就放行，交给传输层判定
  return m.jsonrpc === "2.0";
}

function isInitialize(body: unknown): boolean {
  const has = (m: unknown) =>
    typeof m === "object" && m !== null && (m as { method?: unknown }).method === "initialize";
  return Array.isArray(body) ? body.some(has) : has(body);
}

export function createMcpHttpServer(opts: McpHttpOptions): Server {
  const token = opts.token ?? "";
  const allowInsecure = opts.allowInsecure === true;
  const allowedOrigins = opts.allowedOrigins ?? [];
  const scopes = opts.scopes ?? (["read", "write"] as McpScope[]);
  const actor = opts.actor ?? "mcp:http";
  const sessionIdleMs = opts.sessionIdleMs ?? 30 * 60 * 1000;

  const handlers = createHandlers(opts.ctx) as Record<string, (a: unknown, t: ToolContext) => Promise<unknown>>;
  const sessions = new Map<string, McpSession>();

  async function auth(req: IncomingMessage): Promise<ToolContext | null> {
    // Origin 校验：浏览器跨站请求只在白名单内放行
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin && !allowedOrigins.includes(origin)) return null;

    if (allowInsecure && token === "") {
      // 调试模式：放行全部只读能力（仍拒绝写/管理）。警告日志见 http.ts 启动时输出。
      const list: McpScope[] = ["read"];
      return { actor: "mcp:insecure", scopes: list, has: (s) => scopeSatisfies(list, s) };
    }

    const header = req.headers.authorization ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const bearer = match?.[1]?.trim();
    if (!bearer) return null;

    // 1) 静态引导 token（内存比对，视同 admin）——与 REST 的 NAVHUB_BOOTSTRAP_TOKEN 同性质
    if (token !== "" && secureEqual(bearer, token)) {
      const list = [...new Set<McpScope>(scopes)];
      return { actor, scopes: list, has: (s) => scopeSatisfies(list, s) };
    }

    // 2) 查 api_tokens 表（与 REST 同源同逻辑；findApiTokenByHash 已过滤吊销与过期）：
    //    管理页 /admin/tokens 签发的 token 必须同时适用于 REST 与 MCP HTTP，
    //    否则「凭据页声称供 MCP 使用、实际只看环境变量」的脱节会再次出现。
    try {
      const record = await opts.ctx.repo.findApiTokenByHash(hashToken(bearer));
      if (!record) return null;
      const tableScopes = parseScopes(record.scopes.join(","));
      if (tableScopes.length === 0) return null;
      const list = [...new Set<McpScope>(tableScopes as McpScope[])];
      return { actor: "mcp:" + record.name, scopes: list, has: (s) => scopeSatisfies(list, s) };
    } catch {
      // DB 查询失败（如只读打开）——不让整条 MCP 链路崩掉，退回未授权
      return null;
    }
  }

  async function readJsonBody(req: IncomingMessage): Promise<{ ok: true; body: unknown } | { ok: false; reason: "toolarge" | "invalid" }> {
    // 必须攒够再整体解码：`raw += chunk` 把每个 Buffer 单独按 UTF-8 转字符串，
    // 跨 socket 分片的多字节汉字被拆成 U+FFFD——JSON 照样解析成功，
    // 但写进库的中文标题/描述已经是坏的。
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      received += buf.length;
      if (received > MAX_BODY_BYTES) return { ok: false, reason: "toolarge" };
      chunks.push(buf);
    }
    const raw = Buffer.concat(chunks, received).toString("utf8");
    if (!raw.trim()) return { ok: true, body: {} };
    try {
      return { ok: true, body: JSON.parse(raw) };
    } catch {
      return { ok: false, reason: "invalid" };
    }
  }

  function headerValue(req: IncomingMessage, name: string): string | undefined {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (code: number, body: unknown) => {
      const text = JSON.stringify(body);
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(text),
      });
      res.end(text);
    };

    const url = new URL(req.url ?? "/", "http://" + (req.headers.host ?? "localhost"));

    if (req.method === "GET" && url.pathname === "/health") {
      // 精简版健康检查：鉴权前不泄露 capabilities / 工具数（枚举攻击面）。
      return send(200, { ok: true });
    }

    // 每个请求都重新校验 token：token 失效则已建立的会话一起失效
    const toolCtx = await auth(req);
    if (!toolCtx) {
      res.setHeader("WWW-Authenticate", "Bearer");
      return send(401, { error: "未授权：需要有效的 Bearer token，且来源必须被允许" });
    }

    /* ---------------- 标准 MCP Streamable HTTP ---------------- */

    if (url.pathname === "/mcp") {
      const sid = headerValue(req, "mcp-session-id");
      // MCP 端点的错误一律用 JSON-RPC 2.0 错误体（id:null），标准客户端才能识别
      const rpcError = (code: number, message: string) =>
        send(code, { jsonrpc: "2.0", error: { code: -32000, message }, id: null });

      if (req.method === "GET") {
        // 服务端 -> 客户端 SSE 流：必须携带有效会话
        const session = sid ? sessions.get(sid) : undefined;
        if (!session) return rpcError(404, "Session not found");
        session.lastSeen = Date.now();
        session.activeStreams++;
        res.once("close", () => {
          session.activeStreams--;
          session.lastSeen = Date.now();
        });
        return await session.transport.handleRequest(req, res);
      }

      if (req.method === "DELETE") {
        const session = sid ? sessions.get(sid) : undefined;
        if (!session) return rpcError(404, "Session not found");
        sessions.delete(sid!);
        return await session.transport.handleRequest(req, res);
      }

      if (req.method !== "POST") {
        res.setHeader("Allow", "GET, POST, DELETE");
        return rpcError(405, "Method Not Allowed");
      }

      const parsed = await readJsonBody(req);
      if (!parsed.ok) return rpcError(parsed.reason === "toolarge" ? 413 : 400, parsed.reason === "toolarge" ? "Request body too large" : "Parse error: Invalid JSON");
      if (!isValidJsonRpcMessage(parsed.body)) return rpcError(400, "Invalid JSON-RPC 2.0 message");

      // 已有会话：复用（传输层自行处理请求/通知/响应）
      if (sid) {
        const session = sessions.get(sid);
        if (!session) return rpcError(404, "Session not found（Mcp-Session-Id 无效或已过期）");
        session.lastSeen = Date.now();
        return await session.transport.handleRequest(req, res, parsed.body);
      }

      // 无会话：规范要求第一条消息只能是 initialize
      if (!isInitialize(parsed.body)) {
        return rpcError(400, "Bad Request: No valid session ID provided");
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        maxRequestBodySize: MAX_BODY_BYTES,
        onsessioninitialized: (sessionId) => {
          sessions.set(sessionId, { transport, toolCtx, lastSeen: Date.now(), activeStreams: 0 });
        },
      });
      // 注意：必须在 connect 之前挂 onclose——Protocol.connect 会把它串起来保留
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) sessions.delete(id);
      };
      const mcp = createMcpServer(opts.ctx, toolCtx);
      await mcp.connect(transport);
      return await transport.handleRequest(req, res, parsed.body);
    }

    /* ---------------- 兼容端点（旧脚本 / 简单探活） ---------------- */

    if (req.method === "GET" && url.pathname === "/tools") {
      return send(200, {
        tools: TOOL_DEFS.filter((t) => toolCtx.has(t.scope)).map((t) => ({
          name: t.name, description: t.description, scope: t.scope, mutating: t.mutating,
        })),
      });
    }

    if (req.method === "POST" && url.pathname.startsWith("/tools/")) {
      const name = url.pathname.slice("/tools/".length);
      const def = TOOL_DEFS.find((t) => t.name === name);
      if (!def) return send(404, { error: "未知工具：" + name });
      const handler = handlers[name];
      if (!handler) return send(501, { error: "工具未实现：" + name });

      const parsed = await readJsonBody(req);
      if (!parsed.ok) return send(parsed.reason === "toolarge" ? 413 : 400, { error: parsed.reason === "toolarge" ? "请求体过大" : "请求体不是合法 JSON" });

      try {
        return send(200, await handler(parsed.body, toolCtx));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const status = message.includes("权限") ? 403 : 400;
        return send(status, { error: message });
      }
    }

    return send(404, {
      error: "未知路径",
      hint: "MCP: POST /mcp（标准 Streamable HTTP）| GET /tools | POST /tools/<name> | GET /health",
    });
  });

  // 会话空闲回收：有活跃 SSE 流的会话不回收
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (s.activeStreams === 0 && now - s.lastSeen > sessionIdleMs) {
        sessions.delete(id);
        void s.transport.close().catch(() => undefined);
      }
    }
  }, Math.max(Math.floor(sessionIdleMs / 3), 30_000));
  sweep.unref?.();

  server.on("close", () => {
    clearInterval(sweep);
    for (const s of sessions.values()) void s.transport.close().catch(() => undefined);
    sessions.clear();
  });

  return server;
}

/** 从环境变量构造选项（http.ts 的启动入口使用；测试直接传 options） */
export function mcpHttpOptionsFromEnv(ctx: AppContext): McpHttpOptions {
  const scopes = (process.env.NAVHUB_MCP_SCOPES ?? "read,write")
    .split(",").map((s) => s.trim()).filter(Boolean) as McpScope[];
  return {
    ctx,
    token: process.env.NAVHUB_MCP_TOKEN ?? "",
    allowInsecure: process.env.NAVHUB_MCP_ALLOW_INSECURE === "true",
    allowedOrigins: (process.env.NAVHUB_MCP_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    scopes,
    actor: process.env.NAVHUB_MCP_ACTOR ?? "mcp:http",
  };
}
