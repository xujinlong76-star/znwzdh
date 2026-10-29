/**
 * 停用影响预览（`GET /api/categories/:id/impact`）。
 *
 * 管理端停用类目前的确认框要如实报出「几个子类、几个站点会从导航消失、
 * 会不会多一个 404」。这些数字必须由中枢按**与前台相同的口径**算：
 * - 子树按物化路径 anchor 聚合，不是只数直接子级；
 * - 站点数只算单主指针的存活站点（active + enabled + 未进回收站），
 *   与 `/api/categories/counts` / 类目页达标判定同源。
 *
 * 这里用一棵根-子-孙的小树把口径钉死，含两个反面样本：
 * broken 站点与 enabled=false 的站点都不许进数字。
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
let root: { id: string; anchor: string };
let childA: { id: string };
let childB: { id: string };
let grandchild: { id: string };

async function impact(id: string) {
  const res = await app.inject({ method: "GET", url: `/api/categories/${id}/impact` });
  return { status: res.statusCode, body: res.json() as Record<string, any> };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-cat-impact-"));
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

  root = await ctx.repo.createCategory({ title: "影响面根类", titleEn: "Impact Root" });
  childA = await ctx.repo.createCategory({ title: "子类甲", parentId: root.id });
  grandchild = await ctx.repo.createCategory({ title: "孙类甲一", parentId: childA.id });
  childB = await ctx.repo.createCategory({ title: "子类乙", parentId: root.id });

  // 根自身直挂 1 个（仓储对根挂站点保持宽松），甲 2 个，孙 1 个，乙 3 个
  for (let i = 0; i < 1; i += 1) {
    await ctx.repo.createSite({ url: `https://impact-root-${i}.example.com`, title: `根直挂 ${i}`, categoryId: root.id });
  }
  for (let i = 0; i < 2; i += 1) {
    await ctx.repo.createSite({ url: `https://impact-a-${i}.example.com`, title: `甲站 ${i}`, categoryId: childA.id });
  }
  await ctx.repo.createSite({ url: "https://impact-grand.example.com", title: "孙站", categoryId: grandchild.id });
  for (let i = 0; i < 3; i += 1) {
    await ctx.repo.createSite({ url: `https://impact-b-${i}.example.com`, title: `乙站 ${i}`, categoryId: childB.id });
  }
  // 反面样本：坏链与停用站点都不算「会从导航消失」的存活站点
  await ctx.repo.createSite({
    url: "https://impact-broken.example.com",
    title: "坏链站",
    categoryId: childA.id,
    status: "broken",
  });
  await ctx.repo.createSite({
    url: "https://impact-disabled.example.com",
    title: "停用站",
    categoryId: childA.id,
    enabled: false,
  });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/categories/:id/impact", () => {
  it("根：子树聚合含孙辈，站点数按存活口径", async () => {
    const res = await impact(root.id);
    expect(res.status).toBe(200);
    expect(res.body.category).toMatchObject({
      id: root.id,
      title: "影响面根类",
      slug: "impact-root",
      enabled: true,
      parentId: null,
      anchor: root.anchor,
    });
    expect(res.body.childCategories).toBe(2);
    expect(res.body.descendantCategories).toBe(3);
    expect(res.body.directSites).toBe(1);
    // 1（根）+ 2（甲）+ 1（孙）+ 3（乙）；坏链与停用站不计
    expect(res.body.subtreeSites).toBe(7);
  });

  it("中间层：直接站点与子树站点分开报", async () => {
    const res = await impact(childA.id);
    expect(res.status).toBe(200);
    expect(res.body.childCategories).toBe(1);
    expect(res.body.descendantCategories).toBe(1);
    expect(res.body.directSites).toBe(2);
    expect(res.body.subtreeSites).toBe(3);
  });

  it("叶子：只有自己", async () => {
    const res = await impact(grandchild.id);
    expect(res.status).toBe(200);
    expect(res.body.childCategories).toBe(0);
    expect(res.body.descendantCategories).toBe(0);
    expect(res.body.directSites).toBe(1);
    expect(res.body.subtreeSites).toBe(1);
  });

  it("不存在的类目是 404，而不是一份全零报告", async () => {
    const res = await impact("no-such-category");
    expect(res.status).toBe(404);
  });
});
