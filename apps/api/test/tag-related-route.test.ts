/**
 * 标签共现相关标签端点（修复标签页浏览死胡同）与 /api/tags limit 修复。
 *
 * 入参接受 slug 或 id（与 /api/tags/resolve 同口径，但只读主表 id/slug），
 * 先 getRawTag 归一成 id 再聚合 site_tags 共现，按 sharedSites 降序返回 top-N。
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
  dir = mkdtempSync(join(tmpdir(), "navhub-tag-related-"));
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

  const cat = await ctx.repo.createCategory({ title: "开发" });
  // A 与 B 共现 3 站、与 C 共现 1 站；另有只挂 A 的站不影响共现
  await ctx.repo.createSite({ url: "https://ar1.test", title: "AR1", categoryId: cat.id, tags: ["A", "B"], status: "active" });
  await ctx.repo.createSite({ url: "https://ar2.test", title: "AR2", categoryId: cat.id, tags: ["A", "B"], status: "active" });
  await ctx.repo.createSite({ url: "https://ar3.test", title: "AR3", categoryId: cat.id, tags: ["A", "B"], status: "active" });
  await ctx.repo.createSite({ url: "https://ar4.test", title: "AR4", categoryId: cat.id, tags: ["A", "C"], status: "active" });
  await ctx.repo.createSite({ url: "https://ar5.test", title: "AR5", categoryId: cat.id, tags: ["A"], status: "active" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/tags/:id/related", () => {
  it("按 slug 命中并共现降序返回", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tags/a/related" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.tagSlug).toBe("a");
    const names = body.related.map((t: { name: string }) => t.name);
    expect(names).toContain("B");
    expect(names).toContain("C");
    const b = body.related.find((t: { name: string }) => t.name === "B");
    const c = body.related.find((t: { name: string }) => t.name === "C");
    expect(b.sharedSites).toBe(3);
    expect(c.sharedSites).toBe(1);
    expect(names.indexOf("B")).toBeLessThan(names.indexOf("C"));
  });

  it("按 id 命中（与 slug 同结果）", async () => {
    const bySlug = await app.inject({ method: "GET", url: "/api/tags/a/related" });
    const tag = (await app.inject({ method: "GET", url: "/api/tags?minCount=1" })).json().find((t: { name: string }) => t.name === "A");
    const byId = await app.inject({ method: "GET", url: `/api/tags/${tag.id}/related` });
    expect(byId.statusCode).toBe(200);
    expect(byId.json().related.map((t: { name: string }) => t.name).sort()).toEqual(
      bySlug.json().related.map((t: { name: string }) => t.name).sort(),
    );
  });

  it("limit 截断", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tags/a/related?limit=1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().related).toHaveLength(1);
  });

  it("未知标签是 404 而不是空结果", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tags/no-such-tag/related" });
    expect(res.statusCode).toBe(404);
  });
});

describe("/api/tags limit 修复", () => {
  it("此前被静默忽略的 limit 现在生效", async () => {
    const full = await app.inject({ method: "GET", url: "/api/tags?minCount=1" });
    const limited = await app.inject({ method: "GET", url: "/api/tags?minCount=1&limit=2" });
    expect(full.json().length).toBeGreaterThan(2);
    expect(limited.json()).toHaveLength(2);
  });
});
