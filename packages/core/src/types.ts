/**
 * NavHub 领域模型。
 *
 * 设计约束（重要）：
 * 1. NavSphere 的线上契约是 navigation.json 的三层结构（category -> subCategory -> item），
 *    本文件的 `NavSphereNavigationData` 必须与该契约**字节级兼容**，否则前端无需改动的目标就破产。
 * 2. NavHub 的内部模型（`Site` / `Category`）比该契约更丰富（拼音、向量、健康度等），
 *    因此需要一个**双向映射层**（见 toNavSphereData / fromNavSphereData）。
 */

export type Id = string;

/* ------------------------------------------------------------------ *
 * NavSphere 线格式（禁止随意变更）
 * ------------------------------------------------------------------ */

export interface NavSphereVideoConfig {
  type: "bilibili" | "youtube";
  videoId?: string;
  bvid?: string;
  aid?: string;
  cid?: string;
  p?: number;
}

export interface NavSphereItem {
  id: string;
  title: string;
  titleEn?: string;
  description?: string;
  descriptionEn?: string;
  href: string;
  icon?: string;
  useDefaultIcon?: boolean;
  enabled: boolean;
  videoConfig?: NavSphereVideoConfig;
}

export interface NavSphereSubCategory {
  id: string;
  title: string;
  icon?: string;
  description?: string;
  parentId?: string;
  enabled?: boolean;
  items?: NavSphereItem[];
}

export interface NavSphereCategory {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  enabled?: boolean;
  items?: NavSphereItem[];
  subCategories?: NavSphereSubCategory[];
}

export interface NavSphereNavigationData {
  navigationItems: NavSphereCategory[];
}

export interface NavSphereSiteConfig {
  siteName?: string;
  siteDescription?: string;
  logo?: string;
  favicon?: string;
  appearance?: { theme?: "light" | "dark" | "system" };
  navigation?: { linkTarget?: "_blank" | "_self" };
  seo?: Record<string, unknown>;
  [k: string]: unknown;
}

/* ------------------------------------------------------------------ *
 * NavHub 内部模型
 * ------------------------------------------------------------------ */

export type SiteStatus = "active" | "pending" | "broken" | "archived";

export interface SiteHealth {
  httpStatus?: number | null;
  ok: boolean;
  latencyMs?: number | null;
  redirectTo?: string | null;
  error?: string | null;
  lastCheckedAt?: number | null;
}

export interface SiteAction {
  id: string;
  label: string;
  urlTemplate: string;
  placeholder?: string;
  icon?: string;
}

export type SiteRelationType =
  | "alternative"
  | "ecosystem"
  | "complementary"
  | "part_of"
  | "upstream"
  | "mirror"
  | "related";

export interface SiteRelation {
  id?: string;
  sourceSiteId?: string;
  targetSiteId?: string | null;
  targetTitle: string;
  targetUrl: string;
  relationType: SiteRelationType;
  isFreeOrOpenSource?: boolean;
  note?: string;
  confidence?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface SiteLiveMetrics {
  githubStars?: number;
  latestVersion?: string;
  openSource?: boolean;
  license?: string;
  latencyMs?: number;
}

export interface Site {
  id: Id;
  url: string;
  title: string;
  titleEn?: string | null;
  description?: string | null;
  descriptionEn?: string | null;
  iconKey?: string | null;
  screenshotKey?: string | null;
  categoryId: Id;
  subCategoryId?: Id | null;
  tags: string[];
  status: SiteStatus;
  enabled: boolean;
  /** 排序权重，兼作拖拽顺序 */
  sort: number;
  /** 命中的检索线索数（点击/曝光/搜索命中），用于个性化 */
  weight: number;
  featured?: boolean;
  /** 来源：manual | import | submission | ai | seed | navsphere | api | mcp */
  source?: string | null;
  /** 总点击次数（events 聚合写入） */
  visitCount?: number;
  /** 最近一次点击时间 */
  lastVisitedAt?: number | null;
  /** 热度分（recompute_rank 任务重算） */
  trendScore?: number;
  /**
   * 软删除（回收站）戳：null/undefined=正常，非 null=已删除时刻。
   * 正常查询一律排除软删站点，只有回收站入口返回带此值的记录。
   */
  deletedAt?: number | null;
  health?: SiteHealth;
  /** 深链快速微动作（带参数直达核心能力） */
  actions?: SiteAction[];
  /** 生态与替代品（平替雷达与技术栈关系） */
  relations?: SiteRelation[];
  /** 实时脉搏数据（GitHub Star、版本、开源协议） */
  liveMetrics?: SiteLiveMetrics;
  /** 适用的场景工作台（dev | design | ai | content） */
  workspaces?: string[];
  /** 分面正交属性（付费模式/平台/形态/语言/场景等） */
  facets?: Record<string, string[]>;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: Id;
  /** 物化路径 "a/b/c"，避免"插入时父不存在"的循环外键问题 */
  anchor: string;
  parentId: Id | null;
  title: string;
  titleEn?: string | null;
  description?: string | null;
  icon?: string | null;
  enabled: boolean;
  sort: number;
  /** 来源：navsphere（前端快照托管）| api | ai | seed；null 视为前端托管（兼容旧数据） */
  source?: string | null;
  /** SKOS:altLabel - 分类同义词/备选标签 (e.g. ["AI", "大模型", "人工智能"]) */
  altLabels?: string[];
  /** SKOS:related - 相关概念分类 ID (打破单树隔离，横向关联) */
  relatedCategories?: string[];
  createdAt: number;
  updatedAt: number;
}

export type CollectionKind = "topic" | "geo" | "roadmap";
export interface Collection {
  id: Id;
  slug: string;
  title: string;
  description?: string | null;
  kind: CollectionKind;
  icon?: string | null;
  sort: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface CollectionItem {
  collectionId: Id;
  siteId: Id;
  sort: number;
  note?: string | null;
}

export interface TagDimension {
  id: Id;
  name: string;
  slug: string;
  group: string;
  color?: string | null;
  description?: string | null;
  count?: number;
  aliases?: string[];
}

export interface TagAlias {
  alias: string;
  tagId: Id;
  createdAt: number;
}

/* ------------------------------------------------------------------ *
 * 检索
 * ------------------------------------------------------------------ */

/**
 * 召回通道。前四路是"相关性"通道，personal 是"偏好"通道 —— 二者都进入 RRF 融合。
 *
 * 设计要点：个性化**不是**融合后的后处理加成，而是与相关性通道并列进入 RRF 的一路。
 * 原因是实测发现 RRF（k=60）会把排名 1~10 压缩到仅 ~3% 的分数差，
 * 任何"融合后再乘系数"的做法都会轻易翻转相关性顺序。
 * 把它变成一路、并给一个明确小于相关性通道的权重，翻转能力就被权重天然限界了。
 *
 * 类型说明：内置通道（BuiltinChannel）保留字面量自动补全；
 * `(string & {})` 允许注册表扩展的新通道不报类型错（见 channels.ts）。
 */
import type { BuiltinChannel } from "./channels.ts";

export type SearchChannel = BuiltinChannel | (string & {});

export interface SearchCandidate {
  siteId: Id;
  channel: SearchChannel;
  /** 通道内排名，从 1 开始 */
  rank: number;
  /** 通道原始分（可解释性用） */
  rawScore?: number;
}

export interface SearchHit {
  siteId: Id;
  score: number;
  /** 每路召回的贡献，用于「为什么是它」的可解释排序 */
  contributions: Partial<Record<SearchChannel, { rank: number; value: number }>>;
}

/** 个性化偏好信号（由行为事件聚合而来） */
export interface PersonalizationSignals {
  topCategories?: Id[];
  topTags?: string[];
  visitedSiteIds?: Id[];
}

/** 参与个性化打分所需的最小站点信息 */
export interface PersonalizableSite {
  siteId: Id;
  categoryId: Id;
  tags: string[];
}

export interface SearchQuery {
  q: string;
  limit?: number;
  /**
   * 结果偏移（分页）。0 = 第一页。
   *
   * RRF 融合是纯函数（同输入同输出），因此对融合结果做偏移切片是稳定的；
   * 底层数据在翻页间隙被修改时可能有轻微漂移——对导航检索可接受，
   * 换取的是无需维护游标语义的简单实现。
   */
  offset?: number;
  categoryId?: Id;
  tag?: string;
  /** 多维分面正交过滤（例如 { pricing: ['free'], platform: ['web', 'ios'] }） */
  facets?: Record<string, string[]>;
  statuses?: SiteStatus[];
  /** 关闭语义通道（无模型或追求极低延迟时） */
  disableSemantic?: boolean;
  /** 关闭个性化通道 */
  disablePersonal?: boolean;
  /** 个性化：用户近来偏好 */
  personalize?: PersonalizationSignals;
  /** 排除的关键词（负向关键词，排除包含任一词的站点） */
  excludedTerms?: string[];
}

export interface SearchResult {
  hits: SearchHit[];
  /** 每个通道是否真正参与，用于「AI 不可用」的诚实降级提示 */
  channelsUsed: SearchChannel[];
  semanticAvailable: boolean;
  tookMs: number;
  /** 本次分页的偏移（默认 0） */
  offset?: number;
  /**
   * 召回池里是否还有未展示的结果——据此渲染「加载更多」。
   *
   * 注意语义：这是「本次召回池内还有余量」，**不是**全库匹配总数
   * （每通道各召回 50 条，池子有上限）。叫 total 会误导，故用布尔。
   */
  hasMore?: boolean;
  /**
   * 零结果时的兜底放宽级别（有结果时为 undefined）。
   *
   *   "filter"  原查询带类目/标签过滤且过滤后为空 → 放宽过滤重试
   *   "fuzzy"   过滤放宽仍为空 → 拼音改包含匹配、英文按词拆分 OR 重试
   *
   * 前端据此提示「已放宽筛选」而不是假装这就是精确结果——
   * 降级要诚实，但不能什么都不给。
   */
  fallback?: "filter" | "fuzzy";
  /**
   * Query Planner 决策（v2 新增）。
   *   "early-exit"  exact 强命中，语义通道被剪枝（省一次 embedding 推理）
   *   缺席        全通道正常跑（或 fuzzy 兜底）
   */
  planner?: "early-exit";
  /** 各通道耗时明细（供调参 / OTel / Prometheus 透出） */
  channelTimings?: {
    exactMs: number;
    ftsMs: number;
    pinyinMs: number;
    semanticMs: number;
    skippedSemantic: boolean;
  };
  /** 自动从查询中提取到的分面修饰符意图 */
  inferredFacets?: Record<string, string[]>;
  /** 自动识别的标签修饰符 (#tag 或 tag:tag) */
  inferredTag?: string;
  /** 自动识别的类目修饰符 (@category 或 cat:category) */
  inferredCategory?: string;
  /** 识别到的负向关键词 (-keyword) */
  excludedTerms?: string[];
  /** 零结果时的编辑距离拼写纠错建议 ("您是不是想搜...") */
  didYouMean?: string;
  /** 触发同义词/标签别名/SKOS 扩展词 */
  queryExpansion?: string[];
}

/* ------------------------------------------------------------------ *
 * AI 富化
 * ------------------------------------------------------------------ */

export interface EnrichmentInput {
  url: string;
  title?: string;
  description?: string;
  categoryHint?: string;
}

export interface EnrichmentResult {
  title: string;
  description: string;
  categoryId?: Id | null;
  suggestedCategoryName?: string | null;
  tags: string[];
  keywords: string[];
  lang?: string | null;
  /** 富化来源：llm | heuristic | none —— 用户可据此判断可信度 */
  provenance: "llm" | "heuristic" | "none";
  imageUrl?: string | null;
  iconUrl?: string | null;
}


/* ------------------------------------------------------------------ *
 * URL 规范化指纹清洗器 (URL Canonicalization & Tracking Stripper)
 * ------------------------------------------------------------------ */

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "spm",
  "fbclid",
  "gclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "ref_src",
  "from_source",
]);

/**
 * 规范化 URL：剥离营销追踪参数、统一小写域名、移除默认端口与冗余尾部斜杠。
 * 用于站点入库精确去重与指纹比对。
 */
export function canonicalizeUrl(rawUrl: string): string {
  const trimmed = (rawUrl ?? "").trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return trimmed;
    }
    parsed.hostname = parsed.hostname.toLowerCase();
    if (
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")
    ) {
      parsed.port = "";
    }
    // 剥离追踪参数并按字母序排列剩余参数
    const cleanParams = new URLSearchParams();
    const entries = [...parsed.searchParams.entries()].filter(
      ([k]) => !TRACKING_PARAMS.has(k.toLowerCase()) && !k.toLowerCase().startsWith("utm_")
    );
    entries.sort(([a], [b]) => a.localeCompare(b));
    for (const [k, v] of entries) {
      cleanParams.append(k, v);
    }
    const searchStr = cleanParams.toString();
    parsed.search = searchStr ? `?${searchStr}` : "";

    // 路径尾部斜杠归一化：非根路径去掉末尾多余 '/'，根路径 '/' 且无查询串/锚点时去掉末尾 '/'
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    let out = parsed.toString();
    if (parsed.pathname === "/" && !parsed.search && !parsed.hash && out.endsWith("/")) {
      out = out.slice(0, -1);
    }
    return out;
  } catch {
    return trimmed;
  }
}
