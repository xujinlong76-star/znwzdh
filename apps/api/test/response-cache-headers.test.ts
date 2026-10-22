/**
 * 响应缓存头的回归（2026-10-21 深扫）。
 *
 * 修的是两类「头写了但没生效 / 生效但被覆盖」的静默失效：
 *
 *  1. **徽章路由手写头被 onSend 钩子整行覆盖**。`/api/plugins/:slug/badge.svg`
 *     在 handler 里 `reply.header("Cache-Control", "public, max-age=300")`，
 *     但路由没在 config 里声明 `cache` —— 钩子对「未声明 cache 的 GET」一律
 *     改写 `no-store`。徽章是挂在 README / 官网首页上的高频外链：no-store 等于
 *     每次页面加载都回源打两次库，还要和全局 300/min IP 桶抢额度，
 *     表现就是别人仓库里的徽章随机变成 429 碎图。
 *  2. **HEAD 被当成非缓存方法**。钩子条件只写 `!== "GET"`，于是
 *     `HEAD /api/categories` 恒回 `no-store` 且不带 ETag。Fastify 的
 *     `exposeHeadRoutes` 会按 GET 路由自动生成 HEAD，且 onSend 里的 payload
 *     仍是完整表示（只在写 socket 时去 body），所以 HEAD 完全有条件共享同一套
 *     策略 —— 修复后 HEAD 带 ETag，条件请求能回 304，而不是全量算完再丢。
 *
 * 非空性：把路由的 `cache` 声明删掉，第 1 组立刻变 `no-store` 而失败；
 * 把钩子条件改回 `req.method !== "GET"`，第 2 组立刻失败。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAndCleanPluginManifest } from "@navhub/core";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const BASE = "/api/plugins/cache-probe/badge.svg";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-cache-headers-"));
  ctx = await createContext(
    loadConfig({ sqlitePath: join(dir, "cache.db"), embedding: { enabled: false } } as never),
  );
  const validated = validateAndCleanPluginManifest({
    manifestVersion: 1,
    kind: "theme",
    name: "缓存探针主题",
    version: "1.0.0",
    description: "只为了拿到一个 published 插件来请求徽章",
    tags: ["测试"],
    payload: { accent: "violet", tokens: { "--primary": "262 83% 58%" } },
  } as never);
  if (!validated.ok) throw new Error("清单不合法：" + validated.errors.join("; "));
  await ctx.repo.createPlugin(
    { manifest: validated.manifest, slug: "cache-probe", status: "published", source: "seed", author: "测试" },
    { actor: "test", actorKind: "system" },
  );
  app = await buildServer(ctx);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("徽章路由的缓存策略", () => {
  it("声明了 cache：200 响应不再被钩子改成 no-store", async () => {
    const res = await app.inject({ method: "GET", url: BASE });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, max-age=300");
    expect(String(res.headers["content-type"])).toContain("image/svg+xml");
  });

  it("带 ETag：重复加载走 304，不必重新渲染 SVG", async () => {
    const first = await app.inject({ method: "GET", url: BASE });
    const etag = first.headers["etag"];
    expect(typeof etag).toBe("string");
    const again = await app.inject({ method: "GET", url: BASE, headers: { "if-none-match": String(etag) } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe("");
    // 304 不能带 content-type（残留会让客户端把空 body 当 SVG 解析）。
    // content-length 由 Fastify 在钩子之后按空 payload 生成，只可能是缺失或 0，
    // 这里锁「不是原 SVG 的长度」而不是具体值。
    expect(again.headers["content-type"]).toBeUndefined();
    expect(["0", undefined]).toContain(again.headers["content-length"] as string | undefined);
  });

  it("未发布的插件仍回 404 + no-store（非 200 不给缓存额度）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins/no-such-plugin/badge.svg" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("HEAD 与 GET 共享缓存策略", () => {
  it("HEAD /api/categories 的 cache-control 与 ETag 和 GET 一致", async () => {
    const get = await app.inject({ method: "GET", url: "/api/categories" });
    const head = await app.inject({ method: "HEAD", url: "/api/categories" });
    expect(head.statusCode).toBe(200);
    expect(head.headers["cache-control"]).toBe(get.headers["cache-control"]);
    expect(head.headers["etag"]).toBe(get.headers["etag"]);
    expect(String(head.headers["cache-control"])).not.toBe("no-store");
    // HEAD 不回 body，但长度应当描述 GET 表示
    expect(head.body).toBe("");
  });

  it("HEAD 的条件请求命中 ETag → 304（此前恒为 200 全量计算）", async () => {
    const get = await app.inject({ method: "GET", url: "/api/categories" });
    const res = await app.inject({
      method: "HEAD",
      url: "/api/categories",
      headers: { "if-none-match": String(get.headers["etag"]) },
    });
    expect(res.statusCode).toBe(304);
  });

  it("非 GET/HEAD 不受影响：POST 一律 no-store", async () => {
    const res = await app.inject({ method: "POST", url: "/api/events", payload: { siteId: "x", event: "click" } });
    expect(res.statusCode).toBeLessThan(500);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

/**
 * 推荐类端点：结果与身份无关、每次请求都要重算（向量 KNN / 双曲重排），
 * 此前却和写入路由一样吃 `no-store`。与同域的 trending / new 对齐到 60s + ETag。
 */
describe("推荐端点的缓存策略", () => {
  it("GET /api/rank/similar/:id 带 max-age=60 与 ETag，再验证命中 304", async () => {
    const first = await app.inject({ method: "GET", url: "/api/rank/similar/no-such-site" });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, max-age=60");
    expect(typeof first.headers["etag"]).toBe("string");
    const again = await app.inject({
      method: "GET",
      url: "/api/rank/similar/no-such-site",
      headers: { "if-none-match": String(first.headers["etag"]) },
    });
    expect(again.statusCode).toBe(304);
  });

  it("GET /api/rank/alternatives/:id 同样可缓存；站点不存在时 404 + no-store", async () => {
    const categoryId = await ctx.repo.ensureCategory("缓存探针类目", "test");
    const created = await ctx.repo.createSite({
      url: "https://cache-probe.example/",
      title: "缓存探针站",
      categoryId,
    } as never);
    const ok = await app.inject({ method: "GET", url: `/api/rank/alternatives/${created.id}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("private, max-age=60");

    const missing = await app.inject({ method: "GET", url: "/api/rank/alternatives/__missing__" });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["cache-control"]).toBe("no-store");
  });

/**
 * alternatives 的 N+1 守卫（没有 embedding/向量时这段循环在测试里跑不到，
 * 只能用源码契约锁住，别让它改回逐个 getSite + getEmbedding）。
 */
  it("候选集改成批量取站点：源码里不再有逐条 getSite 的循环调用", async () => {
    const src = await readFile(join(import.meta.dirname, "../src/routes/rank.ts"), "utf8");
    const start = src.indexOf("const candidates = matches.filter");
    const end = src.indexOf("scored.sort", start);
    expect(start).toBeGreaterThan(-1);
    const loop = src.slice(start, end);
    expect(loop).toContain("getSitesByIds");
    expect(loop).not.toMatch(/await ctx\.repo\.getSite\(/);
  });
});

/**
 * 字母标 favicon：图标内容由**标题**推导，缓存头必须跟得上改名。
 * 此前是 `max-age=86400`，改名后浏览器一整天不回源——列表已是新标题，
 * 图标还是旧首字母，只能硬刷新。
 */
describe("字母标 favicon 的缓存策略", () => {
  it("GET /api/favicon/:id → max-age=300 + ETag，改名后 ETag 跟着变", async () => {
    const categoryId = await ctx.repo.ensureCategory("字母标探针类目", "test");
    const site = await ctx.repo.createSite({
      url: "https://letter-mark.example/",
      title: "阿里邮箱",
      categoryId,
    } as never);

    const first = await app.inject({ method: "GET", url: "/api/favicon/" + site.id });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, max-age=300");
    expect(String(first.headers["cache-control"])).not.toContain("86400");
    const firstEtag = String(first.headers["etag"]);
    expect(firstEtag).toBeTruthy();
    expect(first.body).toContain("阿");

    // 用旧 ETag 再验证：没变就是 304，不重新出图
    const fresh = await app.inject({
      method: "GET",
      url: "/api/favicon/" + site.id,
      headers: { "if-none-match": firstEtag },
    });
    expect(fresh.statusCode).toBe(304);

    await ctx.repo.updateSite(site.id, { title: "字节跳动" } as never);
    const renamed = await app.inject({
      method: "GET",
      url: "/api/favicon/" + site.id,
      headers: { "if-none-match": firstEtag },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.headers["etag"]).not.toBe(firstEtag);
    expect(renamed.body).toContain("字");
    expect(renamed.body).not.toContain("阿");
  });
});
