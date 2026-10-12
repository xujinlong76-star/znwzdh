import type { VectorMatch, VectorRecord, VectorStore } from "./types.ts";
import { normalize } from "./types.ts";

/**
 * sqlite-vec (vec0) 实现。
 *
 * 上游两个硬性约束（见 types.ts 注释，均有测试覆盖）：
 *   - 主键必须是 BigInt，JS number 会被拒
 *   - KNN 查询必须带 LIMIT 或 k = ?，否则 prepare 报错
 *
 * 这里把两者都封装掉：对外只暴露 `search(query, limit)`。
 */

/** better-sqlite3 的最小结构类型，避免把驱动类型泄漏到公共 API */
export interface SqliteLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
}

export interface SqliteVecStoreOptions {
  db: SqliteLike;
  dim: number;
  /** 虚拟表名 */
  table?: string;
}

export class SqliteVecStore implements VectorStore {
  readonly kind = "sqlite-vec" as const;
  readonly dim: number;
  private db: SqliteLike;
  private table: string;
  private keyToSite = new Map<number, string>();
  private siteToKey = new Map<string, number>();
  private ready = false;

  constructor(opts: SqliteVecStoreOptions) {
    this.db = opts.db;
    this.dim = opts.dim;
    this.table = opts.table ?? "sites_vec";
  }

  /** 幂等初始化：建虚拟表 + 回填内存里的 key 映射 */
  init(): void {
    if (this.ready) return;
    // 注意：vec0 的 DDL 解析器不接受反引号包裹的列名（实测报
    // "vec0 constructor error: Could not parse '\`site_key\` INTEGER PRIMARY KEY'"），
    // 而且 float[N] 的 N 必须是字面量，不能是绑定参数。
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${this.table} USING vec0(site_key INTEGER PRIMARY KEY, embedding float[${this.dim}])`,
    );
    this.ready = true;
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    this.init();
    if (records.length === 0) return;
    const del = this.db.prepare(`DELETE FROM ${this.table} WHERE site_key = ?`);
    const ins = this.db.prepare(`INSERT INTO ${this.table}(site_key, embedding) VALUES (?, ?)`);
    for (const r of records) {
      if (r.vector.length !== this.dim) {
        throw new Error(`${r.siteId} 向量维度 ${r.vector.length} != ${this.dim}`);
      }
      // vec0 不接受重复主键，先删后插实现 upsert
      del.run(BigInt(r.key));
      // 必须传 BigInt —— 传 number 会抛 "Only integers are allows for primary key values"
      ins.run(BigInt(r.key), normalize(r.vector));
      this.keyToSite.set(r.key, r.siteId);
      this.siteToKey.set(r.siteId, r.key);
    }
  }

  async remove(siteIds: string[]): Promise<void> {
    this.init();
    const del = this.db.prepare(`DELETE FROM ${this.table} WHERE site_key = ?`);
    for (const siteId of siteIds) {
      const key = this.siteToKey.get(siteId);
      if (key === undefined) continue;
      del.run(BigInt(key));
      this.siteToKey.delete(siteId);
      this.keyToSite.delete(key);
    }
  }

  async search(query: Float32Array, limit: number): Promise<VectorMatch[]> {
    this.init();
    if (limit <= 0) return [];
    // LIMIT 必须在 vec0 自己的查询块里 —— 这是 vec0 的硬性约束
    const rows = this.db
      .prepare(
        `SELECT site_key AS siteKey, distance FROM ${this.table} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
      )
      .all(normalize(query), limit) as Array<{ siteKey: number | bigint; distance: number }>;

    const out: VectorMatch[] = [];
    for (const row of rows) {
      const key = Number(row.siteKey);
      const siteId = this.keyToSite.get(key);
      // 映射表冷启动时为空（进程重启），此时用哈希反查
      out.push({ siteId: siteId ?? String(key), distance: Number(row.distance) });
    }
    return out;
  }

  /** 进程重启后重建 key -> siteId 映射 */
  rehydrate(entries: Array<{ key: number; siteId: string }>): void {
    this.keyToSite.clear();
    this.siteToKey.clear();
    for (const e of entries) {
      this.keyToSite.set(e.key, e.siteId);
      this.siteToKey.set(e.siteId, e.key);
    }
  }

  async count(): Promise<number> {
    this.init();
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM ${this.table}`).get() as { c: number };
    return Number(row?.c ?? 0);
  }

  async clear(): Promise<void> {
    this.init();
    this.db.exec(`DELETE FROM ${this.table}`);
    this.keyToSite.clear();
    this.siteToKey.clear();
  }
}
