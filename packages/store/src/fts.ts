import { buildFtsQuery } from "@navhub/core";

/**
 * 全文检索适配层。
 *
 * 关键设计：SQLite 侧用 **external-content FTS5**（`content='sites'`），
 * 让 FTS 表不重复存储正文，只做索引；配合三个触发器保持同步。
 *
 * 索引语料来自 `sites.fts_tokens`（CJK 二元分词后的结果，见 @navhub/core/cjk）。
 * 实测：这样 '启动' 能命中「启动脚本」，'天气' 能命中「中国天气网」，
 * 这是 unicode61 默认分词做不到的。
 */

export interface FtsLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
}

export interface FtsHit {
  siteId: string;
  rank: number;
}

export interface FullTextStore {
  readonly kind: "sqlite-fts5" | "pg-tsvector" | "none";
  search(query: string, limit: number): Promise<FtsHit[]>;
  rebuild(): Promise<void>;
}

export class SqliteFtsStore implements FullTextStore {
  readonly kind = "sqlite-fts5" as const;
  private db: FtsLike;
  private table: string;

  constructor(db: FtsLike, table = "sites_fts") {
    this.db = db;
    this.table = table;
  }

  /**
   * 建表 + 触发器。
   * external-content 表必须显式重建（`INSERT INTO fts(fts) VALUES('rebuild')`）才有数据。
   */
  init(rebuildNow = true): void {
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${this.table} USING fts5(
         title,
         description,
         fts_tokens,
         pinyin_full,
         pinyin_initials,
         content='sites',
         content_rowid='rowid',
         tokenize='unicode61 remove_diacritics 2'
       )`,
    );

    // 触发器保持同步。注意 content_rowid 必须指向 sites 的真实 rowid，
    // 而 sites.id 是 TEXT 主键 —— 所以查询时要用 `rowid` 回连，不能用 id。
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${this.table}_ai AFTER INSERT ON sites BEGIN
        INSERT INTO ${this.table}(rowid, title, description, fts_tokens, pinyin_full, pinyin_initials)
        VALUES (new.rowid, new.title, coalesce(new.description,''), new.fts_tokens, new.pinyin_full, new.pinyin_initials);
      END;
    `);
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${this.table}_ad AFTER DELETE ON sites BEGIN
        INSERT INTO ${this.table}(${this.table}, rowid, title, description, fts_tokens, pinyin_full, pinyin_initials)
        VALUES ('delete', old.rowid, old.title, coalesce(old.description,''), old.fts_tokens, old.pinyin_full, old.pinyin_initials);
      END;
    `);
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${this.table}_au AFTER UPDATE ON sites BEGIN
        INSERT INTO ${this.table}(${this.table}, rowid, title, description, fts_tokens, pinyin_full, pinyin_initials)
        VALUES ('delete', old.rowid, old.title, coalesce(old.description,''), old.fts_tokens, old.pinyin_full, old.pinyin_initials);
        INSERT INTO ${this.table}(rowid, title, description, fts_tokens, pinyin_full, pinyin_initials)
        VALUES (new.rowid, new.title, coalesce(new.description,''), new.fts_tokens, new.pinyin_full, new.pinyin_initials);
      END;
    `);

    if (rebuildNow) this.rebuild();
  }

  async rebuild(): Promise<void> {
    this.db.exec(`INSERT INTO ${this.table}(${this.table}) VALUES('rebuild')`);
  }

  async search(query: string, limit: number): Promise<FtsHit[]> {
    const match = buildFtsQuery(query);
    if (!match || limit <= 0) return [];
    const rows = this.db
      .prepare(
        `SELECT sites.id AS siteId
           FROM ${this.table}
           JOIN sites ON sites.rowid = ${this.table}.rowid
          WHERE ${this.table} MATCH ?
          ORDER BY bm25(${this.table}, 10.0, 4.0, 6.0, 2.0, 2.0)
          LIMIT ?`,
      )
      .all(match, limit) as Array<{ siteId: string }>;
    return rows.map((r, i) => ({ siteId: r.siteId, rank: i + 1 }));
  }
}
