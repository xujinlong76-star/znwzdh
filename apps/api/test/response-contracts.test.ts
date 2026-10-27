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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HealthResponse,
  RESPONSE_SCHEMA_BINDINGS,
  SEARCH_HIT_CORE_FIELDS,
  SITE_CORE_FIELDS,
  SearchResponse,
  SiteListResponse,
  SitePayload,
} from "@navhub/core";
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
});
