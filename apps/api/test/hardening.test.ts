/**
 * 参数校验 / 边界条件加固回归。
 *
 * 覆盖三类"静默穿透到 SQL"的老问题：
 *  1. 校验失败返回 200 + error 体（客户端 `res.ok` 判定为成功 → 崩在 `.hits.map`）；
 *  2. `Math.min(Number(x) || d, max)` 漏掉负数与 NaN → SQLite `LIMIT -1` 表示"不限制"；
 *  3. 缺少身份标识的写操作返回 200，与同族 POST 分支的 400 不一致。
 *
 * 另有两条容量/作用域回归（画像节流表上限；审计与健康趋势的 scope 见 auth.test.ts）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { parseIntParam, parsePagination } from "../src/routes/shared.ts";
import {
  THROTTLE_MAX_ENTRIES,
  profileThrottleSize,
  refreshUserProfile,
  resetProfileThrottle,
} from "../src/profile-service.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;
let seedSiteId: string;

/** 造 >100 个站点：负 limit 若穿透，hotSites 会把全部站点吐出来（而非钳位上限 100） */
const SEED_COUNT = 120;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-hardening-"));
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

  await ctx.repo.createCategory({ id: "cat-ai", title: "AI 工具" });
  for (let i = 0; i < SEED_COUNT; i++) {
    const created = await ctx.repo.createSite({
      url: `https://hardening-${i}.example.com`,
      title: `加固站点 ${i}`,
      description: `第 ${i} 个用于分页钳位回归的站点`,
      categoryId: "cat-ai",
      tags: ["hardening"],
    });
    if (i === 0) seedSiteId = created.id;
  }
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("检索参数校验：非法参数必须 4xx", () => {
  it("GET /api/search?limit=9999 → 400（此前 200 + error 体，前端会当结果解析）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?limit=9999" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("参数无效");
  });

  it("POST /api/search {limit:0} → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/search", payload: { q: "ai", limit: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("参数无效");
  });
});

describe("分页参数钳位：负数 / NaN / 小数不得穿透", () => {
  it("parsePagination 统一钳位", () => {
    expect(parsePagination({ limit: "-5" }).limit).toBe(50);
    expect(parsePagination({ limit: -1 }).limit).toBe(50);
    expect(parsePagination({ limit: "abc" }).limit).toBe(50);
    expect(parsePagination({ limit: "2.7" }).limit).toBe(2);
    expect(parsePagination({ limit: 9999 }).limit).toBe(200);
    expect(parsePagination({ limit: 10, offset: "-3" }).offset).toBe(0);
  });

  it("parseIntParam 同一套语义（供 maxNeighbors 这类单值参数复用）", () => {
    expect(parseIntParam("-5", 15, 1, 50)).toBe(1);
    expect(parseIntParam("abc", 15, 1, 50)).toBe(15);
    expect(parseIntParam("999", 15, 1, 50)).toBe(50);
    expect(parseIntParam(undefined, 15, 1, 50)).toBe(15);
  });

  it("GET /api/rank/trending?limit=-1 受上限约束（SQLite LIMIT -1 = 不限制）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/rank/trending?limit=-1" });
    expect(res.statusCode).toBe(200);
    const hits = res.json().hits as unknown[];
    expect(hits.length).toBeLessThanOrEqual(100);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("GET /api/sites/:id/graph?maxNeighbors=abc 不再把 NaN 绑进 SQL", async () => {
    const res = await app.inject({ method: "GET", url: `/api/sites/${seedSiteId}/graph?maxNeighbors=abc` });
    expect(res.statusCode).toBe(200);
  });
});

describe("缺少身份标识：与同族分支一致返回 400", () => {
  it("DELETE /api/search-history 无身份 → 400", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/search-history" })).statusCode).toBe(400);
  });

  it("GET /api/profile 无身份 → 400", async () => {
    expect((await app.inject({ method: "GET", url: "/api/profile" })).statusCode).toBe(400);
  });

  it("DELETE /api/profile 无身份 → 400", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/profile" })).statusCode).toBe(400);
  });

  it("GET /api/favorites 无身份 → 400", async () => {
    expect((await app.inject({ method: "GET", url: "/api/favorites" })).statusCode).toBe(400);
  });
});

describe("画像节流表容量上限", () => {
  it("身份数超过上限后按 TTL/插入序淘汰，容量不超上限", async () => {
    resetProfileThrottle();
    const stub = {
      repo: {
        behaviorEvents: async () => [],
        listFavorites: async () => [],
        countSearches: async () => 0,
        saveUserProfile: async () => undefined,
      },
    } as unknown as AppContext;

    for (let i = 0; i < THROTTLE_MAX_ENTRIES + 3; i++) {
      await refreshUserProfile(stub, "u-" + i);
    }
    expect(profileThrottleSize()).toBeLessThanOrEqual(THROTTLE_MAX_ENTRIES);
  });
});
