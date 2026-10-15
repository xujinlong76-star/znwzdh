import { describe, expect, it } from "vitest";
import {
  MemoryVectorStore,
  SeamVectorCodec,
  SqliteVecStore,
  fitDimension,
  hasNonFinite,
  hashSiteId,
  normalize,
  sanitizeFinite,
  toBlobParam,
  toPostgresParam,
  vectorToBlob,
} from "../src/vector/index.ts";

/**
 * 回归防线：非有限值（NaN / ±Infinity）绝不能进入任何驱动。
 *
 * 这两个方言的失败形态不对称，是本套件存在的原因：
 *   - PostgreSQL 会显式抛 malformed array literal（还好，能发现）
 *   - SQLite 会静默接受 NaN 字节，之后 KNN 距离全为 NaN，
 *     排序退化成插入序，且不报任何错
 */

const DIM = 8;

describe("sanitizeFinite", () => {
  it("把 NaN / ±Infinity 全部替换为 0，有限值原样保留", () => {
    const out = sanitizeFinite(new Float32Array([0.5, NaN, Infinity, -Infinity, -0.25]));
    expect(Array.from(out)).toEqual([0.5, 0, 0, 0, -0.25]);
  });

  it("返回新数组，不改写入参（调用方可能持有共享 ArrayBuffer）", () => {
    const src = new Float32Array([1, NaN, 2]);
    const out = sanitizeFinite(src);
    expect(Number.isNaN(src[1]!)).toBe(true); // 入参未被就地修正
    expect(Array.from(out)).toEqual([1, 0, 2]);
  });

  it("hasNonFinite 只做检测，不做修正", () => {
    expect(hasNonFinite(new Float32Array([1, 2, 3]))).toBe(false);
    expect(hasNonFinite(new Float32Array([1, NaN]))).toBe(true);
    expect(hasNonFinite(new Float32Array([Infinity]))).toBe(true);
  });
});

describe("toPostgresParam（pgvector 文本字面量）", () => {
  it("非有限值被替换，输出可被 PG 解析的字面量", () => {
    const lit = toPostgresParam(new Float32Array([0.1, NaN, Infinity, -Infinity]));
    expect(lit).toMatch(/^\[-?\d+(\.\d+)?(,-?\d+(\.\d+)?)*\]$/);
    expect(lit).not.toContain("NaN");
    expect(lit).not.toContain("Infinity");
  });

  it("精度收敛到 6 位，避免 0.10000000149011612 这种 17 位尾数", () => {
    const lit = toPostgresParam(new Float32Array([0.1]));
    expect(lit).toBe("[0.100000]");
  });

  it("同一向量两次编码结果稳定（可缓存 / 可比较）", () => {
    const v = new Float32Array([1.5, -2.25, NaN]);
    expect(toPostgresParam(v)).toBe(toPostgresParam(v));
  });
});

describe("toBlobParam / vectorToBlob（sqlite-vec BLOB）", () => {
  it("字节长度恒为 dim * 4", () => {
    const buf = toBlobParam(new Float32Array(DIM));
    expect(buf.length).toBe(DIM * 4);
  });

  it("含 NaN 的向量写进 BLOB 后读回不含 NaN", () => {
    const dirty = new Float32Array([1, NaN, Infinity, -Infinity]);
    const buf = vectorToBlob(dirty);
    const back = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    for (const v of back) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("normalize（L2 归一化）", () => {
  it("含 NaN 时先清洗再归一化：结果有限且仍是单位向量，而不是整条除成 NaN", () => {
    const out = normalize(new Float32Array([1, NaN, 3]));
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    // NaN 位置按 0 参与归一化：[1,0,3] / sqrt(10)
    const norm = Math.hypot(...Array.from(out));
    expect(norm).toBeCloseTo(1, 5);
    expect(out[1]).toBe(0);
  });

  it("整条都是非有限值时退化为零向量（不产生 NaN 模长）", () => {
    const out = normalize(new Float32Array([NaN, Infinity, -Infinity]));
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });

  it("零向量不产生除零 NaN", () => {
    const out = normalize(new Float32Array([0, 0, 0]));
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
  });

  it("正常向量单位模长（回归：sanitize 不该改变既有行为）", () => {
    const out = normalize(new Float32Array([3, 4]));
    expect(out[0]).toBeCloseTo(0.6, 5);
    expect(out[1]).toBeCloseTo(0.8, 5);
  });
});

describe("fitDimension", () => {
  it("不足补 0、超出截断，且都保证有限", () => {
    const short = fitDimension(new Float32Array([1, NaN]), 4);
    expect(Array.from(short)).toEqual([1, 0, 0, 0]);
    const long = fitDimension(new Float32Array([1, 2, 3, 4, 5]), 3);
    expect(Array.from(long)).toEqual([1, 2, 3]);
  });
});

describe("SeamVectorCodec", () => {
  it("toDriverParam 按方言给出正确的物理类型", () => {
    const v = new Float32Array([1, 2]);
    expect(SeamVectorCodec.toDriverParam(v, "postgres")).toBeTypeOf("string");
    expect(Buffer.isBuffer(SeamVectorCodec.toDriverParam(v, "sqlite"))).toBe(true);
    expect(SeamVectorCodec.toDriverParam(v, "memory")).toBeInstanceOf(Float32Array);
  });

  it("normalizeSimilarity 把距离压到 [0,1]，且非有限距离退化为 0 而不是 NaN", () => {
    expect(SeamVectorCodec.normalizeSimilarity(NaN)).toBe(0);
    expect(SeamVectorCodec.normalizeSimilarity(Infinity)).toBe(0);
    expect(SeamVectorCodec.normalizeSimilarity(-1)).toBe(0);
    expect(SeamVectorCodec.normalizeSimilarity(0, "cosine")).toBe(1);
    expect(SeamVectorCodec.normalizeSimilarity(2, "cosine")).toBe(0);
    expect(SeamVectorCodec.normalizeSimilarity(0, "l2")).toBe(1);
    // L2 / 洛伦兹无上界，用径向基衰减：距离越大越接近 0，但永不触底
    expect(SeamVectorCodec.normalizeSimilarity(10, "lorentz")).toBeCloseTo(1 / 11, 6);
  });
});

describe("MemoryVectorStore：脏向量不污染检索", () => {
  it("存入含 NaN 的向量后，search 距离全是有限值且可排序", async () => {
    const store = new MemoryVectorStore(DIM);
    await store.upsert([
      { key: hashSiteId("dirty"), siteId: "dirty", vector: new Float32Array([1, NaN, 0, 0, 0, 0, 0, 0]) },
      { key: hashSiteId("clean"), siteId: "clean", vector: new Float32Array([0, 1, 0, 0, 0, 0, 0, 0]) },
    ]);
    const hits = await store.search(new Float32Array([0, 1, 0, 0, 0, 0, 0, 0]), 2);
    expect(hits.length).toBe(2);
    for (const h of hits) {
      expect(Number.isFinite(h.distance)).toBe(true);
    }
    // clean 与目标向量完全一致，必须排第一（NaN 排序会破坏这个不变量）
    expect(hits[0]!.siteId).toBe("clean");
  });

  it("查询向量维度不足时补零，不产生 NaN 距离", async () => {
    const store = new MemoryVectorStore(DIM);
    await store.upsert([{ key: hashSiteId("a"), siteId: "a", vector: new Float32Array(DIM).fill(0.5) }]);
    const hits = await store.search(new Float32Array([0.5]), 1);
    expect(hits.length).toBe(1);
    expect(Number.isFinite(hits[0]!.distance)).toBe(true);
  });
});

describe("SqliteVecStore：脏向量不污染 KNN 索引（真实回归）", () => {
  it("写入含 NaN 的向量后，检索距离仍为有限值", async () => {
    const Database = (await import("better-sqlite3")).default;
    const sqliteVec = await import("sqlite-vec");
    const raw = new Database(":memory:");
    sqliteVec.load(raw as never);

    const store = new SqliteVecStore({ db: raw as never, dim: DIM });
    const dirty = new Float32Array([1, NaN, Infinity, 0, 0, 0, 0, 0]);
    await store.upsert([{ key: hashSiteId("d1"), siteId: "d1", vector: dirty }]);

    const hits = await store.search(new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]), 1);
    expect(hits.length).toBe(1);
    expect(Number.isFinite(hits[0]!.distance)).toBe(true);
    expect(hits[0]!.siteId).toBe("d1");
  });
});
