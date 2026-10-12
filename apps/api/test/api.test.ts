/**
 * API 端到端测试。
 *
 * 刻意不开真实端口，用 Fastify 的 inject：更快、无端口冲突，
 * 但走的是完整的路由 + 校验 + 仓储 + 检索引擎链路。
 *
 * 同时覆盖"降级"这条最容易出事的路径：embedding 关闭时搜索必须仍然可用。
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

const CATS = [
  { id: "cat-ai", title: "AI 工具" },
  { id: "cat-dev", title: "开发运维" },
  { id: "cat-life", title: "生活服务" },
];

const SITES: Array<{ url: string; title: string; description: string; categoryId: string; tags: string[] }> = [
  { url: "https://github.com/features/copilot", title: "GitHub Copilot", description: "AI 代码补全与编程助手", categoryId: "cat-ai", tags: ["ai", "coding"] },
  { url: "https://cursor.com", title: "Cursor", description: "AI 驱动的代码编辑器", categoryId: "cat-ai", tags: ["ai", "coding"] },
  { url: "https://weather.com.cn", title: "中国天气网", description: "全国天气预报查询", categoryId: "cat-life", tags: ["天气"] },
  { url: "https://npmjs.com", title: "npm", description: "JavaScript 包管理器", categoryId: "cat-dev", tags: ["包管理"] },
  { url: "https://example.com/startup", title: "启动脚本", description: "服务启动脚本编写与运行管理", categoryId: "cat-dev", tags: ["devops"] },
];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-api-"));
  // 刻意关闭 embedding：验证"无模型也能正常服务"这条降级路径
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

  for (const c of CATS) await ctx.repo.createCategory({ id: c.id, title: c.title });
  for (const s of SITES) await ctx.repo.createSite(s);
});

afterAll(async () => {
  await app.close();
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("健康检查与能力上报", () => {
  it("返回 ok、模式与能力清单", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("lite");
    expect(body.capabilities.semantic).toBe(false); // 已显式关闭
    expect(body.capabilities.fts).toBe(true);
    expect(body.capabilities.llm).toBe(false);
    expect(body.stats.sites).toBe(5);
  });

  it("能力降级时仍在 notes 里说明原因（不静默）", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/health" })).json();
    expect(body.capabilities.notes.join(" ")).toContain("embedding");
  });
});

describe("检索接口", () => {
  it("中文子串命中", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("天气") });
    expect(res.statusCode).toBe(200);
    const hits = res.json().hits;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].site.title).toBe("中国天气网");
  });

  it("拼音命中（qidong -> 启动脚本）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=qidong" });
    const hits = res.json().hits;
    expect(hits.some((h: any) => h.site.title === "启动脚本")).toBe(true);
  });

  it("首字母命中（zgtqw -> 中国天气网）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=zgtqw" });
    expect(res.json().hits[0].site.title).toBe("中国天气网");
  });

  it("英文前缀命中（curs -> Cursor）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=curs" });
    expect(res.json().hits.some((h: any) => h.site.title === "Cursor")).toBe(true);
  });

  it("每条命中都带上完整站点对象（前端无需二次请求）", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=AI" });
    for (const h of res.json().hits) {
      expect(h.site).toBeTruthy();
      expect(typeof h.site.url).toBe("string");
      expect(typeof h.score).toBe("number");
      expect(h.contributions).toBeTruthy();
    }
  });

  it("POST 检索同样工作", async () => {
    const res = await app.inject({ method: "POST", url: "/api/search", payload: { q: "包管理", limit: 3 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().hits.length).toBeLessThanOrEqual(3);
  });

  it("空查询返回浏览列表而不是错误", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=" });
    expect(res.statusCode).toBe(200);
    expect(res.json().hits.length).toBeGreaterThan(0);
  });

  it("非法参数被拒绝", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?limit=9999" });
    expect(res.json().error).toBe("参数无效");
  });
});

describe("站点 CRUD", () => {
  it("创建站点并返回 201", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://figma.com", title: "Figma", description: "在线 UI 设计", categoryId: "cat-ai", tags: ["设计"] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe("Figma");
  });

  it("重复 URL 返回 409 而不是静默创建副本", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://figma.com", title: "重复", categoryId: "cat-ai" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("已存在");
  });

  it("非法 URL 返回 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "not-a-url", title: "x", categoryId: "cat-ai" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("改名后新词立刻可检索（索引同步）", async () => {
    const created = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/renamed", title: "旧名字", categoryId: "cat-dev" },
    })).json();

    await app.inject({
      method: "PATCH", url: "/api/sites/" + created.id,
      payload: { title: "云原生部署平台" },
    });

    const hits = (await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("云原生") })).json().hits;
    expect(hits.some((h: any) => h.site.title === "云原生部署平台")).toBe(true);
    // 旧名字不应再命中
    const old = (await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("旧名字") })).json().hits;
    expect(old.some((h: any) => h.site.title === "云原生部署平台")).toBe(false);
  });

  it("删除后不再出现在检索结果中", async () => {
    const created = (await app.inject({
      method: "POST", url: "/api/sites",
      payload: { url: "https://example.com/todelete", title: "待删除站点", categoryId: "cat-dev" },
    })).json();

    const del = await app.inject({ method: "DELETE", url: "/api/sites/" + created.id });
    expect(del.statusCode).toBe(204);

    const hits = (await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("待删除站点") })).json().hits;
    expect(hits.some((h: any) => h.siteId === created.id)).toBe(false);
  });

  it("查询不存在的站点返回 404", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sites/nope" });
    expect(res.statusCode).toBe(404);
  });
});

describe("类目与统计", () => {
  it("列出类目", async () => {
    const res = await app.inject({ method: "GET", url: "/api/categories" });
    expect(res.json().length).toBeGreaterThanOrEqual(3);
  });

  it("支持子类目（物化路径）", async () => {
    const parent = (await app.inject({ method: "GET", url: "/api/categories" })).json().find((c: any) => c.id === "cat-ai");
    const res = await app.inject({ method: "POST", url: "/api/categories", payload: { title: "AI 绘图", parentId: "cat-ai" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().anchor.startsWith(parent.anchor + "/")).toBe(true);
  });

  it("子类目站点能被父类目过滤命中", async () => {
    const sub = (await app.inject({ method: "POST", url: "/api/categories", payload: { title: "AI 视频" } })).json();
    await app.inject({ method: "POST", url: "/api/sites", payload: { url: "https://example.com/aivideo", title: "AI 视频工具", categoryId: sub.id } });
    const hits = (await app.inject({ method: "POST", url: "/api/search", payload: { q: "", categoryId: sub.id, limit: 20 } })).json().hits;
    expect(hits.some((h: any) => h.site.title === "AI 视频工具")).toBe(true);
  });

  it("统计返回真实计数", async () => {
    const body = (await app.inject({ method: "GET", url: "/api/stats" })).json();
    expect(body.sites).toBeGreaterThan(5);
    expect(body.categories).toBeGreaterThan(3);
  });
});

describe("AI 富化接口（无 Key 时降级）", () => {
  it("拒绝非法 URL", async () => {
    const res = await app.inject({ method: "POST", url: "/api/enrich", payload: { url: "nope" } });
    expect(res.statusCode).toBe(400);
  });

  it("SSRF 目标被拦下，但仍返回可用的启发式结果（不 5xx）", async () => {
    const res = await app.inject({ method: "POST", url: "/api/enrich", payload: { url: "http://127.0.0.1:9/" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provenance).toBe("heuristic");
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it("/api/warmup 在 embedding 关闭时如实返回 false", async () => {
    const body = (await app.inject({ method: "POST", url: "/api/warmup" })).json();
    expect(body.ok).toBe(false);
  });
});

describe("事件与审计", () => {
  it("搜索会记录事件（用于个性化与分析）", async () => {
    await app.inject({ method: "GET", url: "/api/search?q=" + encodeURIComponent("测试事件") });
    const row = ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM events WHERE kind = ?").get("search") as { c: number };
    expect(Number(row.c)).toBeGreaterThan(0);
  });

  it("写操作留下审计日志", async () => {
    const row = ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM audit_logs").get() as { c: number };
    expect(Number(row.c)).toBeGreaterThan(0);
  });

  it("可以接受前端上报的点击事件", async () => {
    const res = await app.inject({ method: "POST", url: "/api/events", payload: { kind: "click", siteId: "x" } });
    expect(res.json().ok).toBe(true);
  });
});
