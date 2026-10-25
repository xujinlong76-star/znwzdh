/**
 * 搜索响应的缓存隔离：`private, max-age` 只挡住共享代理，浏览器私有缓存按 URL 复用，
 * 而身份可以只走 Header（不改 URL）⇒ 必须用 `Vary` 把身份字段纳入缓存键，
 * 否则同一台机器上的甲/乙（或同一人登录前后）在 20 秒窗口内直接复用彼此的个性化结果。
 *
 * 钉四件事：
 *  ① /api/search 的 GET 响应声明了四个身份相关字段（RFC 9110 §12.5.5 的缓存键约束）；
 *  ② 累加而不覆盖：CORS 已写的 `Vary: Origin` 必须还在（http-compression.ts:105-109 同款约束）；
 *  ③ HEAD 与 GET 同口径（exposeHeadRoutes，server.ts:127）；
 *  ④ 没声明 vary 的其它缓存路由不被顺手加上（防止把全局行为改掉）。
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
  embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", dim: 512, enabled: false },
  llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
  fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
  corsOrigins: ["*"],
};

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const varyOf = (headers: Record<string, unknown>): string[] =>
  String(headers["vary"] ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-search-vary-"));
  ctx = await createContext(loadConfig({ ...base, sqlitePath: join(dir, "vary.db") }));
  app = await buildServer(ctx);
  await app.ready();
  const cat = await ctx.repo.createCategory({ title: "缓存隔离测试" });
  await ctx.repo.createSite({ url: "https://vary-a.example.com", title: "缓存隔离站点", categoryId: cat.id });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("/api/search 的缓存键声明", () => {
  it("① GET 响应把四个身份相关字段纳入 Vary，且仍是 private", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("缓存隔离站点") });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["cache-control"])).toContain("private");
    const vary = varyOf(res.headers);
    for (const field of ["x-navhub-anon-id", "x-navhub-user-id", "authorization", "cookie"]) {
      expect(vary, `Vary 缺少 ${field}（实测 ${JSON.stringify(vary)}）`).toContain(field);
    }
  });

  it("② 累加不覆盖：跨域请求带来的 Vary: Origin 必须保留", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/search?q=" + encodeURIComponent("缓存隔离站点"),
      headers: { origin: "https://consumer.example.com" },
    });
    expect(res.statusCode).toBe(200);
    const vary = varyOf(res.headers);
    expect(vary, "CORS 的 Vary: Origin 被缓存钩子覆盖掉了").toContain("origin");
    expect(vary).toContain("x-navhub-anon-id");
  });

  it("③ HEAD 与 GET 同口径（exposeHeadRoutes 复用同一条策略）", async () => {
    const url = "/api/search?q=" + encodeURIComponent("缓存隔离站点");
    const get = await app.inject({ method: "GET", url });
    const head = await app.inject({ method: "HEAD", url });
    expect(head.statusCode).toBe(200);
    expect(varyOf(head.headers)).toEqual(varyOf(get.headers));
    expect(String(head.headers["cache-control"])).toBe(String(get.headers["cache-control"]));
  });

  it("④ 未声明 vary 的缓存路由不会被顺手加上（openapi 仍只按自己的策略）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(res.statusCode).toBe(200);
    expect(varyOf(res.headers)).not.toContain("x-navhub-anon-id");
    expect(String(res.headers["cache-control"])).toContain("max-age=60");
  });

  it("⑤ POST 搜索不缓存：声明 cache 对 POST 无效，必须回到 no-store", async () => {
    const res = await app.inject({ method: "POST", url: "/api/search", payload: { q: "缓存隔离站点" } });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["cache-control"])).toBe("no-store");
  });
});
