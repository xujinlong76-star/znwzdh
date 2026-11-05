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
  /**
   * 子串（trigram）索引表名；不支持或建表失败时为 null，调用方必须退回 LIKE。
   *
   * SQLite 用它把 exact 通道里 `lower(col) LIKE '%term%'` 的前导通配符换成
   * 索引查找（P1-3）；PG 侧靠 pg_trgm 表达式索引，不需要改 SQL。
   */
  readonly substringIndex?: string | null;
  search(query: string, limit: number): Promise<FtsHit[]>;
  rebuild(): Promise<void>;
}

/** trigram 子串索引表（external-content，索引 title/url/description） */
export const SITES_SUBSTR_TABLE = "sites_substr";

export class SqliteFtsStore implements FullTextStore {
  readonly kind = "sqlite-fts5" as const;
  substringIndex: string | null = null;
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
    // UPDATE 触发器必须限定列：健康巡检/访问计数会频繁 UPDATE sites 的
    // health_ok/latency/last_checked 等字段，旧触发器对每次 UPDATE 都做一次
    // FTS delete+insert，等于把点击/巡检流量放大成全表索引写。
    // 只在「被索引的 5 列真的变化」时同步，其余 UPDATE 直接零成本。
    const updateTrigger = `${this.table}_au`;
    const existing = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
      .get(updateTrigger) as { sql?: string } | undefined;
    if (!existing || !/AFTER\s+UPDATE\s+OF/i.test(String(existing.sql ?? ""))) {
      // 老库沿用 CREATE TRIGGER IF NOT EXISTS 的旧定义，必须主动替换
      this.db.exec(`DROP TRIGGER IF EXISTS ${updateTrigger}`);
      this.db.exec(`
        CREATE TRIGGER ${updateTrigger} AFTER UPDATE OF title, description, fts_tokens, pinyin_full, pinyin_initials ON sites
        WHEN old.title IS NOT new.title
          OR old.description IS NOT new.description
          OR old.fts_tokens IS NOT new.fts_tokens
          OR old.pinyin_full IS NOT new.pinyin_full
          OR old.pinyin_initials IS NOT new.pinyin_initials
        BEGIN
          INSERT INTO ${this.table}(${this.table}, rowid, title, description, fts_tokens, pinyin_full, pinyin_initials)
          VALUES ('delete', old.rowid, old.title, coalesce(old.description,''), old.fts_tokens, old.pinyin_full, old.pinyin_initials);
          INSERT INTO ${this.table}(rowid, title, description, fts_tokens, pinyin_full, pinyin_initials)
          VALUES (new.rowid, new.title, coalesce(new.description,''), new.fts_tokens, new.pinyin_full, new.pinyin_initials);
        END;
      `);
    }

    if (rebuildNow) this.rebuild();

    this.initSubstring();
  }

  /**
   * trigram 子串索引（P1-3）。
   *
   * exact 通道的 `%term%` 前导通配符无法走普通 B-tree：每次搜索都全表扫
   * title/url/description。trigram 分词把三列切成 3 字符片段建 FTS5 索引，
   * `MATCH '"term"'` 与 LIKE 子串**语义等价**（≥3 个字符时），却能走索引。
   * 1–2 字符的短词 trigram 索引不了，仍走原 LIKE（中文两字词由 FTS 二元通道
   * 兜底召回），所以这里只建表，不改动短词的查询路径。
   *
   * 建表失败（旧 SQLite 无 trigram 分词器）不阻断启动：substringIndex 保持 null，
   * 搜索退回 LIKE，只是慢，不会错。
   */
  private initSubstring(): void {
    try {
      this.db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${SITES_SUBSTR_TABLE} USING fts5(
           title,
           url,
           description,
           content='sites',
           content_rowid='rowid',
           tokenize='trigram case_sensitive 0'
         )`,
      );
      // 与 sites_fts 同一套同步策略：UPDATE 只盯被索引的三列，巡检/点击等
      // 高频 UPDATE 不触发索引写。
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS ${SITES_SUBSTR_TABLE}_ai AFTER INSERT ON sites BEGIN
          INSERT INTO ${SITES_SUBSTR_TABLE}(rowid, title, url, description)
          VALUES (new.rowid, new.title, new.url, coalesce(new.description,''));
        END;
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS ${SITES_SUBSTR_TABLE}_ad AFTER DELETE ON sites BEGIN
          INSERT INTO ${SITES_SUBSTR_TABLE}(${SITES_SUBSTR_TABLE}, rowid, title, url, description)
          VALUES ('delete', old.rowid, old.title, old.url, coalesce(old.description,''));
        END;
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS ${SITES_SUBSTR_TABLE}_au AFTER UPDATE OF title, url, description ON sites
        WHEN old.title IS NOT new.title
          OR old.url IS NOT new.url
          OR old.description IS NOT new.description
        BEGIN
          INSERT INTO ${SITES_SUBSTR_TABLE}(${SITES_SUBSTR_TABLE}, rowid, title, url, description)
          VALUES ('delete', old.rowid, old.title, old.url, coalesce(old.description,''));
          INSERT INTO ${SITES_SUBSTR_TABLE}(rowid, title, url, description)
          VALUES (new.rowid, new.title, new.url, coalesce(new.description,''));
        END;
      `);
      this.substringIndex = SITES_SUBSTR_TABLE;

      // 外部内容 FTS5 的 COUNT(*) 读的是 content 表（sites）行数，无法判断索引
      // 是否灌过数据；docsize 影子表才是「已索引文档数」。老库升级时新表为空，
      // 必须在此重建一次，否则 exact 通道会静默只剩短词 LIKE 可用。
      const live = (this.db.prepare("SELECT COUNT(*) AS n FROM sites WHERE deleted_at IS NULL").get() as { n?: number } | undefined)?.n ?? 0;
      if (live > 0) {
        const indexed = (this.db.prepare(`SELECT COUNT(*) AS n FROM ${SITES_SUBSTR_TABLE}_docsize`).get() as { n?: number } | undefined)?.n ?? 0;
        if (indexed === 0) {
          this.db.exec(`INSERT INTO ${SITES_SUBSTR_TABLE}(${SITES_SUBSTR_TABLE}) VALUES('rebuild')`);
        }
      }
    } catch {
      this.substringIndex = null;
    }
  }

  /** 首次升级/索引丢失时重建 trigram 索引（与 rebuild() 同一入口策略） */
  async rebuildSubstring(): Promise<void> {
    if (!this.substringIndex) return;
    this.db.exec(`INSERT INTO ${this.substringIndex}(${this.substringIndex}) VALUES('rebuild')`);
  }

  async rebuild(): Promise<void> {
    this.db.exec(`INSERT INTO ${this.table}(${this.table}) VALUES('rebuild')`);
  }

  async search(query: string, limit: number): Promise<FtsHit[]> {
    const match = buildFtsQuery(query);
    if (!match || limit <= 0) return [];
    const rows = this.db
      .prepare(
        // enabled 过滤必须与 exact/pinyin/browse 通道一致：否则后台「停用但未删除」
        // 的站点仍会被全文检索命中（PG 侧 fts-pg.ts 早已过滤 TRUE，这里是对齐修复）。
        `SELECT sites.id AS siteId
           FROM ${this.table}
           JOIN sites ON sites.rowid = ${this.table}.rowid
          WHERE ${this.table} MATCH ?
            AND sites.deleted_at IS NULL
            AND sites.enabled = 1
          ORDER BY bm25(${this.table}, 10.0, 4.0, 6.0, 2.0, 2.0)
          LIMIT ?`,
      )
      .all(match, limit) as Array<{ siteId: string }>;
    return rows.map((r, i) => ({ siteId: r.siteId, rank: i + 1 }));
  }
}
