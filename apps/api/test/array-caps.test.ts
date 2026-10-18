/**
 * 数组入参必须有上界（P3-18 的收尾：把 #77 只修了两处的同类问题补齐）。
 *
 * 为什么值得修：请求体上限是 4MB，而 `z.array(...)` 不设 `.max()` 时
 * 单个请求可以塞进十几万条元素 —— 对写路径（批量落库、CRDT 合流）就是一次
 * 写放大，对 CPU 路径就是一次廉价 DoS。开放模式（默认）下这些路由无需凭据。
 *
 * 断言刻意包含「刚好到上限仍然成功」的正向用例：只测拒绝会让人分不清
 * 「因为有界被拒」还是「因为压根不工作」。
 *
 * 非空性：去掉任何一个 `.max()`，对应用例的 400 会变成 200/500，本文件失败。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

const base = {
  mode: "lite" as const,
  embedding: {
    model: "Xenova/bge-small-zh-v1.5",
    endpoint: "https://hf-mirror.com",
    dtype: "q8",
    dim: 512,
    enabled: false,
  },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-caps-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "caps.db") }));
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

const repeat = <T,>(n: number, make: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => make(i));

describe("投机规则候选上限（agents.ts）", () => {
  const candidates = (n: number) =>
    repeat(n, (i) => ({ url: `https://s${i}.example/`, confidence: 0.9, predictedArrivalMs: 10 }));

  it("201 条 → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/speculation/rules",
      payload: { candidates: candidates(201) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("200 条 → 200（上限内不受影响）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/speculation/rules",
      payload: { candidates: candidates(200) },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("类目别名字段上限（categories.ts）", () => {
  it("altLabels 51 条 → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/categories",
      payload: { title: "cap-cat", altLabels: repeat(51, (i) => `l${i}`) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("altLabels 50 条 → 201（上限内不受影响）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/categories",
      payload: { title: "cap-cat-ok", altLabels: repeat(50, (i) => `l${i}`) },
    });
    expect(res.statusCode).toBe(201);
  });

  it("relatedCategories 51 条 → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/categories",
      payload: { title: "cap-cat-rel", relatedCategories: repeat(51, (i) => `c${i}`) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("标签上限（enrich.ts / 站点批量导入）", () => {
  it("/api/sites/auto 51 个标签 → 400（校验先于抓取）", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sites/auto",
      payload: { url: "https://cap-auto.example/", tags: repeat(51, (i) => `t${i}`) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("/api/sites/batch 单个站点 51 个标签 → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sites/batch",
      payload: { sites: [{ url: "https://cap-batch.example/", tags: repeat(51, (i) => `t${i}`) }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("CRDT 操作数与站点关系数上限", () => {
  it("crdt/sync 201 个操作 → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/crdt/sync?userId=cap-user",
      payload: {
        operations: repeat(201, (i) => ({
          id: `op-${i}`,
          type: "SET_CATEGORY_PIN",
          entityId: "c1",
          payload: {},
          timestamp: 1,
          clientId: "c",
        })),
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("站点关系 201 条 → 400（站点存在，拒绝来自数量上限）", async () => {
    const cat = await ctx.repo.createCategory({ title: "CapRel", source: "api" });
    const site = await ctx.repo.createSite({
      url: "https://cap-rel.example/",
      title: "CapRel",
      categoryId: cat.id,
    });
    const res = await app.inject({
      method: "PUT",
      url: `/api/sites/${site.id}/relations`,
      payload: {
        relations: repeat(201, (i) => ({
          targetTitle: `t${i}`,
          targetUrl: `https://t${i}.example/`,
          relationType: "alternative",
        })),
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
