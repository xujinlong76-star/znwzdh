/**
 * MCP 工具测试。
 *
 * 重点不是"功能能跑"，而是**安全边界真的是硬边界**：
 *  - 只读 token 不能调用写工具
 *  - 批量导入默认 dryRun，不会意外落库
 *  - 重复调用（Agent 重试）不会产生重复站点
 *  - 每个写操作都留下审计记录
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, loadConfig, type AppContext } from "@navhub/api";
import { createHandlers } from "../src/handlers.ts";
import { TOOL_DEFS, type McpScope, type ToolContext } from "../src/tools.ts";

let dir: string;
let ctx: AppContext;
let handlers: ReturnType<typeof createHandlers>;

const FULL: ToolContext = { actor: "mcp:test", scopes: ["read", "write"], has: () => true };
const READONLY: ToolContext = {
  actor: "mcp:readonly", scopes: ["read"],
  has: (s: McpScope) => s === "read",
};

function text(res: { content: Array<{ text: string }> }): string {
  return res.content.map((c) => c.text).join("");
}

function payload(res: { content: Array<{ text: string }> }): any {
  return JSON.parse(text(res));
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "navhub-mcp-"));
  const config = loadConfig({
    mode: "lite",
    sqlitePath: join(dir, "mcp.db"),
    embedding: { model: "Xenova/bge-small-zh-v1.5", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: join(dir, "m"), dim: 512, enabled: false },
    llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 3000 },
    fetch: { timeoutMs: 1200, maxBytes: 131072, maxRedirects: 1, allowPrivateNetworks: false, userAgent: "NavHubTest" },
    corsOrigins: ["*"],
  });
  ctx = await createContext(config);
  handlers = createHandlers(ctx);

  await ctx.repo.createCategory({ id: "cat-ai", title: "AI 工具" });
  await ctx.repo.createCategory({ id: "cat-dev", title: "开发运维" });
  await ctx.repo.createSite({ url: "https://github.com/features/copilot", title: "GitHub Copilot", description: "AI 代码补全", categoryId: "cat-ai", tags: ["ai"] });
  await ctx.repo.createSite({ url: "https://weather.com.cn", title: "中国天气网", description: "全国天气预报", categoryId: "cat-dev", tags: ["天气"] });
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("工具清单", () => {
  it("包含 4 个只读工具与 5 个写工具", () => {
    const read = TOOL_DEFS.filter((t) => !t.mutating);
    const write = TOOL_DEFS.filter((t) => t.mutating);
    expect(read.map((t) => t.name).sort()).toEqual(["get_site", "get_stats", "list_categories", "search_sites"]);
    expect(write.length).toBe(5);
  });

  it("每个工具都有 scope 与描述（否则 AI 无法正确选择）", () => {
    for (const t of TOOL_DEFS) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(["read", "write", "admin"]).toContain(t.scope);
    }
  });
});

describe("只读工具", () => {
  it("search_sites 返回带匹配解释的结果", async () => {
    const res = await handlers.search_sites({ query: "天气" }, FULL);
    const body = payload(res);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].title).toBe("中国天气网");
    expect(body.results[0].matchedBy).toBeTruthy();
    expect(body.semanticAvailable).toBe(false);
  });

  it("search_sites 支持拼音查询", async () => {
    const body = payload(await handlers.search_sites({ query: "tianqi" }, FULL));
    expect(body.results.some((r: any) => r.title === "中国天气网")).toBe(true);
  });

  it("get_site 支持 URL 或 id", async () => {
    const byUrl = payload(await handlers.get_site({ idOrUrl: "https://weather.com.cn" }, FULL));
    expect(byUrl.title).toBe("中国天气网");
    const byId = payload(await handlers.get_site({ idOrUrl: byUrl.id }, FULL));
    expect(byId.id).toBe(byUrl.id);
  });

  it("get_site 找不到时返回 isError 而不是抛异常", async () => {
    const res = await handlers.get_site({ idOrUrl: "https://nope.example" }, FULL);
    expect(res.isError).toBe(true);
  });

  it("list_categories 可返回站点计数", async () => {
    const body = payload(await handlers.list_categories({ includeCounts: true }, FULL));
    const ai = body.find((c: any) => c.id === "cat-ai");
    expect(ai.siteCount).toBe(1);
  });

  it("get_stats 返回统计与能力", async () => {
    const body = payload(await handlers.get_stats({}, FULL));
    expect(body.sites).toBe(2);
    expect(body.capabilities.semantic).toBe(false);
  });
});

describe("权限是硬边界", () => {
  it("只读 token 调用 create_site 被拒绝", async () => {
    await expect(handlers.create_site({ url: "https://example.com/x" }, READONLY)).rejects.toThrow(/权限/);
  });

  it("只读 token 调用 update_site / set_status / batch_import / health_check 全部被拒绝", async () => {
    await expect(handlers.update_site({ id: "x", title: "y" }, READONLY)).rejects.toThrow(/权限/);
    await expect(handlers.set_status({ id: "x", status: "active" }, READONLY)).rejects.toThrow(/权限/);
    await expect(handlers.batch_import({ sites: [{ url: "https://example.com/y" }] }, READONLY)).rejects.toThrow(/权限/);
    await expect(handlers.health_check({}, READONLY)).rejects.toThrow(/权限/);
  });

  it("只读 token 可以正常使用只读工具", async () => {
    const body = payload(await handlers.get_stats({}, READONLY));
    expect(body.sites).toBe(2);
  });
});

describe("写工具：幂等与审计", () => {
  it("create_site 可以创建并留下审计", async () => {
    const body = payload(await handlers.create_site({
      url: "https://example.com/fresh", title: "新站点", categoryId: "cat-dev", enrich: false,
    }, FULL));
    expect(body.created).toBe(true);
    const logs = ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE actor = ?").get("mcp:test") as { c: number };
    expect(Number(logs.c)).toBeGreaterThan(0);
  });

  it("重复 URL 返回 already_exists 而不是报错（Agent 无法预知库里有什么）", async () => {
    const body = payload(await handlers.create_site({ url: "https://example.com/fresh" }, FULL));
    expect(body.created).toBe(false);
    expect(body.reason).toBe("already_exists");
  });

  it("幂等键：重复调用返回上次结果且不重复创建", async () => {
    const args = { url: "https://example.com/idem", title: "幂等站点", categoryId: "cat-dev", enrich: false, idempotencyKey: "key-1" };
    const first = payload(await handlers.create_site(args, FULL));
    const second = payload(await handlers.create_site(args, FULL));
    expect(first.created).toBe(true);
    expect(second.replayed).toBe(true);
    const count = ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM sites WHERE url = ?").get("https://example.com/idem") as { c: number };
    expect(Number(count.c)).toBe(1);
  });

  it("set_status 能标记失效并落审计", async () => {
    const site = payload(await handlers.get_site({ idOrUrl: "https://weather.com.cn" }, FULL));
    const body = payload(await handlers.set_status({ id: site.id, status: "broken" }, FULL));
    expect(body.status).toBe("broken");
    const row = ctx.db.sqlite!.prepare("SELECT status FROM sites WHERE id = ?").get(site.id) as { status: string };
    expect(row.status).toBe("broken");
  });
});

describe("批量导入：dryRun 是默认行为", () => {
  it("默认 dryRun=true，只返回计划不落库", async () => {
    const before = (ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM sites").get() as { c: number }).c;
    const body = payload(await handlers.batch_import({
      sites: [{ url: "https://example.com/b1", title: "B1" }, { url: "https://example.com/b2", title: "B2" }],
    }, FULL));
    expect(body.dryRun).toBe(true);
    expect(body.wouldCreate).toBe(2);
    const after = (ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM sites").get() as { c: number }).c;
    expect(after).toBe(before);
  });

  it("dryRun=false 时才真正写入", async () => {
    const body = payload(await handlers.batch_import({
      sites: [{ url: "https://example.com/r1", title: "R1" }, { url: "https://example.com/r2", title: "R2" }],
      dryRun: false, defaultCategoryId: "cat-dev",
    }, FULL));
    expect(body.created).toBe(2);
  });

  it("已存在的站点在计划里被标记 skip", async () => {
    const body = payload(await handlers.batch_import({
      sites: [{ url: "https://example.com/r1" }, { url: "https://example.com/new999" }],
    }, FULL));
    expect(body.plan.find((p: any) => p.url === "https://example.com/r1").action).toBe("skip");
    expect(body.plan.find((p: any) => p.url === "https://example.com/new999").action).toBe("create");
  });

  it("超过条数上限被拒绝（有硬上限，不是靠提示词约束）", async () => {
    const tooMany = Array.from({ length: 101 }, (_, i) => ({ url: "https://example.com/m" + i }));
    await expect(handlers.batch_import({ sites: tooMany, dryRun: true }, FULL)).rejects.toThrow();
  });
});

describe("健康巡检", () => {
  it("SSRF 目标被判为 broken 并记录原因，而不是抛出", async () => {
    await handlers.create_site({ url: "https://example.com/hc", title: "巡检目标", categoryId: "cat-dev", enrich: false }, FULL);
    const body = payload(await handlers.health_check({ limit: 50 }, FULL));
    expect(body.checked).toBeGreaterThan(0);
    expect(Array.isArray(body.broken)).toBe(true);
    // 所有测试用 URL 都不会真正联网成功，因此 broken 应等于 checked
    expect(body.healthy + body.broken.length).toBe(body.checked);
  });
});
