import { buildFtsQuery, hanToTokens } from "@navhub/core";
import type { FtsHit, FullTextStore } from "./fts.ts";

/**
 * PostgreSQL 全文检索（tsvector）。
 *
 * 与 SQLite 侧的关键差异与取舍：
 *
 *  1. **不建物化 tsvector 列**。索引语料在写入期已由 navhub 自己分词
 *     （`sites.fts_tokens`，CJK 单字 + 二元组），因此这里在查询时用
 *     `to_tsvector('simple', fts_tokens)` 即时生成向量。
 *     代价是每次查询多一次表达式求值，收益是省掉一个需要触发器维护的冗余列
 *     （SQLite 侧则用 external-content FTS5，两边各有取舍）。
 *
 *  2. **用 simple 配置而不是 chinese/zhparser**：后者需要额外安装扩展，
 *     而 simple 配合我们自己产出的二元分词已经能正确命中中文子串，
 *     同时避免引入部署依赖。
 *
 *  3. **相关性排序 = ts_rank + 短语加成**。ts_rank 是词袋模型、忽略词序，
 *     会把「启动脚本」与「脚本启动」算作同分。为规避这一明显退化，
 *     额外对「查询串去空格后直接出现在标题中」施加固定加分，
 *     使精确名称能稳定排在模糊命中之前。
 */
export interface PgFtsLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/** PostgreSQL 文本检索配置名 */
const CFG = "simple";

export class PgFtsStore implements FullTextStore {
  readonly kind = "pg-tsvector" as const;
  private db: PgFtsLike;
  private ready = false;

  constructor(db: PgFtsLike) {
    this.db = db;
  }

  /**
   * 建 GIN 表达式索引。
   * 表达式索引必须与查询中的表达式**逐字一致**才可能被规划器使用，
   * 因此这里的 to_tsvector 写法与 search() 中完全相同。
   * 索引属于性能优化而非正确性依赖，建失败不阻断启动（例如权限受限）。
   */
  async init(): Promise<void> {
    if (this.ready) return;
    const colExpr = vectorExpr("fts_tokens");
    try {
      await this.db.query("CREATE INDEX IF NOT EXISTS sites_fts_idx ON sites USING gin (" + colExpr + ")");
      await this.db.query("CREATE INDEX IF NOT EXISTS sites_fts_title_idx ON sites USING gin (" + vectorExpr("title") + ")");
    } catch {
      // 索引失败不影响可用性
    }
    this.ready = true;
  }

  async search(query: string, limit: number): Promise<FtsHit[]> {
    await this.init();
    if (limit <= 0) return [];
    const match = buildFtsQuery(query);
    if (!match) return [];

    // 复用与 SQLite 相同的 token 构造（中文加引号、英文前缀），
    // 仅把 OR 语法换成 PostgreSQL 的 | 。
    const tsquery = match.replace(/ OR /g, " | ");
    const phrase = query.replace(/\s+/g, "");
    const vec = vectorExpr("s.fts_tokens");

    const sql = [
      "SELECT s.id AS site_id,",
      " (" + "ts_rank(" + vec + ", to_tsquery('" + CFG + "', $1))",
      "  + CASE WHEN $2 <> '' AND s.title ILIKE '%' || $2 || '%' THEN 1.0 ELSE 0 END) AS score",
      " FROM sites s",
      " WHERE s.enabled = TRUE",
      "   AND s.deleted_at IS NULL",
      "   AND " + vec + " @@ to_tsquery('" + CFG + "', $1)",
      " ORDER BY score DESC, s.weight DESC, s.sort ASC",
      " LIMIT $3",
    ].join(" ");

    try {
      const res = await this.db.query(sql, [tsquery, phrase, limit]);
      const rows = res.rows as Array<{ site_id: unknown }>;
      return rows.map((r, i) => ({ siteId: String(r.site_id), rank: i + 1 }));
    } catch {
      // tsquery 语法异常（例如查询串全是标点）不应让整次搜索失败
      return [];
    }
  }

  async rebuild(): Promise<void> {
    // tsvector 是即时计算的，没有需要重建的物化索引
    await this.init();
  }
}

/** 生成 `to_tsvector(simple, coalesce(col, ''))` 表达式（索引与查询必须逐字一致） */
function vectorExpr(col: string): string {
  return "to_tsvector('" + CFG + "', coalesce(" + col + ", ''))";
}

/**
 * 生成 PostgreSQL 侧的索引语料。
 * 与 SQLite 侧保持完全一致的形态，便于跨方言一致性测试。
 */
export function pgTokens(text: string): string {
  return hanToTokens(text);
}