/**
 * `saveEmbeddingsBatch` 的行为契约（批量向量写入的性能改造回归网）。
 *
 * 改造动机：`indexSitesBatch` 原先在事务内逐条 `saveEmbedding`，200 条批量导入
 * 就是 200 次 INSERT 加一个长事务。改成多值 UPSERT 后必须保证：
 *
 * 1. **跨分片完整**：分片大小 100，写入 250 条要覆盖 3 条语句，一条都不能丢；
 * 2. **UPSERT 语义不变**：同 site_id 再写一次是覆盖，不是主键冲突；
 * 3. **非有限值仍被清洗**：NaN/Infinity 必须变成 0 落库——这是原 `vectorToBlob`
 *    的既有语义（清洗而非拒绝），批量版不能因为"批量"就把脏值带进 BLOB，
 *    否则 SQLite 侧 KNN 距离会整片变 NaN 且零报错。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/driver.ts";
import { Repository } from "../src/repository.ts";
import { savedEmbeddings } from "../src/repository/embeddings.ts";

describe("saveEmbeddingsBatch", () => {
  let db: Db;
  let repo: Repository;

  beforeAll(async () => {
    db = await openDb({ dialect: "sqlite", sqlitePath: ":memory:" });
    repo = new Repository(db);
  });

  afterAll(async () => {
    await db.close();
  });

  const vec = (seed: number, dim = 4) =>
    Float32Array.from({ length: dim }, (_, i) => seed + i / 10);

  it("跨分片写入 250 条后全部可读回（分片大小 100，覆盖 3 条语句）", async () => {
    const records = Array.from({ length: 250 }, (_, i) => ({
      siteId: `batch-site-${i}`,
      model: "test-model",
      vector: vec(i),
    }));
    await repo.saveEmbeddingsBatch(records);

    const saved = await savedEmbeddings(repo, { model: "test-model" });
    expect(saved).toHaveLength(250);
    const bySite = new Map(saved.map((row) => [row.siteId, row.vector]));
    // 抽查首、分片边界、末条：边界最容易被 slice 算错
    for (const idx of [0, 99, 100, 199, 200, 249]) {
      const got = bySite.get(`batch-site-${idx}`);
      expect(got, `site ${idx} 缺失`).toBeDefined();
      expect(Array.from(got!)).toEqual(Array.from(vec(idx)));
    }
  });

  it("同 site_id 重复写入是覆盖而不是冲突", async () => {
    await repo.saveEmbeddingsBatch([{ siteId: "dup-site", model: "m1", vector: vec(1) }]);
    await repo.saveEmbeddingsBatch([{ siteId: "dup-site", model: "m2", vector: vec(9) }]);

    const saved = await savedEmbeddings(repo, { model: "m2" });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.siteId).toBe("dup-site");
    expect(Array.from(saved[0]!.vector)).toEqual(Array.from(vec(9)));

    // 旧模型的记录必须被替换掉，不能留下两行
    const stale = await savedEmbeddings(repo, { model: "m1", dim: 4 });
    expect(stale.some((row) => row.siteId === "dup-site")).toBe(false);
  });

  it("非有限值被清洗为 0（与原 saveEmbedding 同口径，不抛错也不落 NaN）", async () => {
    const dirty = Float32Array.from([1, Number.NaN, Number.POSITIVE_INFINITY, -2]);
    await repo.saveEmbeddingsBatch([{ siteId: "dirty-site", model: "m3", vector: dirty }]);

    const saved = await savedEmbeddings(repo, { model: "m3" });
    expect(saved).toHaveLength(1);
    const actual = Array.from(saved[0]!.vector);
    expect(actual).toEqual([1, 0, 0, -2]);
    expect(actual.every(Number.isFinite)).toBe(true);
  });

  it("空数组是 no-op（批量调用不为空批开语句）", async () => {
    await expect(repo.saveEmbeddingsBatch([])).resolves.toBeUndefined();
    const saved = await savedEmbeddings(repo, { model: "empty-model" });
    expect(saved).toHaveLength(0);
  });
});
