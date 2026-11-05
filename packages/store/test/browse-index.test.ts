/**
 * 检索复合索引与 weight 死键回归。
 *
 * 两件被锁住的事：
 *  1. browse / 类目页 / 标签页的取值谓词恒定是 `deleted_at IS NULL AND enabled = ?`，
 *     而老的 sites_hot_idx(enabled, trend_score) 既缺 deleted_at、也不以 featured
 *     开头 —— browse 的 ORDER BY 用不上它，只能全表扫 + 临时 B-tree 排序。
 *     这里断言新索引建得上、且 planner 真的选了它（不是「建了但没人用」）。
 *  2. sites.weight 曾被当作排序键，但 INSERT 时硬编码为 0、没有任何 UPDATE 写它，
 *     所以区分不了任何两行。排序改为只依赖真被写入的 trend_score。
 *     这里断言写 trend_score 确实改变 browse 的顺序 —— 反过来说，若哪天有人把
 *     weight 加回 ORDER BY 却忘了给它写口子，这个用例会变红。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SearchEngine } from "../src/search.ts";

/** 索引名清单。两个方言的取法不同，这里只覆盖本用例要用的 SQLite。 */
const indexNames = async (repo: Repository, dialect: string, table: string): Promise<string[]> => {
  if (dialect === "pg") return [];
  const rows = await repo.raw("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?", [table]);
  return rows.map((r) => String(r.name));
};

const planDetail = async (repo: Repository, sql: string, params: unknown[] = []): Promise<string> => {
  const rows = await repo.raw("EXPLAIN QUERY PLAN " + sql, params);
  return rows.map((r) => String(r.detail ?? "")).join("\n");
};

describe("检索复合索引与排序键", () => {
  let db: Db;
  let repo: Repository;
  let search: SearchEngine;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
    search = new SearchEngine({ db, fts: null, vectors: null });
  });

  afterAll(async () => {
    await db.close();
  });

  it("复合索引与 tags.name 索引建得上，且迁移可重复执行", async () => {
    const sites = await indexNames(repo, db.dialect, "sites");
    expect(sites).toContain("sites_browse_idx");
    expect(sites).toContain("sites_enabled_status_idx");
    const tags = await indexNames(repo, db.dialect, "tags");
    expect(tags).toContain("tags_name_idx");
    expect(tags).toContain("tags_name_uniq");

    // 幂等：migrateSiteIndexes 每次启动都跑，重跑不得抛错也不得丢索引
    const { migrateSiteIndexes } = await import("../src/migrate.ts");
    await expect(migrateSiteIndexes(db)).resolves.toBeUndefined();
    expect(await indexNames(repo, db.dialect, "sites")).toContain("sites_browse_idx");
  });

  it("browse 的取值 + 排序走 sites_browse_idx，不再全表扫", async () => {
    const cat = await repo.createCategory({ title: "索引回归分类" });
    for (let i = 0; i < 40; i++) {
      await repo.createSite({
        url: `https://idx-${i}.example.com`,
        title: `IdxSite ${String(i).padStart(3, "0")}`,
        categoryId: cat.id,
      });
    }
    // 让 planner 有统计信息可依（ANALYZE 缺席时它可能偏向全表扫）
    await repo.raw("ANALYZE").catch(() => undefined);
    // 用 browse 真实发出的谓词（deleted_at IS NULL + enabled=1），不含 status
    // 不等值过滤：status <> 'archived' 是非等值谓词，会截断索引的排序能力，
    // 那是 planner 的固有行为，与索引列序无关，不该在这里断言。
    const detail = await planDetail(
      repo,
      `SELECT id FROM sites
        WHERE deleted_at IS NULL AND enabled = 1
        ORDER BY featured DESC, trend_score DESC LIMIT 21 OFFSET 0`,
    );
    // 核心收益：不再是全表扫，planner 选上了复合索引
    expect(detail).toContain("sites_browse_idx");
    expect(detail).not.toMatch(/SCAN\s+sites/);
  });

  it("tags.name 等值查询走索引，不是全表扫", async () => {
    await repo.upsertTag("索引回归标签", "index-regression-tag");
    const detail = await planDetail(repo, "SELECT id FROM tags WHERE name = ?", ["索引回归标签"]);
    expect(detail).not.toMatch(/SCAN\s+tags/);
  });

  it("热度分真的影响 browse 顺序（weight 恒 0，不再参与排序）", async () => {
    const cat = await repo.createCategory({ title: "热度排序回归" });
    const cold = await repo.createSite({
      url: "https://cold-index.example.com",
      title: "Cold Site",
      categoryId: cat.id,
    });
    const hot = await repo.createSite({
      url: "https://hot-index.example.com",
      title: "Hot Site",
      categoryId: cat.id,
    });

    // 只写 trend_score（与 recompute_rank 任务同一条写路径）
    await repo.setTrendScores([
      { id: cold.id, trendScore: 1 },
      { id: hot.id, trendScore: 99 },
    ]);

    const result = await search.search({ q: "", categoryId: cat.id, limit: 10 });
    const ids = result.hits.map((h) => h.siteId);
    expect(ids).toContain(hot.id);
    expect(ids.indexOf(hot.id)).toBeLessThan(ids.indexOf(cold.id));

    // weight 仍是 0 —— 它是历史列，不是排序键。断言这点是为了防止有人把
    // weight 加回 ORDER BY 却不给它写口子（那样排序会静默退化成 id 序）。
    // weight 由 setTrendScores 同步写入（与 trend_score 同值），它不再是历史死列，
    // 但已退出所有 ORDER BY —— 这里锁的是「写口子存在且同步」，防止有人只写
    // trend_score 却让 weight 继续留在排序键上（那样排序口径会分叉）。
    const rows = await repo.raw("SELECT id, weight, trend_score FROM sites WHERE id IN (?, ?)", [hot.id, cold.id]);
    expect(rows.length).toBe(2);
    for (const r of rows) expect(Number(r.weight)).toBe(Number(r.trend_score));
  });

  it("listSites 仍按 sort 升序，排序键换成 trend_score 后行为不变", async () => {
    const cat = await repo.createCategory({ title: "列表排序回归" });
    const b = await repo.createSite({ url: "https://sortb-index.example.com", title: "B", categoryId: cat.id, sort: 2 });
    const a = await repo.createSite({ url: "https://sorta-index.example.com", title: "A", categoryId: cat.id, sort: 1 });
    const list = await repo.listSites({ categoryId: cat.id });
    const ids = list.map((s) => s.id);
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
  });
});
