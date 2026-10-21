/**
 * `facets` 入参预算（clampFacets）——路由侧的 400 / 200 边界。
 *
 * 修复前的两个真实缺陷：
 *  1. `GET /api/sites?facets=<非法 JSON>`：解析失败被 `catch {}` 静默吞掉，
 *     过滤条件整个消失 → 客户端以为在按分面筛选，**实际拿到未过滤的全量列表**
 *     （返回 200 + 错数据，比 400 更糟）。
 *  2. `POST/GET /api/search` 的 facets 走 `z.string().transform(...)`，
 *     JSON 字符串分支完全绕过数组的 `.max(200)`：键数与每键值数由客户端任意决定，
 *     直接放大成绑定参数与往返次数的爆炸（见 sql-in-budget.test.ts 的另一半）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { FACET_MAX_KEYS, FACET_MAX_VALUES_PER_KEY } from "../src/routes/shared.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-facet-budget-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);

  const cat = await ctx.repo.createCategory({ title: "预算测试分类" });
  await ctx.repo.createSite({
    url: "https://facet-budget-a.example.com",
    title: "免费站点",
    categoryId: cat.id,
    facets: { pricing: ["free"] },
  });
  await ctx.repo.createSite({
    url: "https://facet-budget-b.example.com",
    title: "付费站点",
    categoryId: cat.id,
    facets: { pricing: ["paid"] },
  });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("facets 入参预算", () => {
  it("非法 JSON 回 400，而不是静默返回未过滤全量", async () => {
    const res = await app.inject({ method: "GET", url: `/api/sites?facets=${encodeURIComponent('{pricing:')}` });
    expect(res.statusCode).toBe(400);
    expect(String(res.json().detail)).toContain("facets");
    // 对照：同一非法输入在修复前是 200 + 两条站点（free 与 paid 都回来）
    const all = await app.inject({ method: "GET", url: "/api/sites" });
    expect(all.json().length).toBe(2);
  });

  it("键数超预算回 400", async () => {
    const tooMany: Record<string, string[]> = {};
    for (let i = 0; i <= FACET_MAX_KEYS; i++) tooMany[`k${i}`] = ["v"];
    const res = await app.inject({
      method: "GET",
      url: `/api/sites?facets=${encodeURIComponent(JSON.stringify(tooMany))}`,
    });
    expect(res.statusCode).toBe(400);
    expect(String(res.json().detail)).toContain(String(FACET_MAX_KEYS));
  });

  it("单键值数超预算回 400（GET 的 JSON 字符串分支同样受限）", async () => {
    const values = Array.from({ length: FACET_MAX_VALUES_PER_KEY + 1 }, (_, i) => `v${i}`);
    const asQuery = await app.inject({
      method: "GET",
      url: `/api/sites?facets=${encodeURIComponent(JSON.stringify({ pricing: values }))}`,
    });
    expect(asQuery.statusCode).toBe(400);

    const asBody = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { q: "", facets: { pricing: values } },
    });
    expect(asBody.statusCode).toBe(400);
  });

  it("检索侧的非法 facets 同样回 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { q: "", facets: "{pricing:['free']}" }, // 单引号不是合法 JSON
    });
    expect(res.statusCode).toBe(400);
  });

  it("预算内正常过滤，并且值做 trim + 小写归一", async () => {
    const exact = await app.inject({
      method: "GET",
      url: `/api/sites?facets=${encodeURIComponent(JSON.stringify({ pricing: ["free"] }))}`,
    });
    expect(exact.statusCode).toBe(200);
    expect(exact.json().map((s: { title: string }) => s.title)).toEqual(["免费站点"]);

    const messy = await app.inject({
      method: "GET",
      url: `/api/sites?facets=${encodeURIComponent(JSON.stringify({ " Pricing ": [" FREE "] }))}`,
    });
    expect(messy.json().map((s: { title: string }) => s.title)).toEqual(["免费站点"]);
  });

  it("非纯量值（对象/数组/null）回 400，而不是拼成 'null'/'[object Object]' 或静默丢条件", async () => {
    for (const bad of [null, { a: 1 }, ["free"], true]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/sites?facets=${encodeURIComponent(JSON.stringify({ pricing: [bad] }))}`,
      });
      expect(res.statusCode, `facets.pricing=[${JSON.stringify(bad)}] 必须回 400`).toBe(400);
    }
    // 对照：条件确实存在时只回一条站点
    const ok = await app.inject({
      method: "GET",
      url: `/api/sites?facets=${encodeURIComponent(JSON.stringify({ pricing: ["free"] }))}`,
    });
    expect(ok.json().length).toBe(1);
  });
});
