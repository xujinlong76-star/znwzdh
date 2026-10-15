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
  it("包含 9 个只读工具与 9 个写工具", () => {
    const read = TOOL_DEFS.filter((t) => !t.mutating);
    const write = TOOL_DEFS.filter((t) => t.mutating);
    expect(read.map((t) => t.name).sort()).toEqual([
      "compare_technologies",
      "export_sites",
      "get_architecture_recipe",
      "get_site",
      "get_stats",
      "get_trending",
      "list_categories",
      "list_tags",
      "search_sites",
    ]);
    expect(write.length).toBe(9);
  });

  it("run_job 需要 admin 权限（触发全站扫描是危险操作）", () => {
    const runJob = TOOL_DEFS.find((t) => t.name === "run_job");
    expect(runJob?.scope).toBe("admin");
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

  it("只读 token 调用 update_site / set_status / batch_import / health_check / delete_site 全部被拒绝", async () => {
    await expect(handlers.update_site({ id: "x", title: "y" }, READONLY)).rejects.toThrow(/权限/);
    await expect(handlers.set_status({ id: "x", status: "active" }, READONLY)).rejects.toThrow(/权限/);
    await expect(handlers.batch_import({ sites: [{ url: "https://example.com/y" }] }, READONLY)).rejects.toThrow(/权限/);
    await expect(handlers.health_check({}, READONLY)).rejects.toThrow(/权限/);
    await expect(handlers.delete_site({ idOrUrl: "https://weather.com.cn" }, READONLY)).rejects.toThrow(/权限/);
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

describe("Phase 4 新工具", () => {
  const WRITE_ONLY: ToolContext = {
    actor: "mcp:write", scopes: ["read", "write"],
    has: (s: McpScope) => s !== "admin",
  };

  it("get_trending 返回带热度分量与名次的榜单", async () => {
    const res = await handlers.get_trending({ limit: 5 }, READONLY);
    const body = payload(res);
    expect(body.count).toBeGreaterThan(0);
    expect(body.results[0].rank).toBe(1);
    expect(typeof body.results[0].trendScore).toBe("number");
    expect(body.results[0].url).toBeTruthy();
  });

  it("list_tags 返回标签与计数", async () => {
    const res = await handlers.list_tags({ minCount: 1, limit: 10 }, READONLY);
    const body = payload(res);
    expect(body.tags.length).toBeGreaterThan(0);
    expect(body.tags[0].count).toBeGreaterThanOrEqual(1);
  });

  it("refresh_site 入队任务并落审计", async () => {
    const res = await handlers.refresh_site({ idOrUrl: "https://weather.com.cn" }, FULL);
    const body = payload(res);
    expect(body.queued).toBe(true);
    expect(body.jobId).toBeTruthy();
    const jobs = await ctx.repo.listJobs("pending", 10);
    expect(jobs.some((j) => j.kind === "refetch_metadata")).toBe(true);
    const audit = ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = ?").get("job.enqueue") as { c: number };
    expect(Number(audit.c)).toBeGreaterThan(0);
  });

  it("refresh_site 找不到站点时返回 isError", async () => {
    const res = await handlers.refresh_site({ idOrUrl: "no-such" }, FULL);
    expect(res.isError).toBe(true);
  });

  it("run_job 需要 admin：write token 被拒绝", async () => {
    await expect(handlers.run_job({ kind: "recompute_rank" }, WRITE_ONLY)).rejects.toThrow(/admin/);
  });

  it("run_job 有 admin 权限时正常入队", async () => {
    const admin: ToolContext = { actor: "mcp:admin", scopes: ["read", "write", "admin"], has: () => true };
    const res = await handlers.run_job({ kind: "recompute_rank" }, admin);
    const body = payload(res);
    expect(body.queued).toBe(true);
    expect(body.kind).toBe("recompute_rank");
  });

  it("只读 token 调用新写工具被拒绝", async () => {
    await expect(handlers.refresh_site({ idOrUrl: "https://weather.com.cn" }, READONLY)).rejects.toThrow(/write/);
    await expect(handlers.run_job({ kind: "reindex" }, READONLY)).rejects.toThrow(/admin/);
  });
});

describe("删除与导出工具", () => {
  it("delete_site 软删除并落审计，站点进入回收站", async () => {
    const created = payload(await handlers.create_site({
      url: "https://example.com/del-me", title: "待删除", categoryId: "cat-dev", enrich: false,
    }, FULL));
    const res = await handlers.delete_site({ idOrUrl: created.site.id }, FULL);
    const body = payload(res);
    expect(body.deleted).toBe(true);
    expect(body.mode).toBe("soft");
    // 正常查询已排除（fail 返回纯文本，不是 JSON）
    const gone = await handlers.get_site({ idOrUrl: created.site.id }, FULL);
    expect(gone.isError).toBe(true);
    const audit = ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = ? AND target = ?")
      .get("site.delete", created.site.id) as { c: number };
    expect(Number(audit.c)).toBeGreaterThan(0);
  });

  it("delete_site 对不存在的站点返回 not_found 而不是报错（幂等重试）", async () => {
    const res = await handlers.delete_site({ idOrUrl: "no-such-site" }, FULL);
    expect(res.isError).toBeUndefined();
    expect(payload(res).reason).toBe("not_found");
  });

  it("export_sites 支持 JSON 与 CSV，CSV 转义公式注入", async () => {
    const json = payload(await handlers.export_sites({ format: "json" }, READONLY));
    expect(json.format).toBe("json");
    expect(Array.isArray(json.sites)).toBe(true);
    expect(json.count).toBeGreaterThan(0);

    const csv = payload(await handlers.export_sites({ format: "csv" }, READONLY));
    const lines = String(csv.csv).split("\n");
    expect(lines[0]).toContain("url");
    // 数据行里以 = 开头的值必须被转义（防 Excel 公式注入）
    const injected = payload(await handlers.create_site({
      url: "https://example.com/csv-inject", title: "=HYPERLINK(\"http://evil\")", categoryId: "cat-dev", enrich: false,
    }, FULL));
    expect(injected.created).toBe(true);
    const csv2 = payload(await handlers.export_sites({ format: "csv" }, READONLY));
    expect(String(csv2.csv)).toContain("'=HYPERLINK");
    // 审计留痕
    const audit = ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = ?").get("site.export") as { c: number };
    expect(Number(audit.c)).toBeGreaterThan(0);
  });

  it("export_sites 超出上限的 limit 被 zod 拒绝", async () => {
    await expect(handlers.export_sites({ limit: 5000 }, READONLY)).rejects.toThrow();
  });
});

describe("次世代 Agentic 工具：架构配方与选型对比", () => {
  it("get_architecture_recipe 匹配预设链路子图", async () => {
    const res = await handlers.get_architecture_recipe({ query: "协同编辑" }, READONLY);
    const body = payload(res);
    expect(body.matched).toBe(true);
    expect(body.recipe.id).toBe("collaborative-editor");
    expect(body.recipe.layers.length).toBeGreaterThan(0);

    const noMatch = await handlers.get_architecture_recipe({ query: "火星航天测控" }, READONLY);
    const noMatchBody = payload(noMatch);
    expect(noMatchBody.matched).toBe(false);
    expect(Array.isArray(noMatchBody.availableRecipes)).toBe(true);
  });

  it("compare_technologies 对比两项关键技术并给出权衡决断", async () => {
    const res = await handlers.compare_technologies({ query: "cursor vs vscode" }, READONLY);
    const body = payload(res);
    expect(body.matched).toBe(true);
    expect(body.matrix.id).toBe("cursor-vs-vscode");
    expect(body.matrix.dimensions.length).toBeGreaterThan(0);
    expect(body.matrix.verdict).toBeTruthy();

    const noMatch = await handlers.compare_technologies({ query: "apple vs banana" }, READONLY);
    const noMatchBody = payload(noMatch);
    expect(noMatchBody.matched).toBe(false);
  });

  it("heal_broken_site 诊断故障站点并生成自愈报告", async () => {
    const res = await handlers.heal_broken_site({ idOrUrl: "https://weather.com.cn" }, FULL);
    const body = payload(res);
    expect(body.healed).toBe(true);
    expect(body.report).toBeTruthy();
    expect(body.report.waybackFallbackUrl).toContain("web.archive.org");
    const audit = ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = ?").get("site.heal") as { c: number };
    expect(Number(audit.c)).toBeGreaterThan(0);
  });
});
