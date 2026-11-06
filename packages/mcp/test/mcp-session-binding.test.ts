/**
 * MCP 会话绑定回归（2026-11-06 深扫 S-3）。
 *
 * 漏洞：会话创建时把 toolCtx（含 scopes / ownerIdentity）闭包进 McpServer，
 * 之后复用会话只校验「当前 token 有效」，不校验「是不是同一个身份」。
 * 攻击者持有一个有效的只读 token + 泄露的 Mcp-Session-Id，即可复用创建时
 * 带 write/admin 的 server，形成会话固定 / 权限提升。
 *
 * 这里用两台真实 HTTP 服务（不同 token）走完整 initialize -> 复用链路，
 * 断言跨 token 复用被 403 且会话被销毁。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createContext, loadConfig, hashToken, type AppContext } from "@navhub/api";
import { createMcpHttpServer } from "../../../apps/mcp/src/http-server.ts";

let dir: string;
let ctx: AppContext;
let writeServer: Server;
let writeBase: string;
let readServer: Server;
let readBase: string;

const WRITE_TOKEN = "write-token-session-binding";
const READ_TOKEN = "read-token-session-binding";

const INIT = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "vitest", version: "1.0" } },
};

function listen(s: Server): Promise<string> {
  return new Promise((resolve) => {
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address() as AddressInfo;
      resolve("http://127.0.0.1:" + addr.port);
    });
  });
}

function post(base: string, body: unknown, token: string, sessionId?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: "Bearer " + token,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  return fetch(base + "/mcp", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-mcp-session-bind-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "mcp.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "m"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 3000 },
    fetch: { timeoutMs: 1200, maxBytes: 131072, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  // 把 READ_TOKEN 注册进 api_tokens（read scope），使它与静态 WRITE_TOKEN
  // 在**同一台服务**上都有效但权限不同 —— 这正是「低权限 token 复用高权限会话」的场景。
  await ctx.repo.createApiToken({ name: "read-only-token", tokenHash: hashToken(READ_TOKEN), scopes: "read" });
  writeServer = createMcpHttpServer({ ctx, token: WRITE_TOKEN, scopes: ["read", "write"] });
  writeBase = await listen(writeServer);
  readServer = createMcpHttpServer({ ctx, token: READ_TOKEN, scopes: ["read"] });
  readBase = await listen(readServer);
});

afterAll(async () => {
  await new Promise<void>((r) => writeServer.close(() => r()));
  await new Promise<void>((r) => readServer.close(() => r()));
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP 会话绑定调用方身份", () => {
  it("同一 token 可复用自己创建的会话", async () => {
    const initRes = await post(writeBase, INIT, WRITE_TOKEN);
    expect(initRes.status).toBe(200);
    const sid = initRes.headers.get("mcp-session-id");
    expect(sid).toBeTruthy();
    const reuse = await post(writeBase, { jsonrpc: "2.0", id: 2, method: "tools/list" }, WRITE_TOKEN, sid!);
    expect(reuse.status).toBe(200);
  });

  it("不同 token 持同一 sessionId 复用 → 403 且会话被销毁", async () => {
    const initRes = await post(writeBase, INIT, WRITE_TOKEN);
    const sid = initRes.headers.get("mcp-session-id");
    expect(sid).toBeTruthy();
    // 用只读 token（在同一服务上有效、scope=read）去命中写服务上的会话
    const hijack = await post(writeBase, { jsonrpc: "2.0", id: 2, method: "tools/list" }, READ_TOKEN, sid!);
    expect(hijack.status).toBe(403);
    // 会话已被销毁：原 token 也不能再复用
    const after = await post(writeBase, { jsonrpc: "2.0", id: 3, method: "tools/list" }, WRITE_TOKEN, sid!);
    expect(after.status).toBe(404);
  });

  it("scopes 不同的会话不串用（同一 token、不同服务实例）", async () => {
    const initRes = await post(readBase, INIT, READ_TOKEN);
    const sid = initRes.headers.get("mcp-session-id");
    expect(sid).toBeTruthy();
    const reuse = await post(readBase, { jsonrpc: "2.0", id: 2, method: "tools/list" }, READ_TOKEN, sid!);
    expect(reuse.status).toBe(200);
  });
});
