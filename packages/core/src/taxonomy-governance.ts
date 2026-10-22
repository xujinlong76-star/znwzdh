/**
 * 分类与标签体系智能治理引擎 (Taxonomy Governance & Auditing Engine)
 *
 * 核心目标：
 * 1. 站点归类契合度检测（Categorization Mismatch / Candidate Ranking）
 * 2. 冗余与形近标签合并建议（Tag Consolidation & Synonym/Alias Proposal）
 * 3. 零结果搜索聚类与类目/标签缺口发现（Zero-Result Gap Discovery）
 * 4. 治理提案结构定义与状态机（Pending -> Applied / Dismissed）
 */

export type TaxonomyProposalKind =
  | "categorization_mismatch"
  | "tag_consolidation"
  | "zero_result_gap"
  | "facet_gap"
  | "category_gap";

export type TaxonomyProposalStatus = "pending" | "applied" | "dismissed";

/**
 * 「未分类」兜底类目的固定 id。
 *
 * 它此前是懒创建的：`ensureCategory("未分类")` 按标题匹配，谁先触发谁建，
 * 于是没有图标/描述/排序，`sort` 挤在默认 0，也不在任何种子数据里 ——
 * 删掉类目、AI 归类失败、插件卸载的站点全都往它身上落。
 * 固定 id 之后它成为第一个「有主」的系统类目：显式种子、可从清扫中豁免、
 * 并按 slug 从导航与 sitemap 排除。
 */
export const UNCATEGORIZED_CATEGORY_ID = "cat-uncategorized";
export const UNCATEGORIZED_CATEGORY_TITLE = "未分类";

export interface TaxonomyProposal {
  id: string;
  kind: TaxonomyProposalKind;
  targetId: string;
  targetTitle?: string;
  currentValue?: string;
  suggestedValue: string;
  confidence: number;
  reason: string;
  status: TaxonomyProposalStatus;
  meta?: Record<string, unknown>;
  createdAt: number;
  appliedAt?: number | null;
}

/**
 * 字符串 Levenshtein 编辑距离
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Int32Array(n + 1);
  let curr = new Int32Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const aChar = a[i - 1]?.toLowerCase();
    for (let j = 1; j <= n; j++) {
      const bChar = b[j - 1]?.toLowerCase();
      const cost = aChar === bChar ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    const temp = prev;
    prev = curr;
    curr = temp;
  }

  return prev[n] ?? 0;
}

/**
 * 规范化标签形式：去除首尾空白、转小写、去除内部非字母数字标点
 */
export function normalizeTagKey(tag: string): string {
  return tag.trim().toLowerCase().replace(/[\-_.\s]+/g, "");
}

/**
 * 类目名的匹配键：与标签同口径（忽略大小写、空格与连字符）。
 *
 * 「AI 工具」和「AI工具」是同一个概念；slug 化与去重都靠它。
 */
export function normalizeCategoryKey(title: string): string {
  return normalizeTagKey(title ?? "");
}

/** AI / MCP 建议的类目名在现树里的解析结果 */
export type CategoryTitleResolution =
  | { status: "unique"; categoryId: string }
  | { status: "none" }
  | { status: "ambiguous"; categoryIds: string[] };

/**
 * 把模型给的类目名解析到已有类目：先标题、再 SKOS altLabel，要求唯一命中。
 *
 * 为什么不返回「第一个匹配」：标题历史上不唯一（实测「语言」×3），
 * 静默挑一个会让「AI 归类」的结果取决于存储顺序。歧义时交人工裁决，
 * 调用方拿 ambiguous 去产提案（同名的两个类目本身也是合并候选）。
 */
export function resolveCategoryTitleSuggestion(
  title: string,
  categories: Array<{ id: string; title: string; altLabels?: string[] }>,
): CategoryTitleResolution {
  const key = normalizeCategoryKey(title);
  if (!key) return { status: "none" };
  const hits = new Set<string>();
  for (const c of categories) {
    if (normalizeCategoryKey(c.title) === key || (c.altLabels ?? []).some((a) => normalizeCategoryKey(a) === key)) {
      hits.add(c.id);
    }
  }
  if (hits.size === 0) return { status: "none" };
  if (hits.size > 1) return { status: "ambiguous", categoryIds: [...hits] };
  return { status: "unique", categoryId: [...hits][0]! };
}

/** category_gap 提案的稳定 id：同一个建议名在队列里只有一条，重复出现累加 seenCount */
export function categoryGapProposalId(title: string): string {
  return `category_gap_${encodeURIComponent(normalizeCategoryKey(title))}`;
}

/**
 * 标签冗余与同义合并治理审计
 */
export function auditTagConsolidation(
  tags: Array<{ tag: string; count: number }>,
  existingAliases: Record<string, string> = {},
): TaxonomyProposal[] {
  const proposals: TaxonomyProposal[] = [];
  const sorted = [...tags].sort((a, b) => b.count - a.count);

  for (let i = 0; i < sorted.length; i++) {
    const higher = sorted[i];
    if (!higher || existingAliases[higher.tag.toLowerCase()]) continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const lower = sorted[j];
      if (!lower || higher.tag === lower.tag) continue;
      if (existingAliases[lower.tag.toLowerCase()]) continue;

      const normHigher = normalizeTagKey(higher.tag);
      const normLower = normalizeTagKey(lower.tag);

      // 1. 完全大小写/标点不同，或包含常见前后缀 (如 React.js vs react, dev-tools vs devtools)
      const stripSuffix = (s: string) => s.replace(/(js|ts|cli|工具|框架)$/, "");
      if (normHigher === normLower || stripSuffix(normLower) === normHigher || stripSuffix(normHigher) === normLower) {
        proposals.push({
          id: `tag_merge_${encodeURIComponent(lower.tag)}_to_${encodeURIComponent(higher.tag)}`,
          kind: "tag_consolidation",
          targetId: lower.tag,
          targetTitle: lower.tag,
          currentValue: lower.tag,
          suggestedValue: higher.tag,
          confidence: normHigher === normLower ? 0.95 : 0.88,
          reason: `标签 "${lower.tag}" (引用 ${lower.count} 次) 与主标签 "${higher.tag}" (引用 ${higher.count} 次) 形式重合，建议归一`,
          status: "pending",
          meta: { higherCount: higher.count, lowerCount: lower.count, action: "alias" },
          createdAt: Date.now(),
        });
        continue;
      }

      // 2. 编辑距离极小且低频 (如 Viee vs Vue, githubb vs github)
      const dist = levenshteinDistance(higher.tag, lower.tag);
      const minLen = Math.min(higher.tag.length, lower.tag.length);
      if (dist === 1 && minLen >= 3 && lower.count <= 2) {
        proposals.push({
          id: `tag_typo_${encodeURIComponent(lower.tag)}_to_${encodeURIComponent(higher.tag)}`,
          kind: "tag_consolidation",
          targetId: lower.tag,
          targetTitle: lower.tag,
          currentValue: lower.tag,
          suggestedValue: higher.tag,
          confidence: 0.85,
          reason: `标签 "${lower.tag}" 疑似拼写变体 (编辑距离 1)，建议并入高频标签 "${higher.tag}"`,
          status: "pending",
          meta: { higherCount: higher.count, lowerCount: lower.count, action: "merge" },
          createdAt: Date.now(),
        });
      }
    }
  }

  return proposals;
}

/**
 * 零结果检索词缺口发现审计
 */
export function auditZeroResultGaps(
  zeroQueries: Array<{ query: string; count: number; lastAt?: number }>,
  existingTags: string[] = [],
  existingCategories: Array<{ id: string; title: string; altLabels?: string[] }> = [],
  minCount = 2,
): TaxonomyProposal[] {
  const proposals: TaxonomyProposal[] = [];
  const knownTerms = new Set<string>();

  for (const t of existingTags) knownTerms.add(t.trim().toLowerCase());
  for (const c of existingCategories) {
    knownTerms.add(c.title.trim().toLowerCase());
    for (const alt of c.altLabels ?? []) knownTerms.add(alt.trim().toLowerCase());
  }

  for (const item of zeroQueries) {
    const q = item.query.trim();
    if (!q || q.length < 2 || item.count < minCount) continue;
    if (knownTerms.has(q.toLowerCase())) continue;

    // 排除纯数字或无效长串
    if (/^\d+$/.test(q) || q.length > 30) continue;

    proposals.push({
      id: `zero_gap_${encodeURIComponent(q.toLowerCase())}`,
      kind: "zero_result_gap",
      targetId: q,
      targetTitle: q,
      currentValue: "",
      suggestedValue: q,
      confidence: Math.min(0.99, 0.65 + item.count * 0.05),
      reason: `关键词 "${q}" 遭遇了 ${item.count} 次零结果检索，尚未被现有类目或标签覆盖`,
      status: "pending",
      meta: { count: item.count, lastAt: item.lastAt ?? Date.now() },
      createdAt: Date.now(),
    });
  }

  return proposals;
}

/**
 * 站点分类契合度审计（基于词素重叠与特征统计）
 */
export function auditSiteCategorization(
  sites: Array<{ id: string; title: string; description?: string; categoryId: string; tags?: string[] }>,
  categories: Array<{ id: string; title: string; altLabels?: string[] }>,
): TaxonomyProposal[] {
  const proposals: TaxonomyProposal[] = [];
  const catMap = new Map<string, { id: string; title: string; keywords: string[] }>();

  for (const cat of categories) {
    const kw = [cat.title.toLowerCase(), ...(cat.altLabels ?? []).map((a) => a.toLowerCase())];
    catMap.set(cat.id, { id: cat.id, title: cat.title, keywords: kw });
  }

  for (const site of sites) {
    const text = `${site.title} ${site.description ?? ""} ${(site.tags ?? []).join(" ")}`.toLowerCase();
    const currentCat = catMap.get(site.categoryId);

    let bestCat = currentCat;
    let maxMatches = currentCat ? scoreCategoryMatch(text, currentCat.keywords) : 0;

    for (const [id, cat] of catMap.entries()) {
      if (id === site.categoryId) continue;
      const score = scoreCategoryMatch(text, cat.keywords);
      if (score > maxMatches + 1) { // 显著更匹配其它分类
        maxMatches = score;
        bestCat = cat;
      }
    }

    if (bestCat && bestCat.id !== site.categoryId && maxMatches >= 2) {
      proposals.push({
        id: `site_cat_${site.id}_to_${bestCat.id}`,
        kind: "categorization_mismatch",
        targetId: site.id,
        targetTitle: site.title,
        currentValue: currentCat ? currentCat.title : site.categoryId,
        suggestedValue: bestCat.title,
        confidence: Math.min(0.92, 0.6 + maxMatches * 0.1),
        reason: `站点 "${site.title}" 特征词与分类 "${bestCat.title}" 匹配度较高 (${maxMatches} 个关键词)，建议复核并归类至该分类`,
        status: "pending",
        meta: { siteId: site.id, fromCategoryId: site.categoryId, toCategoryId: bestCat.id, score: maxMatches },
        createdAt: Date.now(),
      });
    }
  }

  return proposals;
}

function scoreCategoryMatch(text: string, keywords: string[]): number {
  let score = 0;
  for (const kw of keywords) {
    if (!kw || kw.length < 2) continue;
    if (text.includes(kw)) {
      score += 1;
    }
  }
  return score;
}
