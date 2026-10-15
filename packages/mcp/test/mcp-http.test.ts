/**
 * MCP Streamable HTTP 传输测试（标准协议）。
 *
 * 这里刻意用**真实 HTTP 端口**（listen 0 随机端口）+ fetch 走完整链路，
 * 而不是注入 mock：标准传输的价值就在于"真的能被标准客户端连上"，
 * 用假传输测不出 Accept/会话头/JSON-RPC 这些规范细节。
 *
 * 覆盖：
 *  - /health 鉴权前可用，且不泄露能力
 *  - /mcp 无 token 401；有 token 走完 initialize -> tools/list -> tools/call
 *  - 会话头缺失/失效的规范行为（400 / 404）
 *  - scope 收紧时写工具被拒（只读 token 不能建站）
 *  - 兼容端点 GET /tools、POST /tools/<name> 仍可用
 *  - Origin 白名单（DNS rebinding / CSRF 防护）
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createContext, loadConfig, type AppContext } from "@navhub/api";
import { createMcpHttpServer } from "../src/http-server.ts";

let dir: string;
let ctx: AppContext;
let server: Server;
let base: string;
let readonlyServer: Server;
let readonlyBase: string;

const TOKEN = "test-token-123";

/** 创建临时 lite 上下文并灌两条站点（与 mcp.test.ts 同构） */
async function makeCtx(): Promise<AppContext> {
  const d = mkdtempSync(join(tmpdir(), "navhub-mcp-http-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(d, "mcp.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(d, "m"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 3000 },
    fetch: { timeoutMs: 1200, maxBytes: 131072, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest" },
    corsOrigins: ["*"],
  });
  const c = await createContext(config);
  await c.repo.createCategory({ id: "cat-ai", title: "AI 工具" });
  await c.repo.createSite({ url: "https://github.com/features/copilot", title: "GitHub Copilot", description: "AI 代码补全", categoryId: "cat-ai", tags: ["ai"] });
  return c;
}

function listen(s: Server): Promise<string> {
  return new Promise((resolve) => {
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address() as AddressInfo;
      resolve("http://127.0.0.1:" + addr.port);
    });
  });
}

/** 标准 MCP 客户端发一条 JSON-RPC 消息（Accept 必须同时含 json 与 event-stream） */
function mcpPost(body: unknown, opts: { token?: string | null; sessionId?: string; origin?: string } = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (opts.token !== null) headers.Authorization = "Bearer " + (opts.token ?? TOKEN);
  if (opts.sessionId) headers["Mcp-Session-Id"] = opts.sessionId;
  if (opts.origin) headers.Origin = opts.origin;
  return fetch(base + "/mcp", { method: "POST", headers, body: JSON.stringify(body) });
}

const INIT = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "1.0" } },
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-mcp-http-root-"));
  ctx = await makeCtx();
  server = createMcpHttpServer({ ctx, token: TOKEN, scopes: ["read", "write"] });
  base = await listen(server);

  readonlyServer = createMcpHttpServer({ ctx, token: TOKEN, scopes: ["read"] });
  readonlyBase = await listen(readonlyServer);
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => readonlyServer.close(() => r()));
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("存活探针与鉴权", () => {
  it("/health 鉴权前可用且不泄露能力枚举", async () => {
    const res = await fetch(base + "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("/mcp 无 token 返回 401 并带 WWW-Authenticate", async () => {
    const res = await mcpPost(INIT, { token: null });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("错误 token 返回 401", async () => {
    const res = await mcpPost(INIT, { token: "wrong" });
    expect(res.status).toBe(401);
  });
});

describe("标准 MCP Streamable HTTP", () => {
  it("initialize -> tools/list -> tools/call 全链路", async () => {
    const init = await mcpPost(INIT);
    expect(init.status).toBe(200);
    const sessionId = init.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    const initBody = (await init.json()) as any;
    expect(initBody.result.serverInfo.name).toBe("navhub");
    expect(initBody.result.capabilities.tools).toBeTruthy();

    // 客户端随后必须发 notifications/initialized（无 id，202）
    const note = await mcpPost({ jsonrpc: "2.0", method: "notifications/initialized" }, { sessionId: sessionId! });
    expect(note.status).toBe(202);

    const list = await mcpPost({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { sessionId: sessionId! });
    expect(list.status).toBe(200);
    const tools = ((await list.json()) as any).result.tools as Array<{ name: string; inputSchema: unknown }>;
    expect(tools.map((t) => t.name)).toContain("search_sites");
    expect(tools.map((t) => t.name)).toContain("create_site");
    // run_job 是 admin 工具：read,write 的 token 不该看到它
    expect(tools.map((t) => t.name)).not.toContain("run_job");
    // 每个工具都带 JSON Schema 入参描述
    expect(tools.every((t) => t.inputSchema && typeof t.inputSchema === "object")).toBe(true);

    const call = await mcpPost(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_stats", arguments: {} } },
      { sessionId: sessionId! },
    );
    expect(call.status).toBe(200);
    const callBody = (await call.json()) as any;
    expect(callBody.result.isError).toBeFalsy();
    const stats = JSON.parse(callBody.result.content[0].text);
    expect(stats.sites).toBeGreaterThanOrEqual(1);
  });

  it("非 initialize 请求且无会话头 -> 400（JSON-RPC 错误体）", async () => {
    const res = await mcpPost({ jsonrpc: "2.0", id: 9, method: "tools/list" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.code).toBe(-32000);
  });

  it("未知会话头 -> 404", async () => {
    const res = await mcpPost({ jsonrpc: "2.0", id: 10, method: "tools/list" }, { sessionId: "does-not-exist" });
    expect(res.status).toBe(404);
  });

  it("非法 JSON / 非 JSON-RPC 请求体 -> 400", async () => {
    const bad = await fetch(base + "/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + TOKEN },
      body: "{ not json",
    });
    expect(bad.status).toBe(400);

    const notRpc = await mcpPost(123);
    expect(notRpc.status).toBe(400);
  });

  it("GET /mcp 未知会话 -> 404", async () => {
    const res = await fetch(base + "/mcp", {
      headers: { Accept: "text/event-stream", Authorization: "Bearer " + TOKEN },
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /mcp 结束会话后该会话不可再用", async () => {
    const init = await mcpPost(INIT);
    const sessionId = init.headers.get("mcp-session-id")!;
    const del = await fetch(base + "/mcp", {
      method: "DELETE",
      headers: { Accept: "application/json, text/event-stream", Authorization: "Bearer " + TOKEN, "Mcp-Session-Id": sessionId },
    });
    expect([200, 204]).toContain(del.status);
    const after = await mcpPost({ jsonrpc: "2.0", id: 11, method: "tools/list" }, { sessionId });
    expect(after.status).toBe(404);
  });
});

describe("scope 收紧：只读 token 不能写", () => {
  it("tools/list 只暴露只读工具，tools/call 写工具被拒", async () => {
    const init = await fetch(readonlyBase + "/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify(INIT),
    });
    const sessionId = init.headers.get("mcp-session-id")!;

    const list = await fetch(readonlyBase + "/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + TOKEN, "Mcp-Session-Id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const names = ((await list.json()) as any).result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("search_sites");
    expect(names).not.toContain("create_site");

    const call = await fetch(readonlyBase + "/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + TOKEN, "Mcp-Session-Id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_site", arguments: { url: "https://example.com/forbidden" } } }),
    });
    const body = (await call.json()) as any;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/权限/);
  });
});

describe("Origin 白名单（DNS rebinding / CSRF 防护）", () => {
  it("非白名单 Origin 的跨站请求被拒（默认空白名单）", async () => {
    const res = await mcpPost(INIT, { origin: "https://evil.example" });
    expect(res.status).toBe(401);
  });

  it("白名单内的 Origin 被放行", async () => {
    const s = createMcpHttpServer({ ctx, token: TOKEN, scopes: ["read", "write"], allowedOrigins: ["https://ok.example"] });
    const b = await listen(s);
    try {
      const res = await fetch(b + "/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + TOKEN, Origin: "https://ok.example" },
        body: JSON.stringify(INIT),
      });
      expect(res.status).toBe(200);
      // 不在白名单的 Origin 仍然被拒
      const bad = await fetch(b + "/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer " + TOKEN, Origin: "https://evil.example" },
        body: JSON.stringify(INIT),
      });
      expect(bad.status).toBe(401);
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});

describe("兼容端点（旧脚本）", () => {
  it("GET /tools 返回按 scope 过滤的工具清单", async () => {
    const res = await fetch(base + "/tools", { headers: { Authorization: "Bearer " + TOKEN } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.tools.map((t: { name: string }) => t.name)).toContain("search_sites");
  });

  it("POST /tools/<name> 调用单个工具", async () => {
    const res = await fetch(base + "/tools/get_stats", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.content[0].type).toBe("text");
  });

  it("无 token 的兼容端点同样 401", async () => {
    const res = await fetch(base + "/tools");
    expect(res.status).toBe(401);
  });
});
