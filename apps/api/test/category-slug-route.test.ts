/**
 * P1-5 类目 slug 的读路径（2026-10-22 类目树升级方案 §5.1）。
 *
 * `/category/{slug}` 上线后，slug 是类目的对外标识，中枢必须能只凭 slug 服务：
 * 1. `GET /api/categories/by-slug/:slug` —— 页面取数与管理端跳转都要它；
 * 2. `GET /api/search?categoryId=<slug>` —— 类目页把 URL 上那一段直接透给检索，
 *    含后代展开，省掉「先查列表换 id」的一次往返；
 * 3. SKOS 导出的概念 URI 用 slug —— 交换出去的标识要和人类可访问的页面一致。
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

/** 命中站点 id（排序后比较，检索序不影响结论） */
function hitIds(json: unknown): string[] {
  const hits = (json as { hits?: Array<{ site?: { id?: string } | null }> })?.hits ?? [];
  return hits.map((h) => h.site?.id ?? "").filter(Boolean).sort();
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-cat-slug-"));
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

  const root = await ctx.repo.createCategory({ title: "影音娱乐", titleEn: "Entertainment" });
  const leaf = await ctx.repo.createCategory({ title: "播客与音频", parentId: root.id });
  const elsewhere = await ctx.repo.createCategory({ title: "效率办公", titleEn: "Office Productivity" });
  // 挂在子类目上：证明 slug 过滤真的展开了后代，而不只命中父级直挂站点
  await ctx.repo.createSite({ url: "https://slug-podcast.example.com", title: "Slug 播客站", categoryId: leaf.id });
  await ctx.repo.createSite({ url: "https://slug-outside.example.com", title: "别处站点", categoryId: elsewhere.id });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/categories/by-slug/:slug", () => {
  it("按 slug 命中，大小写不敏感", async () => {
    const hit = await app.inject({ method: "GET", url: "/api/categories/by-slug/entertainment" });
    expect(hit.statusCode).toBe(200);
    expect(hit.json().title).toBe("影音娱乐");

    const upper = await app.inject({ method: "GET", url: "/api/categories/by-slug/Entertainment" });
    expect(upper.statusCode).toBe(200);
    expect(upper.json().id).toBe(hit.json().id);
  });

  it("未知 slug 是 404，而不是被当成 id 兜一圈", async () => {
    const res = await app.inject({ method: "GET", url: "/api/categories/by-slug/no-such-slug" });
    expect(res.statusCode).toBe(404);
  });

  it("uuid 不从 by-slug 口子进来（两个标识各走各的路由）", async () => {
    const cat = await ctx.repo.getCategoryBySlug("entertainment");
    const res = await app.inject({ method: "GET", url: `/api/categories/by-slug/${cat!.id}` });
    expect(res.statusCode).toBe(404);
  });
});

describe("按 slug 过滤检索", () => {
  it("slug 过滤含后代，与 id 过滤同结果", async () => {
    const cat = await ctx.repo.getCategoryBySlug("entertainment");
    const bySlug = await app.inject({ method: "GET", url: "/api/search?q=&status=active&categoryId=entertainment" });
    const byId = await app.inject({
      method: "GET",
      url: `/api/search?q=&status=active&categoryId=${encodeURIComponent(cat!.id)}`,
    });
    expect(bySlug.statusCode).toBe(200);
    // 「别处站点」不能被带进来：过滤条件生效了，而不是静默放行全库
    expect(hitIds(bySlug.json())).toEqual(hitIds(byId.json()));
    expect(hitIds(bySlug.json())).toHaveLength(1);
  });

  it("未知 slug 返回空集，而不是静默不过滤", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=&status=active&categoryId=not-a-category" });
    expect(res.statusCode).toBe(200);
    expect(hitIds(res.json())).toHaveLength(0);
  });
});

describe("SKOS 概念 URI", () => {
  it("uri 用 slug 形态，与 /category/{slug} 一致；id 仍是内部主键", async () => {
    const cat = await ctx.repo.getCategoryBySlug("entertainment");
    const res = await app.inject({ method: "GET", url: "/api/categories/skos" });
    expect(res.statusCode).toBe(200);
    const concept = (res.json() as Array<{ id: string; uri: string; prefLabel: { zh?: string } }>).find(
      (c) => c.prefLabel.zh === "影音娱乐",
    );
    expect(concept?.uri).toMatch(/\/category\/entertainment$/);
    expect(concept?.id).toBe(cat!.id);
  });
});
