import {
  DEFAULT_WEIGHTS,
  fuse,
  looksLikeLatinQuery,
  normalizeQueryPinyin,
  personalCandidates,
  predictFusionWeights,
  type FusionWeights,
  type LinUCBModel,
  type PersonalizableSite,
  type SearchCandidate,
  type SearchChannel,
  type SearchHit,
  type SearchQuery,
  type SearchResult,
} from "@navhub/core";
import type { Db } from "./driver.ts";
import type { FullTextStore } from "./fts.ts";
import { bindSqlite, toPgSql } from "./repository.ts";
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
  bandit?: LinUCBModel | null;
}

export interface SearchEngineOptions {
  /** 每路召回条数（越大越准但越慢）。RRF 需要足够的候选池 */
  perChannel?: number;
}

/**
 * 「启用中」的**值**写法（供 `enabled = <值>` 使用）。
 * SQLite 里 enabled 是 INTEGER(0/1)，PostgreSQL 里是 BOOLEAN；
 * 直接写 `enabled = 1` 在 PG 上会报 "operator does not exist: boolean = integer"。
 */
function enabledValue(dialect: "sqlite" | "pg"): string {
  return dialect === "sqlite" ? "1" : "TRUE";
}

/**
 * 原始行形态。
 *
 * 属性名一律**小写**：PostgreSQL 会把未加引号的别名折叠为小写，
 * 因此统一用小写键可以同时适配两种方言（SQLite 保留原样，但我们的别名也是小写）。
 */
interface SiteRow {
  id: string;
  url: string;
  title: string;
  description: string | null;
  categoryid: string;
  pinyinfull: string;
  pinyininitials: string;
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

  /** 「启用中」的值：SQLite 用 1，PostgreSQL 用 TRUE */
  private get enabled(): string {
    return enabledValue(this.deps.db.dialect);
  }

  get bandit(): LinUCBModel | null {
    return this.deps.bandit ?? null;
  }

  setBandit(bandit: LinUCBModel | null): void {
    this.deps.bandit = bandit;
  }

  async search(q: SearchQuery): Promise<SearchResult> {
    const started = Date.now();
    const limit = q.limit ?? 20;
    const offset = Math.max(0, q.offset ?? 0);
    const raw = (q.q ?? "").trim();
    const weights = this.deps.bandit
      ? predictFusionWeights(this.deps.bandit, raw, this.deps.weights)
      : (this.deps.weights ?? DEFAULT_WEIGHTS);
    // 召回池必须覆盖「已取走的 + 本页要展示的」，否则翻到第 2 页就空了
    const pool = Math.max((offset + limit) * 3, 60);

    // 空查询 = 浏览模式：按 featured/weight/sort 出列表，不经过 RRF
    if (raw.length === 0) {
      const browse = await this.browse(q, limit, offset);
      return {
        hits: browse.hits,
        channelsUsed: [],
        semanticAvailable: this.semanticAvailable,
        tookMs: Date.now() - started,
        offset,
        hasMore: browse.hasMore,
      };
    }

    const hasFilter = Boolean(q.categoryId || q.tag);
    let fallback: SearchResult["fallback"];
    let candidates = await this.runChannels(raw, q, false);

    // ---- 零结果兜底（两级放宽） ----
    // 第 1 级：原查询带类目/标签过滤 → 先怀疑是过滤器太窄（用户常在类目内搜索后
    //          换了想搜的词），去掉过滤重试。这是最常见的「明明有却不显示」。
    if (candidates.length === 0 && hasFilter) {
      const widened = await this.runChannels(raw, { ...q, categoryId: undefined, tag: undefined }, false);
      if (widened.length > 0) {
        candidates = widened;
        fallback = "filter";
      }
    }
    // 第 2 级：拼音从「前缀」放宽为「包含」、英文多词改逐词 OR。
    //   覆盖：搜 "code editor"（整串子串匹配不中，但 code 单词能中）
    //         搜 "tianq"（不在全拼/首字母开头，但包含能中）
    if (candidates.length === 0) {
      const widened = await this.runChannels(raw, q, true);
      if (widened.length > 0) {
        candidates = widened;
        fallback = "fuzzy";
      }
    }

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
      // RRF 是纯函数 → 融合结果稳定，按 offset 切片即可（漂移说明见 types.ts）
      hits: hits.slice(offset, offset + limit),
      channelsUsed: [...used] as SearchChannel[],
      semanticAvailable: this.semanticAvailable,
      tookMs: Date.now() - started,
      offset,
      hasMore: offset + limit < hits.length,
      ...(fallback ? { fallback } : {}),
    };
  }

  /** 并行跑四路召回。fuzzy=true 时放宽拼音与英文匹配（供零结果兜底用）。 */
  private async runChannels(raw: string, opt: SearchQuery, fuzzy: boolean): Promise<SearchCandidate[]> {
    const [exact, ftsHits, pinyin, semantic] = await Promise.all([
      this.channelExact(raw, opt, fuzzy),
      this.channelFts(raw, opt),
      this.channelPinyin(raw, opt, fuzzy),
      opt.disableSemantic ? Promise.resolve([]) : this.channelSemantic(raw, opt),
    ]);
    return [...exact, ...ftsHits, ...pinyin, ...semantic];
  }

  /**
   * 通道 1：子串精确匹配（中文最可靠的一路）。
   *
   * fuzzy 模式下英文长查询按空白/标点拆词，改为逐词 OR——
   * "ai code editor" 作为整串子串匹配不到任何标题，但其中任一词能匹配。
   * 中文不拆（CJK 拆词无意义，语义靠 semantic、相关性靠 fts）。
   */
  private async channelExact(q: string, opt: SearchQuery, fuzzy = false): Promise<SearchCandidate[]> {
    const lowered = q.toLowerCase();
    const terms: string[] = [lowered];
    if (fuzzy && !/[一-鿿]/.test(q)) {
      const parts = q.split(/[\s,;|/]+/).map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2);
      if (parts.length > 1) terms.push(...parts);
    }

    const conditions = [
      "lower(title) LIKE ?", "lower(url) LIKE ?", "lower(coalesce(description,'')) LIKE ?",
      "pinyin_full LIKE ?", "pinyin_initials LIKE ?",
    ];
    // 每个 term 一组 5 个 LIKE；组内 OR、组间 OR
    const orGroups: string[] = [];
    const likeParams: unknown[] = [];
    for (const t of terms) {
      const like = "%" + t + "%";
      orGroups.push("(" + conditions.join(" OR ") + ")");
      likeParams.push(like, like, like, like, like);
    }

    const rows = await this.rawRows(
      `SELECT id, url, title, description, category_id AS categoryid,
              pinyin_full AS pinyinfull, pinyin_initials AS pinyininitials, status, NULL AS tags
         FROM sites
        WHERE enabled = ${this.enabled}
          AND deleted_at IS NULL
          AND (${orGroups.join(" OR ")})
        ORDER BY weight DESC, sort ASC
        LIMIT ?`,
      [...likeParams, this.perChannel],
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
        `SELECT id, url, title, description, category_id AS categoryid,
                pinyin_full AS pinyinfull, pinyin_initials AS pinyininitials, status, NULL AS tags
           FROM sites WHERE id IN (${hits.map(() => "?").join(",")}) AND deleted_at IS NULL`,
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

  /**
   * 通道 3：拼音。
   *
   * 默认前缀匹配（`tianqi` → 中国天气网）；fuzzy 模式改为**包含**匹配，
   * 兜住「打了一半 / 拼错开头 / 非首字母」的查询（如 `tianq`、`gtqw`）。
   */
  private async channelPinyin(q: string, opt: SearchQuery, fuzzy = false): Promise<SearchCandidate[]> {
    if (!looksLikeLatinQuery(q) && !/[\u4e00-\u9fff]/.test(q)) return [];
    const { full, initials } = normalizeQueryPinyin(q);
    if (!full) return [];
    const pattern = fuzzy ? "%" + full + "%" : full + "%";
    const initialPattern = fuzzy ? "%" + initials + "%" : initials + "%";
    const rows = await this.rawRows(
      `SELECT id, url, title, description, category_id AS categoryid,
              pinyin_full AS pinyinfull, pinyin_initials AS pinyininitials, status, NULL AS tags
         FROM sites
        WHERE enabled = ${this.enabled} AND deleted_at IS NULL AND (pinyin_full LIKE ? OR pinyin_initials LIKE ?)
        ORDER BY
          CASE WHEN pinyin_initials = ? THEN 0
               WHEN pinyin_full = ? THEN 0
               WHEN pinyin_initials LIKE ? THEN 1
               ELSE 2 END,
          weight DESC, sort ASC
        LIMIT ?`,
      [pattern, initialPattern, initials, full, initialPattern, this.perChannel],
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
        `SELECT id, url, title, description, category_id AS categoryid,
                pinyin_full AS pinyinfull, pinyin_initials AS pinyininitials, status, NULL AS tags
           FROM sites WHERE id IN (${matches.map(() => "?").join(",")}) AND deleted_at IS NULL`,
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
      out = out.filter((r) => ids.has(r.categoryid));
    }
    if (opt.tag) {
      const ids = await this.siteIdsWithTag(opt.tag);
      out = out.filter((r) => ids.has(r.id));
    }
    return out;
  }

  /** 浏览模式：多取 1 条用于判断 hasMore（避免 COUNT 往返） */
  private async browse(q: SearchQuery, limit: number, offset: number): Promise<{ hits: SearchHit[]; hasMore: boolean }> {
    // 浏览排序：编辑精选(featured) > 热度(trend_score) > 权重(weight) > 手工序(sort)。
    // trend_score 由 recompute_rank 任务写入；为 0 时自然退化为旧行为，
    // 因此这次排序升级对存量数据零影响。
    const wheres: string[] = [`enabled = ${this.enabled}`, "deleted_at IS NULL"];
    const params: unknown[] = [];

    if (q.statuses?.length) {
      wheres.push(`status IN (${q.statuses.map(() => "?").join(",")})`);
      params.push(...q.statuses);
    } else {
      wheres.push(`status != 'archived'`);
    }

    if (q.categoryId) {
      const ids = await this.categoryWithDescendants(q.categoryId);
      if (ids.size > 0) {
        wheres.push(`category_id IN (${[...ids].map(() => "?").join(",")})`);
        params.push(...ids);
      } else {
        return { hits: [], hasMore: false };
      }
    }

    if (q.tag) {
      const ids = await this.siteIdsWithTag(q.tag);
      if (ids.size > 0) {
        wheres.push(`id IN (${[...ids].map(() => "?").join(",")})`);
        params.push(...ids);
      } else {
        return { hits: [], hasMore: false };
      }
    }

    // 多取 1 条 = hasMore 探针；browse 是排行榜而非 RRF，offset 直接下推 SQL
    params.push(limit + 1, offset);
    const rows = await this.rawRows(
      `SELECT id, url, title, description, category_id AS categoryid,
              pinyin_full AS pinyinfull, pinyin_initials AS pinyininitials, status, NULL AS tags
         FROM sites WHERE ${wheres.join(" AND ")}
        ORDER BY featured DESC, trend_score DESC, weight DESC, sort ASC LIMIT ? OFFSET ?`,
      params,
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { hits: page.map((r) => ({ siteId: r.id, score: 1, contributions: {} })), hasMore };
  }

  private async loadPersonalizable(ids: string[]): Promise<Map<string, PersonalizableSite>> {
    const map = new Map<string, PersonalizableSite>();
    if (ids.length === 0) return map;
    const tagExpr = this.deps.db.dialect === "sqlite"
      ? "(SELECT group_concat(t.slug) FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = s.id)"
      : "(SELECT string_agg(t.slug, ',') FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE st.site_id = s.id)";
    const rows = await this.rawRows(
      `SELECT s.id, s.category_id AS categoryid,
              ${tagExpr} AS tags
         FROM sites s WHERE s.id IN (${ids.map(() => "?").join(",")}) AND s.deleted_at IS NULL`,
      ids,
    );
    for (const r of rows) {
      map.set(r.id, { siteId: r.id, categoryId: r.categoryid, tags: r.tags ? r.tags.split(",") : [] });
    }
    return map;
  }

  /** 类目含后代（anchor 物化路径前缀） */
  private async categoryWithDescendants(categoryId: string): Promise<Set<string>> {
    // rawRows 统一返回 SiteRow 形态（复用同一条行读取路径），因此这里需要显式取值
    const rows = await this.rawRows(`SELECT anchor FROM categories WHERE id = ?`, [categoryId]) as unknown as Array<{ anchor?: string }>;
    const anchor = rows[0]?.anchor;
    const ids = new Set<string>([categoryId]);
    if (!anchor) return ids;
    // 必须显式取别名：rawRows 的返回值是按列名取值的，写 `SELECT id` 会得到 { id }，
    // 而下面读的是 d.categoryid —— 之前正是漏了别名导致子类目 id 全是 undefined，
    // 于是「父类目包含子类目」在子类目没有直属站点时返回空结果。
    const descendants = await this.rawRows(
      `SELECT id AS categoryid FROM categories WHERE anchor LIKE ?`,
      [anchor + "/%"],
    ) as unknown as Array<{ categoryid?: string }>;
    for (const d of descendants) if (d.categoryid) ids.add(d.categoryid);
    return ids;
  }

  /**
   * 按标签过滤。
   * 同时匹配 slug 与 name：调用方（前端、MCP）可能传「天气」这种展示名，
   * 只匹配 slug 会让中文标签查不到东西。
   */
  private async siteIdsWithTag(tag: string): Promise<Set<string>> {
    const rows = await this.rawRows(
      `SELECT st.site_id AS id FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE t.slug = ? OR t.name = ?`,
      [tag, tag],
    );
    return new Set(rows.map((r) => r.id));
  }

  /** 方言无关的原始查询：sqlite 同步、pg 异步，这里统一成 Promise */
  private async rawRows(sqlText: string, params: unknown[]): Promise<SiteRow[]> {
    if (this.deps.db.dialect === "sqlite") {
      return this.deps.db.sqlite!.prepare(sqlText).all(...bindSqlite(params)) as SiteRow[];
    }
    // PostgreSQL 用 $1..$n 占位符，且布尔必须是 true/false（不能传 0/1）
    const res = await this.deps.db.pg!.query(toPgSql(sqlText), params);
    // 关键：PostgreSQL 会把**未加引号的别名**折叠成小写，
    // 于是 `AS categoryid` 实际返回列名 `categoryid`，导致 r.categoryid 恒为 undefined。
    // 这里统一把 PG 的列名小写化，读取侧一律用小写属性名。
    return (res.rows as Record<string, unknown>[]).map((r) => {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(r)) out[k.toLowerCase()] = r[k];
      return out as unknown as SiteRow;
    });
  }
}