/**
 * 响应契约的端到端防线。
 *
 * OpenAPI 里的响应体曾经一律写成「通用 object」：文档不说形状，实现改了
 * 也没人知道契约破了。现在形状定义在 @navhub/core 的 rest-responses.ts，
 * 本文件用同一份 zod schema 校验**真实注入响应**——文档、实现、测试三方
 * 只能靠同一份契约说话。
 *
 * 覆盖方式刻意是「跑起来验」而不是「读文档比对」：路由补了必填字段、
 * 改了可空性、把数字降级成字符串，只有真实响应能暴露。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CATEGORY_CORE_FIELDS,
  CategoryCountsResponse,
  CategoryListResponse,
  CategoryPageResponse,
  HealthResponse,
  MeOverviewResponse,
  PluginListResponse,
  RESPONSE_SCHEMA_BINDINGS,
  RankNewResponse,
  RankTrendingResponse,
  SEARCH_HIT_CORE_FIELDS,
  SITE_CORE_FIELDS,
  SearchResponse,
  SiteListResponse,
  SitePayload,
  TAG_CORE_FIELDS,
  TagListResponse,
} from "@navhub/core";
import type { PluginManifest } from "@navhub/core";
import type { TagWithCount } from "@navhub/store";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

let dir: string;
let ctx: AppContext;
let app: Awaited<ReturnType<typeof buildServer>>;

const CAT_ROOTS = [
  { id: "root-ai", title: "AI 专区" },
  { id: "root-dev", title: "开发专区" },
  { id: "root-life", title: "生活专区" },
];

const CATS = [
  { id: "cat-ai", title: "AI 工具", parentId: "root-ai" },
  { id: "cat-dev", title: "开发运维", parentId: "root-dev" },
  { id: "cat-life", title: "生活服务", parentId: "root-life" },
];

const SITES = [
  { url: "https://github.com/features/copilot", title: "GitHub Copilot", description: "AI 代码补全与编程助手", categoryId: "cat-ai", tags: ["ai", "coding"] },
  { url: "https://cursor.com", title: "Cursor", description: "AI 驱动的代码编辑器", categoryId: "cat-ai", tags: ["ai", "coding"] },
  { url: "https://weather.com.cn", title: "中国天气网", description: "全国天气预报查询", categoryId: "cat-life", tags: ["天气"] },
  { url: "https://npmjs.com", title: "npm", description: "JavaScript 包管理器", categoryId: "cat-dev", tags: ["包管理"] },
  { url: "https://example.com/startup", title: "启动脚本", description: "服务启动脚本编写与运行管理", categoryId: "cat-dev", tags: ["devops"] },
];

// 列表瘦身只针对 site-pack（单条清单约 34KB，24 条曾达 1.16MB），
// 所以契约测试必须用 site-pack 才验得到「默认摘掉 manifest」。
const SITE_PACK_MANIFEST: PluginManifest = {
  manifestVersion: 1,
  kind: "site-pack",
  name: "契约测试网址包",
  description: "响应契约测试用的最小网址包",
  version: "1.0.0",
  tags: ["test"],
  payload: { sites: [{ url: "https://example.org", title: "示例站" }] },
};

// /api/me 是身份域路由：开放模式（authRequired=false）下自报头即可信，
// 这里用固定身份，避免用户中心概览随内置演示数据变化而抖动。
const ME_IDENTITY = "contract-user";
const ME_HEADERS = { "x-navhub-user-id": ME_IDENTITY };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-response-contracts-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "contracts.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "models"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 5000 },
    fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubTest/0.1" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  app = await buildServer(ctx);
  await app.ready();

  for (const c of CAT_ROOTS) await ctx.repo.createCategory({ id: c.id, title: c.title });
  for (const c of CATS) await ctx.repo.createCategory({ id: c.id, title: c.title, parentId: c.parentId });
  for (const s of SITES) await ctx.repo.createSite(s);
  // 插件列表要有真实条目才验得到卡片形状（空数组会让契约形同虚设）
  await ctx.repo.createPlugin({ manifest: SITE_PACK_MANIFEST, source: "seed", status: "published" });
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

/** safeParse 失败时把 issue 打出来，否则只剩一句 true !== false */
function expectContract(schema: { safeParse: (v: unknown) => any }, payload: unknown, label: string): void {
  const parsed = schema.safeParse(payload);
  expect(parsed.success, label + " 不满足响应契约：" + (parsed.success ? "" : JSON.stringify(parsed.error.issues))).toBe(true);
}

describe("绑定表与真实路由同源", () => {
  it("每个绑定键都能在注册期路由清单里找到", () => {
    const inventory = new Set(
      app.routeInventory.map((r) => r.method + " " + r.url.replace(/:([A-Za-z0-9_]+)/g, "{$1}")),
    );
    for (const key of Object.keys(RESPONSE_SCHEMA_BINDINGS)) {
      expect(inventory.has(key), "绑定表里的路由不存在：" + key).toBe(true);
    }
  });

  it("每个绑定都进了 openapi.json，且 200 指向组件而不是通用 object", async () => {
    const doc = (await app.inject({ method: "GET", url: "/api/openapi.json" })).json() as {
      paths: Record<string, Record<string, any>>;
      components: { schemas: Record<string, any> };
    };
    for (const [key, binding] of Object.entries(RESPONSE_SCHEMA_BINDINGS)) {
      const [method, path] = key.split(" ");
      const op = doc.paths[path!]?.[method!.toLowerCase()];
      expect(op, "文档缺少端点：" + key).toBeTruthy();
      const ref = op.responses["200"].content["application/json"].schema.$ref;
      expect(ref, key + " 的 200 未引用响应契约").toBe("#/components/schemas/" + binding.name);

      const component = doc.components.schemas[binding.name];
      expect(component, "组件缺失：" + binding.name).toBeTruthy();
      // 组件必须是真字段，不是空壳 object
      const shape = component.type === "array" ? component.items : component;
      expect(Object.keys(shape?.properties ?? {}).length, "组件是空壳：" + binding.name).toBeGreaterThan(0);
    }
  });

  it("GET 与 POST /api/search 共用同一个组件（同一处理器的响应不许分叉）", async () => {
    const doc = (await app.inject({ method: "GET", url: "/api/openapi.json" })).json() as {
      paths: Record<string, Record<string, any>>;
    };
    const getRef = doc.paths["/api/search"]!.get.responses["200"].content["application/json"].schema.$ref;
    const postRef = doc.paths["/api/search"]!.post.responses["200"].content["application/json"].schema.$ref;
    expect(postRef).toBe(getRef);
  });

  it("核心字段清单与 schema 同步（清单漏字段时编译期已红，这里再钉运行时）", () => {
    for (const field of SITE_CORE_FIELDS) {
      expect((SitePayload.shape as Record<string, unknown>)[field], "SitePayload 缺少核心字段：" + field).toBeTruthy();
    }
    // 搜索命中的核心字段由 satisfies 在编译期对齐 SearchHit，这里只确认清单非空
    expect(SEARCH_HIT_CORE_FIELDS.length).toBeGreaterThan(0);
  });

  it("类目/标签核心字段清单与 schema 同步", () => {
    const categoryShape = CategoryListResponse.element.shape as Record<string, unknown>;
    for (const field of CATEGORY_CORE_FIELDS) {
      expect(categoryShape[field], "CategoryPayload 缺少核心字段：" + field).toBeTruthy();
    }
    const tagShape = TagListResponse.element.shape as Record<string, unknown>;
    for (const field of TAG_CORE_FIELDS) {
      expect(tagShape[field], "TagPayload 缺少核心字段：" + field).toBeTruthy();
    }
  });

  it("标签契约字段与仓储类型 TagWithCount 编译期对齐", () => {
    // TagWithCount 在 @navhub/store（依赖方向 store → core），core 里没法反向 import，
    // 只能在这里钉：清单里写错字段名，这行 satisfies 就会在编译期红。
    const aligned = TAG_CORE_FIELDS satisfies readonly (keyof TagWithCount)[];
    expect(aligned.length).toBeGreaterThan(0);
  });
});

/**
 * 覆盖率棘轮：绑定表只保证「登记了的不漂」，不保证「新路由会登记」。
 * 反向（绑定的路由必须真实存在）已在上一组；这里补另一头——每条读路由都要有契约。
 *
 * 基线为什么落文件而不是写在测试里：未绑定的读路由有 231 条（历史面），
 * 塞进正文等于把 231 行噪音焊死在测试文件里。落 fixtures 后语义不变：
 * **精确快照**（多一条红、少一条也红），任何变化都必须显式改文件——补了绑定
 * 要删行，新增路由要决定「登记契约」还是「进基线并说明理由」。基线只许缩小。
 *
 * 为什么读路由优先：读路由的响应是前端类型生成的输入（HubSite、榜单都从这里来），
 * 漏一条就等于给前端留一个手写类型的口子；写路由的响应形状目前多是一句话回执，
 * 暂不纳入，避免为「{ok:true}」制造无意义的 schema 负担。
 */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const bindingKeyOf = (route: { method: string; url: string }): string =>
  route.method.toUpperCase() + " " + route.url.replace(/:([A-Za-z0-9_]+)/g, "{$1}");

const UNBOUND_FIXTURE = "test/fixtures/unbound-read-routes.txt";

function readUnboundBaseline(): string[] {
  const text = readFileSync(new URL("./fixtures/unbound-read-routes.txt", import.meta.url), "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

describe("契约覆盖率棘轮", () => {
  it("每条读路由都必须登记响应契约（未登记的与基线精确一致，只许缩小）", () => {
    const unbound = app.routeInventory
      .filter((route) => READ_METHODS.has(route.method.toUpperCase()))
      .map(bindingKeyOf)
      .filter((key) => !(key in RESPONSE_SCHEMA_BINDINGS))
      .sort();
    expect(
      unbound,
      "读路由与契约基线不一致。" +
        "新增读路由 → 在 packages/core/src/rest-responses.ts 加 schema 与绑定，" +
        "再跑 node scripts/generate-rest-contract-types.mjs；" +
        "确属无需契约（如 openapi.json 自身）→ 把键加进 " + UNBOUND_FIXTURE + " 并在提交说明理由。" +
        "补了绑定的路由 → 必须从基线删除（基线只许缩小）",
    ).toEqual(readUnboundBaseline().sort());
  });

  it("契约基线不陈旧：每条都仍是真实存在、仍未登记的读路由", () => {
    const reads = new Map(app.routeInventory.filter((r) => READ_METHODS.has(r.method.toUpperCase())).map((r) => [bindingKeyOf(r), r]));
    for (const key of readUnboundBaseline()) {
      expect(reads.has(key), "基线里的读路由不存在了（改名/删除）：" + key).toBe(true);
      expect(key in RESPONSE_SCHEMA_BINDINGS, "该读路由已登记契约，请从 " + UNBOUND_FIXTURE + " 删除：" + key).toBe(false);
    }
  });
});

describe("真实响应满足契约", () => {
  it("GET /api/health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expectContract(HealthResponse, body, "GET /api/health");
    expect(body.stats.sites).toBe(5);
    expect(body.capabilities.semantic).toBe(false);
  });

  it("GET /api/sites", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sites" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(5);
    expectContract(SiteListResponse, body, "GET /api/sites");
  });

  it("GET /api/search", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=Cursor" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expectContract(SearchResponse, body, "GET /api/search");
    expect(body.hits.length).toBeGreaterThan(0);
    // 命中上必须挂站点详情（前端直接渲染 hit.site 的标题/图标）
    expect(body.hits[0].site?.id).toBeTruthy();
    expect(body.items.length).toBe(body.hits.length);
  });

  it("POST /api/search", async () => {
    const res = await app.inject({ method: "POST", url: "/api/search", payload: { q: "Cursor" } });
    expect(res.statusCode).toBe(200);
    expectContract(SearchResponse, res.json(), "POST /api/search");
  });

  it("GET /api/categories", async () => {
    const res = await app.inject({ method: "GET", url: "/api/categories" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expectContract(CategoryListResponse, body, "GET /api/categories");
    expect(body.length).toBe(CAT_ROOTS.length + CATS.length);
    const root = body.find((c: { id: string }) => c.id === "root-ai");
    // 根节点父级必须是 null 而不是缺字段：前端拿 parentId 判层级
    expect(root.parentId).toBeNull();
    expect(root.anchor).toBe("root-ai");
  });

  it("GET /api/categories/page", async () => {
    const res = await app.inject({ method: "GET", url: "/api/categories/page?limit=2&offset=0" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expectContract(CategoryPageResponse, body, "GET /api/categories/page");
    expect(body.items.length).toBe(2);
    expect(body.total).toBe(CAT_ROOTS.length + CATS.length);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
  });

  it("GET /api/categories/page?parentId=null 只回根", async () => {
    const res = await app.inject({ method: "GET", url: "/api/categories/page?parentId=null" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expectContract(CategoryPageResponse, body, "GET /api/categories/page?parentId=null");
    expect(body.items.map((c: { id: string }) => c.id).sort()).toEqual(CAT_ROOTS.map((c) => c.id).sort());
  });

  it("GET /api/categories/counts", async () => {
    const res = await app.inject({ method: "GET", url: "/api/categories/counts" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expectContract(CategoryCountsResponse, body, "GET /api/categories/counts");
    const byId = new Map(body.counts.map((c: { categoryId: string; sites: number }) => [c.categoryId, c.sites]));
    expect(byId.get("cat-ai")).toBe(2);
    // 只有存活站点计入；空类目不出现（而不是出现一条 0）
    expect(byId.has("root-ai")).toBe(false);
  });

  it("GET /api/tags", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tags" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expectContract(TagListResponse, body, "GET /api/tags");
    const ai = body.find((t: { name: string }) => t.name === "ai");
    expect(ai.count).toBe(2);
    expect(Array.isArray(ai.aliases)).toBe(true);
  });

  it("GET /api/rank/trending", async () => {
    const res = await app.inject({ method: "GET", url: "/api/rank/trending?limit=5" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expectContract(RankTrendingResponse, body, "GET /api/rank/trending");
    expect(body.hits.length).toBe(SITES.length);
    // 热度分量是 tooltip 的「为什么排在这儿」，必须齐全
    expect(Object.keys(body.hits[0].trend).sort()).toEqual(["lastVisitedAt", "trendScore", "visits"]);
    expect(body.hits[0].site.id).toBeTruthy();
  });

  it("GET /api/rank/new", async () => {
    const res = await app.inject({ method: "GET", url: "/api/rank/new?limit=5" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expectContract(RankNewResponse, body, "GET /api/rank/new");
    expect(body.hits.length).toBe(SITES.length);
  });

  it("GET /api/plugins：列表带 summary、默认不带 manifest", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expectContract(PluginListResponse, body, "GET /api/plugins");
    expect(body.total).toBe(1);
    expect(body.items.length).toBe(1);
    const item = body.items[0];
    expect(item.slug).toBeTruthy();
    expect(item.summary.kind).toBe("site-pack");
    expect(item.summary.siteCount).toBe(1);
    // 列表瘦身是刻意设计：site-pack 的 manifest 只在 ?manifest=1 时回来
    expect(item.manifest).toBeUndefined();
    // 内部归属串不能出现在公共响应里
    expect(item.ownerIdentity).toBeUndefined();
  });

  it("GET /api/plugins?manifest=1 才带完整清单", async () => {
    const res = await app.inject({ method: "GET", url: "/api/plugins?manifest=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expectContract(PluginListResponse, body, "GET /api/plugins?manifest=1");
    expect(body.items[0].manifest).toBeTruthy();
  });

  it("GET /api/me：概览与设置一次取回", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me", headers: ME_HEADERS });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expectContract(MeOverviewResponse, body, "GET /api/me");
    expect(body.identity).toBe(ME_IDENTITY);
    // 未绑定登录账号的匿名身份是合法身份：概览照常返回，user 为 null
    expect(body.user).toBeNull();
    expect(body.counts.favorites).toBe(0);
    // 设置缺省即「开启 + 默认体验」：每个字段恒有值，不是可选
    expect(body.settings.defaultSearchEngine).toBe("internal");
    expect(body.settings.historyRetentionDays).toBe(180);
  });
});

describe("契约不是空转（负控：手工漂移必须被拒）", () => {
  it("health：ok 降级 / 统计字段类型漂移都会被拒", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/health" })).json();
    expect(HealthResponse.safeParse({ ...body, ok: false }).success).toBe(false);
    expect(HealthResponse.safeParse({ ...body, stats: { ...body.stats, sites: "5" } }).success).toBe(false);
  });

  it("sites：状态枚举外的新值 / tags 变成字符串都会被拒", async () => {
    const one = (await app.inject({ method: "GET", url: "/api/sites" })).json()[0];
    expect(SiteListResponse.safeParse([{ ...one, status: "retired" }]).success).toBe(false);
    expect(SiteListResponse.safeParse([{ ...one, tags: "ai" }]).success).toBe(false);
  });

  it("search：命中分数从数字降级成字符串会被拒", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/search?q=Cursor" })).json();
    const drifted = body.hits.map((h: Record<string, unknown>) => ({ ...h, score: String(h.score) }));
    expect(SearchResponse.safeParse({ ...body, hits: drifted }).success).toBe(false);
  });

  it("categories：parentId 从 null 漂成缺字段、sort 降级成字符串都会被拒", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/categories" })).json();
    const [first] = body;
    const { parentId: _drop, ...withoutParent } = first;
    expect(CategoryListResponse.safeParse([withoutParent]).success).toBe(false);
    expect(CategoryListResponse.safeParse([{ ...first, sort: String(first.sort) }]).success).toBe(false);
  });

  it("categories/page：分页壳缺 total 或 items 漂成单对象都会被拒", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/categories/page?limit=1" })).json();
    const { total: _drop, ...noTotal } = body;
    expect(CategoryPageResponse.safeParse(noTotal).success).toBe(false);
    expect(CategoryPageResponse.safeParse({ ...body, items: body.items[0] }).success).toBe(false);
  });

  it("tags：count 降级成字符串、aliases 变成字符串都会被拒", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/tags" })).json();
    const first = body[0];
    expect(TagListResponse.safeParse([{ ...first, count: String(first.count) }]).success).toBe(false);
    expect(TagListResponse.safeParse([{ ...first, aliases: "ai" }]).success).toBe(false);
  });

  it("rank/trending：trend 少一个分量、visits 降级都会被拒", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/rank/trending?limit=1" })).json();
    const hit = body.hits[0];
    const { trendScore: _drop, ...partialTrend } = hit.trend;
    expect(RankTrendingResponse.safeParse({ hits: [{ ...hit, trend: partialTrend }] }).success).toBe(false);
    expect(
      RankTrendingResponse.safeParse({ hits: [{ ...hit, trend: { ...hit.trend, visits: "0" } }] }).success,
    ).toBe(false);
  });

  it("plugins：summary 缺失或 total 降级成字符串都会被拒", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/plugins" })).json();
    const { summary: _drop, ...noSummary } = body.items[0];
    expect(PluginListResponse.safeParse({ ...body, items: [noSummary] }).success).toBe(false);
    expect(PluginListResponse.safeParse({ ...body, total: String(body.total) }).success).toBe(false);
  });

  it("me：计数降级、设置枚举漂移、settings 整块缺失都会被拒", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/me", headers: ME_HEADERS })).json();
    expect(MeOverviewResponse.safeParse({ ...body, counts: { ...body.counts, favorites: "0" } }).success).toBe(false);
    expect(
      MeOverviewResponse.safeParse({ ...body, settings: { ...body.settings, defaultSearchEngine: "baidu" } }).success,
    ).toBe(false);
    const { settings: _drop, ...noSettings } = body;
    expect(MeOverviewResponse.safeParse(noSettings).success).toBe(false);
  });
});
