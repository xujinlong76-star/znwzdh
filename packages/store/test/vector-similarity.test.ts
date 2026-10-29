/**
 * VectorMatch.similarity 的跨实现一致性。
 *
 * 背景：三个存储实现的 `distance` 不是同一把尺子——memory/pgvector 是余弦距离，
 * sqlite-vec 的 vec0 默认是 L2。把 distance 直接当「相似度阈值」会在换存储后端时
 * 静默改变语义（0.4 在余弦下是弱相关，在 L2 下对应余弦 0.92）。
 *
 * 因此 VectorMatch 增加 similarity（统一余弦口径），语义通道只认这个字段。
 * 这里用同一对向量喂两个真实实现，断言换算结果一致：
 *   - 同向：sim = 1
 *   - 正交：sim = 0（L2 d = √2 ⇒ 1 - d²/2 = 0）
 *   - 反向：sim = -1
 */
import { describe, expect, it } from "vitest";
import { MemoryVectorStore, SqliteVecStore, hashSiteId, type VectorStore } from "../src/vector/index.ts";

const DIM = 2;

function byId(hits: Array<{ siteId: string; distance: number; similarity: number }>) {
  return new Map(hits.map((h) => [h.siteId, h]));
}

async function expectCosineContract(store: VectorStore) {
  await store.upsert([
    { key: hashSiteId("same"), siteId: "same", vector: new Float32Array([1, 0]) },
    { key: hashSiteId("orth"), siteId: "orth", vector: new Float32Array([0, 1]) },
    { key: hashSiteId("opp"), siteId: "opp", vector: new Float32Array([-1, 0]) },
  ]);
  const hits = byId(await store.search(new Float32Array([1, 0]), 3));
  expect(hits.get("same")!.similarity).toBeCloseTo(1, 5);
  expect(hits.get("orth")!.similarity).toBeCloseTo(0, 5);
  expect(hits.get("opp")!.similarity).toBeCloseTo(-1, 5);
  // similarity 与 distance 方向相反，且都在约定区间内
  expect(hits.get("same")!.distance).toBeLessThan(hits.get("orth")!.distance);
  for (const h of hits.values()) {
    expect(h.similarity).toBeGreaterThanOrEqual(-1);
    expect(h.similarity).toBeLessThanOrEqual(1);
  }
}

describe("VectorMatch.similarity：跨实现统一余弦口径", () => {
  it("MemoryVectorStore：同向/正交/反向分别为 1 / 0 / -1", async () => {
    await expectCosineContract(new MemoryVectorStore(DIM));
  });

  it("SqliteVecStore（vec0 默认 L2）：换算后与内存实现一致", async () => {
    const Database = (await import("better-sqlite3")).default;
    const sqliteVec = await import("sqlite-vec");
    const raw = new Database(":memory:");
    sqliteVec.load(raw as never);
    const store = new SqliteVecStore({ db: raw as never, dim: DIM });
    await expectCosineContract(store);
  });

  it("SqliteVecStore 的 distance 确实是 L2（回归：换算公式依赖这个前提）", async () => {
    const Database = (await import("better-sqlite3")).default;
    const sqliteVec = await import("sqlite-vec");
    const raw = new Database(":memory:");
    sqliteVec.load(raw as never);
    const store = new SqliteVecStore({ db: raw as never, dim: DIM });
    await store.upsert([{ key: hashSiteId("orth"), siteId: "orth", vector: new Float32Array([0, 1]) }]);
    const [hit] = await store.search(new Float32Array([1, 0]), 1);
    // 余弦距离下正交应当恰好是 1；如果是 1，说明 vec0 其实用了余弦，
    // 那么 1 - d²/2 = 0.5 的换算就会把「完全不相关」报成中等相似
    expect(hit!.distance).toBeCloseTo(Math.SQRT2, 4);
  });
});
