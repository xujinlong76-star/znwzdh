import {
  DEFAULT_WEIGHTS,
  fuse,
  looksLikeLatinQuery,
  normalizeQueryPinyin,
  personalCandidates,
  type FusionWeights,
  type PersonalizableSite,
  type SearchCandidate,
  type SearchChannel,
  type SearchHit,
  type SearchQuery,
  type SearchResult,
} from "@navhub/core";
import type { Db } from "./driver.ts";
import type { FullTextStore } from "./fts.ts";
import type { VectorStore } from "./vector/types.ts";

/**
 * 混合检索引擎：四路召回 + RRF 融合 + 个性化。
 *
 * 通道设计取舍：
 *  - exact   : LIKE 子串命中。中文语义下这是**必要**通道——用户搜"天气"时，
 *              "中国天气网"的精确子串命中比语义近似更可信。
 *  - fts     : BM25 全文。走 CJK 二元分词索引，提供真正的相关性排序与多词支持。
 *  - pinyin  : 拼音全拼/首字母。让"qidong"、"qdjb"命中"启动脚本"。
 *  - semantic: 本地向量 KNN。让"写代码的AI"命中 GitHub Copilot。
 *
 * 四路各自都可能"对但排错"，RRF 只看排名做融合，再用 coverage 乘子奖励多路共识 ——
 * 这是抗"语义答非所问"的关键（实测见仓库测试）。
 */

export interface SearchEngineDeps {
  db: Db;
  fts: FullTextStore | null;
  vectors: VectorStore | null;
  embed?: ((text: string) => Promise<Float32Array>) | null;
  weights?: FusionWeights;
}

export interface SearchEngineOptions {
  /** 每路召回条数（越大越准但越慢）。RRF 需要足够的候选池 */
  perChannel?: number;
}

interface SiteRow {
  id: string;
  url: string;
  title: string;
  description: string | null;
  categoryId: string;
  pinyinFull: string;
  pinyinInitials: string;
  status: string;
  tags: string | null;
}

export class SearchEngine {
  private deps: SearchEngineDeps;
  private perChannel: number;

  constructor(deps: SearchEngineDeps, opts: SearchEngineOptions = {}) {
    this.deps = deps;
    this.perChannel = opts.perChannel ?? 50;
  }

  get semanticAvailable(): boolean {
    return Boolean(this.deps.vectors && this.deps.embed);
  }

  async search(q: SearchQuery): Promise<SearchResult> {
    const started = Date.now();
    const limit = q.limit ?? 20;
    const raw = (q.q ?? "").trim();
    const weights = this.deps.weights ?? DEFAULT_WEIGHTS;
    const pool = Math.max(limit * 3, 60);
    const candidates: SearchCandidate[] = [];

    // 空查询 = 浏览模式：按 featured/weight/sort 出列表，不经过 RRF
    if (raw.length === 0) {
      const browse = await this.browse(q, limit);
      return {
        hits: browse,
        channelsUsed: [],
        semanticAvailable: this.semanticAvailable,
        tookMs: Date.now() - started,
      };
    }

    const [exact, ftsHits, pinyin, semantic] = await Promise.all([
      this.channelExact(raw, q),
      this.channelFts(raw, q),
      this.channelPinyin(raw, q),
      q.disableSemantic ? Promise.resolve([]) : this.channelSemantic(raw, q),
    ]);
    candidates.push(...exact, ...ftsHits, ...pinyin, ...semantic);

    // 个性化作为独立通道参与融合（而不是事后加成），见 fusion.ts 的说明。
    // 只对"已经被相关性通道召回"的站点施加偏好，避免偏好把无关站点带进结果。
    if (q.personalize && !q.disablePersonal && candidates.length > 0) {
      const recalled = [...new Set(candidates.map((c) => c.siteId))];
      const sites = await this.loadPersonalizable(recalled);
      candidates.push(...personalCandidates(sites, q.personalize));
    }

    const hits: SearchHit[] = fuse(candidates, weights, pool);

    const used = new Set(candidates.map((c) => c.channel));
    return {
      hits: hits.slice(0, limit),
      channelsUsed: [...used] as SearchChannel[],
      semanticAvailable: this.semanticAvailable,
      tookMs: Date.now() - started,
    };
  }

  /** 通道 1：子串精确匹配（中文最可靠的一路） */
  private async channelExact(q: string, opt: SearchQuery): Promise<SearchCandidate[]> {
    const like = "%" + q.toLowerCase() + "%";
    const rows = await this.rawRows(
      `SELECT id, url, title, description, category_id AS categoryId,
              pinyin_full AS pinyinFull, pinyin_initials AS pinyinInitials, status, NULL AS tags
         FROM sites
        WHERE enabled = 1
          AND (lower(title) LIKE ? OR lower(url) LIKE ? OR lower(coalesce(description,'')) LIKE ?
               OR pinyin_full LIKE ? OR pinyin_initials LIKE ?)
        ORDER BY weight DESC, sort ASC
        LIMIT ?`,
      [like, like, like, like, like, this.perChannel],
    );
    const filtered = await this.postFilter(rows, opt);
    return filtered.map((r, i) => ({ siteId: r.id, channel: "exact" as const, rank: i + 1 }));
  }

  /** 通道 2：BM25 全文 */
  private async channelFts(q: string, opt: SearchQuery): Promise<SearchCandidate[]> {
    if (!this.deps.fts) return [];
    try {
      const hits = await this.deps.fts.search(q, this.perChannel);
      if (hits.length === 0) return [];
      const rows = await this.rawRows(
        `SELECT id, url, title, description, category_id AS categoryId,
                pinyin_full AS pinyinFull, pinyin_initials AS pinyinInitials, status, NULL AS tags
           FROM sites WHERE id IN (${hits.map(() => "?").join(",")})`,
        hits.map((h) => h.siteId),
      );
      const allowed = await this.postFilter(rows, opt);
      const allowedIds = new Set(allowed.map((r) => r.id));
      return hits
        .filter((h) => allowedIds.has(h.siteId))
        .map((h, i) => ({ siteId: h.siteId, channel: "fts" as const, rank: i + 1 }));
    } catch {
      // FTS 不可用（例如索引损坏）不应让整次搜索失败
      return [];
    }
  }

  /** 通道 3：拼音 */
  private async channelPinyin(q: string, opt: SearchQuery): Promise<SearchCandidate[]> {
    if (!looksLikeLatinQuery(q) && !/[\u4e00-\u9fff]/.test(q)) return [];
    const { full, initials } = normalizeQueryPinyin(q);
    if (!full) return [];
    const rows = await this.rawRows(
      `SELECT id, url, title, description, category_id AS categoryId,
              pinyin_full AS pinyinFull, pinyin_initials AS pinyinInitials, status, NULL AS tags
         FROM sites
        WHERE enabled = 1 AND (pinyin_full LIKE ? OR pinyin_initials LIKE ?)
        ORDER BY
          CASE WHEN pinyin_initials = ? THEN 0
               WHEN pinyin_full = ? THEN 0
               WHEN pinyin_initials LIKE ? THEN 1
               ELSE 2 END,
          weight DESC, sort ASC
        LIMIT ?`,
      [full + "%", initials + "%", initials, full, initials + "%", this.perChannel],
    );
    const filtered = await this.postFilter(rows, opt);
    return filtered.map((r, i) => ({ siteId: r.id, channel: "pinyin" as const, rank: i + 1 }));
  }

  /** 通道 4：语义向量 */
  private async channelSemantic(q: string, opt: SearchQuery): Promise<SearchCandidate[]> {
    if (!this.deps.vectors || !this.deps.embed) return [];
    try {
      const vec = await this.deps.embed(q);
      const matches = await this.deps.vectors.search(vec, this.perChannel);
      if (matches.length === 0) return [];
      const rows = await this.rawRows(
        `SELECT id, url, title, description, category_id AS categoryId,
                pinyin_full AS pinyinFull, pinyin_initials AS pinyinInitials, status, NULL AS tags
           FROM sites WHERE id IN (${matches.map(() => "?").join(",")})`,
        matches.map((m) => m.siteId),
      );
      const allowed = await this.postFilter(rows, opt);
      const allowedIds = new Set(allowed.map((r) => r.id));
      return matches
        .filter((m) => allowedIds.has(m.siteId))
        .map((m, i) => ({ siteId: m.siteId, channel: "semantic" as const, rank: i + 1, rawScore: m.distance }));
    } catch {
      // 模型不可用 / 维度不匹配时静默降级 —— 搜索必须仍然可用
      return [];
    }
  }

  /** 分类/标签/状态过滤，通道内统一处理 */
  private async postFilter(rows: SiteRow[], opt: SearchQuery): Promise<SiteRow[]> {
    let out = rows;
    if (opt.statuses?.length) {
      const set = new Set(opt.statuses);
      out = out.filter((r) => set.has(r.status as never));
    } else {
      out = out.filter((r) => r.status !== "archived");
    }
    if (opt.categoryId) {
      const ids = await this.categoryWithDescendants(opt.categoryId);
      out = out.filter((r) => ids.has(r.categoryId));
    }
    if (opt.tag) {
      const ids = await this.siteIdsWithTag(opt.tag);
      out = out.filter((r) => ids.has(r.id));
    }
    return out;
  }

  private async browse(q: SearchQuery, limit: number): Promise<SearchHit[]> {
    const rows = await this.rawRows(
      `SELECT id, url, title, description, category_id AS categoryId,
              pinyin_full AS pinyinFull, pinyin_initials AS pinyinInitials, status, NULL AS tags
         FROM sites WHERE enabled = 1 ORDER BY featured DESC, weight DESC, sort ASC LIMIT ?`,
      [limit],
    );
    const filtered = await this.postFilter(rows, q);
    return filtered.map((r) => ({ siteId: r.id, score: 1, contributions: {} }));
  }

  private async loadPersonalizable(ids: string[]): Promise<Map<string, PersonalizableSite>> {
    const map = new Map<string, PersonalizableSite>();
    if (ids.length === 0) return map;
    const rows = await this.rawRows(
      `SELECT s.id, s.category_id AS categoryId,
              (SELECT group_concat(t.slug) FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = s.id) AS tags
         FROM sites s WHERE s.id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );
    for (const r of rows) {
      map.set(r.id, { siteId: r.id, categoryId: r.categoryId, tags: r.tags ? r.tags.split(",") : [] });
    }
    return map;
  }

  /** 类目含后代（anchor 物化路径前缀） */
  private async categoryWithDescendants(categoryId: string): Promise<Set<string>> {
    const rows = await this.rawRows(`SELECT anchor FROM categories WHERE id = ?`, [categoryId]);
    // rawRows 返回 SiteRow（为复用统一的行读取路径），这里只取 anchor 字段
    const anchor = (rows[0] as unknown as { anchor?: string } | undefined)?.anchor;
    const ids = new Set<string>([categoryId]);
    if (!anchor) return ids;
    const descendants = await this.rawRows(`SELECT id FROM categories WHERE anchor LIKE ?`, [anchor + "/%"]);
    for (const d of descendants) ids.add(d.id);
    return ids;
  }

  private async siteIdsWithTag(tagSlug: string): Promise<Set<string>> {
    const rows = await this.rawRows(
      `SELECT st.site_id AS id FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE t.slug = ?`,
      [tagSlug],
    );
    return new Set(rows.map((r) => r.id));
  }

  /** 方言无关的原始查询：sqlite 同步、pg 异步，这里统一成 Promise */
  private async rawRows(sqlText: string, params: unknown[]): Promise<SiteRow[]> {
    if (this.deps.db.dialect === "sqlite") {
      const runner = this.deps.db.sqlite!;
      // sqlite 参数不支持 boolean/undefined
      const safe = params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
      return runner.prepare(sqlText).all(...safe) as SiteRow[];
    }
    // pg 用 $1..$n 占位符
    let i = 0;
    const pgSql = sqlText.replace(/\?/g, () => "$" + ++i);
    const res = await this.deps.db.pg!.query(pgSql, params);
    return res.rows as SiteRow[];
  }
}
