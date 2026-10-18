/**
 * 前端错误闭环（P2-5）：
 *   1. `client-errors.ts` 的聚合语义（去重 / 计数 / 容量 / 汇总）；
 *   2. `POST /api/errors` 的入站契约（白名单 kind、指纹格式、pathname 不带 query）；
 *   3. 聚合视图居然真的能在看板查到「人为制造的 ChunkLoadError」。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ClientErrorStore,
  clientErrorKey,
  summarizeClientErrors,
  type ClientErrorEntry,
} from "../src/client-errors.ts";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-client-errors-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("ClientErrorStore 聚合", () => {
  it("同键累计 count 并刷新 lastSeen，不同 kind / 指纹 / 路径各自成条", () => {
    const store = new ClientErrorStore();
    store.record({ kind: "chunk", fingerprint: "aaaaaaaaaaaa", path: "/hot", now: 1000 });
    store.record({ kind: "chunk", fingerprint: "aaaaaaaaaaaa", path: "/hot", now: 2000 });
    store.record({ kind: "network", fingerprint: "aaaaaaaaaaaa", path: "/hot", now: 3000 });

    const list = store.list();
    expect(list).toHaveLength(2);
    const chunk = list.find((e) => e.kind === "chunk")!;
    expect(chunk.count).toBe(2);
    expect(chunk.firstSeen).toBe(1000);
    expect(chunk.lastSeen).toBe(2000);
  });

  it("clientErrorKey 把 digest 与 path 纳入区分（同消息不同路由不算同一错误）", () => {
    expect(clientErrorKey({ kind: "chunk", fingerprint: "a", path: "/hot", digest: "d1" })).not.toBe(
      clientErrorKey({ kind: "chunk", fingerprint: "a", path: "/hot", digest: "d2" }),
    );
    expect(clientErrorKey({ kind: "chunk", fingerprint: "a", path: "/hot" })).not.toBe(
      clientErrorKey({ kind: "chunk", fingerprint: "a", path: "/tags" }),
    );
  });

  it("超出容量时淘汰 lastSeen 最旧的条目", () => {
    const store = new ClientErrorStore(2);
    store.record({ kind: "runtime", fingerprint: "1", now: 1 });
    store.record({ kind: "runtime", fingerprint: "2", now: 2 });
    store.record({ kind: "runtime", fingerprint: "3", now: 3 });
    const fps = store.list().map((e) => e.fingerprint).sort();
    expect(fps).toEqual(["2", "3"]);
  });

  it("summarizeClientErrors 按 kind 计数、总数含重复、recent 按 lastSeen 倒序", () => {
    const entries: ClientErrorEntry[] = [
      { kind: "chunk", fingerprint: "a", path: "/", digest: null, count: 3, firstSeen: 1, lastSeen: 10 },
      { kind: "network", fingerprint: "b", path: "/hot", digest: null, count: 2, firstSeen: 2, lastSeen: 20 },
    ];
    const s = summarizeClientErrors(entries, 10);
    expect(s.total).toBe(5);
    expect(s.byKind.chunk).toBe(3);
    expect(s.byKind.network).toBe(2);
    expect(s.byKind.hydration).toBe(0);
    expect(s.recent.map((e) => e.fingerprint)).toEqual(["b", "a"]);
  });
});

describe("POST /api/errors", () => {
  it("合法上报返回 204，events 表落一条 client_error（含指纹，不含原文）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/errors",
      payload: { kind: "chunk", fingerprint: "0a1b2c3d4e5f", path: "/hot", digest: "digest-1" },
    });
    expect(res.statusCode).toBe(204);

    const rows = await ctx.repo.raw("SELECT kind, meta FROM events WHERE kind = ?", ["client_error"]);
    expect(rows.length).toBe(1);
    const meta = JSON.parse(String(rows[0].meta));
    expect(meta).toMatchObject({ kind: "chunk", fingerprint: "0a1b2c3d4e5f", path: "/hot", digest: "digest-1", count: 1 });
  });

  it("非白名单 kind / 坏指纹 / 带 query 的 path 一律 400", async () => {
    for (const bad of [
      { kind: "unknown", fingerprint: "0a1b2c3d4e5f" },
      { kind: "chunk", fingerprint: "xyz" },
      { kind: "chunk", fingerprint: "0a1b2c3d4e5f", path: "/hot?query=leak" },
    ]) {
      const res = await app.inject({ method: "POST", url: "/api/errors", payload: bad });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe("看板闭环：人为制造的 ChunkLoadError 能被看见", () => {
  it("上报 3 次同源错误后，聚合视图给出 count=3 与按 kind 的计数", async () => {
    const fp = "deadbeef1234";
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/errors",
        payload: { kind: "chunk", fingerprint: fp, path: "/hot", digest: "digest-x" },
      });
      expect(res.statusCode).toBe(204);
    }
    // 注意：看板是进程内聚合，与 events 表各自独立；这里经 app.inject 直接路由
    const res = await app.inject({ method: "GET", url: "/api/admin/client-errors" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; byKind: Record<string, number>; recent: Array<{ fingerprint: string; count: number }> };
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.byKind.chunk).toBeGreaterThanOrEqual(3);
    const hit = body.recent.find((e) => e.fingerprint === fp);
    expect(hit?.count).toBeGreaterThanOrEqual(3);
  });
});
