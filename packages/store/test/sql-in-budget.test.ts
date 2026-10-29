/**
 * IN 列表参数预算与分面查询并发度（2026-10-21 深扫 · 性能/健壮性）。
 *
 * 锁四件事：
 *  1. 任何一条语句绑定的 IN 参数个数必须**有上限**。参数上限是语句级的
 *     （SQLite 老构建 999，PG 65535），超限直接抛错 → 500；而分面交集的 id 数
 *     由数据量决定（一个热门分面值能覆盖上千站点）。
 *  2. 主路径（集合绑定 json_each / ANY）：>一片 id 也只发**一条**语句、一个参数，
 *     不再做「分片查 + JS 归并」。
 *  3. 回退路径（探测失败）：分片之后结果仍然正确——分页必须等价于「对全量候选按
 *     同一 ORDER BY 排序再切片」，而不是「第一片的前 N 条」。
 *  4. `filterSiteIdsByFacets` 的多个分面条件必须并发查，而不是串行 await
 *     ——串行时「条件数」直接等于「网络往返数」，在 PG 上是纯粹的延迟放大。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { SQL_IN_CHUNK, collectionInPredicate } from "../src/sql-in.ts";

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

/** 覆盖 SQL_IN_CHUNK 的分面大 fixture：sort 打散，id 序与 sort 序不同向 */
async function makeBulkFixture() {
  const cat = await repo.createCategory({ title: "分面大片测试" });
  const total = SQL_IN_CHUNK + 100;
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
  return planned;
}

beforeAll(async () => {
  db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
  repo = new Repository(db);
});

afterAll(async () => {
  await db.close();
});

describe("集合绑定（单语句主路径）", () => {
  it("collectionInPredicate：三种方言各绑一个参数，空列表交给调用方短路", () => {
    const lite = collectionInPredicate("sqlite", "s.id", ["a", "b"]);
    expect(lite).toEqual({
      sql: "s.id IN (SELECT value FROM json_each(?))",
      params: [JSON.stringify(["a", "b"])],
    });
    const pg = collectionInPredicate("pg", "s.id", ["a", "b"]);
    expect(pg).toEqual({ sql: "s.id = ANY(?::text[])", params: [["a", "b"]] });
    // 空集合的语义是「无匹配」，不能由 SQL 的空 IN 决定（各方言行为不一致）
    expect(collectionInPredicate("sqlite", "s.id", [])).toBeNull();
    expect(collectionInPredicate("pg", "s.id", [])).toBeNull();
  });

  it("本机 SQLite 探测通过（有 JSON1），列表无论多大都只占一个参数位", async () => {
    const big = Array.from({ length: SQL_IN_CHUNK * 3 }, (_, i) => `id-${i}`);
    const pred = await repo.collectionIn("s.id", big);
    expect(pred).not.toBeNull();
    expect(pred!.params.length).toBe(1);
    // JSON 文本承载全部 id：参数个数与列表长度无关
    expect(String(pred!.params[0]).startsWith("[")).toBe(true);
    // 空列表由调用方短路，谓词层不产出恒真/恒假条件
    expect(await repo.collectionIn("s.id", [])).toBeNull();
  });
});

describe("IN 列表参数预算", () => {
  let planned: Array<{ id: string; sort: number }>;

  beforeAll(async () => {
    planned = await makeBulkFixture();
  }, 180_000);

  const expectedTop = (n: number) =>
    [...planned].sort((a, b) => a.sort - b.sort).slice(0, n).map((p) => p.id);

  it("主路径：命中超过一片（>500）时一条语句搞定，分页等价于全量排序后切片", async () => {
    const probe = instrument(repo);
    try {
      const page = await repo.listSites({ facets: { pricing: ["bulk"] }, limit: 50 });
      expect(page.map((s) => s.id)).toEqual(expectedTop(50));
      // 语句级预算：任何一条语句都不得逼近 SQL_IN_CHUNK
      // （主查询 = 1 个 JSON 参数 + LIMIT/OFFSET；探测与分面条件语句更小）
      expect(probe.maxParams()).toBeLessThanOrEqual(5);
      expect(probe.calls.filter((n) => n > SQL_IN_CHUNK).length).toBe(0);
      // 跨页一致性：第二页由同一条语句的 OFFSET 切出，不依赖片序
      const page2 = await repo.listSites({ facets: { pricing: ["bulk"] }, limit: 50, offset: 50 });
      expect(page2.map((s) => s.id)).toEqual(expectedTop(100).slice(50));
    } finally {
      probe.restore();
    }
  });

  it("回退路径：强制集合绑定不可用时退回分片归并，结果仍等价且单语句不超预算", async () => {
    // 模拟「老 SQLite 没有 JSON1」的探测失败，锁住能力兜底分支不会腐坏
    const state = repo as unknown as { collectionBindOk: boolean | null };
    const saved = state.collectionBindOk;
    state.collectionBindOk = false;
    const probe = instrument(repo);
    try {
      const page = await repo.listSites({ facets: { pricing: ["bulk"] }, limit: 50 });
      // 分页等价：必须是全量归并后的前 50，而不是某一片的前 50
      expect(page.map((s) => s.id)).toEqual(expectedTop(50));
      // 确实走了多语句分片（候选被切成 ≥2 片），且每条都在预算内
      expect(probe.calls.length).toBeGreaterThanOrEqual(3);
      expect(probe.maxParams()).toBeGreaterThan(SQL_IN_CHUNK);
      expect(probe.maxParams()).toBeLessThanOrEqual(SQL_IN_CHUNK + 3);
      const offsetPage = await repo.listSites({ facets: { pricing: ["bulk"] }, limit: 50, offset: 550 });
      expect(offsetPage.map((s) => s.id)).toEqual(expectedTop(600).slice(550));
    } finally {
      probe.restore();
      state.collectionBindOk = saved;
    }
  }, 120_000);

  it("单个分面键的值超预算：主路径一条语句，回退路径分片且都守住预算", async () => {
    const cat = await repo.createCategory({ title: "值预算测试" });
    await repo.createSite({
      url: "https://value-budget.example.com",
      title: "值预算站点",
      categoryId: cat.id,
      facets: { pricing: ["free"] },
    });

    const many = Array.from({ length: SQL_IN_CHUNK * 2 + 1 }, (_, i) => `value-${i}`);
    many.push(" FREE "); // 归一（trim + 小写）后必须仍命中

    // 主路径：整片值绑成一个 JSON 参数，一条语句查完，参数个数与值个数无关
    const probe = instrument(repo);
    try {
      const ids = await repo.filterSiteIdsByFacets({ pricing: many });
      expect(ids.length).toBe(1);
      expect(probe.calls.length).toBeLessThanOrEqual(2);
      expect(probe.maxParams()).toBeLessThanOrEqual(SQL_IN_CHUNK + 1);
      expect(probe.calls.filter((n) => n > SQL_IN_CHUNK + 1)).toHaveLength(0);
    } finally {
      probe.restore();
    }

    // 回退路径（老 SQLite 没有 JSON1）：必须按片查，而不是拼出一条超限语句
    const state = repo as unknown as { collectionBindOk: boolean | null };
    const saved = state.collectionBindOk;
    state.collectionBindOk = false;
    const fallback = instrument(repo);
    try {
      const ids = await repo.filterSiteIdsByFacets({ pricing: many });
      expect(ids.length).toBe(1);
      // 一条语句 = 一片值 + facet_key
      expect(fallback.maxParams()).toBeLessThanOrEqual(SQL_IN_CHUNK + 1);
      expect(fallback.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      fallback.restore();
      state.collectionBindOk = saved;
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
