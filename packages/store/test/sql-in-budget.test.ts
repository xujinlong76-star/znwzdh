/**
 * IN 列表参数预算与分面查询并发度（2026-10-21 深扫 · 性能/健壮性）。
 *
 * 锁三件事：
 *  1. 任何一条语句绑定的 IN 参数个数必须**有上限**。参数上限是语句级的
 *     （SQLite 老构建 999，PG 65535），超限直接抛错 → 500；而分面交集的 id 数
 *     由数据量决定（一个热门分面值能覆盖上千站点）。
 *  2. 拆片之后结果仍然正确：分页必须等价于「对全量候选按同一 ORDER BY 排序再切片」，
 *     而不是「第一片的前 N 条」。
 *  3. `filterSiteIdsByFacets` 的多个分面条件必须并发查，而不是串行 await
 *     ——串行时「条件数」直接等于「网络往返数」，在 PG 上是纯粹的延迟放大。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SQL_IN_CHUNK } from "../src/sql-in.ts";

let db: Db;
let repo: Repository;

/** 记录每次 raw() 的参数个数，以及「同时在飞」的查询数 */
function instrument(target: Repository) {
  const original = target.raw.bind(target);
  const calls: number[] = [];
  let active = 0;
  let maxActive = 0;
  (target as { raw: unknown }).raw = async (sqlText: string, params: unknown[] = []) => {
    calls.push(params.length);
    active++;
    maxActive = Math.max(maxActive, active);
    // 让出事件循环：串行实现永远只有 1 个在飞，并发实现会同时看到多个
    await Promise.resolve();
    try {
      return await original(sqlText, params);
    } finally {
      active--;
    }
  };
  return {
    calls,
    maxParams: () => (calls.length > 0 ? Math.max(...calls) : 0),
    maxActive: () => maxActive,
    restore: () => ((target as { raw: unknown }).raw = original),
  };
}

beforeAll(async () => {
  db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  repo = new Repository(db);
});

afterAll(async () => {
  await db.close();
});

describe("IN 列表参数预算", () => {
  it("分面交集超过一片时：单条语句不超预算，且分页等价于全量排序后切片", async () => {
    const cat = await repo.createCategory({ title: "分面大片测试" });
    const total = SQL_IN_CHUNK + 100; // 刚好跨过一片，逼出多语句路径
    // sort 打散：id 序与 sort 序不同向，只有真正跨片归并才能取到全局前 N 条
    const planned = Array.from({ length: total }, (_, i) => ({
      id: `bulk-${String(i).padStart(5, "0")}`,
      sort: (i * 7919) % total,
    }));
    for (const p of planned) {
      await repo.createSiteWithId({
        id: p.id,
        url: `https://bulk-${p.id}.example.com`,
        title: `大片站点 ${p.id}`,
        categoryId: cat.id,
        sort: p.sort,
        facets: { pricing: ["bulk"] },
      });
    }

    const probe = instrument(repo);
    try {
      const page = await repo.listSites({ facets: { pricing: ["bulk"] }, limit: 50 });
      expect(page.map((s) => s.id)).toEqual(
        [...planned].sort((a, b) => a.sort - b.sort).slice(0, 50).map((p) => p.id)
      );
      // 一条语句最多 = 一片 id + 基础条件 + LIMIT/OFFSET
      expect(probe.maxParams()).toBeLessThanOrEqual(SQL_IN_CHUNK + 3);
      // 确实走了多语句（候选被切成 ≥2 片）
      expect(probe.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      probe.restore();
    }
  }, 120_000);

  it("单个分面键的值个数超预算时自动分片，而不是拼出一条超限语句", async () => {
    const cat = await repo.createCategory({ title: "值预算测试" });
    await repo.createSite({
      url: "https://value-budget.example.com",
      title: "值预算站点",
      categoryId: cat.id,
      facets: { pricing: ["free"] },
    });

    const probe = instrument(repo);
    try {
      const many = Array.from({ length: SQL_IN_CHUNK * 2 + 1 }, (_, i) => `value-${i}`);
      many.push(" FREE "); // 归一（trim + 小写）后必须仍命中
      const ids = await repo.filterSiteIdsByFacets({ pricing: many });
      expect(ids.length).toBe(1);
      // 一条语句 = 一片值 + facet_key
      expect(probe.maxParams()).toBeLessThanOrEqual(SQL_IN_CHUNK + 1);
      expect(probe.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      probe.restore();
    }
  });

  it("多个分面条件并发查询（条件数不再等于往返数）", async () => {
    const cat = await repo.createCategory({ title: "并发测试" });
    await repo.createSite({
      url: "https://concurrent-a.example.com",
      title: "并发站点",
      categoryId: cat.id,
      facets: { pricing: ["free"], platform: ["web"], scene: ["dev"] },
    });

    const probe = instrument(repo);
    try {
      const ids = await repo.filterSiteIdsByFacets({
        pricing: ["free"],
        platform: ["web"],
        scene: ["dev"],
      });
      expect(ids.length).toBe(1);
      expect(probe.maxActive()).toBeGreaterThanOrEqual(3);
    } finally {
      probe.restore();
    }
  });
});
