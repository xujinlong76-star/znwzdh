import type { VectorMatch, VectorRecord, VectorStore } from "./types.ts";
import { clampSimilarity, normalize } from "./types.ts";
import { fitDimension, toPostgresParam } from "./codec.ts";

/**
 * pgvector 实现（standard 模式）。
 *
 * 与 sqlite-vec 的差异：
 *   - 主键是普通 integer，没有 BigInt 包袱
 *   - 相似度用 `<=>`（余弦距离），需要 `vector` 扩展
 *   - upsert 用原生 ON CONFLICT
 *
 * 对外行为必须与 SqliteVecStore 一致（同一套测试通过）。
 */
export interface PgLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

export interface PgVectorStoreOptions {
  db: PgLike;
  dim: number;
  table?: string;
  /** 建表时使用的距离索引类型；HNSW 需要 pgvector >= 0.5 */
  indexType?: "hnsw" | "ivfflat" | "none";
}

export class PgVectorStore implements VectorStore {
  readonly kind = "pgvector" as const;
  readonly dim: number;
  private db: PgLike;
  private table: string;
  private indexType: "hnsw" | "ivfflat" | "none";
  private ready = false;

  constructor(opts: PgVectorStoreOptions) {
    this.db = opts.db;
    this.dim = opts.dim;
    this.table = opts.table ?? "sites_vec";
    this.indexType = opts.indexType ?? "hnsw";
  }

  async init(): Promise<void> {
    if (this.ready) return;
    await this.db.query("CREATE EXTENSION IF NOT EXISTS vector");
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
         site_key integer PRIMARY KEY,
         site_id text NOT NULL UNIQUE,
         embedding vector(${this.dim}) NOT NULL
       )`,
    );
    if (this.indexType !== "none") {
      // HNSW 用余弦距离，与归一化后的向量语义一致
      await this.db.query(
        `CREATE INDEX IF NOT EXISTS ${this.table}_embedding_idx
           ON ${this.table} USING ${this.indexType} (embedding vector_cosine_ops)`,
      );
    }
    this.ready = true;
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    await this.init();
    for (const r of records) {
      if (r.vector.length !== this.dim) {
        throw new Error(`${r.siteId} 向量维度 ${r.vector.length} != ${this.dim}`);
      }
      const v = normalize(r.vector);
      await this.db.query(
        `INSERT INTO ${this.table}(site_key, site_id, embedding) VALUES ($1, $2, $3::vector)
         ON CONFLICT (site_key) DO UPDATE SET site_id = EXCLUDED.site_id, embedding = EXCLUDED.embedding`,
        [r.key, r.siteId, toPostgresParam(v)],
      );
    }
  }

  async remove(siteIds: string[]): Promise<void> {
    await this.init();
    if (siteIds.length === 0) return;
    await this.db.query(`DELETE FROM ${this.table} WHERE site_id = ANY($1)`, [siteIds]);
  }

  async search(query: Float32Array, limit: number): Promise<VectorMatch[]> {
    await this.init();
    if (limit <= 0) return [];
    const res = await this.db.query(
      `SELECT site_id AS "siteId", embedding <=> $1::vector AS distance
         FROM ${this.table}
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      [toPostgresParam(normalize(fitDimension(query, this.dim))), limit],
    );
    return (res.rows as Array<{ siteId: string; distance: number | string }>).map((r) => {
      const distance = Number(r.distance); // `<=>` 即余弦距离
      return { siteId: r.siteId, distance, similarity: clampSimilarity(1 - distance) };
    });
  }

  async count(): Promise<number> {
    await this.init();
    const res = await this.db.query(`SELECT COUNT(*)::int AS c FROM ${this.table}`);
    return Number((res.rows[0] as { c: number } | undefined)?.c ?? 0);
  }

  async clear(): Promise<void> {
    await this.init();
    await this.db.query(`DELETE FROM ${this.table}`);
  }
}

/**
 * pgvector 的文本表示：[1,2,3]。
 *
 * 委托给 codec：非有限值必须被替换掉。PG 侧虽然会显式报
 * malformed array literal，但那是在 SQL 执行期才炸，堆栈里看不出
 * 是哪个站点的 embedding 出了问题。
 */
export function toPgVector(v: Float32Array): string {
  return toPostgresParam(v);
}
