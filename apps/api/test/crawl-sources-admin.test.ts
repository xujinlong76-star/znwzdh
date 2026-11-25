/**
 * 采集来源管理 API（/api/admin/crawl-sources）契约。
 *
 * 这四个端点同时是 hub 网关策略生成的来源（apps/api/src/routes/*.ts 的
 * config.scope 声明）；缺任意一个，管理台经 /api/hub 调用都会被判
 * HUB_ROUTE_UNCLASSIFIED。这里钉住 CRUD + 字段映射 + 去重 + 校验。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-crawl-sources-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { model: "none", endpoint: "", dtype: "q8", dim: 512, cacheDir: join(dir, "models"), enabled: false },
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

function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url, payload });
}

describe("采集来源 CRUD（admin scope，网关策略来源）", () => {
  it("GET 初始为空，POST 创建后按 camelCase 返回并可再次读到", async () => {
    const empty = await call("GET", "/api/admin/crawl-sources");
    expect(empty.statusCode).toBe(200);
    expect(empty.json().items).toEqual([]);

    const created = await call("POST", "/api/admin/crawl-sources", {
      url: "https://example.com/sitemap.xml",
      kind: "sitemap",
      priority: 5,
      intervalMs: 120_000,
    });
    expect(created.statusCode).toBe(200);
    const item = created.json().item as Record<string, unknown>;
    expect(item).toMatchObject({ url: "https://example.com/sitemap.xml", kind: "sitemap", enabled: true, priority: 5, intervalMs: 120_000 });
    expect(typeof item.id).toBe("string");
    expect(typeof item.nextRunAt).toBe("number");

    const listed = await call("GET", "/api/admin/crawl-sources?limit=10");
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    expect((listed.json().items as Array<Record<string, unknown>>)[0]!.id).toBe(item.id);
  });

  it("PATCH 只更新传入字段，DELETE 后不再出现", async () => {
    const listed = await call("GET", "/api/admin/crawl-sources");
    const id = String((listed.json().items as Array<Record<string, unknown>>)[0]!.id);

    const patched = await call("PATCH", `/api/admin/crawl-sources/${id}`, { enabled: false, priority: 9 });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().item).toMatchObject({ id, enabled: false, priority: 9, kind: "sitemap", intervalMs: 120_000 });

    const deleted = await call("DELETE", `/api/admin/crawl-sources/${id}`);
    expect(deleted.statusCode).toBe(200);
    const after = await call("GET", "/api/admin/crawl-sources");
    expect(after.json().items).toEqual([]);
  });

  it("采集运营读面已接线：overview / candidates 走真实迁移表", async () => {
    const overview = await call("GET", "/api/admin/crawl/overview");
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({ ok: true });

    const candidates = await call("GET", "/api/admin/crawl/candidates");
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json()).toMatchObject({ ok: true, items: [] });
  });

  it("重复 URL 报 409，非法 kind/url 报 400，不存在的 ID 报 404", async () => {
    const first = await call("POST", "/api/admin/crawl-sources", { url: "https://dup.example.com/feed" });
    expect(first.statusCode).toBe(200);
    const id = String((first.json().item as Record<string, unknown>).id);

    const dup = await call("POST", "/api/admin/crawl-sources", { url: "https://dup.example.com/feed" });
    expect(dup.statusCode).toBe(409);

    const badKind = await call("POST", "/api/admin/crawl-sources", { url: "https://bad.example.com/", kind: "gopher" });
    expect(badKind.statusCode).toBe(400);
    const badUrl = await call("PATCH", `/api/admin/crawl-sources/${id}`, { url: "not-a-url" });
    expect(badUrl.statusCode).toBe(400);
    const missing = await call("PATCH", "/api/admin/crawl-sources/does-not-exist", { enabled: false });
    expect(missing.statusCode).toBe(404);
  });
});
