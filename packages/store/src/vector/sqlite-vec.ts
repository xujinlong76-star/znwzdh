import type { VectorMatch, VectorRecord, VectorStore } from "./types.ts";
import { normalize } from "./types.ts";
import { fitDimension } from "./codec.ts";

/**
 * sqlite-vec (vec0) 实现。
 *
 * 上游两个硬性约束（见 types.ts 注释，均有测试覆盖）：
 *   - 主键必须是 BigInt，JS number 会被拒
 *   - KNN 查询必须带 LIMIT 或 k = ?，否则 prepare 报错
 *
 * 关键设计（2026-10 修复）：vec0 表里**同时存 site_key 与 site_id**。
 * 早先版本只存 site_key（FNV 哈希），靠进程内 keyToSite 映射把哈希还原成站点 UUID。
 * 这有一个致命缺陷：映射只在进程启动时 rehydrate 一次；如果别的进程（seed 脚本、
 * 另一个服务实例）之后直接写了 embeddings，运行中的服务对新增向量一无所知，
 * 于是 search 返回的 siteId 是"哈希值当字符串"，匹配不到任何站点 UUID，
 * 语义通道会**静默返回空**（channelSemantic 的 catch 吞掉了这个逻辑错误的表现）。
 *
 * 把 site_id 作为 vec0 的元数据列存进去之后，search 直接从行里取 site_id，
 * 彻底摆脱对进程内映射的依赖 —— 进程重启、跨进程写入都不会再丢语义检索。
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

  /** 当前 vec0 表应满足的 DDL（site_id 元数据列 + 指定维度） */
  private ddl(): string {
    return `CREATE VIRTUAL TABLE IF NOT EXISTS ${this.table} USING vec0(site_key INTEGER PRIMARY KEY, site_id TEXT, embedding float[${this.dim}])`;
  }

  /**
   * 幂等初始化：建虚拟表，并对旧 schema（无 site_id 列 / 维度不符）做就地迁移。
   *
   * 注意：vec0 的 DDL 解析器不接受反引号包裹的列名（实测报
   * "vec0 constructor error: Could not parse '`site_key` INTEGER PRIMARY KEY'"），
   * 且 float[N] 的 N 必须是字面量。
   */
  init(): void {
    if (this.ready) return;
    this.migrateSchema();
    this.ready = true;
  }

  /**
   * 检测旧 schema 并迁移。
   *
   * 判断依据是 sqlite_master 里存的建表 SQL：只要不含 site_id 列或维度与当前不符，
   * 就 DROP 重建。重建后表是空的，由 rehydrate() 用 embeddings 表里的向量重灌。
   */
  private migrateSchema(): void {
    const row = this.db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(this.table) as { sql?: string } | undefined;
    const sql = row?.sql ?? "";
    const needsMigrate = Boolean(row) && (!sql.includes("site_id") || !sql.includes(`float[${this.dim}]`));
    if (needsMigrate) {
      this.db.exec(`DROP TABLE IF EXISTS ${this.table}`);
    }
    this.db.exec(this.ddl());
  }

  async upsert(records: VectorRecord[]): Promise<void> {
    this.init();
    if (records.length === 0) return;
    const del = this.db.prepare(`DELETE FROM ${this.table} WHERE site_key = ?`);
    const ins = this.db.prepare(`INSERT INTO ${this.table}(site_key, site_id, embedding) VALUES (?, ?, ?)`);
    for (const r of records) {
      if (r.vector.length !== this.dim) {
        throw new Error(`${r.siteId} 向量维度 ${r.vector.length} != ${this.dim}`);
      }
      // vec0 不接受重复主键，先删后插实现 upsert
      del.run(BigInt(r.key));
      // 必须传 BigInt —— 传 number 会抛 "Only integers are allows for primary key values"
      ins.run(BigInt(r.key), r.siteId, normalize(r.vector));
      this.keyToSite.set(r.key, r.siteId);
      this.siteToKey.set(r.siteId, r.key);
    }
  }

  async remove(siteIds: string[]): Promise<void> {
    this.init();
    // 优先按 site_id 直接删（不依赖进程内映射）
    const delById = this.db.prepare(`DELETE FROM ${this.table} WHERE site_id = ?`);
    const delByKey = this.db.prepare(`DELETE FROM ${this.table} WHERE site_key = ?`);
    for (const siteId of siteIds) {
      delById.run(siteId);
      const key = this.siteToKey.get(siteId);
      if (key !== undefined) delByKey.run(BigInt(key));
      this.siteToKey.delete(siteId);
      if (key !== undefined) this.keyToSite.delete(key);
    }
  }

  async search(query: Float32Array, limit: number): Promise<VectorMatch[]> {
    this.init();
    if (limit <= 0) return [];
    // LIMIT 必须在 vec0 自己的查询块里 —— 这是 vec0 的硬性约束
    const rows = this.db
      .prepare(
        `SELECT site_id AS siteId, site_key AS siteKey, distance FROM ${this.table} WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
      )
      .all(normalize(fitDimension(query, this.dim)), limit) as Array<{ siteId: string | null; siteKey: number | bigint; distance: number }>;

    const out: VectorMatch[] = [];
    for (const row of rows) {
      const key = Number(row.siteKey);
      // site_id 列是唯一事实源；仅在旧数据（site_id 为 NULL）时才退回进程内映射，
      // 再退回哈希值（后两者都不是站点 UUID，只是尽力而为的兜底）。
      const siteId = row.siteId ?? this.keyToSite.get(key) ?? String(key);
      out.push({ siteId, distance: Number(row.distance) });
    }
    return out;
  }

  /**
   * 重建进程内映射，并在 vec0 表与 embeddings 不一致时（迁移成空表 / 跨进程写入后残留 /
   * 部分丢失）以 embeddings 为唯一事实源重建 vec0。
   *
   * 入参来自 Repository.savedEmbeddings()，形如 { key, siteId, vector } ——
   * 正好是 VectorRecord[]。
   *
   * 为什么按"计数不一致"重建而不是"永远重建"：正常情况下 upsert 已经同步维护了
   * site_id 列，重启时若计数一致就无需 O(n) 重灌；一旦计数对不上（迁移 / 跨进程写 /
   * 手工删改），立刻全量重建，保证语义检索不因进程内状态陈旧而静默失效。
   */
  rehydrate(records: VectorRecord[]): void {
    this.init();
    this.keyToSite.clear();
    this.siteToKey.clear();

    const existing = (this.db.prepare(`SELECT COUNT(*) AS c FROM ${this.table}`).get() as { c: number }).c;
    const needsRebuild = existing !== records.length;

    if (needsRebuild) {
      // 必须无条件清空：持久层记录为 0 而 vec0 里仍有行（删除/换模型后的残留）
      // 时，旧逻辑因 `records.length > 0` 跳过重建，残留向量会永远留在索引里。
      this.db.exec(`DELETE FROM ${this.table}`);
      if (records.length > 0) {
        const ins = this.db.prepare(`INSERT INTO ${this.table}(site_key, site_id, embedding) VALUES (?, ?, ?)`);
        for (const r of records) {
          if (r.vector.length === this.dim) {
            ins.run(BigInt(r.key), r.siteId, normalize(r.vector));
          }
        }
      }
    }

    for (const r of records) {
      this.keyToSite.set(r.key, r.siteId);
      this.siteToKey.set(r.siteId, r.key);
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
