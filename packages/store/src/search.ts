import {
  DEFAULT_WEIGHTS,
  CHANNELS,
  createLinUCBModel,
  predictArmWeights,
  updateDiscountedArmReward,
  computeDwellTimeReward,
  fuse,
  type LinUCBModel,
  type RetrievalChannel,
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
  findDidYouMeanSuggestion,
  parseFacetedQuery,
} from "@navhub/core";
import type { Db, Dialect } from "./driver.ts";
import type { FullTextStore } from "./fts.ts";
import { bindSqlite, slugify, toPgSql } from "./repository.ts";
import { containsLike, escapeLike, prefixLike } from "./sql-like.ts";
import { chunkList } from "./sql-in.ts";
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
  repo?: {
    getSystemState<T = unknown>(key: string): Promise<T | null>;
    setSystemState(key: string, value: unknown): Promise<void>;
  };
}

export interface SearchEngineOptions {
  /** 每路召回条数（越大越准但越慢）。RRF 需要足够的候选池 */
  perChannel?: number;
  /**
   * Query Planner 强精确命中 early-exit 阈值。
   * exact 通道命中数 >= 该值时直接跳过 semantic（省一次 embedding 推理），默认 5。
   * 设为 0 关闭 early-exit（全通道恒跑，便于离线评估与回归对比）。
   */
  earlyExitExactHits?: number;
  /**
   * 语义通道的余弦相似度闸门：低于该值的向量命中不进入候选池。
   * 0（默认）= 关闭闸门，保持旧行为；API 层按 NAVHUB_SEMANTIC_MIN_SIMILARITY 注入。
   * 只认 VectorMatch.similarity —— 各存储实现的 distance 度量不同（L2 / 余弦），
   * 拿 distance 当阈值会在换存储后端时静默改变语义。
   */
  semanticMinSimilarity?: number;
  /**
   * 语义独占时的严格闸门：词法通道（exact/fts/pinyin）全线无命中、结果只剩
   * 语义近邻时，低于该值的候选在融合前剔除。
   *
   * 为什么需要第二档：KNN 对任何输入都返回 top-N，bge 这类模型对无关文本的
   * 余弦相似度本来就集中在 0.5 上下（各向异性），基础闸门 0.4 挡不住——
   * 乱码查询会拿到一批「最像的噪声」并伪装成结果。宁可给出诚实的零结果，
   * 让 didYouMean 接手纠错，也不假装配对。
   *
   * 默认 0.55；0 表示关闭；基础闸门为 0（显式关闭相似度过滤）时不生效，
   * 严格闸门比基础闸门更松时也不生效（基础闸门已经更严）。
   */
  semanticOnlyMinSimilarity?: number;
}

/**
 * 单次检索各通道耗时明细（供 Query Planner 调参与 OTel/Prometheus 透出）。
 *
 * 计量口径：各通道**自身**从发起到 resolve 的墙钟毫秒。fts/pinyin/semantic 是并行执行的，
 * 区间可以相互重叠 —— 三者之和允许大于请求总耗时，端到端时间看 SearchResult.tookMs。
 */
export interface ChannelTimings {
  exactMs: number;
  ftsMs: number;
  pinyinMs: number;
  semanticMs: number;
  skippedSemantic: boolean;
  /**
   * 被相似度闸门剔除的向量命中数。
   * 基础闸门在通道内回表前统计；语义独占的严格闸门在融合前追加统计。
   * 两档都关闭时恒为 0。
   */
  semanticFiltered: number;
}

/**
 * 单次检索内共享的过滤集合缓存。
 *
 * 为什么需要：category/tag/facets 三组过滤是**通道无关**的，但四个通道各自
 * 调一次 postFilter —— 一个带类目+标签+2 个分面的查询，同一份过滤集合会被
 * 重复算 4 次（每次 3~5 条 SQL），纯属浪费。这里让同一次 search 内只算一次。
 *
 * 只挂在单次 search 的局部变量上，不放到实例上 —— 放实例就成了跨请求共享，
 * 并发下会把 A 用户的过滤集合套到 B 用户的查询上。
 */
interface FilterCache {
  category?: Promise<Set<string>>;
  tag?: Promise<Set<string>>;
  /**
   * 多标签**交集**集合。
   *
   * 只挂在单次 search 的局部变量上，不放到实例上 —— 放实例就成了跨请求共享，
   * 并发下会把 A 用户的过滤集合套到 B 用户的查询上。
   */
  tags?: Promise<Set<string>>;
  facets?: Promise<Set<string>>;
}

/**
 * 「启用中」的**值**写法（供 `enabled = <值>` 使用）。
 * SQLite 里 enabled 是 INTEGER(0/1)，PostgreSQL 里是 BOOLEAN；
 * 直接写 `enabled = 1` 在 PG 上会报 "operator does not exist: boolean = integer"。
 */
function enabledValue(dialect: Dialect): string {
  return dialect === "pg" ? "TRUE" : "1";
}

/**
 * trigram 子串索引能服务的最短查询是 3 个码点：SQLite 的 trigram 分词器
 * 只把长度 ≥3 的片段切三元组，更短的词 MATCH 恒为空。短词必须继续走 LIKE。
 */
export function trigramEligible(term: string): boolean {
  return Array.from(term).length >= 3;
}

/**
 * FTS5 字符串字面量：双引号包裹、内部双引号翻倍。
 * 用户输入的 `"`、`*`、`-`、`OR` 等都不能被当成查询语法。
 */
export function ftsPhrase(term: string): string {
  return '"' + term.replace(/"/g, '""') + '"';
}

/**
 * pinyin_full / pinyin_initials 只含 `[a-z0-9]`（见 @navhub/core/pinyin.ts），
 * 含空格、符号或中文的查询词与它们必然不匹配——跳过这两个 LIKE 分支
 * 结果不变，但中文查询每次能省掉一次 `sites` 全表扫描。
 */
export function pinyinMatchable(term: string): boolean {
  return /^[a-z0-9]+$/.test(term);
}

/**
 * 把检索算子还原成字面词：`#tag` / `@分类` / `tag:` / `pricing:` 等前缀剥掉，
 * 保留用户真正输入的词。仅用于「算子过滤后一无所获」的字面回落。
 */
function stripSearchOperators(raw: string): string {
  return raw
    .replace(/(^|\s)[#@](?=[A-Za-z0-9_\u4e00-\u9fa5-])/g, "$1")
    .replace(/(^|\s)(?:tag|标签|cat|category|类目|分类|pricing|platform|form|language|lang|计费|平台|形态|语言):/gi, "$1")
    .replace(/["“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 拼写建议词表：整条标题/标签名 + 其中的英文词元。
 *
 * 只切英文词元：中文串做「编辑距离 ≤2」的纠错没有意义（两字之差就是另一个词），
 * 而产品名几乎都写在英文段里（「Docker 官方文档」→ docker）。
 * 旧实现只取**无序前 100 行**标题当词表，"dockr" 之类的拼写错误能否被纠
 * 取决于数据库返回顺序——这里改为全量 + 词元，结果对同一份数据稳定可复现。
 */
function buildSpellingDictionary(terms: string[]): string[] {
  const out = new Set<string>();
  for (const term of terms) {
    const clean = term.trim();
    if (!clean) continue;
    out.add(clean);
    for (const word of clean.split(/[^A-Za-z0-9+#]+/)) {
      if (word.length >= 3) out.add(word);
    }
  }
  return [...out];
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
  private earlyExitExactHits: number;
  private semanticMinSimilarity: number;
  private semanticOnlyMinSimilarity: number;
  private linucbModel: LinUCBModel;
  private feedbackCount = 0;
  private savingPromise: Promise<void> | null = null;
  private readonly MODEL_STATE_KEY = "model:linucb:search";
  /** 最近一次检索的通道耗时（供 /api/search 透出与 Prometheus 采集） */
  private lastTimings: ChannelTimings | null = null;

  constructor(deps: SearchEngineDeps, opts: SearchEngineOptions = {}) {
    this.deps = deps;
    this.perChannel = opts.perChannel ?? 50;
    this.earlyExitExactHits = opts.earlyExitExactHits ?? 5;
    const gate = opts.semanticMinSimilarity ?? 0;
    this.semanticMinSimilarity = Number.isFinite(gate) ? Math.min(1, Math.max(0, gate)) : 0;
    const strictGate = opts.semanticOnlyMinSimilarity ?? 0.55;
    this.semanticOnlyMinSimilarity = Number.isFinite(strictGate)
      ? Math.min(1, Math.max(0, strictGate))
      : 0.55;
    this.linucbModel = createLinUCBModel(0.15);
  }

  /** 最近一次 search() 的通道耗时明细；search 前为 null */
  getLastTimings(): ChannelTimings | null {
    return this.lastTimings;
  }

  /**
   * 从持久化存储还原 LinUCB 在线学习模型参数
   */
  async initLinUCB(): Promise<void> {
    if (!this.deps.repo) return;
    try {
      const saved = await this.deps.repo.getSystemState<{
        model: LinUCBModel;
        feedbackCount: number;
      }>(this.MODEL_STATE_KEY);
      if (saved?.model?.arms && saved.model.dimension === this.linucbModel.dimension) {
        this.linucbModel = saved.model;
        this.feedbackCount = saved.feedbackCount ?? 0;
      }
    } catch {
      // 容错降级
    }
  }

  /**
   * 将当前 LinUCB 模型参数异步快照刷入持久化存储
   */
  async flushLinUCB(): Promise<void> {
    if (!this.deps.repo) return;
    try {
      await this.deps.repo.setSystemState(this.MODEL_STATE_KEY, {
        model: this.linucbModel,
        feedbackCount: this.feedbackCount,
        updatedAt: Date.now(),
      });
    } catch {
      // 容错
    }
  }

  /**
   * 导出 LinUCB 在线多臂老虎机模型遥测指标（供管理端仪表盘展现各检索通道权重演进）
   */
  getLinUCBTelemetry(): {
    dimension: number;
    alpha: number;
    feedbackCount: number;
    arms: Record<RetrievalChannel, { bNorm: number; bSum: number; weightEstimate: number }>;
  } {
    const armsTelemetry = {} as Record<RetrievalChannel, { bNorm: number; bSum: number; weightEstimate: number }>;
    for (const ch of CHANNELS) {
      const arm = this.linucbModel.arms[ch];
      if (!arm) continue;
      const b = arm.b || [];
      const bSum = b.reduce((s, v) => s + v, 0);
      const bNorm = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
      // 权重估值：以基准权重 1.0 + 累加奖励反馈偏移
      const weightEstimate = Math.round((1.0 + bSum) * 100) / 100;
      armsTelemetry[ch] = {
        bNorm: Math.round(bNorm * 1000) / 1000,
        bSum: Math.round(bSum * 1000) / 1000,
        weightEstimate,
      };
    }

    return {
      dimension: this.linucbModel.dimension,
      alpha: this.linucbModel.alpha,
      feedbackCount: this.feedbackCount,
      arms: armsTelemetry,
    };
  }

  /**
   * 在线强化学习反馈更新：根据用户点击/驻留行为实时更新 Discounted-LinUCB 模型
   */
  recordFeedback(
    channel: RetrievalChannel,
    query: string,
    rewardOrDwell?: { reward?: number; dwellSeconds?: number; interactionType?: "click" | "copy" | "bounce" }
  ): void {
    const q = (query ?? "").trim();
    if (!q) return;
    const reward =
      rewardOrDwell?.reward !== undefined
        ? rewardOrDwell.reward
        : rewardOrDwell?.dwellSeconds !== undefined
          ? computeDwellTimeReward(rewardOrDwell.dwellSeconds, rewardOrDwell.interactionType ?? "click")
          : 1.0;
    updateDiscountedArmReward(this.linucbModel, channel, q, reward, 0.98);
    this.feedbackCount++;
    // 每 10 次交互反馈自动进行一次轻量后台落库
    if (this.feedbackCount % 10 === 0 && this.deps.repo && !this.savingPromise) {
      this.savingPromise = this.flushLinUCB().finally(() => {
        this.savingPromise = null;
      });
    }
  }

  /**
   * 获取当前在线 LinUCB 模型快照与针对指定查询词的预测动态权重。
   *
   * 只回摘要（维度/探索系数/各臂的 b 范数与权重估值），不回原始 A/b 矩阵：
   * 调用方是管理端探针，矩阵属于排序器内部状态，没有展示需求。
   */
  getLinUCBStatus(sampleQuery = "react"): {
    feedbackCount: number;
    dimension: number;
    alpha: number;
    predictedWeights: Record<RetrievalChannel, number>;
    arms: Record<RetrievalChannel, { bNorm: number; bSum: number; weightEstimate: number }>;
  } {
    const basePriors: Record<RetrievalChannel, number> = {
      exact: DEFAULT_WEIGHTS.exact ?? 1.4,
      fts: DEFAULT_WEIGHTS.fts ?? 1.0,
      pinyin: DEFAULT_WEIGHTS.pinyin ?? 0.9,
      semantic: DEFAULT_WEIGHTS.semantic ?? 1.15,
      personal: DEFAULT_WEIGHTS.personal ?? 0.3,
    };
    const telemetry = this.getLinUCBTelemetry();
    return {
      feedbackCount: telemetry.feedbackCount,
      dimension: telemetry.dimension,
      alpha: telemetry.alpha,
      predictedWeights: predictArmWeights(this.linucbModel, sampleQuery, basePriors),
      arms: telemetry.arms,
    };
  }

  get semanticAvailable(): boolean {
    return Boolean(this.deps.vectors && this.deps.embed);
  }

  /** 「启用中」的值：SQLite 用 1，PostgreSQL 用 TRUE */
  private get enabled(): string {
    return enabledValue(this.deps.db.dialect);
  }

  /**
   * 同义词/别名扩展结果的短 TTL 缓存。
   *
   * `expandQueryTerms` 在**每次**检索前串行跑 2 条查询，是召回开始前的固定延迟。
   * 别名表与类目 alt_labels 变动极少（管理端手工维护），60 秒的新鲜度足够，
   * 却能把热门查询的这部分往返直接省掉。缓存按查询词分桶并设上限，
   * 避免高基数查询把内存撑爆。
   */
  private expansionCache = new Map<string, { at: number; terms: string[] }>();
  private static readonly EXPANSION_TTL_MS = 60_000;
  private static readonly EXPANSION_CACHE_MAX = 512;

  /**
   * 类目子树解析结果的短 TTL 缓存。
   *
   * categoryWithDescendants 是全站最热的重复读：每个类目页、每次带 categoryId 的
   * 检索都要付 1~3 次解析查询 + 一次 anchor 前缀扫描，而类目树由管理端手工维护、
   * 几乎不变。此前只有单次检索内的 FilterCache 复用（browse 分支甚至不走它），
   * 跨请求每次都重跑。
   *
   * 与 expansionCache 同构：60s TTL + 上限 FIFO。失效靠 invalidateCategoryTree()，
   * 类目增删改（写路径）必须调用它，否则最长 60s 内新类目搜不到。
   */
  private categoryTreeCache = new Map<string, { at: number; ids: Set<string> }>();
  private static readonly CATEGORY_TREE_TTL_MS = 60_000;
  private static readonly CATEGORY_TREE_CACHE_MAX = 512;

  /** 类目写路径调用：类目增删改后清空子树缓存，避免最长 60s 的陈旧解析。 */
  invalidateCategoryTree(): void {
    this.categoryTreeCache.clear();
  }

  /**
   * 基于 tag_aliases 与 categories.alt_labels 的同义词/知识图谱查询扩展
   */
  private async expandQueryTerms(raw: string): Promise<string[]> {
    const norm = raw.trim().toLowerCase();
    if (!norm) return [];
    const cached = this.expansionCache.get(norm);
    if (cached && Date.now() - cached.at < SearchEngine.EXPANSION_TTL_MS) return cached.terms;
    const terms = await this.loadExpandedTerms(norm);
    if (this.expansionCache.size >= SearchEngine.EXPANSION_CACHE_MAX) {
      // 简单的 FIFO 淘汰：Map 保持插入顺序，删最早的即可
      const oldest = this.expansionCache.keys().next();
      if (!oldest.done) this.expansionCache.delete(oldest.value);
    }
    this.expansionCache.set(norm, { at: Date.now(), terms });
    return terms;
  }

  private async loadExpandedTerms(norm: string): Promise<string[]> {
    const terms = [norm];
    try {
      // 1. 查 tag_aliases 别名表与主标签
      const aliasRows = (await this.rawRows(
        `SELECT t.name, t.slug, ta.alias
           FROM tag_aliases ta
           JOIN tags t ON t.id = ta.tag_id
          WHERE lower(ta.alias) = ? OR lower(t.slug) = ? OR lower(t.name) = ?
          LIMIT 3`,
        [norm, norm, norm]
      )) as unknown as Array<{ name?: string; slug?: string; alias?: string }>;

      for (const r of aliasRows) {
        if (r.name) terms.push(r.name.toLowerCase());
        if (r.slug) terms.push(r.slug.toLowerCase());
        if (r.alias) terms.push(r.alias.toLowerCase());
      }

      // 2. 查 categories.alt_labels (JSON 数组)
      const catRows = (await this.rawRows(
        `SELECT title, alt_labels FROM categories WHERE alt_labels LIKE ? ESCAPE '!' LIMIT 2`,
        [`%${escapeLike(JSON.stringify(norm))}%`]
      )) as unknown as Array<{ title?: string; alt_labels?: string }>;

      for (const c of catRows) {
        if (c.title) terms.push(c.title.toLowerCase());
      }
    } catch {
      // 容错降级
    }
    return [...new Set(terms.filter(Boolean))];
  }

  async search(q: SearchQuery): Promise<SearchResult> {
    const started = Date.now();
    const limit = q.limit ?? 20;
    const offset = Math.max(0, q.offset ?? 0);
    const raw = (q.q ?? "").trim();

    // 智能分面修饰符与高级检索算子解析（如 "开源 矢量设计" 或 "cat:tools #design -adobe"）
    const parsedIntent = parseFacetedQuery(raw);
    const hasInferredFacets = Object.keys(parsedIntent.inferredFacets).length > 0;
    const effectiveFacets = hasInferredFacets
      ? { ...parsedIntent.inferredFacets, ...(q.facets ?? {}) }
      : q.facets;
    const effectiveTag = q.tag ?? parsedIntent.inferredTag;
    const effectiveCategory = q.categoryId ?? parsedIntent.inferredCategory;
    const effectiveExcluded = [...(q.excludedTerms ?? []), ...(parsedIntent.excludedTerms ?? [])];
    let effectiveQuery = parsedIntent.cleanedQuery;
    /**
     * mode 与 disableSemantic 二选一的**唯一裁定点**。
     *
     * mode 是新的声明式写法（"hybrid" / "keyword" / "semantic"），disableSemantic
     * 是旧开关。两者都给出时以 mode 为准，否则「mode=hybrid + disableSemantic:true」
     * 这种自相矛盾的入参会随调用方构造对象的顺序漂移——同一个请求两种行为。
     *
     * 未给 mode 时原样保留 disableSemantic：既有调用方（含本仓测试）全部走这条路径，
     * 行为逐字不变。
     *
     * "semantic" 只保留语义通道：词法三通道照跑（它们的 SQL 比一次 embedding
     * 推理便宜得多，且 early-exit 逻辑依赖 exact 命中数），但候选在融合前被剔除，
     * 因此**排序与召回集合**都只来自语义近邻 —— 与「只跑语义」等价，
     * 但又不用为它单独复制一套 runChannels 分支。
     */
    const wantSemanticOnly = q.mode === "semantic";
    const effectiveDisableSemantic = q.mode
      ? q.mode === "keyword"
      : Boolean(q.disableSemantic);
    let effectiveOpt: SearchQuery = {
      ...q,
      tag: effectiveTag,
      categoryId: effectiveCategory,
      facets: effectiveFacets,
      excludedTerms: effectiveExcluded.length > 0 ? effectiveExcluded : undefined,
      disableSemantic: effectiveDisableSemantic,
      mode: q.mode,
    };

    // 若已累积在线强化学习反馈且未硬性锁死静态权重，启用 Discounted-LinUCB 动态情境权重
    const weights: FusionWeights =
      this.deps.weights ??
      (this.feedbackCount > 0 && effectiveQuery.length > 0
        ? {
            ...DEFAULT_WEIGHTS,
            ...predictArmWeights(this.linucbModel, effectiveQuery, {
              exact: DEFAULT_WEIGHTS.exact ?? 1.4,
              fts: DEFAULT_WEIGHTS.fts ?? 1.0,
              pinyin: DEFAULT_WEIGHTS.pinyin ?? 0.9,
              semantic: DEFAULT_WEIGHTS.semantic ?? 1.15,
              personal: DEFAULT_WEIGHTS.personal ?? 0.3,
            }),
          }
        : DEFAULT_WEIGHTS);
    // 召回池必须覆盖「已取走的 + 本页要展示的」，否则翻到第 2 页就空了。
    // 但只放大 fuse 的 pool 不够：每个通道自己的 LIMIT 仍是固定 perChannel(50)，
    // 过滤（类目/标签/分面）又在通道 LIMIT 之后执行——第 10 页时前 500 条里
    // 可能只剩几条符合过滤条件，页面直接空。因此按页码同步放大**通道召回数**，
    // 封顶 500，避免深翻页把整库读进内存。
    const recall = Math.max(this.perChannel, Math.min((offset + limit) * 5, 500));
    const pool = Math.max((offset + limit) * 3, 60);

    const hasParsedIntent =
      hasInferredFacets || Boolean(parsedIntent.inferredTag) || Boolean(parsedIntent.inferredCategory);

    // 空查询 = 浏览模式：按 featured/trend_score/sort 出列表，不经过 RRF
    let literalFallback = false;
    if (effectiveQuery.length === 0) {
      const browse = await this.browse(effectiveOpt, limit, offset);
      const browseResult: SearchResult = {
        hits: browse.hits,
        channelsUsed: [],
        semanticAvailable: this.semanticAvailable,
        tookMs: Date.now() - started,
        offset,
        hasMore: browse.hasMore,
        ...(hasInferredFacets ? { inferredFacets: parsedIntent.inferredFacets } : {}),
        ...(parsedIntent.inferredTag ? { inferredTag: parsedIntent.inferredTag } : {}),
        ...(parsedIntent.inferredCategory ? { inferredCategory: parsedIntent.inferredCategory } : {}),
        ...(effectiveExcluded.length > 0 ? { excludedTerms: effectiveExcluded } : {}),
      };
      if (browse.hits.length > 0 || !hasParsedIntent) return browseResult;
      // 自然语言分面/算子可以把整句吃光（「开源」「插件」「@design」），过滤后却一条不剩。
      // 这些词大概率就是用户想搜的文本 —— 退回字面检索，否则用户看到的是「有这个词却零结果」。
      // 显式过滤（URL 上的 tag/category/facets 参数）仍保留，只丢推断出来的那部分。
      const literal = stripSearchOperators(raw);
      if (literal.length === 0) return browseResult;
      effectiveQuery = literal;
      effectiveOpt = { ...effectiveOpt, categoryId: q.categoryId, tag: q.tag, tags: q.tags, facets: q.facets };
      literalFallback = true;
    }

    // 语义与知识图谱同义词扩展
    const expandedTerms = await this.expandQueryTerms(effectiveQuery);

    const hasFilter = Boolean(
      effectiveOpt.categoryId ||
      effectiveOpt.tag ||
      (effectiveOpt.tags && effectiveOpt.tags.length > 0) ||
      (effectiveOpt.facets && Object.keys(effectiveOpt.facets).length > 0)
    );
    /**
     * mode="semantic" 的通道裁剪：只留语义候选。
     *
     * 为什么在**每次** runChannels 之后立刻裁，而不是融合前统一裁一次：
     * 下面的零结果兜底按 candidates.length === 0 决定是否放宽过滤重试，
     * 若留到融合前才裁，词法命中会让兜底判定为「有结果」而不再重试，
     * 裁完却一条不剩 —— 用户拿到零结果且没有任何放宽提示。
     */
    const keepModeChannels = (list: SearchCandidate[]): SearchCandidate[] =>
      wantSemanticOnly ? list.filter((c) => c.channel === "semantic") : list;
    let fallback: SearchResult["fallback"];
    // 过滤集合按「一次 search」缓存，四个通道共用 —— 见 FilterCache 注释
    const filterCache: FilterCache = {};
    let { candidates, timings } = await this.runChannels(
      effectiveQuery,
      effectiveOpt,
      false,
      expandedTerms,
      filterCache,
      recall,
    );
    candidates = keepModeChannels(candidates);

    // ---- 零结果兜底（两级放宽） ----
    // 第 1 级：原查询带类目/标签/分面正向过滤 → 先怀疑是过滤器太窄，去掉正向过滤重试（负向排除关键词仍坚决保留）
    if (candidates.length === 0 && hasFilter) {
      const widened = await this.runChannels(
        effectiveQuery,
        { ...effectiveOpt, categoryId: undefined, tag: undefined, tags: undefined, facets: undefined },
        false,
        expandedTerms,
        filterCache,
        recall,
      );
      const widenedKept = keepModeChannels(widened.candidates);
      if (widenedKept.length > 0) {
        candidates = widenedKept;
        timings = widened.timings;
        fallback = "filter";
      }
    }
    // 第 2 级：拼音从「前缀」放宽为「包含」、英文多词改逐词 OR。
    if (candidates.length === 0) {
      const widened = await this.runChannels(effectiveQuery, effectiveOpt, true, expandedTerms, filterCache, recall);
      const widenedKept = keepModeChannels(widened.candidates);
      if (widenedKept.length > 0) {
        candidates = widenedKept;
        timings = widened.timings;
        fallback = "fuzzy";
      }
    }
    // 字面回落：结果来自「丢掉推断过滤」，如实按筛选放宽上报（前端据此提示）
    if (literalFallback && candidates.length > 0 && !fallback) fallback = "filter";

    // 语义独占的严格闸门：词法通道全线无命中时，剩下的只有「最近的向量邻居」。
    // KNN 对任何输入都有输出，乱码查询的最近邻相似度也能到 0.5 上下（bge 的各向异性），
    // 基础闸门 0.4 拦不住——这里再卡一刀，宁可零结果交给 didYouMean 纠错，也不假装配对。
    // 有词法命中时不开：弱语义只是低权重补充，RRF 已有权重兜底，不该整刀剔除。
    const lexicalHits = candidates.filter((c) => c.channel !== "semantic" && c.channel !== "personal");
    if (
      lexicalHits.length === 0 &&
      this.semanticMinSimilarity > 0 &&
      this.semanticOnlyMinSimilarity > this.semanticMinSimilarity
    ) {
      const before = candidates.length;
      candidates = candidates.filter(
        (c) => c.channel !== "semantic" || (c.similarity ?? 0) >= this.semanticOnlyMinSimilarity
      );
      timings.semanticFiltered += before - candidates.length;
    }

    // 拼写建议 (Did You Mean)：零结果，或**只有语义近邻、没有任何关键词命中**时计算。
    // 语义 KNN 对任何输入都返回最近邻，若只在零候选时算，带向量库的生产环境里
    // 这个功能永远不可达——拼错的词只会得到一批「最像的」站点，没有任何纠错提示。
    const semanticOnly = candidates.length > 0 && lexicalHits.length === 0;
    let didYouMean: string | undefined;
    /**
     * 纠错建议的最短查询长度：**拉丁按 3、中文按 2**。
     *
     * 为什么按书写系统分档：硬卡 3 的本意是挡掉 go/ai 这类 2 字母缩写召出的噪声建议，
     * 但汉字信息密度高，2 字已是完整词（小说/简历/面试/字体/翻译/代理…）——实测这批
     * 2 字查询在真实查询里占比很大，卡 3 等于让它们**永远拿不到纠错**，只剩一批
     * 「语义上最像」的站点，用户看到的是答非所问且无从纠正。中文下限降到 2。
     */
    const suggestMinLen = /[\u4e00-\u9fa5]/.test(effectiveQuery) ? 2 : 3;
    if ((candidates.length === 0 || semanticOnly) && effectiveQuery.length >= suggestMinLen) {
      try {
        const siteRows = (await this.rawRows(
          `SELECT title FROM sites WHERE deleted_at IS NULL AND enabled = ${this.enabled} LIMIT 5000`,
          []
        )) as unknown as Array<{ title?: string }>;
        const tagRows = (await this.rawRows(
          `SELECT name FROM tags LIMIT 5000`,
          []
        )) as unknown as Array<{ name?: string }>;
        const dict = buildSpellingDictionary([
          ...siteRows.map((r) => r.title || ""),
          ...tagRows.map((r) => r.name || ""),
        ]);
        const suggestion = findDidYouMeanSuggestion(effectiveQuery, dict, 2);
        if (suggestion) didYouMean = suggestion;
      } catch {
        // 容错降级
      }
    }

    // 个性化作为独立通道参与融合
    if (effectiveOpt.personalize && !effectiveOpt.disablePersonal && candidates.length > 0) {
      const recalled = [...new Set(candidates.map((c) => c.siteId))];
      const sites = await this.loadPersonalizable(recalled);
      candidates.push(...personalCandidates(sites, effectiveOpt.personalize));
    }

    const hits: SearchHit[] = fuse(candidates, weights, pool);

    const used = new Set(candidates.map((c) => c.channel));
    // 兼容旧调用方（getLastTimings）；请求内请优先读 result.channelTimings ——
    // 实例字段在并发下会被其它请求覆盖，只有返回值是本请求自己的。
    this.lastTimings = timings;
    return {
      hits: hits.slice(offset, offset + limit),
      channelsUsed: [...used] as SearchChannel[],
      semanticAvailable: this.semanticAvailable,
      tookMs: Date.now() - started,
      offset,
      hasMore: offset + limit < hits.length,
      ...(fallback ? { fallback } : {}),
      ...(timings.skippedSemantic && !effectiveOpt.disableSemantic ? { planner: "early-exit" as const } : {}),
      channelTimings: timings,
      ...(hasInferredFacets && !literalFallback ? { inferredFacets: parsedIntent.inferredFacets } : {}),
      ...(parsedIntent.inferredTag && !literalFallback ? { inferredTag: parsedIntent.inferredTag } : {}),
      ...(parsedIntent.inferredCategory && !literalFallback
        ? { inferredCategory: parsedIntent.inferredCategory }
        : {}),
      ...(effectiveExcluded.length > 0 ? { excludedTerms: effectiveExcluded } : {}),
      ...(didYouMean ? { didYouMean } : {}),
      ...(expandedTerms.length > 1 ? { queryExpansion: expandedTerms } : {}),
    };
  }

  /**
   * Query Planner：先跑 exact（~1ms），强命中直接跳过 semantic。
   * fuzzy=true（零结果兜底）时恒跑全通道，保证召回最大化。
   *
   * 通道耗时按「各通道自身墙钟」计量（并行区间可重叠）：旧实现把整批 await 时间
   * 同值写进 fts/pinyin/semantic 三个字段，Prometheus 上 fts/pinyin 均值被语义推理
   * 时间污染（三个通道永远同值），通道画像失真。
   */
  private async runChannels(
    raw: string,
    opt: SearchQuery,
    fuzzy: boolean,
    extraTerms: string[] = [],
    cache: FilterCache = {},
    recall: number = this.perChannel,
  ): Promise<{ candidates: SearchCandidate[]; timings: ChannelTimings }> {
    const t0 = Date.now();
    const exact = await this.channelExact(raw, opt, fuzzy, extraTerms, cache, recall);
    const exactMs = Date.now() - t0;
    /** 按通道计时：返回 [通道结果, 该通道墙钟毫秒] */
    const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
      const started = Date.now();
      const value = await fn();
      return [value, Date.now() - started];
    };
    // early-exit：精确命中足够强时，语义通道的 embedding 推理是纯浪费（首次 300ms+）。
    // mode="semantic" 时**不得**剪枝：用户明确只要语义结果，剪掉就一条不剩，
    // 而候选在 search() 里会被裁成只剩语义 —— 结果是恒零且没有任何降级提示。
    if (
      !fuzzy &&
      !opt.disableSemantic &&
      opt.mode !== "semantic" &&
      this.earlyExitExactHits > 0 &&
      exact.length >= this.earlyExitExactHits
    ) {
      const [[ftsHits, ftsMs], [pinyin, pinyinMs]] = await Promise.all([
        timed(() => this.channelFts(raw, opt, extraTerms, cache, recall)),
        timed(() => this.channelPinyin(raw, opt, false, cache, recall)),
      ] as const);
      return {
        candidates: [...exact, ...ftsHits, ...pinyin],
        timings: { exactMs, ftsMs, pinyinMs, semanticMs: 0, skippedSemantic: true, semanticFiltered: 0 },
      };
    }
    const semanticStats = { filtered: 0 };
    const [[ftsHits, ftsMs], [pinyin, pinyinMs], [semantic, semanticMs]] = await Promise.all([
      timed(() => this.channelFts(raw, opt, extraTerms, cache, recall)),
      timed(() => this.channelPinyin(raw, opt, fuzzy, cache, recall)),
      timed(() =>
        opt.disableSemantic
          ? Promise.resolve<SearchCandidate[]>([])
          : this.channelSemantic(raw, opt, cache, recall, semanticStats),
      ),
    ] as const);
    return {
      candidates: [...exact, ...ftsHits, ...pinyin, ...semantic],
      timings: {
        exactMs,
        ftsMs,
        pinyinMs,
        semanticMs: opt.disableSemantic ? 0 : semanticMs,
        skippedSemantic: Boolean(opt.disableSemantic),
        semanticFiltered: opt.disableSemantic ? 0 : semanticStats.filtered,
      },
    };
  }

  /**
   * 通道 1：子串精确匹配（支持站点标签、多词交叉检索与同义词扩展）。
   *
   * 排序分档（粗到细，见下方 ORDER BY）：标题精确 > 标题包含 > **标签精确** >
   * 标签包含 > 标题首词 > 其它。加中间两档的原因：此前只有标题参与分档，
   * 标签与描述同落最后一档、再按 trend_score 排，于是「热门但不相关」的站会
   * 压过「标签就是这个词」的站——实测搜「代理」时 OpenHands（tag=开发代理）
   * 排在 Nginx（tag=代理）之前、搜「k8s」时 containerd 压过 Knative（tag=k8s）。
   * 标签是人工策划的强相关信号，必须先于热度。
   */
  private async channelExact(q: string, opt: SearchQuery, fuzzy = false, extraTerms: string[] = [], cache?: FilterCache, limit = this.perChannel): Promise<SearchCandidate[]> {
    const lowered = q.toLowerCase();
    const tokens = q.split(/[\s,;|/]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    const terms: string[] = [lowered, ...extraTerms.map((t) => t.toLowerCase())];
    if (fuzzy) {
      const parts = tokens.filter((t) => t.length >= 2);
      if (parts.length > 1) terms.push(...parts);
    }
    const uniqueTerms = [...new Set(terms.filter(Boolean))];
    if (uniqueTerms.length === 0) return [];

    // 每个匹配来源独立成一个 SELECT 分支，再 UNION 成候选 id 集。
    // 不能把这些条件写成一个 OR：只要 OR 里有一条前导通配符 LIKE 无法索引，
    // SQLite 就会放弃 trigram 索引、退化成全表扫描（P1-3 实测的规划器行为）。
    const trigram = this.trigramTable();
    const branches = uniqueTerms.flatMap((term) => this.termBranches(term, trigram));
    // 多词且非 fuzzy 模式下，增加所有 token 的文本交叉与 (AND) 条件
    // 使得 "react 状态" 能成功召回 Title="React..." 且 Description="...状态管理..." 的多词交叉站点
    const multi = !fuzzy && tokens.length > 1 ? this.multiTokenBranch(tokens, trigram) : null;
    if (multi) branches.push(multi);

    const pre = await this.buildPreFilterClauses(opt, cache);
    if (pre.empty) return [];
    const extraWhere = pre.wheres.length > 0 ? " AND " + pre.wheres.join(" AND ") : "";

    const rows = await this.rawRows(
      `SELECT id, url, title, description, category_id AS categoryid,
              pinyin_full AS pinyinfull, pinyin_initials AS pinyininitials, status, NULL AS tags
         FROM sites
        WHERE enabled = ${this.enabled}
          AND deleted_at IS NULL
          AND id IN (${branches.map((b) => b.sql).join(" UNION ")})
          ${extraWhere}
        ORDER BY
          CASE WHEN lower(title) = ? THEN 0
               WHEN lower(title) LIKE ? ESCAPE '!' THEN 1
               WHEN EXISTS (SELECT 1 FROM site_tags st JOIN tags t ON t.id = st.tag_id
                             WHERE st.site_id = sites.id AND (lower(t.name) = ? OR t.slug = ?)) THEN 2
               WHEN EXISTS (SELECT 1 FROM site_tags st JOIN tags t ON t.id = st.tag_id
                             WHERE st.site_id = sites.id AND (lower(t.name) LIKE ? ESCAPE '!' OR lower(t.slug) LIKE ? ESCAPE '!')) THEN 3
               WHEN lower(title) LIKE ? ESCAPE '!' THEN 4
               ELSE 5 END,
          weight DESC, trend_score DESC, sort ASC, id ASC
        LIMIT ?`,
      [
        ...branches.flatMap((b) => b.params),
        ...pre.params,
        lowered,
        containsLike(lowered),
        lowered,
        lowered,
        containsLike(lowered),
        containsLike(lowered),
        containsLike(tokens[0] || lowered),
        limit,
      ],
    );
    const filtered = await this.postFilter(rows, opt, cache);
    return filtered.map((r, i) => ({ siteId: r.id, channel: "exact" as const, rank: i + 1 }));
  }

  /** 构造前过滤 SQL 谓词下推（Pre-filtering Pushdown），从根源杜绝后过滤截断与漏召回 */
  private async buildPreFilterClauses(
    opt: SearchQuery,
    cache?: FilterCache
  ): Promise<{ wheres: string[]; params: unknown[]; empty: boolean }> {
    const wheres: string[] = [];
    const params: unknown[] = [];

    if (opt.statuses?.length) {
      wheres.push(`status IN (${opt.statuses.map(() => "?").join(",")})`);
      params.push(...opt.statuses);
    } else {
      wheres.push("status != 'archived'");
    }

    if (opt.categoryId) {
      const ids = await (cache
        ? (cache.category ??= this.categoryWithDescendants(opt.categoryId))
        : this.categoryWithDescendants(opt.categoryId));
      if (ids.size > 0) {
        wheres.push(`category_id IN (${[...ids].map(() => "?").join(",")})`);
        params.push(...ids);
      } else {
        return { wheres: [], params: [], empty: true };
      }
    }

    if (opt.tag) {
      const ids = await (cache
        ? (cache.tag ??= this.siteIdsWithTag(opt.tag))
        : this.siteIdsWithTag(opt.tag));
      if (ids.size > 0) {
        if (ids.size > 500) {
          const { sql, params: tagParams } = this.tagSiteIdsSql(opt.tag);
          wheres.push(`id IN (${sql})`);
          params.push(...tagParams);
        } else {
          wheres.push(`id IN (${[...ids].map(() => "?").join(",")})`);
          params.push(...ids);
        }
      } else {
        return { wheres: [], params: [], empty: true };
      }
    }

    if (opt.tags && opt.tags.length > 0) {
      const ids = await (cache
        ? (cache.tags ??= this.siteIdsWithAllTags(opt.tags))
        : this.siteIdsWithAllTags(opt.tags));
      if (ids.size > 0) {
        wheres.push("id IN (" + [...ids].map(() => "?").join(",") + ")");
        params.push(...ids);
      } else {
        return { wheres: [], params: [], empty: true };
      }
    }

    return { wheres, params, empty: false };
  }

  /** trigram 索引只在 SQLite FTS5 实现里可用；PG 靠 pg_trgm 表达式索引服务 LIKE */
  private trigramTable(): string | null {
    const fts = this.deps.fts;
    return fts && fts.kind === "sqlite-fts5" ? fts.substringIndex ?? null : null;
  }

  /** 单个查询词的全部匹配来源：标题/URL/描述（长词走 trigram）、拼音、标签 */
  private termBranches(term: string, trigram: string | null): Array<{ sql: string; params: unknown[] }> {
    const branches: Array<{ sql: string; params: unknown[] }> = [];
    if (trigram && trigramEligible(term)) {
      branches.push({
        // 从 trigram 索引驱动（MATCH 在 JOIN 内侧），再回 sites 校验启用/未删；
        // 这样规划器不会因为别的 LIKE 分支退化成全表扫描。
        sql: `SELECT s2.id AS id FROM ${trigram} JOIN sites s2 ON s2.rowid = ${trigram}.rowid
               WHERE ${trigram} MATCH ? AND s2.enabled = ${this.enabled} AND s2.deleted_at IS NULL`,
        params: [ftsPhrase(term)],
      });
    } else {
      const like = containsLike(term);
      branches.push({
        sql: `SELECT id FROM sites WHERE enabled = ${this.enabled} AND deleted_at IS NULL
                 AND (lower(title) LIKE ? ESCAPE '!'
                   OR lower(url) LIKE ? ESCAPE '!'
                   OR lower(coalesce(description,'')) LIKE ? ESCAPE '!')`,
        params: [like, like, like],
      });
    }
    if (pinyinMatchable(term)) {
      // 性能优化：短字母/拼音(<=2字符如 'jd'、'wx')坚决走前缀索引 prefixLike ('jd%')，
      // 命中 sites_pinyin_initials_idx 与 sites_pinyin_full_idx B-Tree 索引裁剪；
      // >=3 字符才放宽为 containsLike 兜底中段匹配，消灭海量短词前导通配 % 全表扫描。
      const pfx = term.length <= 2 ? prefixLike(term) : containsLike(term);
      branches.push({
        sql: `SELECT id FROM sites WHERE enabled = ${this.enabled} AND deleted_at IS NULL
                 AND (pinyin_initials LIKE ? ESCAPE '!' OR pinyin_full LIKE ? ESCAPE '!')`,
        params: [pfx, pfx],
      });
    }
    const tagLike = containsLike(term);
    branches.push({
      sql: `SELECT st.site_id AS id FROM site_tags st JOIN tags t ON t.id = st.tag_id
             WHERE lower(t.name) LIKE ? ESCAPE '!' OR lower(t.slug) LIKE ? ESCAPE '!'`,
      params: [tagLike, tagLike],
    });
    return branches;
  }

  /** 多词交叉：每个 token 各自命中（文本或标签），不要求落在同一列 */
  private multiTokenBranch(tokens: string[], trigram: string | null): { sql: string; params: unknown[] } | null {
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const tok of tokens) {
      const tagLike = containsLike(tok);
      const tagIn = "id IN (SELECT st.site_id FROM site_tags st JOIN tags t ON t.id = st.tag_id WHERE lower(t.name) LIKE ? ESCAPE '!' OR lower(t.slug) LIKE ? ESCAPE '!')";
      if (trigram && trigramEligible(tok)) {
        clauses.push(`(id IN (SELECT s2.id FROM ${trigram} JOIN sites s2 ON s2.rowid = ${trigram}.rowid WHERE ${trigram} MATCH ?) OR ${tagIn})`);
        params.push(ftsPhrase(tok), tagLike, tagLike);
      } else {
        const like = containsLike(tok);
        clauses.push(`(lower(title) LIKE ? ESCAPE '!' OR lower(url) LIKE ? ESCAPE '!' OR lower(coalesce(description,'')) LIKE ? ESCAPE '!' OR ${tagIn})`);
        params.push(like, like, like, tagLike, tagLike);
      }
    }
    return {
      sql: `SELECT id FROM sites WHERE enabled = ${this.enabled} AND deleted_at IS NULL AND ${clauses.join(" AND ")}`,
      params,
    };
  }

  /** 通道 2：BM25 全文（支持同义词多词检索） */
  private async channelFts(q: string, opt: SearchQuery, extraTerms: string[] = [], cache?: FilterCache, limit = this.perChannel): Promise<SearchCandidate[]> {
    if (!this.deps.fts) return [];
    try {
      const searchQueries = [q, ...extraTerms.filter((t) => t !== q.toLowerCase())];
      const allHits: Array<{ siteId: string; rank: number }> = [];
      const seen = new Set<string>();

      for (const query of searchQueries) {
        const hits = await this.deps.fts.search(query, limit);
        for (const h of hits) {
          if (!seen.has(h.siteId)) {
            seen.add(h.siteId);
            allHits.push(h);
          }
        }
        if (allHits.length >= limit) break;
      }

      if (allHits.length === 0) return [];
      const rows = await this.rawRows(
        // enabled 与 exact/pinyin/browse 通道对齐：停用站点不应经 FTS 通道回流。
        // PG 的 fts-pg 已在 SQL 内过滤，SQLite 的 Fts5Store 也已补上，这里是
        // 「通道取回后二次筛选」这层的兜底（防其它 FullTextStore 实现漏过滤）。
        `SELECT id, url, title, description, category_id AS categoryid,
                pinyin_full AS pinyinfull, pinyin_initials AS pinyininitials, status, NULL AS tags
           FROM sites WHERE id IN (${allHits.map(() => "?").join(",")})
             AND deleted_at IS NULL AND enabled = ${this.enabled}`,
        allHits.map((h) => h.siteId),
      );
      const allowed = await this.postFilter(rows, opt, cache);
      const allowedIds = new Set(allowed.map((r) => r.id));
      return allHits
        .filter((h) => allowedIds.has(h.siteId))
        .map((h, i) => ({ siteId: h.siteId, channel: "fts" as const, rank: i + 1 }));
    } catch {
      return [];
    }
  }

  /**
   * 通道 3：拼音。
   *
   * 默认前缀匹配：全拼串以查询词开头（`cainiao` → 菜鸟教程）或首字母精确命中
   * （`cnjc` → 菜鸟教程）。查询词出现在拼音串**中段**时（`tianqi` → 中国天气网）
   * 由 exact 通道的 contains 兜住；fuzzy 模式改为**包含**匹配，
   * 兜住「打了一半 / 拼错开头 / 非首字母」的查询（如 `tianq`、`gtqw`）。
   * 首字母串的包含放宽有长度门槛，理由见下方 initialPattern 注释。
   *
   * **中文查询压根不该进这条通道**：拼音列是给「用拉丁字母打中文」用的
   * （`qdjb` → 启动脚本），而中文查询在 exact 通道里已经按标题/描述原文 contains 过了。
   * 把中文再转成拼音去 LIKE 拼音列，只会撞上**跨词界拼出来的子串**——
   * `pinyin_full` 是标题+描述整串连写、没有隔音符号，于是 `梯子`→`tizi` 命中
   * Fontsource 描述里的「…限制 xian**tizi**tuoguan …」，`小说`→`xiaoshuo` 命中 XState，
   * `书签`→`shuqian` 命中 SQLite，`面试`→`mianshi` 命中 MSI Afterburner。
   * 真库 88 条真实中文查询实测：跳过后 7 条结果集变化，丢掉的 9 条命中全是这类乱撞，
   * 没有一条本来是对的命中（`代` 那种单字查询整批都是垃圾，跳过反而干净）。
   */
  private async channelPinyin(q: string, opt: SearchQuery, fuzzy = false, cache?: FilterCache, limit = this.perChannel): Promise<SearchCandidate[]> {
    if (!looksLikeLatinQuery(q)) return [];
    const { full, initials } = normalizeQueryPinyin(q);
    if (!full) return [];
    const pattern = fuzzy ? containsLike(full) : prefixLike(full);
    // fuzzy 的「包含」放宽对首字母串要设长度门槛。库里拉丁标题的 pinyin_initials
    // 存的就是整串小写标题（实测 Photopea→`photopea`、Hetzner→`hetzner`、
    // Adobe Acrobat 在线工具→`adobeacrobatzxgj`），2 字母模式于是跨过词界乱撞：
    // `梯子`(tz) → StackBlitz / Hetzner / Forest 专注森林，`翻译`(fy) → Fastify / Dify / Iconify，
    // `内存`(nc) → SWE-bench / Let's Encrypt。而这些查询真正该命中的条目
    // （中国天气网、有道云笔记）由 exact 通道的标题 contains 兜住，放宽首字母只添噪声。
    // ≥3 字母仍按包含匹配，保住注释里 `gtqw` 这类「命中在中段」的查询。
    const initialPattern = fuzzy && initials.length >= 3 ? containsLike(initials) : prefixLike(initials);
    const pre = await this.buildPreFilterClauses(opt, cache);
    if (pre.empty) return [];
    const extraWhere = pre.wheres.length > 0 ? " AND " + pre.wheres.join(" AND ") : "";

    const rows = await this.rawRows(
      `SELECT id, url, title, description, category_id AS categoryid,
              pinyin_full AS pinyinfull, pinyin_initials AS pinyininitials, status, NULL AS tags
         FROM sites
        WHERE enabled = ${this.enabled} AND deleted_at IS NULL AND (pinyin_full LIKE ? ESCAPE '!' OR pinyin_initials LIKE ? ESCAPE '!')
          ${extraWhere}
        ORDER BY
          CASE WHEN pinyin_initials = ? THEN 0
               WHEN pinyin_full = ? THEN 0
               WHEN pinyin_initials LIKE ? ESCAPE '!' THEN 1
               ELSE 2 END,
          weight DESC, trend_score DESC, sort ASC, id ASC
        LIMIT ?`,
      [pattern, initialPattern, ...pre.params, initials, full, initialPattern, limit],
    );
    const filtered = await this.postFilter(rows, opt, cache);
    return filtered.map((r, i) => ({ siteId: r.id, channel: "pinyin" as const, rank: i + 1 }));
  }

  /** 通道 4：语义向量 */
  private async channelSemantic(
    q: string,
    opt: SearchQuery,
    cache?: FilterCache,
    limit = this.perChannel,
    stats?: { filtered: number },
  ): Promise<SearchCandidate[]> {
    if (!this.deps.vectors || !this.deps.embed) return [];
    try {
      const vec = await this.deps.embed(q);
      let matches = await this.deps.vectors.search(vec, limit);
      // 闸门只认 similarity（统一余弦口径）；过滤放在回表之前，省掉无谓的 SQL。
      // 阈值 0 表示关闭：旧行为连「近似正交」的命中也会进 RRF，靠覆盖率乘子兜底。
      if (this.semanticMinSimilarity > 0 && matches.length > 0) {
        const kept = matches.filter((m) => m.similarity >= this.semanticMinSimilarity);
        if (stats) stats.filtered += matches.length - kept.length;
        matches = kept;
      }
      if (matches.length === 0) return [];
      const rows = await this.rawRows(
        // 语义通道同样只应召回启用中的站点：向量表不会随 enabled 变更自动清理，
        // 缺这层过滤会让「已停用」的站点继续出现在搜索结果里。
        `SELECT id, url, title, description, category_id AS categoryid,
                pinyin_full AS pinyinfull, pinyin_initials AS pinyininitials, status, NULL AS tags
           FROM sites WHERE id IN (${matches.map(() => "?").join(",")})
             AND deleted_at IS NULL AND enabled = ${this.enabled}`,
        matches.map((m) => m.siteId),
      );
      const allowed = await this.postFilter(rows, opt, cache);
      const allowedIds = new Set(allowed.map((r) => r.id));
      return matches
        .filter((m) => allowedIds.has(m.siteId))
        .map((m, i) => ({
          siteId: m.siteId,
          channel: "semantic" as const,
          rank: i + 1,
          rawScore: m.distance,
          similarity: m.similarity,
        }));
    } catch {
      // 模型不可用 / 维度不匹配时静默降级 —— 搜索必须仍然可用
      return [];
    }
  }

  /** 分类/标签/分面过滤，通道内统一处理 */
  private async postFilter(rows: SiteRow[], opt: SearchQuery, cache?: FilterCache): Promise<SiteRow[]> {
    let out = rows;
    if (opt.statuses?.length) {
      const set = new Set(opt.statuses);
      out = out.filter((r) => set.has(r.status as never));
    } else {
      out = out.filter((r) => r.status !== "archived");
    }
    if (opt.categoryId) {
      const ids = await (cache
        ? (cache.category ??= this.categoryWithDescendants(opt.categoryId))
        : this.categoryWithDescendants(opt.categoryId));
      out = out.filter((r) => ids.has(r.categoryid));
    }
    if (opt.tag) {
      const ids = await (cache
        ? (cache.tag ??= this.siteIdsWithTag(opt.tag))
        : this.siteIdsWithTag(opt.tag));
      out = out.filter((r) => ids.has(r.id));
    }
    if (opt.tags && opt.tags.length > 0) {
      // 多标签取交集（AND）；与单数 tag 同时给出时两个条件都生效。
      const ids = await (cache
        ? (cache.tags ??= this.siteIdsWithAllTags(opt.tags))
        : this.siteIdsWithAllTags(opt.tags));
      out = out.filter((r) => ids.has(r.id));
    }
    if (opt.facets && Object.keys(opt.facets).length > 0) {
      const facets = opt.facets;
      const ids = await (cache
        ? (cache.facets ??= this.siteIdsWithFacets(facets))
        : this.siteIdsWithFacets(facets));
      out = out.filter((r) => ids.has(r.id));
    }
    if (opt.excludedTerms && opt.excludedTerms.length > 0) {
      const lowerEx = opt.excludedTerms.map((t) => t.toLowerCase());
      out = out.filter((r) => {
        const hay = `${r.title} ${r.description ?? ""} ${r.url}`.toLowerCase();
        return !lowerEx.some((ex) => hay.includes(ex));
      });
    }
    return out;
  }

  /** 浏览模式：多取 1 条用于判断 hasMore（避免 COUNT 往返） */
  private async browse(q: SearchQuery, limit: number, offset: number): Promise<{ hits: SearchHit[]; hasMore: boolean }> {
    // 浏览排序：编辑精选(featured) > 热度(trend_score) > 手工序(sort) > id 决胜。
    // trend_score 由 recompute_rank 任务写入；为 0 时自然退化为旧行为，
    // 因此这次排序升级对存量数据零影响。
    //
    // weight 曾排在 trend_score 之后，但它恒为 0：INSERT 时硬编码 0（见
    // repository/sites.ts 的两个 INSERT 站点），全仓没有任何 UPDATE 写它
    // （recompute_rank 只写 trend_score），因此这个键从未区分过任何两行——
    // 通道内顺序实际落在 sort/id 上，等于随机。留着它只会让人以为还有第二
    // 个热度来源。这里统一改为只依赖真被写入的 trend_score（与通道内排序
    // 同一口径），weight 列保留在表里供历史兼容，但不再参与排序。
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
        if (ids.size > 500) {
          // 命中过多时把过滤下推成子查询，避免上千个绑定参数；
          // 谓词与 siteIdsWithTag 同源（tagSiteIdsSql），口径不会分叉。
          const { sql, params: tagParams } = this.tagSiteIdsSql(q.tag);
          wheres.push(`id IN (${sql})`);
          params.push(...tagParams);
        } else {
          wheres.push(`id IN (${[...ids].map(() => "?").join(",")})`);
          params.push(...ids);
        }
      } else {
        return { hits: [], hasMore: false };
      }
    }

    if (q.tags && q.tags.length > 0) {
      // 浏览模式（空查询）同样支持多标签交集，口径与 postFilter 一致
      const ids = await this.siteIdsWithAllTags(q.tags);
      if (ids.size > 0) {
        wheres.push('id IN (' + [...ids].map(() => "?").join(",") + ')');
        params.push(...ids);
      } else {
        return { hits: [], hasMore: false };
      }
    }

    if (q.facets && Object.keys(q.facets).length > 0) {
      const ids = await this.siteIdsWithFacets(q.facets);
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
        ORDER BY weight DESC, featured DESC, trend_score DESC, sort ASC, id ASC LIMIT ? OFFSET ?`,
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
    for (const chunk of chunkList(ids)) {
      const rows = await this.rawRows(
        `SELECT s.id, s.category_id AS categoryid,
                ${tagExpr} AS tags
           FROM sites s WHERE s.id IN (${chunk.map(() => "?").join(",")}) AND s.deleted_at IS NULL`,
        chunk,
      );
      for (const r of rows) {
        map.set(r.id, { siteId: r.id, categoryId: r.categoryid, tags: r.tags ? r.tags.split(",") : [] });
      }
    }
    return map;
  }

  /**
   * 类目含后代（anchor 物化路径前缀展开）。
   *
   * 解析口径：**先 id，再 slug**（slug 全局唯一，见 categories_slug_idx）；
   * 两者都未命中才退回「标题 / SKOS altLabel」，且要求**唯一**命中。
   * 旧实现把三种解析并成一条 `LIMIT 1`，
   * 而标题既不唯一也不受约束（实测「语言」×3、「操作系统」×2），
   * 于是同名类目的过滤结果由存储顺序决定 —— 静默选错节点。
   * 歧义时按「无法解析」处理：返回只含入参的集合，结果为空而不是选错的那个。
   */
  private async categoryWithDescendants(categoryId: string): Promise<Set<string>> {
    const norm = categoryId.trim();
    const cached = this.categoryTreeCache.get(norm);
    if (cached && Date.now() - cached.at < SearchEngine.CATEGORY_TREE_TTL_MS) return cached.ids;
    const byId = (await this.rawRows(`SELECT id, anchor FROM categories WHERE id = ?`, [norm])) as unknown as Array<{ id?: string; anchor?: string }>;
    let target = byId[0];
    if (!target) {
      // /category/{slug} 的读路径要把 slug 直接透给检索，否则前端得先换成 id 多一跳
      const bySlug = (await this.rawRows(`SELECT id, anchor FROM categories WHERE slug = ? LIMIT 1`, [norm.toLowerCase()])) as unknown as Array<{ id?: string; anchor?: string }>;
      target = bySlug[0];
    }
    if (!target) {
      const byName = (await this.rawRows(
        `SELECT id, anchor FROM categories WHERE title = ? OR alt_labels LIKE ? ESCAPE '!' LIMIT 2`,
        [norm, `%${escapeLike(JSON.stringify(norm))}%`],
      )) as unknown as Array<{ id?: string; anchor?: string }>;
      if (byName.length === 1) target = byName[0];
    }

    const ids = new Set<string>([target?.id ? String(target.id) : norm]);
    const anchor = target?.anchor;
    // 未解析到（歧义/不存在）也缓存：这是「每次都要重跑 3 条查询仍得到空」的最坏路径，
    // 缓存它才挡得住扫描式调用。缩短到 60s 由调用方 invalidateCategoryTree() 兜底。
    const remember = () => {
      if (this.categoryTreeCache.size >= SearchEngine.CATEGORY_TREE_CACHE_MAX) {
        const oldest = this.categoryTreeCache.keys().next();
        if (!oldest.done) this.categoryTreeCache.delete(oldest.value);
      }
      this.categoryTreeCache.set(norm, { at: Date.now(), ids });
    };
    if (!anchor) {
      remember();
      return ids;
    }

    const descendants = await this.rawRows(
      `SELECT id AS categoryid FROM categories WHERE anchor LIKE ?`,
      [anchor + "/%"],
    ) as unknown as Array<{ categoryid?: string }>;
    for (const d of descendants) if (d.categoryid) ids.add(d.categoryid);
    remember();
    return ids;
  }

  /**
   * 标签过滤的匹配谓词（slug / name / alias 三路）。
   *
   * 归一化约定：**只在查询侧归一，不动库里已存的数据**。
   * 库里 t.slug 是 slugify 的产物（小写、空格转连字符），而 t.name 保留原始大小写
   * （"AI" / "SaaS"）。旧实现把 trim 后的原值直接和三者比，于是 tag=AI 匹配不到
   * slug 为 "ai" 的标签、tag="AI 工具" 匹配不到 slug 为 "ai-工具" 的标签 ——
   * 过滤结果静默为空（前端表现为「明明有这个标签却零结果」）。
   * 查询侧同时给出 lowercase 原值与 slugify 形态，两侧都能命中。
   *
   * siteIdsWithTag 与 browse(>500 命中时的 SQL 下推) 共用这一段，
   * 保证两条路径的口径永远一致。
   */
  private tagSiteIdsSql(tag: string): { sql: string; params: unknown[] } {
    const norm = tag.trim();
    if (!norm) return { sql: "SELECT NULL AS id FROM tags WHERE 1 = 0", params: [] };
    const lower = norm.toLowerCase();
    const slug = slugify(norm);
    const conds = ["lower(t.slug) = ?", "lower(t.name) = ?", "lower(ta.alias) = ?"];
    const params: unknown[] = [lower, lower, lower];
    // slugify 会把空格换成连字符（"AI 工具" → "ai-工具"），与 lowercase 原值不同时才需要补一路
    if (slug !== lower) {
      conds.push("lower(t.slug) = ?");
      params.push(slug);
    }
    return {
      sql: `SELECT DISTINCT st.site_id AS id
         FROM site_tags st
         JOIN tags t ON t.id = st.tag_id
         LEFT JOIN tag_aliases ta ON ta.tag_id = t.id
        WHERE ${conds.join(" OR ")}`,
      params,
    };
  }

  /**
   * 按标签过滤。
   * 同时匹配 slug、name 与 tag_aliases 别名（SKOS altLabel 归一化）：
   * 调用方可能传「天气」展示名，或者「AIGC」「AI」等别名；大小写不敏感。
   */
  private async siteIdsWithTag(tag: string): Promise<Set<string>> {
    return this.siteIdsWithAllTags([tag]);
  }

  /**
   * 多标签过滤：**交集** —— 站点必须同时具备 tags 里的每一个标签。
   *
   * 为什么是交集而不是并集：用户在标签页勾选第二个标签时，意图是「再收窄一层」
   * （设计 + 开源 = 既设计又开源）。并集会越勾越多，与「筛选」的直觉相反。
   *
   * 实现取舍：不做 N 路 SQL 自连接交集，而是「每个标签查一次 site_id
   * （复用 tagSiteIdsSql，与单标签口径完全一致：slug / name / alias + 大小写与
   * slugify 双形态），再在内存取交集」。标签数已由路由侧封顶（20），
   * 且每个标签的命中集合通常远小于站点总数，内存交集开销可忽略。
   *
   * 从最小的集合起步迭代；任一标签命中为空 ⇒ 交集为空，直接短路。
   */
  private async siteIdsWithAllTags(tags: string[]): Promise<Set<string>> {
    const norms = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
    if (norms.length === 0) return new Set();
    if (norms.length === 1) {
      const { sql, params } = this.tagSiteIdsSql(norms[0]!);
      const rows = await this.rawRows(sql, params);
      return new Set(rows.map((r) => r.id));
    }

    const perTag = await Promise.all(
      norms.map(async (tag) => {
        const { sql, params } = this.tagSiteIdsSql(tag);
        const rows = await this.rawRows(sql, params);
        return new Set(rows.map((r) => r.id));
      }),
    );

    perTag.sort((a, b) => a.size - b.size);
    let acc = perTag[0]!;
    for (const next of perTag.slice(1)) {
      if (acc.size === 0) break;
      const intersected = new Set<string>();
      for (const id of acc) if (next.has(id)) intersected.add(id);
      acc = intersected;
    }
    return acc;
  }

  /**
   * 按分面属性过滤。
   * 支持多分面正交组合：
   * - 分面键之间（例如 pricing 与 platform）为 AND（交集）
   * - 单个分面键内的多个取值（例如 platform = web OR platform = ios）为 OR（并集）
   */
  private async siteIdsWithFacets(facets: Record<string, string[]>): Promise<Set<string>> {
    const conditions = Object.entries(facets)
      .map(([key, rawVals]) => {
        const vals = [...new Set((rawVals ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean))];
        return vals.length > 0 ? { key: key.toLowerCase(), vals } : null;
      })
      .filter((c): c is { key: string; vals: string[] } => c !== null);
    if (conditions.length === 0) return new Set();

    // 条件之间并发查（键数与每键值数已由路由侧 clampFacets 设预算），
    // 值再按 SQL_IN_CHUNK 分片，保证绑定参数不会撞语句级上限。
    const perCondition = await Promise.all(
      conditions.map(async ({ key, vals }) => {
        const sites = new Set<string>();
        for (const part of chunkList(vals)) {
          const placeholders = part.map(() => "?").join(", ");
          const rows = await this.rawRows(
            `SELECT DISTINCT site_id AS id FROM site_facets WHERE facet_key = ? AND facet_value IN (${placeholders})`,
            [key, ...part],
          );
          for (const r of rows) sites.add(r.id);
        }
        return sites;
      }),
    );

    let candidateSet = perCondition[0]!;
    for (const set of perCondition.slice(1)) {
      if (candidateSet.size === 0) break;
      const nextSet = new Set<string>();
      for (const id of candidateSet) {
        if (set.has(id)) nextSet.add(id);
      }
      candidateSet = nextSet;
    }

    return candidateSet;
  }

  /** 方言无关的原始查询：sqlite 同步、pg 异步，这里统一成 Promise */
  private async rawRows(sqlText: string, params: unknown[]): Promise<SiteRow[]> {
    if (this.deps.db.dialect === "sqlite" || this.deps.db.dialect === "libsql") {
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