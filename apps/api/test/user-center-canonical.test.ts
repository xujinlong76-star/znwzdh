import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";
import { signIdentity } from "../src/identity-signature.ts";

/**
 * 用户中心第三批：canonical 身份解析 + 收藏列表分页/检索。
 *
 * 背景（N2）：身份合并后，旧 id 仍是一枚**合法且已签名**的身份——扩展、MCP、
 * 没刷新的旧标签页都会继续用它发请求。如果只有 `/api/me*` 解析别名，这些读写就会
 * 落在旧 id 上：读是空的、写是孤儿行，而用户以为"数据合并后丢了"。
 *
 * 这里锁的就是「五个用户域路由都解析别名」这一条语义，以及分页参数的边界。
 */
const SECRET = "test-secret-please-rotate";
const ANON = "anon-77777777-7777-7777-7777-777777777777";
const USER = "github:u-canonical";

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
let siteA = "";
let siteB = "";

const headersFor = (identity: string) => ({
  "x-navhub-user-id": identity,
  "x-navhub-identity-signature": signIdentity(SECRET, identity),
});
const asAnon = () => headersFor(ANON);
const asUser = () => headersFor(USER);

function call(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  headers: Record<string, string> = asUser(),
) {
  return app.inject({ method, url, headers, payload: payload as never });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-canonical-"));
  ctx = await createContext(
    loadConfig({ ...base, sqlitePath: join(dir, "canonical.db"), identitySecret: SECRET }),
  );
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "身份解析" });
  siteA = (await ctx.repo.createSite({ url: "https://canon-a.example.com", title: "Alpha 站", categoryId: cat.id })).id;
  siteB = (await ctx.repo.createSite({ url: "https://canon-b.example.com", title: "Beta 站", categoryId: cat.id })).id;
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("canonical 身份解析（N2）", () => {
  it("合并后旧 id 读取到的是新身份的数据", async () => {
    // 匿名身份先收藏一条，再合并到登录身份
    const add = await call("POST", "/api/favorites", { siteId: siteA, note: "匿名时收的" }, asAnon());
    expect(add.statusCode).toBe(201);

    const merged = await ctx.repo.mergeIdentity(ANON, USER);
    expect(merged.favoritesMoved).toBe(1);

    // 旧 id 继续发请求（模拟未刷新的旧标签页 / 扩展）
    const legacy = await call("GET", "/api/favorites", undefined, asAnon());
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().items).toHaveLength(1);
    expect(legacy.json().items[0].note).toBe("匿名时收的");

    // 新身份同样看得到
    const current = await call("GET", "/api/favorites", undefined, asUser());
    expect(current.json().items).toHaveLength(1);
  });

  it("合并后旧 id 的写入落在 canonical 身份上，不产生孤儿行", async () => {
    const res = await call("POST", "/api/favorites", { siteId: siteB }, asAnon());
    expect([200, 201]).toContain(res.statusCode);

    const orphan = await ctx.repo.raw("SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?", [ANON]);
    expect(Number(orphan[0].c)).toBe(0);

    const canonicalRows = await ctx.repo.raw("SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?", [USER]);
    expect(Number(canonicalRows[0].c)).toBe(2);
  });

  it("搜索历史与画像同样按 canonical 读写", async () => {
    await ctx.repo.recordSearch(USER, "canonical 测试", 3);
    const legacyHistory = await call("GET", "/api/search-history?limit=50", undefined, asAnon());
    expect(legacyHistory.statusCode).toBe(200);
    const queries = legacyHistory.json().items.map((item: { query: string }) => item.query);
    expect(queries).toContain("canonical 测试");

    const profile = await call("GET", "/api/profile", undefined, asAnon());
    expect(profile.statusCode).toBe(200);
  });
});

describe("收藏列表分页与检索（N8）", () => {
  it("不带 limit 时保持全量语义（旧客户端不受影响）", async () => {
    const res = await call("GET", "/api/favorites");
    expect(res.json().items).toHaveLength(2);
    expect(res.json().total).toBeUndefined();
  });

  it("带 limit 时返回 total / hasMore，并按 offset 翻页", async () => {
    const first = await call("GET", "/api/favorites?limit=1&offset=0");
    expect(first.json().items).toHaveLength(1);
    expect(first.json().total).toBe(2);
    expect(first.json().hasMore).toBe(true);

    const second = await call("GET", "/api/favorites?limit=1&offset=1");
    expect(second.json().hasMore).toBe(false);
    // 两页的 siteId 必须不同，否则 offset 没生效
    expect(second.json().items[0].siteId).not.toBe(first.json().items[0].siteId);
  });

  it("关键词命中站点标题，并转义 LIKE 通配符", async () => {
    const hit = await call("GET", "/api/favorites?limit=50&q=Alpha");
    expect(hit.json().items).toHaveLength(1);
    expect(hit.json().items[0].siteId).toBe(siteA);

    // `%` 必须当字面量：不转义会变成「匹配任意串」而返回全部
    const wildcard = await call("GET", "/api/favorites?limit=50&q=%25");
    expect(wildcard.json().items).toHaveLength(0);
  });

  it("sort=title 按标题升序", async () => {
    const res = await call("GET", "/api/favorites?limit=50&sort=title");
    const titles = res.json().items.map((item: { site: { title: string } | null }) => item.site?.title);
    expect(titles).toEqual(["Alpha 站", "Beta 站"]);
  });

  it("limit 越界被钳位，不返回 500", async () => {
    const huge = await call("GET", "/api/favorites?limit=99999");
    expect(huge.statusCode).toBe(200);
    const negative = await call("GET", "/api/favorites?limit=-5");
    expect(negative.statusCode).toBe(200);
    expect(negative.json().items.length).toBeGreaterThan(0);
  });
});
