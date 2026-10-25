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
import {
  FACET_MAX_KEYS,
  FACET_MAX_KEY_LENGTH,
  FACET_MAX_VALUES_PER_KEY,
  FACET_MAX_VALUE_LENGTH,
} from "../src/routes/shared.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let freeSiteId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-facet-budget-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "api.db"),
    auth: { enabled: false },
    embedding: { enabled: false },
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);

  const cat = await ctx.repo.createCategory({ title: "预算测试分类" });
  const freeSite = await ctx.repo.createSite({
    url: "https://facet-budget-a.example.com",
    title: "免费站点",
    categoryId: cat.id,
    facets: { pricing: ["free"] },
  });
  freeSiteId = freeSite.id;
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

describe("facets 预算三处统一（存储写入 / 列表过滤 / 检索过滤）", () => {
  it("17 个键：/api/sites 与 /api/search 同一份预算，都必须放行", async () => {
    // 17 = 旧 /api/search 上限（16）之上、新统一上限（20）之内的第一个值
    const seventeen: Record<string, string[]> = {};
    for (let i = 0; i < 17; i++) seventeen[`k${i}`] = ["v"];
    const encoded = encodeURIComponent(JSON.stringify(seventeen));

    const list = await app.inject({ method: "GET", url: `/api/sites?facets=${encoded}` });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(0);

    // 检索侧对「过滤后零结果」有放宽兜底（fallback:"filter"）：这里断言的是
    // 条件被当成过滤器接受了（修复前是 400），而不是要求它返回零条。
    const search = await app.inject({ method: "GET", url: `/api/search?q=%E7%AB%99%E7%82%B9&facets=${encoded}` });
    expect(search.statusCode).toBe(200);
    expect(search.json().fallback).toBe("filter");
  });

  it("GET /api/search 的 JSON 字符串 facets 真的参与过滤（修复前被 zod 直接 400）", async () => {
    const free = await app.inject({
      method: "GET",
      url: `/api/search?q=%E7%AB%99%E7%82%B9&facets=${encodeURIComponent(JSON.stringify({ pricing: ["free"] }))}`,
    });
    expect(free.statusCode).toBe(200);
    expect(free.json().hits.map((h: { site: { title: string } }) => h.site.title)).toEqual(["免费站点"]);

    const paid = await app.inject({
      method: "GET",
      url: `/api/search?q=%E7%AB%99%E7%82%B9&facets=${encodeURIComponent(JSON.stringify({ pricing: ["paid"] }))}`,
    });
    expect(paid.json().hits.map((h: { site: { title: string } }) => h.site.title)).toEqual(["付费站点"]);
  });

  it("取值全为空串：两个端点都 400，不再静默返回未过滤结果", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/sites?facets=${encodeURIComponent(JSON.stringify({ pricing: [""] }))}`,
    });
    expect(list.statusCode).toBe(400);
    expect(String(list.json().detail)).toContain("pricing");

    const search = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { q: "站点", facets: { pricing: ["  "] } },
    });
    expect(search.statusCode).toBe(400);
  });

  it("键名 / 取值长度边界：50 与 100 放行，51 与 101 回 400", async () => {
    const longKey = "k".repeat(FACET_MAX_KEY_LENGTH);
    const longValue = "v".repeat(FACET_MAX_VALUE_LENGTH);
    const ok = await app.inject({
      method: "GET",
      url: `/api/sites?facets=${encodeURIComponent(JSON.stringify({ [longKey]: [longValue] }))}`,
    });
    expect(ok.statusCode).toBe(200);

    for (const bad of [
      { ["k".repeat(FACET_MAX_KEY_LENGTH + 1)]: ["v"] },
      { pricing: ["v".repeat(FACET_MAX_VALUE_LENGTH + 1)] },
    ]) {
      const res = await app.inject({
        method: "GET",
        url: `/api/sites?facets=${encodeURIComponent(JSON.stringify(bad))}`,
      });
      expect(res.statusCode, JSON.stringify(bad).slice(0, 60)).toBe(400);
    }
  });

  it("写入口 PUT /api/sites/:id/facets 与查询同源：20 维放行，21 维 400，201 值 400", async () => {
    const twenty: Record<string, string[]> = {};
    for (let i = 0; i < FACET_MAX_KEYS; i++) twenty[`d${i}`] = ["v"];
    const ok = await app.inject({
      method: "PUT",
      url: `/api/sites/${freeSiteId}/facets`,
      payload: { facets: twenty },
    });
    expect(ok.statusCode).toBe(200);

    const tooManyDims = { ...twenty, extra: ["v"] };
    const dims = await app.inject({
      method: "PUT",
      url: `/api/sites/${freeSiteId}/facets`,
      payload: { facets: tooManyDims },
    });
    expect(dims.statusCode).toBe(400);

    // 修复前写入侧单键最多 50 个值，比查询侧允许的还小 —— 写进去的词表
    // 查询端能收，但用户根本无法通过 PUT 维护超过 50 个取值的维度。
    const tooManyValues = {
      pricing: Array.from({ length: FACET_MAX_VALUES_PER_KEY + 1 }, (_, i) => `v${i}`),
    };
    const values = await app.inject({
      method: "PUT",
      url: `/api/sites/${freeSiteId}/facets`,
      payload: { facets: tooManyValues },
    });
    expect(values.statusCode).toBe(400);

    const atLimit = await app.inject({
      method: "PUT",
      url: `/api/sites/${freeSiteId}/facets`,
      payload: {
        facets: { pricing: Array.from({ length: FACET_MAX_VALUES_PER_KEY }, (_, i) => `v${i}`) },
      },
    });
    expect(atLimit.statusCode).toBe(200);
  });
});
