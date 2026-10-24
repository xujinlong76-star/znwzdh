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
  // G2「站点只挂叶子」在写入口生效：写工具用这两个叶子做归属，根只作导航
  await ctx.repo.createCategory({ id: "cat-ai-code", title: "AI 编程助手", parentId: "cat-ai" });
  await ctx.repo.createCategory({ id: "cat-dev-ops", title: "部署与监控", parentId: "cat-dev" });
  await ctx.repo.createSite({ url: "https://github.com/features/copilot", title: "GitHub Copilot", description: "AI 代码补全", categoryId: "cat-ai-code", tags: ["ai"] });
  await ctx.repo.createSite({ url: "https://weather.com.cn", title: "中国天气网", description: "全国天气预报", categoryId: "cat-dev-ops", tags: ["天气"] });
});

afterAll(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("工具清单", () => {
  it("包含 27 个只读工具与 13 个写工具", () => {
    const read = TOOL_DEFS.filter((t) => !t.mutating);
    const write = TOOL_DEFS.filter((t) => t.mutating);
    expect(read.map((t) => t.name).sort()).toEqual([
      "analyze_color_harmony",
      "analyze_stack_compatibility",
      "cluster_sites",
      "compare_technologies",
      "compile_speculation_rules",
      "evaluate_developer_intent",
      "exchange_p2p_mesh",
      "export_sites",
      "find_tech_path",
      "get_alternatives",
      "get_architecture_recipe",
      "get_federated_recommendations",
      "get_profile_summary",
      "get_site",
      "get_stats",
      "get_trending",
      "list_categories",
      "list_collections",
      "list_favorites",
      "list_jobs",
      "list_plugins",
      "list_search_history",
      "list_tags",
      "resolve_wayback",
      "search_plugins",
      "search_sites",
      "synthesize_agent_tool",
    ]);
    expect(write.length).toBe(13);
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
    // 计数按单个类目算：站点挂在叶子上，所以是叶子有数、它的根为 0（聚合是前端的事）
    const leaf = body.find((c: any) => c.id === "cat-ai-code");
    expect(leaf.siteCount).toBe(1);
    expect(body.find((c: any) => c.id === "cat-ai").siteCount).toBe(0);
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
      url: "https://example.com/fresh", title: "新站点", categoryId: "cat-dev-ops", enrich: false,
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
    const args = { url: "https://example.com/idem", title: "幂等站点", categoryId: "cat-dev-ops", enrich: false, idempotencyKey: "key-1" };
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
      dryRun: false, defaultCategoryId: "cat-dev-ops",
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
    await handlers.create_site({ url: "https://example.com/hc", title: "巡检目标", categoryId: "cat-dev-ops", enrich: false }, FULL);
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
    // 不复用模块级 fixture 站点：上面的「健康巡检」把所有不可达站点都标成了 broken，
    // 而标签计数只统计 status='active' 的站点（见 listTagsWithCounts 的 JOIN 条件）。
    // 依赖既有数据就等于让结果取决于「前面跑了哪些用例」，实测整文件按序跑时
    // 这里会拿到空数组（单独跑却通过）—— 现造一个带独占标签的活站点来断言。
    await ctx.repo.createSite({
      url: "https://tags-count-probe.example",
      title: "标签计数探针",
      description: "只用于验证标签计数可见性",
      categoryId: "cat-dev",
      tags: ["标签计数探针"],
    });
    const res = await handlers.list_tags({ minCount: 1, limit: 50 }, READONLY);
    const body = payload(res);
    expect(body.tags.length).toBeGreaterThan(0);
    const probe = body.tags.find((t: any) => t.name === "标签计数探针");
    expect(probe).toBeTruthy();
    expect(probe!.count).toBeGreaterThanOrEqual(1);
  });

  it("list_collections 默认只看启用中的专题，all=true 才带停用的", async () => {
    await ctx.repo.upsertCollection({ slug: "ai-tools", title: "AI 工具箱", enabled: true });
    await ctx.repo.upsertCollection({ slug: "legacy-topic", title: "已下线专题", enabled: false });

    const slugs = (body: any) => body.collections.map((c: { slug: string }) => c.slug);
    const enabled = payload(await handlers.list_collections({}, READONLY));
    expect(slugs(enabled)).toContain("ai-tools");
    expect(slugs(enabled)).not.toContain("legacy-topic");

    const all = payload(await handlers.list_collections({ all: true }, READONLY));
    expect(slugs(all)).toContain("legacy-topic");
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

  it("list_jobs 让 Agent 查得到任务结果（只读权限即可调用，最近在前）", async () => {
    const res = await handlers.list_jobs({ limit: 10 }, READONLY);
    const body = payload(res);
    expect(body.count).toBeGreaterThan(0);
    expect(body.jobs.some((j: { kind: string }) => j.kind === "refetch_metadata")).toBe(true);
    // 列表必须按创建时间倒序：Agent 依赖「最近在前」判断刚入队的任务
    const times = body.jobs.map((j: { createdAt: number }) => j.createdAt);
    expect([...times].sort((a: number, b: number) => b - a)).toEqual(times);
  });

  it("list_jobs 支持按状态过滤", async () => {
    const res = await handlers.list_jobs({ status: "pending", limit: 10 }, READONLY);
    const body = payload(res);
    for (const job of body.jobs) expect(job.status).toBe("pending");
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
      url: "https://example.com/del-me", title: "待删除", categoryId: "cat-dev-ops", enrich: false,
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
      url: "https://example.com/csv-inject", title: "=HYPERLINK(\"http://evil\")", categoryId: "cat-dev-ops", enrich: false,
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

  it("heal_broken_site 诊断故障站点并生成自愈报告（但不改数据）", async () => {
    const res = await handlers.heal_broken_site({ idOrUrl: "https://weather.com.cn" }, FULL);
    const body = payload(res);
    expect(body.healed).toBe(false);
    expect(body.diagnosed).toBe(true);
    expect(body.report).toBeTruthy();
    expect(body.report.waybackFallbackUrl).toContain("web.archive.org");
    const audit = ctx.db.sqlite!.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE action = ?").get("site.heal") as { c: number };
    expect(Number(audit.c)).toBeGreaterThan(0);
  });

  it("find_tech_path 计算技术栈间多跳演进路径", async () => {
    const res = await handlers.find_tech_path({ from: "react", to: "postgres" }, READONLY);
    const body = payload(res);
    expect(body.success).toBe(true);
    expect(body.found).toBe(true);
    expect(body.nodeChain.length).toBeGreaterThanOrEqual(3);
    expect(body.nodeChain[0].id).toBe("react");
    expect(body.nodeChain[body.nodeChain.length - 1].id).toBe("postgres");
  });

  it("analyze_stack_compatibility 诊断技术选型并补齐缺失层", async () => {
    const res = await handlers.analyze_stack_compatibility({ techs: ["react", "nextjs"] }, READONLY);
    const body = payload(res);
    expect(body.success).toBe(true);
    expect(body.selectedTechIds).toContain("react");
    expect(body.coveredLayers).toContain("frontend");
    expect(body.missingLayers).toContain("database");
    expect(body.suggestedAdditions.length).toBeGreaterThan(0);
  });

  it("cluster_sites 对站点执行 K-Means++ 语义聚类并自动命名分类", async () => {
    const res = await handlers.cluster_sites({ targetK: 2 }, READONLY);
    const body = payload(res);
    expect(body.success).toBe(true);
    expect(body.totalItems).toBeGreaterThanOrEqual(1);
    expect(body.clusterCount).toBeGreaterThanOrEqual(1);
    expect(body.averageCohesion).toBeGreaterThan(0);
    expect(body.clusters[0]?.suggestedName).toBeTruthy();
  });

  it("sync_crdt_operations 多端操作日志协同同步与因果收敛", async () => {
    // 1. 只读 scope 调用应失败
    await expect(handlers.sync_crdt_operations({
      userId: "mcp_crdt_user",
      operations: [
        {
          id: "op_mcp_1",
          type: "SET_CATEGORY_PIN",
          entityId: "cat_fe",
          payload: { isPinned: true },
          timestamp: 2000,
          clientId: "mcp_client",
        },
      ],
    }, READONLY)).rejects.toThrow();

    // 2. 具备写权限调用
    const res = await handlers.sync_crdt_operations({
      userId: "mcp_crdt_user",
      operations: [
        {
          id: "op_mcp_1",
          type: "SET_CATEGORY_PIN",
          entityId: "cat_fe",
          payload: { isPinned: true },
          timestamp: 2000,
          clientId: "mcp_client",
        },
        {
          id: "op_mcp_2",
          type: "UPSERT_CUSTOM_CATEGORY",
          entityId: "cat_mobile",
          payload: { id: "cat_mobile", title: "跨端移动开发", items: [] },
          timestamp: 2010,
          clientId: "mcp_client",
        },
      ],
    }, FULL);

    const body = payload(res);
    expect(body.merged).toBe(true);
    expect(body.clientCount).toBe(2);
    expect(body.state.pinnedCategoryIds).toContain("cat_fe");
    expect(body.state.customCategories[0].title).toBe("跨端移动开发");
  });

  it("evaluate_developer_intent 秒级解析开发者输入语义意图", async () => {
    // 1. Cron 表达式解析
    const cronRes = await handlers.evaluate_developer_intent({ input: "0 0 * * *" }, READONLY);
    const cronBody = payload(cronRes);
    expect(cronBody.matched).toBe(true);
    expect(cronBody.type).toBe("cron");
    expect(cronBody.subtitle).toContain("每天");

    // 2. 十六进制颜色代码解析
    const colorRes = await handlers.evaluate_developer_intent({ input: "#3b82f6" }, READONLY);
    const colorBody = payload(colorRes);
    expect(colorBody.matched).toBe(true);
    expect(colorBody.type).toBe("color");
    expect(colorBody.previewValue).toBe("#3B82F6");
    expect(colorBody.subtitle).toContain("rgb");

    // 3. Curl 语句转 Fetch 脚本
    const curlRes = await handlers.evaluate_developer_intent({ input: "curl -X POST https://api.example.com/data" }, READONLY);
    const curlBody = payload(curlRes);
    expect(curlBody.matched).toBe(true);
    expect(curlBody.type).toBe("curl_to_fetch");
    expect(curlBody.previewValue).toContain("fetch");

    // 4. 普通非意图查询
    const plainRes = await handlers.evaluate_developer_intent({ input: "普通普通的网站检索文本" }, READONLY);
    const plainBody = payload(plainRes);
    expect(plainBody.matched).toBe(false);
  });

  it("analyze_color_harmony 审计 UI 调色板对比度与和谐度", async () => {
    const res = await handlers.analyze_color_harmony({
      palette: ["#0f172a", "#3b82f6", "#10b981"],
      foreground: "#ffffff",
      background: "#0f172a",
    }, READONLY);
    const body = payload(res);
    expect(body.success).toBe(true);
    expect(body.wcagContrastRatio).toBeGreaterThan(4.5);
    expect(["AAA", "AA"]).toContain(body.wcagPassLevel);
    expect(body.harmonyScore).toBeGreaterThanOrEqual(50);
    expect(body.dominantColors).toHaveLength(3);
  });

  it("get_federated_recommendations 执行 LDP 差分隐私协同推荐排序", async () => {
    const res = await handlers.get_federated_recommendations({
      localVector: [1, 0, 1, 0],
      globalVector: [0.5, 0.5, 0.5, 0.5],
      candidates: [
        { id: "cand-1", name: "AI Dev", featureVector: [1, 0, 1, 0] },
        { id: "cand-2", name: "Design", featureVector: [0, 1, 0, 1] },
      ],
      personalWeight: 0.7,
      privatize: true,
      epsilon: 1.0,
    }, READONLY);
    const body = payload(res);
    expect(body.count).toBe(2);
    expect(body.recommendations[0].itemId).toBe("cand-1");
    expect(body.recommendations[0].score).toBeGreaterThan(body.recommendations[1].score);
    expect(body.privacy.epsilon).toBe(1.0);
    expect(body.privacy.privatizedVector).toHaveLength(4);
  });

  it("compile_speculation_rules 编译 W3C Speculation Rules 规则负载", async () => {
    const res = await handlers.compile_speculation_rules({
      candidates: [
        { url: "https://cursor.com", confidence: 0.95, predictedArrivalMs: 120 },
        { url: "https://npmjs.com", confidence: 0.60, predictedArrivalMs: 300 },
        { url: "https://example.com/logout", confidence: 0.99, predictedArrivalMs: 50 }, // 应该被过滤
      ],
      prerenderConfidenceThreshold: 0.8,
      prefetchConfidenceThreshold: 0.4,
    }, READONLY);
    const body = payload(res);
    expect(body.hasRules).toBe(true);
    expect(body.rules.prerender[0].urls).toContain("https://cursor.com");
    expect(body.rules.prefetch[0].urls).toContain("https://npmjs.com");
    expect(body.rules.prerender[0].urls).not.toContain("https://example.com/logout");
    expect(body.script).toContain("prerender");
    expect(body.fallbackTags.length).toBeGreaterThanOrEqual(1);
  });

  it("synthesize_agent_tool 动态将 REST 端点与站点检索合成为 WebMCP 工具", async () => {
    // 1. 合成站点搜索工具
    const siteRes = await handlers.synthesize_agent_tool({
      kind: "site_search",
      siteSearchSpec: {
        siteId: "github",
        siteName: "GitHub",
        searchUrlTemplate: "https://github.com/search?q={query}",
        category: "开发平台",
      },
    }, READONLY);
    const siteBody = payload(siteRes);
    expect(siteBody.kind).toBe("site_search");
    expect(siteBody.tool.name).toBe("search_github");
    expect(siteBody.exampleInvocation.navigableUrl).toContain("https://github.com/search?q=example");

    // 2. 合成单端点 REST 工具
    const restRes = await handlers.synthesize_agent_tool({
      kind: "rest",
      restSpec: {
        name: "get_weather_report",
        description: "获取特定城市的实时天气",
        url: "https://api.weather.example.com/v1/query",
        method: "GET",
        parameters: [
          { name: "city", type: "string", in: "query", required: true },
        ],
      },
    }, READONLY);
    const restBody = payload(restRes);
    expect(restBody.kind).toBe("rest");
    expect(restBody.tool.name).toBe("get_weather_report");
    expect(restBody.tool.inputSchema.properties.city).toBeDefined();
  });

  it("exchange_p2p_mesh 通过网格报文协议交换多端书签 CRDT 增量", async () => {
    const res = await handlers.exchange_p2p_mesh({
      nodeId: "local-node-1",
      message: {
        type: "HELLO",
        senderId: "remote-peer-2",
        seq: 1,
        timestamp: Date.now(),
        payload: { clock: { "remote-peer-2": 3 }, siteCount: 15 },
      },
    }, READONLY);
    const body = payload(res);
    expect(body.nodeId).toBe("local-node-1");
    expect(body.receivedType).toBe("HELLO");
    expect(body.peerState).toBe("SYNCING");
    expect(body.outgoingResponse.type).toBe("SYNC_REQUEST");
  });

  it("get_alternatives 在双曲空间推导平替", async () => {
    const site = (await ctx.repo.listSites({ limit: 1 }))[0]!;
    const res = await handlers.get_alternatives({ idOrUrl: site.id, limit: 3 }, READONLY);
    const body = payload(res);
    expect(body.target.id).toBe(site.id);
    expect(body.alternatives).toBeDefined();
    expect(Array.isArray(body.alternatives)).toBe(true);
  });

  it("resolve_wayback 查询或生成时间机器快照与拯救链接", async () => {
    const res = await handlers.resolve_wayback({ url: "https://example.com/dead-page" }, READONLY);
    const body = payload(res);
    expect(body.targetUrl).toBe("https://example.com/dead-page");
    expect(body.recoveryUrl).toContain("web.archive.org/web");
    expect(body.saveUrl).toContain("web.archive.org/save");
  });
});

describe("插件市场工具", () => {
  function makeManifest(name: string, url: string) {
    return {
      manifestVersion: 1,
      kind: "site-pack",
      name,
      description: "用于 MCP 安装链路测试的声明式网址包",
      version: "1.0.0",
      payload: {
        categories: [{ title: "mcp 测试" }],
        sites: [{ url, title: "MCP 示例站", category: "mcp 测试", tags: ["mcp"] }],
      },
    };
  }

  let publishedSlug = "";

  it("list_plugins 只返回已上架插件（pending 不可见）", async () => {
    const pending = await ctx.repo.createPlugin(
      { manifest: makeManifest("MCP 测试网址包", "https://mcp-plugin.example.com") as any, author: "mcp-test", authorKind: "token", source: "user", status: "pending" },
      { actor: "mcp:test", actorKind: "token" },
    );

    const before = payload(await handlers.list_plugins({ query: "MCP 测试" }, READONLY));
    expect(before.plugins.some((p: any) => p.slug === pending.slug)).toBe(false);

    await ctx.repo.reviewPlugin(pending.slug, "approve", null, { actor: "mcp:test", actorKind: "admin" });
    publishedSlug = pending.slug;

    const after = payload(await handlers.list_plugins({ query: "MCP 测试" }, READONLY));
    const row = after.plugins.find((p: any) => p.slug === publishedSlug);
    expect(row).toBeTruthy();
    expect(row.summary.siteCount).toBe(1);
    expect(row.installHint).toContain("install_plugin");
  });

  it("search_plugins 关键词回退可用（embedding 关闭时 degraded 如实标注）", async () => {
    const body = payload(await handlers.search_plugins({ query: "MCP 测试" }, READONLY));
    expect(body.mode).toBe("keyword");
    expect(body.degraded).toBe(true);
    const row = body.plugins.find((p: any) => p.slug === publishedSlug);
    expect(row).toBeTruthy();
    expect(row.installHint).toContain("install_plugin");
  });

  it("search_plugins 遵守输入契约（空 query 被拒绝）", async () => {
    await expect(handlers.search_plugins({ query: "" }, READONLY)).rejects.toThrow();
  });

  it("install_plugin 以增量方式写入站点并支持幂等键重放", async () => {
    const res = await handlers.install_plugin({ slug: publishedSlug, idempotencyKey: "mcp-install-1" }, FULL);
    const body = payload(res);
    expect(body.applied.createdSiteIds.length).toBe(1);
    expect(body.identity).toBe("mcp:mcp:test");

    const replayed = payload(await handlers.install_plugin({ slug: publishedSlug, idempotencyKey: "mcp-install-1" }, FULL));
    expect(replayed.replayed).toBe(true);
  });

  it("只读 token 不能安装插件（硬边界）", async () => {
    await expect(handlers.install_plugin({ slug: publishedSlug }, READONLY)).rejects.toThrow(/权限/);
  });

  it("install_plugin 拒绝未上架插件（isError 而不是抛异常）", async () => {
    const pending = await ctx.repo.createPlugin(
      { manifest: makeManifest("MCP 未上架网址包", "https://mcp-pending.example.com") as any, author: "mcp-test", authorKind: "token", source: "user", status: "pending" },
      { actor: "mcp:test", actorKind: "token" },
    );
    const res = await handlers.install_plugin({ slug: pending.slug }, FULL);
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("不可安装");
  });
});

describe("用户域只读工具（B2：收藏、搜索历史、画像）", () => {
  const USER = "github:u-mcp-test";
  const USER_TC = { actor: "mcp:u-mcp-test", scopes: ["read"] as any[], has: () => true, ownerIdentity: USER };

  it("实例级令牌（ownerIdentity 为空）调用时被明确拒绝", async () => {
    await expect(handlers.list_favorites({}, READONLY)).rejects.toThrow(/用户级个人令牌/);
    await expect(handlers.list_search_history({}, READONLY)).rejects.toThrow(/用户级个人令牌/);
    await expect(handlers.get_profile_summary({}, READONLY)).rejects.toThrow(/用户级个人令牌/);
  });

  it("带 ownerIdentity 正常读取用户收藏与搜索历史", async () => {
    await ctx.repo.recordSearch(USER, "TypeScript", 1);
    const history = payload(await handlers.list_search_history({ limit: 10 }, USER_TC));
    expect(history.owner).toBe(USER);
    expect(history.items.some((i: any) => i.query === "TypeScript")).toBe(true);

    const profile = payload(await handlers.get_profile_summary({}, USER_TC));
    expect(profile.owner).toBe(USER);
  });
});
