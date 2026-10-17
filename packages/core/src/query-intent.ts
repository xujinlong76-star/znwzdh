import { levenshteinDistance } from "./taxonomy-governance.ts";

/**
 * 搜索意图与分面修饰符规则
 */
export interface FacetIntentRule {
  pattern: RegExp;
  facetKey: string;
  facetValue: string;
  label: string;
}

export interface MatchedFacetModifier {
  word: string;
  facetKey: string;
  facetValue: string;
  label: string;
}

export interface ParsedFacetedQuery {
  rawQuery: string;
  cleanedQuery: string;
  inferredFacets: Record<string, string[]>;
  matchedModifiers: MatchedFacetModifier[];
  inferredTag?: string;
  inferredCategory?: string;
  excludedTerms?: string[];
  exactPhrases?: string[];
}

/**
 * 结构化分面别名映射
 */
const STRUCTURED_FACET_KEYS: Record<string, string> = {
  pricing: "pricing",
  计费: "pricing",
  platform: "platform",
  平台: "platform",
  form: "form",
  形态: "form",
  language: "language",
  lang: "language",
  语言: "language",
};

/**
 * 受控分面意图识别规则表
 * 英文词使用 \\b 词边界保护，防止误伤（如 mac 误伤 machine、cli 误伤 client）
 */
export const FACET_INTENT_RULES: FacetIntentRule[] = [
  // 计费分面 (Pricing)
  { pattern: /(?:开源|open[- ]?source)/i, facetKey: "pricing", facetValue: "open_source", label: "开源免费" },
  { pattern: /(?:完全免费|免费|\bfree\b)/i, facetKey: "pricing", facetValue: "free", label: "免费" },
  { pattern: /(?:商业付费|商业版|付费|收费|\bpaid\b)/i, facetKey: "pricing", facetValue: "paid", label: "商业付费" },
  { pattern: /(?:免费增值|\bfreemium\b)/i, facetKey: "pricing", facetValue: "freemium", label: "免费增值" },

  // 运行平台分面 (Platform)
  { pattern: /(?:macOS|苹果端|\bmac\b)/i, facetKey: "platform", facetValue: "macos", label: "macOS" },
  { pattern: /(?:windows端|\bwindows\b|\bwin\b)/i, facetKey: "platform", facetValue: "windows", label: "Windows" },
  { pattern: /(?:linux端|\blinux\b)/i, facetKey: "platform", facetValue: "linux", label: "Linux" },
  { pattern: /(?:ios端|\bios\b|iphone|ipad)/i, facetKey: "platform", facetValue: "ios", label: "iOS" },
  { pattern: /(?:android端|安卓端|安卓|\bandroid\b)/i, facetKey: "platform", facetValue: "android", label: "Android" },
  { pattern: /(?:网页版|在线版|浏览器版|网页|在线|\bweb\b)/i, facetKey: "platform", facetValue: "web", label: "Web 网页端" },
  { pattern: /(?:浏览器插件|chrome插件|插件|扩展|\bextension\b)/i, facetKey: "platform", facetValue: "extension", label: "扩展插件" },

  // 产品形态分面 (Form)
  { pattern: /(?:命令行工具|命令行|\bcli\b)/i, facetKey: "form", facetValue: "cli", label: "命令行工具" },
  { pattern: /(?:开发者api|开发包|\bapi\b|\bsdk\b)/i, facetKey: "form", facetValue: "api", label: "API / SDK" },
  { pattern: /(?:自托管|私有化部署|私有部署|self[- ]?hosted|docker部署)/i, facetKey: "form", facetValue: "self_hosted", label: "自托管" },
  { pattern: /(?:桌面客户端|桌面软件|桌面端|\bdesktop\b)/i, facetKey: "form", facetValue: "desktop", label: "桌面端" },
  { pattern: /(?:开发框架|组件库|代码库|\blibrary\b)/i, facetKey: "form", facetValue: "library", label: "代码库" },

  // 语言支持分面 (Language)
  { pattern: /(?:中文界面|中文版|汉化|支持中文)/i, facetKey: "language", facetValue: "zh", label: "中文" },
  { pattern: /(?:英文版|英文界面|\benglish\b)/i, facetKey: "language", facetValue: "en", label: "英文" },
];

/**
 * 从原始搜索查询串中智能析取显式分面意图修饰符，并返回清洗后的核心查询词与推断分面
 */
export function parseFacetedQuery(raw: string): ParsedFacetedQuery {
  const rawTrimmed = (raw ?? "").trim();
  if (!rawTrimmed) {
    return { rawQuery: "", cleanedQuery: "", inferredFacets: {}, matchedModifiers: [] };
  }

  let working = rawTrimmed;
  const inferredFacets: Record<string, string[]> = {};
  const matchedModifiers: MatchedFacetModifier[] = [];
  let inferredTag: string | undefined;
  let inferredCategory: string | undefined;
  const excludedTerms: string[] = [];
  const exactPhrases: string[] = [];

  // 1. 精确短语提取: "quoted phrase" 或 “quoted phrase”
  working = working.replace(/(?:^|\s)["“]([^"”]+)["”](?=\s|$)/g, (_, phrase) => {
    const p = phrase.trim();
    if (p) exactPhrases.push(p);
    return " " + p + " ";
  });

  // 2. 显式标签修饰符: #tag 或 tag:tag 或 标签:tag
  working = working.replace(/(?:^|\s)#([a-zA-Z0-9_\u4e00-\u9fa5\-]+)(?=\s|$)/g, (_, tag) => {
    if (!inferredTag) inferredTag = tag.trim().toLowerCase();
    return " ";
  });
  working = working.replace(/(?:^|\s)(?:tag|标签):([a-zA-Z0-9_\u4e00-\u9fa5\-]+)(?=\s|$)/gi, (_, tag) => {
    if (!inferredTag) inferredTag = tag.trim().toLowerCase();
    return " ";
  });

  // 3. 显式类目修饰符: @category 或 cat:category 或 category:category 或 类目:category
  working = working.replace(/(?:^|\s)@([a-zA-Z0-9_\u4e00-\u9fa5\-]+)(?=\s|$)/g, (_, cat) => {
    if (!inferredCategory) inferredCategory = cat.trim();
    return " ";
  });
  working = working.replace(/(?:^|\s)(?:cat|category|类目|分类):([a-zA-Z0-9_\u4e00-\u9fa5\-]+)(?=\s|$)/gi, (_, cat) => {
    if (!inferredCategory) inferredCategory = cat.trim();
    return " ";
  });

  // 4. 显式键值分面语法: pricing:open_source, platform:macos, form:cli 等
  working = working.replace(
    /(?:^|\s)(pricing|platform|form|language|lang|计费|平台|形态|语言):([a-zA-Z0-9_\u4e00-\u9fa5\-]+)(?=\s|$)/gi,
    (_, rawKey, rawVal) => {
      const k = STRUCTURED_FACET_KEYS[rawKey.toLowerCase()] || rawKey.toLowerCase();
      const v = rawVal.trim().toLowerCase();
      const cur = inferredFacets[k] || [];
      if (!cur.includes(v)) cur.push(v);
      inferredFacets[k] = cur;
      matchedModifiers.push({
        word: `${rawKey}:${rawVal}`,
        facetKey: k,
        facetValue: v,
        label: `${rawKey}:${rawVal}`,
      });
      return " ";
    }
  );

  // 5. 负向过滤关键词: -keyword (词首带减号且非单词内部连字符)
  working = working.replace(/(?:^|\s)-([a-zA-Z0-9_\u4e00-\u9fa5]+)(?=\s|$)/g, (_, term) => {
    const t = term.trim().toLowerCase();
    if (t && !excludedTerms.includes(t)) excludedTerms.push(t);
    return " ";
  });

  // 6. 受控自然语言分面修饰符规则
  for (const rule of FACET_INTENT_RULES) {
    const match = rule.pattern.exec(working);
    if (!match) continue;

    const matchedWord = match[0];
    matchedModifiers.push({
      word: matchedWord,
      facetKey: rule.facetKey,
      facetValue: rule.facetValue,
      label: rule.label,
    });

    const currentList = inferredFacets[rule.facetKey] || [];
    if (!currentList.includes(rule.facetValue)) {
      currentList.push(rule.facetValue);
      inferredFacets[rule.facetKey] = currentList;
    }

    // 从工作字符串中安全剔除该修饰符
    working = working.replace(rule.pattern, " ");
  }

  // 清洗多余空格
  const cleanedQuery = working.replace(/\s+/g, " ").trim();

  return {
    rawQuery: rawTrimmed,
    cleanedQuery,
    inferredFacets,
    matchedModifiers,
    ...(inferredTag ? { inferredTag } : {}),
    ...(inferredCategory ? { inferredCategory } : {}),
    ...(excludedTerms.length > 0 ? { excludedTerms } : {}),
    ...(exactPhrases.length > 0 ? { exactPhrases } : {}),
  };
}

/**
 * 基于 Levenshtein 编辑距离的零结果拼写纠错建议 ("您是不是想搜...")
 *
 * @param query 用户输入的待纠错词
 * @param dictionary 候选词典（全站标题、标签、分类词）
 * @param maxDistance 最大允许编辑距离（默认 2）
 */
export function findDidYouMeanSuggestion(
  query: string,
  dictionary: string[],
  maxDistance = 2
): string | null {
  const normQuery = query.trim().toLowerCase();
  if (!normQuery || normQuery.length < 3) return null;

  let bestCandidate: string | null = null;
  let minDistance = maxDistance + 1;

  // 针对短词严格收紧最大距离，防止误纠
  const effectiveMax = normQuery.length <= 4 ? 1 : maxDistance;

  for (const candidate of dictionary) {
    const normCand = candidate.trim().toLowerCase();
    if (!normCand || normCand === normQuery) continue;

    // 长度相差过大直接剪枝
    if (Math.abs(normCand.length - normQuery.length) > effectiveMax) continue;

    const dist = levenshteinDistance(normQuery, normCand);
    if (dist <= effectiveMax && dist < minDistance) {
      minDistance = dist;
      bestCandidate = candidate.trim();
    }
  }

  return bestCandidate;
}
