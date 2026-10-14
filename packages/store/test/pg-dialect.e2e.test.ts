/**
 * 跨方言（PostgreSQL）一致性测试。
 *
 * 背景：SQLite 是默认且唯一有自动化覆盖的方言；`scripts/pg-check.mts` 是手工脚本，
 * 需要真实 PG 才能跑 —— 意味着 PG 侧的 SQL 回归（标签聚合 / 软删除部分索引 /
 * FTS tsvector / 参数占位符）只能靠人肉复跑，很容易在改 Repository 时静默回归。
 *
 * 本套件复跑与 SQLite 套件**同一批核心断言**，跑在真 PG 上：
 *  - 未设置 NAVHUB_TEST_DATABASE_URL（或连不上）→ 全套件 skip，不误伤普通 CI
 *  - 设置了 → 与 SQLite 结果必须**逐项一致**，不一致就是方言 bug
 *
 * 连接示例（CI 的 postgres service 或 docker compose）：
 *   set NAVHUB_TEST_DATABASE_URL=postgres://navhub:navhub@127.0.0.1:5432/navhub_test
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../../apps/api/src/config.ts";
import { createContext, type AppContext } from "../../../apps/api/src/context.ts";

const DATABASE_URL = process.env.NAVHUB_TEST_DATABASE_URL;

/** 跳过条件的可读说明（写进测试标题，失败时不看日志也知道为什么没跑） */
const skip = DATABASE_URL
  ? false
  : "未设置 NAVHUB_TEST_DATABASE_URL（需真实 PostgreSQL；CI 由 postgres service 注入）";

// 连不上时整体 skip 而不是红：仓库在没有 PG 的环境（默认开发机）也必须能跑绿
let ctx: AppContext | null = null;
let connectError: string | null = null;
try {
  if (DATABASE_URL) {
    ctx = await createContext(loadConfig({
      mode: "standard",
      databaseUrl: DATABASE_URL,
      // 该套件只验存储与检索，不碰 embedding / LLM
      embedding: { model: "x", endpoint: "https://hf-mirror.com", dtype: "q8", cacheDir: "./data/models", dim: 512, enabled: false },
      llm: { baseUrl: "https://api.deepseek.com", apiKey: null, model: "deepseek-chat", timeoutMs: 3000 },
      fetch: { timeoutMs: 2000, maxBytes: 262144, maxRedirects: 2, allowPrivateNetworks: false, userAgent: "NavHubPgTest/0.1" },
      corsOrigins: ["*"],
    }));
  }
} catch (err) {
  connectError = err instanceof Error ? err.message : String(err);
}

afterAll(async () => {
  await ctx?.close();
});

describe.skipIf(!ctx)("跨方言：PostgreSQL 核心行为与 SQLite 一致", () => {
  const catId = "pg-e2e-cat";
  const subId = "pg-e2e-sub";
  let siteId = "";

  beforeAll(async () => {
    if (!ctx) return;
    // 干净起点：清掉本套件上一轮可能留下的数据
    for (const sql of [
      "DELETE FROM site_tags", "DELETE FROM tags", "DELETE FROM sites", "DELETE FROM categories",
      "DELETE FROM audit_logs", "DELETE FROM events", "DELETE FROM health_checks", "DELETE FROM jobs",
      "DELETE FROM user_profiles",
    ]) await ctx.db.pg!.query(sql);

    const cat = await ctx.repo.createCategory({ id: catId, title: "PG 方言类目" });
    const sub = await ctx.repo.createCategory({ id: subId, title: "PG 方言子类", parentId: catId });
    expect(cat.anchor).toBeTruthy();
    // 物化路径：子类目锚点必须挂在父级下（曾有 PG 行为差异）
    expect(sub.anchor.startsWith(catId + "/")).toBe(true);
  });

  it("站点 + 中文标签写入与读回（group_concat vs string_agg 的聚合差异点）", async () => {
    const site = await ctx!.repo.createSite({
      url: "https://example.com/pg-dialect",
      title: "方言测试站",
      description: "用于验证 PG 与 SQLite 行为一致",
      categoryId: catId,
      tags: ["天气", "生活"],
    });
    siteId = site.id;
    expect(site.tags.sort()).toEqual(["天气", "生活"].sort());

    const found = await ctx!.repo.findSiteByUrl("https://example.com/pg-dialect");
    expect(found).not.toBeNull();
    expect(found!.tags.sort()).toEqual(["天气", "生活"].sort());
  });

  it("父类目过滤包含子类目（走 anchor LIKE，参数占位符 $1..$n 转换正确）", async () => {
    await ctx!.repo.createSite({ url: "https://example.com/pg-sub", title: "子类站点", categoryId: subId });
    const hits = await ctx!.search.search({ q: "", categoryId: catId, limit: 20 });
    expect(hits.hits.length).toBe(2);
  });

  it("检索：FTS（tsvector）/ 拼音 / 浏览模式可用", async () => {
    const fts = await ctx!.fts!.search("天气", 5);
    expect(fts.length).toBeGreaterThan(0);

    const py = await ctx!.search.search({ q: "zgtqw", limit: 5 });
    expect(py.hits.length).toBeGreaterThan(0);

    const browse = await ctx!.search.search({ q: "", limit: 10 });
    expect(browse.hits.length).toBeGreaterThan(0);
  });

  it("标签过滤（中文 slug）命中且不串（值参数化，非字符串拼接）", async () => {
    const hits = await ctx!.search.search({ q: "", tag: "天气", limit: 10 });
    expect(hits.hits.length).toBe(1);
  });

  it("软删除：正常查询排除、回收站可见、部分唯一索引允许同 URL 重加", async () => {
    await ctx!.repo.deleteSite(siteId);
    expect(await ctx!.repo.getSite(siteId)).toBeNull();
    expect(await ctx!.repo.findSiteByUrl("https://example.com/pg-dialect")).toBeNull();
    const trashed = await ctx!.repo.listDeletedSites(100);
    expect(trashed.some((s) => s.id === siteId)).toBe(true);

    // 部分唯一索引 WHERE deleted_at IS NULL：删后同 URL 立即可重加
    const reused = await ctx!.repo.createSite({
      url: "https://example.com/pg-dialect", title: "重加的同 URL", categoryId: catId,
    });
    expect(reused.id).not.toBe(siteId);
    expect((await ctx!.repo.getSite(reused.id))!.title).toBe("重加的同 URL");
    await ctx!.repo.purgeSite(reused.id);
  });

  it("标签删除解绑并刷新站点检索索引（PG 的 sites 更新触发 tsvector 同步）", async () => {
    const s = (await ctx!.repo.findSiteByUrl("https://example.com/pg-sub"))!;
    await ctx!.repo.setSiteTags(s.id, [...s.tags, "方言孤独特有"]);
    const tag = (await ctx!.repo.listTagsWithCounts()).find((t) => t.name === "方言孤独特有")!;
    expect(tag).toBeTruthy();

    const res = await ctx!.repo.deleteTag(tag.id);
    expect(res.unbound).toBeGreaterThanOrEqual(1);
    const after = (await ctx!.repo.getSite(s.id))!;
    expect(after.tags).not.toContain("方言孤独特有");
    // 索引同步：搜被删标签不再命中（fts_tokens 已重算）
    const hits = await ctx!.search.search({ q: "方言孤独特有", limit: 10 });
    expect(hits.hits.length).toBe(0);
  });

  it("巡检历史写入与读取（health_checks 双方言列类型）", async () => {
    const s = (await ctx!.repo.findSiteByUrl("https://example.com/pg-sub"))!;
    await ctx!.repo.updateSiteHealth(s.id, {
      httpStatus: 200, ok: true, latencyMs: 88, redirectTo: null, error: null, currentStatus: "active",
    });
    const series = await ctx!.repo.healthCheckSeries(Date.now() - 60_000);
    expect(series.length).toBeGreaterThanOrEqual(1);
    expect(series[0]!.ok).toBe(true);
    expect(series[0]!.latencyMs).toBe(88);
  });

  it("任务队列：认领 / 完成 / 退避到点判断（? 占位符 → $n）", async () => {
    const id = await ctx!.repo.enqueueJob("reindex", { vectors: false });
    const job = await ctx!.repo.claimNextJob();
    expect(job).not.toBeNull();
    expect(job!.id).toBe(id);
    expect(job!.attempts).toBe(1);
    expect(job!.nextRunAt).toBeNull();

    // 失败退避：回 pending 且到点前不被再次认领
    await ctx!.repo.completeJob(id, "测试失败", { retryAt: Date.now() + 3_600_000 });
    const pending = await ctx!.repo.claimNextJob();
    expect(pending === null || pending.id !== id).toBe(true);
    // 到点后可再次认领
    await ctx!.repo.completeJob(id, null);
    const again = await ctx!.repo.claimNextJob();
    expect(again?.id).toBe(id);
    await ctx!.repo.completeJob(again!.id, null);
  });

  it("审计与事件落库（BIGSERIAL 与 INTEGER 自增差异）", async () => {
    await ctx!.repo.audit({ actor: "pg-e2e", action: "pg.test", target: "x", ip: "127.0.0.1" });
    await ctx!.repo.recordEvent("search", { query: "方言" });
    const logs = await ctx!.repo.listAuditLogs({ action: "pg.test", limit: 10 });
    expect(logs.items.length).toBeGreaterThan(0);
    expect(logs.items[0]!.ip).toBe("127.0.0.1");
  });

  it("画像读写（JSON 列）roundtrip", async () => {
    await ctx!.repo.saveUserProfile("pg-e2e-user", {
      topCategories: [catId], topTags: ["天气"], visitedSiteIds: [siteId], favoriteSiteIds: [], searchCount: 3,
    });
    const profile = await ctx!.repo.getUserProfile("pg-e2e-user");
    expect(profile!.topCategories).toEqual([catId]);
    expect(profile!.searchCount).toBe(3);
    await ctx!.repo.deleteUserProfile("pg-e2e-user");
    expect(await ctx!.repo.getUserProfile("pg-e2e-user")).toBeNull();
  });
});

describe("连接前置条件", () => {
  it("未配置或连不上时明确说明（不是悄悄跳过）", () => {
    if (!DATABASE_URL) {
      // 保持 skip 语义：这条在未配置时记录原因，配置了但连不上时才失败
      expect(skip).toBeTruthy();
      console.warn("[pg-dialect] 跳过：未设置 NAVHUB_TEST_DATABASE_URL");
    } else {
      expect(connectError, "设置了 NAVHUB_TEST_DATABASE_URL 但连接失败：" + connectError).toBeNull();
      expect(ctx, "应成功创建 PG 上下文").not.toBeNull();
    }
  });
});
