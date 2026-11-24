/**
 * 多信号相似站点发现与竞品洞察引擎（SimilarSites 级能力 · 纯函数可单测）。
 *
 * 相比旧版单纯「共享标签计数」或「裸向量 KNN」，本模块融合 5 维真实可验证信号：
 *   1. 标签加权重合度（IDF 特异性加权，罕见核心标签如「影视评分」远高于泛标签「工具」）；
 *   2. 语义与文本亲和度（BGE 向量余弦相似度 + 中英双语词元/二元语法文本重叠）；
 *   3. 分类树与 SKOS 横向亲缘（同细分类目 / 同父级大类 / SKOS relatedCategories）；
 *   4. 结构化分面属性对齐（付费模式 / 运行平台 / 形态架构 / 语言 / 开源属性）；
 *   5. 知识图谱关系与受众行为共现（官方认证 alternative 平替、生态关联、同收藏受众重合度）。
 *
 * 诚实度红线：
 *   - 绝不伪造外部月访问量或虚构全球排名；
 *   - 站内全库排名（siteRank）与同类目排名（categoryRank）均严格基于本库真实活跃站点与热度权重计算；
 *   - 每条推荐都附带可解释的匹配维度拆解（breakdown）与匹配理由（reasons）。
 */
import type { Category, Site, SiteRelation, SiteRelationType } from "./types.ts";

export type SimilarScopeFilter = "all" | "same-category" | "cross-category";
export type SimilarSortBy = "similarity" | "popularity" | "latency" | "tags";

export interface SimilarSignalBreakdown {
  /** 标签重合度 (0..100) */
  tags: number;
  /** 语义与内容亲和度 (0..100) */
  semantic: number;
  /** 分类与专题亲缘度 (0..100) */
  category: number;
  /** 属性与定位匹配度 (0..100) */
  facets: number;
  /** 图谱与受众共现度 (0..100) */
  graph: number;
}

export interface SimilarSiteMatch {
  site: Site;
  categoryName: string | null;
  parentCategoryName: string | null;
  /** 综合相似度百分比（15..99） */
  similarityPercent: number;
  /** 站内全库热度排名（1 为最高） */
  siteRank: number;
  /** 所属细分类目内热度排名（1 为最高） */
  categoryRank: number;
  sameCategory: boolean;
  sameParentCategory: boolean;
  relationType: SiteRelationType | null;
  relationNote: string | null;
  isOpenSource: boolean;
  isHealthy: boolean;
  /** 是否与目标站同属一个品牌/主域矩阵（如 docs.github.com / 豆瓣音乐） */
  isSameBrand: boolean;
  sharedTags: string[];
  /** 该候选站独有、目标站未标注的差异特色标签 */
  uniqueTags: string[];
  sharedFacets: string[];
  /** 可解释匹配原因（最多 3 条） */
  reasons: string[];
  breakdown: SimilarSignalBreakdown;
}

export interface SimilarSiteTargetProfile {
  site: Site;
  categoryName: string | null;
  parentCategoryName: string | null;
  siteRank: number;
  totalActiveSites: number;
  categoryRank: number;
  categoryTotal: number;
  isOpenSource: boolean;
}

export interface SimilarSitesSummary {
  totalFound: number;
  sameCategoryCount: number;
  crossCategoryCount: number;
  openSourceCount: number;
  healthyCount: number;
  sameBrandCount: number;
  topSharedTags: Array<{ tag: string; count: number }>;
  categories: Array<{ id: string; name: string; count: number }>;
  signalMode: "hybrid-vector" | "hybrid-lexical";
}

export interface SimilarSitesReport {
  matchType: "exact-site" | "matched-site" | "topic-discovery";
  query: string;
  target: SimilarSiteTargetProfile | null;
  summary: SimilarSitesSummary;
  items: SimilarSiteMatch[];
}

export interface ComputeSimilarSitesOptions {
  limit?: number;
  scope?: SimilarScopeFilter;
  categoryId?: string;
  openSourceOnly?: boolean;
  healthyOnly?: boolean;
  excludeSameBrand?: boolean;
  tag?: string;
  sort?: SimilarSortBy;
  /** 来自向量索引的真实语义余弦相似度（0..1） */
  vectorSimilarityById?: ReadonlyMap<string, number>;
  /** 来自用户收藏/访问共现的受众重合度（0..1） */
  audienceOverlapById?: ReadonlyMap<string, number>;
  /** 目标站点的知识图谱关系边 */
  targetRelations?: readonly SiteRelation[];
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "you", "are", "all",
  "http", "https", "www", "com", "org", "net", "io", "app", "dev", "cn", "ai", "co",
  "site", "web", "online", "official", "home", "index", "html", "page",
  "网站", "官网", "官方", "平台", "工具", "在线", "免费", "提供", "支持", "用户", "可以",
  "使用", "一个", "以及", "基于", "面向", "专注", "打造", "综合", "常用", "精选", "大全",
]);

const OPEN_SOURCE_TAGS = new Set([
  "开源", "open-source", "opensource", "oss", "foss", "self-hosted", "自托管", "mit", "apache", "gpl",
]);

/** 规范化 URL 主机名（去除 www. 前缀，小写） */
export function normalizeSiteHost(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withProto);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/)[0] ?? "";
  }
}

/** 提取主干域名（如 movie.douban.com -> douban.com） */
export function extractRegistrableDomain(host: string): string {
  const clean = normalizeSiteHost(host);
  if (!clean) return "";
  const parts = clean.split(".").filter(Boolean);
  if (parts.length <= 2) return clean;
  const lastTwo = parts.slice(-2).join(".");
  if (/^(com|org|net|gov|edu|ac)\.(cn|uk|jp|au|hk|tw)$/i.test(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/** 中英混合词元提取（英文单词 + 中文 2-gram），用于零依赖内容亲和度计算 */
export function extractSimilarityTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = (text || "").toLowerCase();
  if (!normalized) return tokens;

  // 英文/数字词元（长度 ≥ 2）
  const asciiMatches = normalized.match(/[a-z0-9][a-z0-9+.#-]{1,24}/g);
  if (asciiMatches) {
    for (const raw of asciiMatches) {
      const tok = raw.replace(/^[.-]+|[.-]+$/g, "");
      if (tok.length >= 2 && !STOPWORDS.has(tok)) tokens.add(tok);
    }
  }

  // 中文连续段提取 2-gram（短语 2-4 字同时保留整词）
  const cjkSegments = normalized.match(/[\u4e00-\u9fa5]{2,}/g);
  if (cjkSegments) {
    for (const seg of cjkSegments) {
      if (seg.length <= 4 && !STOPWORDS.has(seg)) tokens.add(seg);
      for (let i = 0; i < seg.length - 1; i++) {
        const bg = seg.slice(i, i + 2);
        if (!STOPWORDS.has(bg)) tokens.add(bg);
      }
    }
  }

  return tokens;
}

/** 判断站点是否具备开源特征 */
export function isSiteOpenSource(site: Site): boolean {
  if (site.liveMetrics?.openSource) return true;
  const pricing = site.facets?.pricing ?? [];
  if (pricing.some((v) => /开源|open.?source|foss/i.test(v))) return true;
  if ((site.tags ?? []).some((t) => OPEN_SOURCE_TAGS.has(t.trim().toLowerCase()))) return true;
  const host = normalizeSiteHost(site.url);
  if (host === "github.com" || host === "gitlab.com" || host === "codeberg.org") return true;
  return false;
}

/** 判断站点当前可达性是否健康 */
export function isSiteHealthy(site: Site): boolean {
  if (site.status !== "active") return false;
  if (site.health && site.health.ok === false) return false;
  return true;
}

/** 判断两个站点是否同属一个品牌/主域家族（如 github.com 与 docs.github.com、豆瓣与豆瓣音乐） */
export function isSameBrandSite(target: Site, candidate: Site): boolean {
  const targetDomain = extractRegistrableDomain(target.url);
  const candDomain = extractRegistrableDomain(candidate.url);
  if (targetDomain && candDomain && targetDomain === candDomain) {
    // 排除共享代码托管/公共平台主域（github.com/a 与 github.com/b 属于不同开源项目，不是同品牌）
    const sharedPlatforms = new Set(["github.com", "gitlab.com", "gitee.com", "github.io", "vercel.app", "netlify.app", "pages.dev", "notion.site", "huggingface.co"]);
    if (!sharedPlatforms.has(targetDomain)) return true;
    const tHost = normalizeSiteHost(target.url);
    const cHost = normalizeSiteHost(candidate.url);
    if (tHost !== cHost) return true;
  }
  // 品牌名前缀判定：取主标题核心品牌段（分隔符前），避免把「豆瓣电影」「GitHub 官方文档」排在外部竞品前面
  const targetBrand = (target.title || "").split(/[·\-—|｜(\uff08\s]/)[0]?.trim().toLowerCase() ?? "";
  const candTitle = (candidate.title || "").trim().toLowerCase();
  if (targetBrand.length >= 2 && candTitle !== targetBrand && candTitle.startsWith(targetBrand)) {
    const isAscii = /^[a-z0-9]+$/.test(targetBrand);
    if (!isAscii || targetBrand.length >= 4) {
      const nextChar = candTitle[targetBrand.length] ?? "";
      if (!isAscii || !/[a-z0-9]/.test(nextChar)) return true;
    }
  }
  return false;
}

/** 热度排序分（仅使用真实馆藏指标：点击数 + 趋势分 + 权重 + 精选 + GitHub Star） */
export function sitePopularityScore(site: Site): number {
  const visits = Math.max(0, Number(site.visitCount ?? 0));
  const trend = Math.max(0, Number(site.trendScore ?? 0));
  const weight = Math.max(0, Number(site.weight ?? 0));
  const stars = Math.max(0, Number(site.liveMetrics?.githubStars ?? 0));
  const featuredBonus = site.featured ? 30 : 0;
  const sortBonus = site.sort > 0 && site.sort <= 50 ? (51 - site.sort) * 0.4 : 0;
  return (
    Math.log1p(visits) * 18 +
    trend * 12 +
    Math.log1p(weight) * 8 +
    Math.log1p(stars) * 3.5 +
    featuredBonus +
    sortBonus
  );
}

/** 为全库活跃站点计算真实站内排名与同类目排名 */
export function computeSiteRankings(sites: readonly Site[]): {
  siteRankById: Map<string, number>;
  categoryRankById: Map<string, number>;
  categoryTotalById: Map<string, number>;
  totalActiveSites: number;
} {
  const active = sites.filter((s) => s.status === "active" && s.enabled !== false && !s.deletedAt);
  const scored = active
    .map((s) => ({
      id: s.id,
      categoryId: s.categoryId,
      score: sitePopularityScore(s),
      sort: s.sort ?? 9999,
      createdAt: s.createdAt ?? 0,
    }))
    .sort((a, b) => b.score - a.score || a.sort - b.sort || b.createdAt - a.createdAt);

  const siteRankById = new Map<string, number>();
  const categoryRankById = new Map<string, number>();
  const categoryTotalById = new Map<string, number>();

  for (let i = 0; i < scored.length; i++) {
    const row = scored[i]!;
    siteRankById.set(row.id, i + 1);
    const nextCatRank = (categoryTotalById.get(row.categoryId) ?? 0) + 1;
    categoryTotalById.set(row.categoryId, nextCatRank);
    categoryRankById.set(row.id, nextCatRank);
  }

  return {
    siteRankById,
    categoryRankById,
    categoryTotalById,
    totalActiveSites: active.length,
  };
}

function buildTagIdfMap(sites: readonly Site[]): Map<string, number> {
  const df = new Map<string, number>();
  const total = Math.max(1, sites.length);
  for (const s of sites) {
    const seen = new Set<string>();
    for (const raw of s.tags ?? []) {
      const norm = raw.trim().toLowerCase();
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      df.set(norm, (df.get(norm) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [tag, count] of df.entries()) {
    idf.set(tag, Math.log(1 + total / (1 + count)));
  }
  return idf;
}

function diceSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const tok of small) {
    if (big.has(tok)) common++;
  }
  return (2 * common) / (a.size + b.size);
}

function siteTextBlob(site: Site): string {
  const hostStem = normalizeSiteHost(site.url).replace(/\.(com|org|net|io|cn|dev|app|ai|co)$/i, "");
  return [
    site.title,
    site.titleEn ?? "",
    site.description ?? "",
    site.descriptionEn ?? "",
    hostStem,
    ...(site.tags ?? []),
  ].join(" ");
}

function normalizeFacetEntries(site: Site): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (site.facets) {
    for (const [k, vals] of Object.entries(site.facets)) {
      if (!Array.isArray(vals) || vals.length === 0) continue;
      const set = new Set(vals.map((v) => String(v).trim()).filter(Boolean));
      if (set.size > 0) out.set(k, set);
    }
  }
  return out;
}

function calibrateSimilarityPercent(rawScore: number, hasStrongSignal: boolean): number {
  if (rawScore <= 0) return 0;
  // 平滑映射到 20%..99%，让强相关平替/同分类多标签重合稳定落在 75%–98%，跨类弱相关落在 30%–65%
  const boosted = hasStrongSignal
    ? 0.42 + rawScore * 0.58
    : Math.pow(Math.min(1, rawScore), 0.78) * 0.94;
  return Math.max(15, Math.min(99, Math.round(boosted * 100)));
}

function buildMatchReasons(params: {
  relationType: SiteRelationType | null;
  relationNote: string | null;
  sharedTags: string[];
  sameCategory: boolean;
  sameParentCategory: boolean;
  categoryName: string | null;
  parentCategoryName: string | null;
  semanticScore: number;
  hasVector: boolean;
  sharedFacets: string[];
  audienceOverlap: number;
}): string[] {
  const reasons: string[] = [];
  if (params.relationType === "alternative") {
    reasons.push(params.relationNote ? `认证平替：${params.relationNote}` : "知识图谱认证对标平替");
  } else if (params.relationType === "complementary" || params.relationType === "ecosystem") {
    reasons.push(params.relationNote ? `生态关联：${params.relationNote}` : "同技术/内容生态搭配");
  }
  if (params.sharedTags.length > 0) {
    const preview = params.sharedTags.slice(0, 3).map((t) => `#${t}`).join(" ");
    reasons.push(`共享 ${params.sharedTags.length} 个主题标签：${preview}`);
  }
  if (params.sameCategory && params.categoryName) {
    reasons.push(`同属「${params.categoryName}」细分领域`);
  } else if (params.sameParentCategory && params.parentCategoryName) {
    reasons.push(`同属「${params.parentCategoryName}」大类跨子分类推荐`);
  }
  if (params.semanticScore >= 0.45) {
    const pct = Math.round(params.semanticScore * 100);
    reasons.push(params.hasVector ? `语义向量高度相近 (${pct}%)` : `功能简介高度吻合 (${pct}%)`);
  }
  if (params.audienceOverlap >= 0.2) {
    reasons.push("收藏用户高度重合");
  }
  if (params.sharedFacets.length > 0 && reasons.length < 3) {
    reasons.push(`定位一致：${params.sharedFacets.slice(0, 2).join(" · ")}`);
  }
  return reasons.slice(0, 3);
}

/**
 * 为已收录目标站点生成 SimilarSites 级多信号相似站点分析报告。
 */
export function computeSimilarSitesForTarget(
  target: Site,
  allSites: readonly Site[],
  categories: readonly Category[],
  options: ComputeSimilarSitesOptions = {},
): SimilarSitesReport {
  const limit = Math.max(1, Math.min(48, Math.trunc(options.limit ?? 24)));
  const scope = options.scope ?? "all";
  const sort = options.sort ?? "similarity";
  const categoryFilter = options.categoryId?.trim() || "";
  const tagFilter = options.tag?.trim().toLowerCase() || "";

  const activeSites = allSites.filter(
    (s) => s.status === "active" && s.enabled !== false && !s.deletedAt,
  );
  const categoryById = new Map<string, Category>();
  for (const c of categories) categoryById.set(c.id, c);

  const resolveCategoryNames = (catId: string) => {
    const cat = categoryById.get(catId) ?? null;
    const parent = cat?.parentId ? categoryById.get(cat.parentId) ?? null : null;
    return {
      categoryName: cat?.title ?? null,
      parentCategoryName: parent?.title ?? null,
      parentId: cat?.parentId ?? null,
      relatedCategoryIds: new Set(cat?.relatedCategories ?? []),
    };
  };

  const rankings = computeSiteRankings(activeSites);
  const tagIdf = buildTagIdfMap(activeSites);

  const targetCatInfo = resolveCategoryNames(target.categoryId);
  const targetTags = (target.tags ?? []).map((t) => t.trim()).filter(Boolean);
  const targetTagNormMap = new Map<string, string>();
  for (const t of targetTags) targetTagNormMap.set(t.toLowerCase(), t);
  const targetTokens = extractSimilarityTokens(siteTextBlob(target));
  const targetFacets = normalizeFacetEntries(target);
  const targetOpenSource = isSiteOpenSource(target);
  const targetRegDomain = extractRegistrableDomain(target.url);

  // 汇总知识图谱关系边（双向容错：按 targetSiteId 或规范化域名匹配）
  const relationBySiteId = new Map<string, SiteRelation>();
  const relationByHost = new Map<string, SiteRelation>();
  const relations = [...(options.targetRelations ?? []), ...(target.relations ?? [])];
  for (const rel of relations) {
    if (rel.targetSiteId && !relationBySiteId.has(rel.targetSiteId)) {
      relationBySiteId.set(rel.targetSiteId, rel);
    }
    const relHost = normalizeSiteHost(rel.targetUrl);
    if (relHost && !relationByHost.has(relHost)) {
      relationByHost.set(relHost, rel);
    }
  }

  const vectorMap = options.vectorSimilarityById;
  const audienceMap = options.audienceOverlapById;
  const hasAnyVector = Boolean(vectorMap && vectorMap.size > 0);

  const allScored: SimilarSiteMatch[] = [];

  for (const cand of activeSites) {
    if (cand.id === target.id) continue;

    const candCatInfo = resolveCategoryNames(cand.categoryId);
    const sameCategory = cand.categoryId === target.categoryId;
    const sameParentCategory =
      !sameCategory &&
      Boolean(
        (targetCatInfo.parentId && targetCatInfo.parentId === candCatInfo.parentId) ||
        targetCatInfo.parentId === cand.categoryId ||
        candCatInfo.parentId === target.categoryId,
      );
    const skosRelated =
      !sameCategory &&
      (targetCatInfo.relatedCategoryIds.has(cand.categoryId) ||
        candCatInfo.relatedCategoryIds.has(target.categoryId));

    // 1. 标签 IDF 加权 Jaccard
    const candTagNorms = new Set(
      (cand.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
    );
    const sharedTagPairs: Array<{ label: string; idf: number }> = [];
    let interWeight = 0;
    let unionWeight = 0;
    for (const [norm, label] of targetTagNormMap.entries()) {
      const w = tagIdf.get(norm) ?? 1;
      unionWeight += w;
      if (candTagNorms.has(norm)) {
        interWeight += w;
        sharedTagPairs.push({ label, idf: w });
      }
    }
    for (const norm of candTagNorms) {
      if (!targetTagNormMap.has(norm)) {
        unionWeight += tagIdf.get(norm) ?? 1;
      }
    }
    sharedTagPairs.sort((a, b) => b.idf - a.idf);
    const sharedTags = sharedTagPairs.map((p) => p.label);
    const tagScore =
      unionWeight > 0 && sharedTags.length > 0
        ? Math.min(1, (interWeight / unionWeight) * 1.45 + Math.min(0.25, sharedTags.length * 0.06))
        : 0;

    // 2. 语义与文本亲和度（向量余弦 + 中英词元 Dice）
    const candTokens = extractSimilarityTokens(siteTextBlob(cand));
    const lexicalSim = diceSimilarity(targetTokens, candTokens);
    const vecSimRaw = vectorMap?.get(cand.id);
    const vecSim = typeof vecSimRaw === "number" && Number.isFinite(vecSimRaw)
      ? Math.max(0, Math.min(1, vecSimRaw))
      : null;
    const semanticScore =
      vecSim !== null
        ? Math.min(1, vecSim * 0.72 + lexicalSim * 0.28)
        : Math.min(1, lexicalSim * 1.85);

    // 3. 分类树与 SKOS 亲缘度
    const categoryScore = sameCategory
      ? 1.0
      : sameParentCategory
        ? 0.58
        : skosRelated
          ? 0.48
          : 0;

    // 4. 分面与定位对齐度
    const candFacets = normalizeFacetEntries(cand);
    const candOpenSource = isSiteOpenSource(cand);
    const sharedFacets: string[] = [];
    let facetMatches = 0;
    let facetTotal = 0;
    for (const [fKey, tVals] of targetFacets.entries()) {
      const cVals = candFacets.get(fKey);
      if (!cVals) continue;
      facetTotal++;
      let hit = false;
      for (const v of tVals) {
        if (cVals.has(v)) {
          hit = true;
          sharedFacets.push(v);
        }
      }
      if (hit) facetMatches++;
    }
    if (targetOpenSource && candOpenSource) {
      sharedFacets.push("开源项目");
      facetMatches += 0.6;
      facetTotal += 0.6;
    }
    const facetScore = facetTotal > 0 ? Math.min(1, facetMatches / facetTotal) : 0;

    // 5. 知识图谱关系 + 受众收藏共现
    const candHost = normalizeSiteHost(cand.url);
    const rel = relationBySiteId.get(cand.id) ?? (candHost ? relationByHost.get(candHost) : undefined) ?? null;
    const relScore = rel
      ? rel.relationType === "alternative"
        ? 1.0
        : rel.relationType === "complementary" || rel.relationType === "ecosystem"
          ? 0.72
          : 0.55
      : 0;
    const audienceOverlap = Math.max(0, Math.min(1, audienceMap?.get(cand.id) ?? 0));
    const isSameBrand = isSameBrandSite(target, cand);
    const graphScore = Math.min(1, Math.max(relScore, audienceOverlap * 0.9));

    // 无任何有效信号（不同类目、无共享标签、无图谱边、文本极弱）直接跳过，避免垃圾噪声
    if (
      categoryScore === 0 &&
      tagScore === 0 &&
      graphScore === 0 &&
      semanticScore < 0.24
    ) {
      continue;
    }

    const rawScore =
      tagScore * 0.32 +
      semanticScore * 0.28 +
      categoryScore * 0.18 +
      facetScore * 0.10 +
      graphScore * 0.12;

    const hasStrongSignal =
      rel?.relationType === "alternative" ||
      (sameCategory && sharedTags.length >= 2) ||
      (vecSim !== null && vecSim >= 0.72);

    const basePercent = calibrateSimilarityPercent(rawScore, hasStrongSignal);
    // 同品牌子站/文档页做轻度降权（-10%），让外部独立竞品平替优先浮到前列
    const similarityPercent = isSameBrand ? Math.max(20, basePercent - 10) : basePercent;
    if (similarityPercent < 20) continue;

    const uniqueTags = (cand.tags ?? [])
      .map((t) => t.trim())
      .filter((t) => t && !targetTagNormMap.has(t.toLowerCase()))
      .slice(0, 5);

    const reasons = buildMatchReasons({
      relationType: rel?.relationType ?? null,
      relationNote: rel?.note ?? null,
      sharedTags,
      sameCategory,
      sameParentCategory,
      categoryName: candCatInfo.categoryName,
      parentCategoryName: candCatInfo.parentCategoryName,
      semanticScore,
      hasVector: vecSim !== null,
      sharedFacets,
      audienceOverlap,
    });
    if (isSameBrand && !reasons.some((r) => r.includes("同品牌"))) {
      reasons.unshift("同品牌生态子站/关联服务");
    }

    allScored.push({
      site: cand,
      categoryName: candCatInfo.categoryName,
      parentCategoryName: candCatInfo.parentCategoryName,
      similarityPercent,
      siteRank: rankings.siteRankById.get(cand.id) ?? rankings.totalActiveSites,
      categoryRank: rankings.categoryRankById.get(cand.id) ?? 1,
      sameCategory,
      sameParentCategory,
      relationType: rel?.relationType ?? null,
      relationNote: rel?.note ?? null,
      isOpenSource: candOpenSource,
      isHealthy: isSiteHealthy(cand),
      isSameBrand,
      sharedTags,
      uniqueTags,
      sharedFacets: [...new Set(sharedFacets)].slice(0, 4),
      reasons: reasons.slice(0, 3),
      breakdown: {
        tags: Math.round(tagScore * 100),
        semantic: Math.round(semanticScore * 100),
        category: Math.round(categoryScore * 100),
        facets: Math.round(facetScore * 100),
        graph: Math.round(graphScore * 100),
      },
    });
  }

  // 全候选先按综合相似度降序，截取合理池（top 80）再做聚合统计与筛选，保证面板汇总精准
  allScored.sort(
    (a, b) =>
      b.similarityPercent - a.similarityPercent ||
      b.sharedTags.length - a.sharedTags.length ||
      a.siteRank - b.siteRank,
  );
  const pool = allScored.slice(0, Math.max(limit * 2, 60));

  // 聚合摘要（供前端筛选胶囊与维度洞察使用）
  const tagCounts = new Map<string, number>();
  const catCounts = new Map<string, { id: string; name: string; count: number }>();
  let sameCategoryCount = 0;
  let crossCategoryCount = 0;
  let openSourceCount = 0;
  let healthyCount = 0;
  let sameBrandCount = 0;

  for (const item of pool) {
    if (item.sameCategory) sameCategoryCount++;
    else crossCategoryCount++;
    if (item.isOpenSource) openSourceCount++;
    if (item.isHealthy) healthyCount++;
    if (item.isSameBrand) sameBrandCount++;
    for (const t of item.sharedTags) {
      tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    }
    const cId = item.site.categoryId;
    const cName = item.categoryName ?? "其他分类";
    const prev = catCounts.get(cId);
    if (prev) prev.count++;
    else catCounts.set(cId, { id: cId, name: cName, count: 1 });
  }

  // 按用户所选过滤条件筛选
  const filtered = pool.filter((item) => {
    if (scope === "same-category" && !item.sameCategory) return false;
    if (scope === "cross-category" && item.sameCategory) return false;
    if (categoryFilter && item.site.categoryId !== categoryFilter) return false;
    if (options.openSourceOnly && !item.isOpenSource) return false;
    if (options.healthyOnly && !item.isHealthy) return false;
    if (options.excludeSameBrand && item.isSameBrand) return false;
    if (tagFilter && !item.sharedTags.some((t) => t.toLowerCase() === tagFilter)) return false;
    return true;
  });

  // 按用户所选维度排序
  filtered.sort((a, b) => {
    switch (sort) {
      case "popularity":
        return a.siteRank - b.siteRank || b.similarityPercent - a.similarityPercent;
      case "latency": {
        const la = a.site.health?.ok && typeof a.site.health.latencyMs === "number" ? a.site.health.latencyMs : 999_999;
        const lb = b.site.health?.ok && typeof b.site.health.latencyMs === "number" ? b.site.health.latencyMs : 999_999;
        return la - lb || b.similarityPercent - a.similarityPercent;
      }
      case "tags":
        return b.sharedTags.length - a.sharedTags.length || b.similarityPercent - a.similarityPercent;
      case "similarity":
      default:
        return b.similarityPercent - a.similarityPercent || a.siteRank - b.siteRank;
    }
  });

  const targetProfile: SimilarSiteTargetProfile = {
    site: target,
    categoryName: targetCatInfo.categoryName,
    parentCategoryName: targetCatInfo.parentCategoryName,
    siteRank: rankings.siteRankById.get(target.id) ?? rankings.totalActiveSites,
    totalActiveSites: rankings.totalActiveSites,
    categoryRank: rankings.categoryRankById.get(target.id) ?? 1,
    categoryTotal: rankings.categoryTotalById.get(target.categoryId) ?? 1,
    isOpenSource: targetOpenSource,
  };

  return {
    matchType: "exact-site",
    query: target.url,
    target: targetProfile,
    summary: {
      totalFound: pool.length,
      sameCategoryCount,
      crossCategoryCount,
      openSourceCount,
      healthyCount,
      sameBrandCount,
      topSharedTags: [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count })),
      categories: [...catCounts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      signalMode: hasAnyVector ? "hybrid-vector" : "hybrid-lexical",
    },
    items: filtered.slice(0, limit),
  };
}

/**
 * 按用户输入（URL、域名、站点名）在馆藏中定位最匹配站点；
 * 命中时用于输出完整 SimilarSites 报告，未命中时返回 null 供上层走主题发现兜底。
 */
export function resolveSiteByLookupQuery(
  rawQuery: string,
  sites: readonly Site[],
): { site: Site; matchType: "exact-site" | "matched-site" } | null {
  const q = (rawQuery || "").trim();
  if (!q) return null;
  const active = sites.filter((s) => s.status === "active" && s.enabled !== false && !s.deletedAt);
  const lower = q.toLowerCase();
  const qHost = normalizeSiteHost(q);
  const qDomain = extractRegistrableDomain(qHost);
  const looksLikeUrl = /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(lower.replace(/^https?:\/\//, ""));

  // 1. 精确 ID 命中
  const byId = active.find((s) => s.id === q);
  if (byId) return { site: byId, matchType: "exact-site" };

  // 2. 精确规范化主机名命中（如 movie.douban.com / github.com）
  if (looksLikeUrl && qHost) {
    const exactHostHits = active.filter((s) => normalizeSiteHost(s.url) === qHost);
    if (exactHostHits.length > 0) {
      exactHostHits.sort((a, b) => sitePopularityScore(b) - sitePopularityScore(a));
      return { site: exactHostHits[0]!, matchType: "exact-site" };
    }
    // 3. 主域一致命中（如输入 douban.com 命中 movie.douban.com 或 www.douban.com）
    if (qDomain) {
      const domainHits = active.filter((s) => extractRegistrableDomain(s.url) === qDomain);
      if (domainHits.length > 0) {
        domainHits.sort((a, b) => sitePopularityScore(b) - sitePopularityScore(a));
        return { site: domainHits[0]!, matchType: "matched-site" };
      }
    }
  }

  // 4. 站点名精确匹配（中/英文名）
  const exactTitle = active.find(
    (s) => s.title.trim().toLowerCase() === lower || (s.titleEn ?? "").trim().toLowerCase() === lower,
  );
  if (exactTitle) return { site: exactTitle, matchType: "exact-site" };

  // 5. 标题前缀/包含或主机名前缀命中（按热度优选，例如输入 "豆瓣" / "figma" / "notion"）
  const titleHits = active.filter((s) => {
    const t = s.title.toLowerCase();
    const te = (s.titleEn ?? "").toLowerCase();
    const h = normalizeSiteHost(s.url);
    return t.includes(lower) || te.includes(lower) || (lower.length >= 3 && h.startsWith(lower));
  });
  if (titleHits.length > 0) {
    titleHits.sort((a, b) => {
      const aExactStart = a.title.toLowerCase().startsWith(lower) || (a.titleEn ?? "").toLowerCase().startsWith(lower) ? 1 : 0;
      const bExactStart = b.title.toLowerCase().startsWith(lower) || (b.titleEn ?? "").toLowerCase().startsWith(lower) ? 1 : 0;
      return bExactStart - aExactStart || sitePopularityScore(b) - sitePopularityScore(a);
    });
    return { site: titleHits[0]!, matchType: "matched-site" };
  }

  return null;
}

/**
 * 外部未收录域名或自由主题词的相似发现（SimilarSites.com 任意网址查询兜底）：
 * 把外部 URL/关键词构造为虚拟查询文档，从 4,800+ 馆藏中匹配最相似站点。
 */
export function computeTopicSimilarSites(
  rawQuery: string,
  allSites: readonly Site[],
  categories: readonly Category[],
  options: ComputeSimilarSitesOptions = {},
): SimilarSitesReport {
  const limit = Math.max(1, Math.min(48, Math.trunc(options.limit ?? 24)));
  const q = (rawQuery || "").trim();
  const activeSites = allSites.filter(
    (s) => s.status === "active" && s.enabled !== false && !s.deletedAt,
  );
  const categoryById = new Map<string, Category>();
  for (const c of categories) categoryById.set(c.id, c);
  const rankings = computeSiteRankings(activeSites);
  const qTokens = extractSimilarityTokens(q.replace(/^https?:\/\//i, "").replace(/^www\./i, ""));
  const vectorMap = options.vectorSimilarityById;
  const hasAnyVector = Boolean(vectorMap && vectorMap.size > 0);
  const lower = q.toLowerCase();

  const items: SimilarSiteMatch[] = [];
  for (const cand of activeSites) {
    const candTokens = extractSimilarityTokens(siteTextBlob(cand));
    const lexical = diceSimilarity(qTokens, candTokens);
    const vecRaw = vectorMap?.get(cand.id);
    const vecSim = typeof vecRaw === "number" && Number.isFinite(vecRaw) ? Math.max(0, Math.min(1, vecRaw)) : null;

    const matchedTags = (cand.tags ?? []).filter((t) => {
      const tl = t.toLowerCase();
      return lower.includes(tl) || tl.includes(lower) || qTokens.has(tl);
    });
    const tagScore = matchedTags.length > 0 ? Math.min(1, matchedTags.length * 0.35) : 0;
    const semanticScore = vecSim !== null ? Math.min(1, vecSim * 0.72 + lexical * 0.28) : Math.min(1, lexical * 2.1);

    const cat = categoryById.get(cand.categoryId) ?? null;
    const parent = cat?.parentId ? categoryById.get(cat.parentId) ?? null : null;
    const catHit = cat && (cat.title.toLowerCase().includes(lower) || qTokens.has(cat.title.toLowerCase())) ? 0.65 : 0;

    const rawScore = tagScore * 0.35 + semanticScore * 0.5 + catHit * 0.15;
    if (rawScore < 0.08) continue;

    const similarityPercent = calibrateSimilarityPercent(rawScore, matchedTags.length > 0 || (vecSim !== null && vecSim >= 0.65));
    const reasons: string[] = [];
    if (matchedTags.length > 0) {
      reasons.push(`命中主题标签：${matchedTags.slice(0, 3).map((t) => `#${t}`).join(" ")}`);
    }
    if (semanticScore >= 0.25) {
      reasons.push(vecSim !== null ? `语义主题高度匹配 (${Math.round(semanticScore * 100)}%)` : `内容关键词相关 (${Math.round(semanticScore * 100)}%)`);
    }
    if (cat) reasons.push(`归属「${cat.title}」分类`);

    items.push({
      site: cand,
      categoryName: cat?.title ?? null,
      parentCategoryName: parent?.title ?? null,
      similarityPercent,
      siteRank: rankings.siteRankById.get(cand.id) ?? rankings.totalActiveSites,
      categoryRank: rankings.categoryRankById.get(cand.id) ?? 1,
      sameCategory: false,
      sameParentCategory: false,
      relationType: null,
      relationNote: null,
      isOpenSource: isSiteOpenSource(cand),
      isHealthy: isSiteHealthy(cand),
      isSameBrand: false,
      sharedTags: matchedTags,
      uniqueTags: (cand.tags ?? []).filter((t) => !matchedTags.includes(t)).slice(0, 5),
      sharedFacets: [],
      reasons: reasons.slice(0, 3),
      breakdown: {
        tags: Math.round(tagScore * 100),
        semantic: Math.round(semanticScore * 100),
        category: Math.round(catHit * 100),
        facets: 0,
        graph: 0,
      },
    });
  }

  items.sort((a, b) => b.similarityPercent - a.similarityPercent || a.siteRank - b.siteRank);
  const pool = items.slice(0, Math.max(limit * 2, 60));

  const catCounts = new Map<string, { id: string; name: string; count: number }>();
  const tagCounts = new Map<string, number>();
  let openSourceCount = 0;
  let healthyCount = 0;
  for (const item of pool) {
    if (item.isOpenSource) openSourceCount++;
    if (item.isHealthy) healthyCount++;
    for (const t of item.sharedTags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    const prev = catCounts.get(item.site.categoryId);
    if (prev) prev.count++;
    else catCounts.set(item.site.categoryId, { id: item.site.categoryId, name: item.categoryName ?? "其他分类", count: 1 });
  }

  const categoryFilter = options.categoryId?.trim() || "";
  const filtered = pool.filter((item) => {
    if (categoryFilter && item.site.categoryId !== categoryFilter) return false;
    if (options.openSourceOnly && !item.isOpenSource) return false;
    if (options.healthyOnly && !item.isHealthy) return false;
    return true;
  });

  return {
    matchType: "topic-discovery",
    query: q,
    target: null,
    summary: {
      totalFound: pool.length,
      sameCategoryCount: 0,
      crossCategoryCount: pool.length,
      openSourceCount,
      healthyCount,
      // 主题发现没有目标站点，无从谈同品牌（同品牌计数只在有 target 的相似路径里有意义）
      sameBrandCount: 0,
      topSharedTags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count })),
      categories: [...catCounts.values()].sort((a, b) => b.count - a.count).slice(0, 10),
      signalMode: hasAnyVector ? "hybrid-vector" : "hybrid-lexical",
    },
    items: filtered.slice(0, limit),
  };
}
