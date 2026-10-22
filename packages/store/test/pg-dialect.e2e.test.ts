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
  // 拼音断言（zgtqw → 中国天气网）用；单独挂一个类目，避免影响后面的类目/标签计数断言
  const lifeId = "pg-e2e-life";
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

    // 拼音首字母用例需要在库里有标题可归一为 zgtqw 的站点（与 SQLite 套件同款断言）；
    // 之前这里没建该站点，导致 "zgtqw" 必然零命中——是测试夹具缺失，不是检索 bug。
    await ctx.repo.createCategory({ id: lifeId, title: "PG 方言生活类目" });
    await ctx.repo.createSite({ url: "https://weather.example.com/pg", title: "中国天气网", categoryId: lifeId });
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
    // 到点后可再次认领：把退避时间拨到过去模拟时间流逝（与 apps/api/test/jobs.test.ts 同做法）。
    // 注意不能用 completeJob(id, null)——那会把任务落成 done，当然再认领不到。
    await ctx!.db.pg!.query("UPDATE jobs SET next_run_at = $1 WHERE id = $2", [Date.now() - 1, id]);
    const again = await ctx!.repo.claimNextJob();
    expect(again?.id).toBe(id);
    expect(again!.attempts).toBe(2);
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

  /* -------------------- 用户域（N6 补齐：此前 PG 零覆盖） -------------------- */

  it("收藏：幂等写入 + 墓碑复活（ON CONFLICT DO NOTHING 与部分唯一索引）", async () => {
    const user = "pg-e2e-fav-user";
    const site = await ctx!.repo.createSite({ url: "https://example.com/pg-fav", title: "PG 收藏站", categoryId: catId });
    const first = await ctx!.repo.addFavorite({ userId: user, siteId: site.id });
    expect(first.existed).toBe(false);
    // 双写竞态：第二次必须是幂等 200，而不是撞唯一索引抛错
    const second = await ctx!.repo.addFavorite({ userId: user, siteId: site.id });
    expect(second.existed).toBe(true);
    expect((await ctx!.repo.listFavorites(user)).length).toBe(1);

    // 软删后再收藏 = 复活：墓碑必须被清掉，否则列表里看不到（SQLite 侧已修）
    expect(await ctx!.repo.removeFavorite(user, site.id)).toBe(true);
    expect((await ctx!.repo.listFavorites(user)).length).toBe(0);
    const revived = await ctx!.repo.addFavorite({ userId: user, siteId: site.id });
    expect(revived.existed).toBe(false);
    expect((await ctx!.repo.listFavorites(user)).length).toBe(1);
    await ctx!.repo.clearFavorites(user);
  });

  it("收藏：批量 ops 的 LWW 与墓碑传播（增量同步的服务端语义）", async () => {
    const user = "pg-e2e-sync-user";
    const site = await ctx!.repo.createSite({ url: "https://example.com/pg-sync", title: "PG 同步站", categoryId: catId });

    const added = await ctx!.repo.applyFavoriteOps(user, [{ op: "add", siteId: site.id, note: "来自批量", at: 1_000 }]);
    expect(added.applied).toBe(1);
    expect(added.version).toBeGreaterThanOrEqual(1_000);

    // at 不大于 updated_at → LWW 跳过（同一端的旧请求重放不能覆盖新状态）
    const stale = await ctx!.repo.applyFavoriteOps(user, [{ op: "add", siteId: site.id, note: "旧请求", at: 500 }]);
    expect(stale.applied).toBe(0);
    expect((await ctx!.repo.listFavorites(user))[0].note).toBe("来自批量");

    // remove 落墓碑，增量拉取必须能看到它（否则另一端永远不知道被删了）
    await ctx!.repo.applyFavoriteOps(user, [{ op: "remove", siteId: site.id, at: 2_000 }]);
    const since = await ctx!.repo.listFavoritesSince(user, 1_500);
    expect(since.items.length).toBe(1);
    expect(since.items[0].deletedAt).not.toBeNull();
    expect((await ctx!.repo.listFavorites(user)).length).toBe(0);
    await ctx!.repo.clearFavorites(user);
  });

  it("收藏列表：JOIN + LIKE 转义 + 分页在 PG 上等价", async () => {
    const user = "pg-e2e-list-user";
    const alpha = await ctx!.repo.createSite({ url: "https://alpha.example.com/pg", title: "Alpha 站", categoryId: catId });
    const beta = await ctx!.repo.createSite({ url: "https://beta.example.com/pg", title: "Beta 站", categoryId: catId });
    await ctx!.repo.addFavorite({ userId: user, siteId: alpha.id, note: "100% 命中" });
    await ctx!.repo.addFavorite({ userId: user, siteId: beta.id });

    const page = await ctx!.repo.listFavoritesPage(user, { limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(true);
    const second = await ctx!.repo.listFavoritesPage(user, { limit: 1, offset: 1 });
    expect(second.hasMore).toBe(false);

    // 标题检索走 LEFT JOIN sites
    expect((await ctx!.repo.listFavoritesPage(user, { q: "Alpha" })).total).toBe(1);
    // 备注检索 + `%` 必须当字面量：alpha 的备注含 "100%"，所以 q="%" 只命中它一条，
    // 而不是把两条都当通配符匹配；q="_" 没有任何字面量下划线，应为 0。
    expect((await ctx!.repo.listFavoritesPage(user, { q: "100%" })).total).toBe(1);
    expect((await ctx!.repo.listFavoritesPage(user, { q: "%" })).total).toBe(1);
    expect((await ctx!.repo.listFavoritesPage(user, { q: "_" })).total).toBe(0);
    // 标题排序：LOWER(COALESCE(...)) 是双方言表达式
    const sorted = await ctx!.repo.listFavoritesPage(user, { sort: "title", limit: 50 });
    expect(sorted.items.map((f) => f.siteId)).toEqual([alpha.id, beta.id]);
    await ctx!.repo.clearFavorites(user);
  });

  it("身份合并：收藏搬到目标身份，源身份不再有行", async () => {
    const source = "pg-e2e-merge-src";
    const target = "pg-e2e-merge-dst";
    const site = await ctx!.repo.createSite({ url: "https://example.com/pg-merge", title: "PG 合并站", categoryId: catId });
    await ctx!.repo.addFavorite({ userId: source, siteId: site.id });
    const result = await ctx!.repo.mergeIdentity(source, target);
    expect(result.favoritesMoved).toBe(1);
    expect((await ctx!.repo.listFavorites(target)).length).toBe(1);
    expect((await ctx!.repo.listFavorites(source)).length).toBe(0);
    // 解析别名：旧 id 的读写必须落到目标身份
    expect(await ctx!.repo.resolveIdentity(source)).toBe(target);
    await ctx!.repo.clearFavorites(target);
  });

  it("数据主权：设置水位读写 + 注销计数（PG 事务与布尔列）", async () => {
    const user = "pg-e2e-sovereign";
    const site = await ctx!.repo.createSite({ url: "https://example.com/pg-sovereign", title: "PG 主权站", categoryId: catId });
    await ctx!.repo.addFavorite({ userId: user, siteId: site.id });
    await ctx!.repo.updateUserSettings(user, { personalizationEnabled: false, favoriteSignalCutoff: 1_700_000_000_000 });
    const settings = await ctx!.repo.getUserSettings(user);
    expect(settings.personalizationEnabled).toBe(false);
    expect(settings.favoriteSignalCutoff).toBe(1_700_000_000_000);

    const counts = await ctx!.repo.deleteUserData(user);
    expect(counts.favorites).toBe(1);
    expect(counts.settings).toBe(1);
    expect((await ctx!.repo.listFavorites(user)).length).toBe(0);
    expect(await ctx!.repo.getUserSettings(user).then((s) => s.personalizationEnabled)).toBe(true);
  });

  it("专题条目按 item sort 聚合排序（PG 不允许 GROUP BY s.id + ORDER BY ci.sort）", async () => {
    const a = await ctx!.repo.createSite({ url: "https://example.com/pg-col-a", title: "专题条目甲", categoryId: lifeId });
    const b = await ctx!.repo.createSite({ url: "https://example.com/pg-col-b", title: "专题条目乙", categoryId: lifeId });
    await ctx!.repo.upsertCollection({ slug: "pg-e2e-col", title: "PG 专题", sites: [b.id, a.id] });
    // PG 上 ORDER BY ci.sort 会直接报错（列必须出现在 GROUP BY 或聚合里），
    // SQLite 宽松放行——回归护栏：双方言都必须按 sort 返回。
    const sites = await ctx!.repo.listCollectionSites("pg-e2e-col");
    expect(sites.map((s) => s.id)).toEqual([b.id, a.id]);
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
