import type { SearchEvalCase } from "./search-eval.ts";

export type SearchGoldGrade = 0 | 1 | 2 | 3 | "unjudgeable";
export type SearchGoldIntent =
  | "exact_site" | "task" | "category" | "pinyin" | "mixed_language"
  | "zero_result" | "ambiguous" | "long_tail" | "other";

export interface SearchGoldAnnotation {
  annotatorId: string;
  independent: true;
  judgments: Record<string, SearchGoldGrade>;
}
export interface SearchGoldAdjudication {
  reviewerId: string;
  judgments: Record<string, SearchGoldGrade>;
}
export interface SearchGoldCase {
  id: string;
  sampleId: string;
  sampledAt: string;
  query: string;
  locale: string;
  intent: SearchGoldIntent;
  privacyReviewed: true;
  hits: string[];
  annotations: [SearchGoldAnnotation, SearchGoldAnnotation];
  adjudication?: SearchGoldAdjudication;
}
export interface SearchGoldSet {
  schema: "navhub-search-gold-v1";
  deidentified: true;
  source: "production_search_telemetry";
  cases: SearchGoldCase[];
}
export interface SearchGoldValidationResult {
  totalCases: number;
  eligibleCases: number;
  excludedUnjudgeableCases: number;
  evaluationCases: SearchEvalCase[];
}

const INTENTS = new Set<SearchGoldIntent>([
  "exact_site", "task", "category", "pinyin", "mixed_language",
  "zero_result", "ambiguous", "long_tail", "other",
]);
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{5,63}$/;
const LOCALE_PATTERN = /^(?:[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*|mixed|unknown)$/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const CN_MOBILE_PATTERN = /\b1[3-9]\d{9}\b/;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}
function isGrade(value: unknown): value is SearchGoldGrade {
  return value === "unjudgeable" || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3);
}
function assertJudgments(value: unknown, hitIds: Set<string>, field: string): Record<string, SearchGoldGrade> {
  if (!isRecord(value)) throw new Error(field + " 必须是对象");
  const entries = Object.entries(value);
  if (entries.length !== hitIds.size) throw new Error(field + " 必须覆盖候选快照中的全部 siteId");
  for (const [siteId, grade] of entries) {
    if (!hitIds.has(siteId)) throw new Error(field + " 包含候选快照之外的 siteId");
    if (!isGrade(grade)) throw new Error(field + " 的相关性等级必须是 0–3 整数或 unjudgeable");
  }
  return value as Record<string, SearchGoldGrade>;
}

/**
 * Validate a privacy-reviewed, double-blind production search gold set.
 * Query text is never included in thrown errors or returned diagnostics.
 */
export function validateSearchGoldSet(input: unknown): SearchGoldValidationResult {
  if (!isRecord(input) || input.schema !== "navhub-search-gold-v1") {
    throw new Error("金标集 schema 必须为 navhub-search-gold-v1");
  }
  if (input.deidentified !== true || input.source !== "production_search_telemetry") {
    throw new Error("金标集必须明确声明已脱敏且来源为真实生产搜索遥测");
  }
  if (!Array.isArray(input.cases)) throw new Error("金标集 cases 必须是数组");

  const caseIds = new Set<string>();
  const sampleIds = new Set<string>();
  const normalizedQueries = new Set<string>();
  const evaluationCases: SearchEvalCase[] = [];
  let excludedUnjudgeableCases = 0;

  for (let index = 0; index < input.cases.length; index++) {
    const prefix = "第 " + (index + 1) + " 条样本";
    const item = input.cases[index];
    if (!isRecord(item)) throw new Error(prefix + "结构无效");
    if (typeof item.id !== "string" || !ID_PATTERN.test(item.id) || caseIds.has(item.id)) {
      throw new Error(prefix + " id 无效或重复");
    }
    caseIds.add(item.id);
    if (typeof item.sampleId !== "string" || !ID_PATTERN.test(item.sampleId) || sampleIds.has(item.sampleId)) {
      throw new Error(prefix + " sampleId 无效或重复");
    }
    sampleIds.add(item.sampleId);
    if (!isIsoDate(item.sampledAt)) throw new Error(prefix + " sampledAt 必须为 ISO 时间");
    if (typeof item.query !== "string" || !item.query.trim() || item.query.length > 240) {
      throw new Error(prefix + " query 必须为 1–240 字符");
    }
    if (EMAIL_PATTERN.test(item.query) || CN_MOBILE_PATTERN.test(item.query) || IPV4_PATTERN.test(item.query)) {
      throw new Error(prefix + " query 疑似包含邮箱、手机号或 IP，必须先脱敏");
    }
    const queryKey = item.query.trim().replace(/\\s+/g, " ").toLowerCase();
    if (normalizedQueries.has(queryKey)) throw new Error(prefix + " query 与已有样本重复");
    normalizedQueries.add(queryKey);
    if (item.privacyReviewed !== true) throw new Error(prefix + " 必须完成隐私复核");
    if (typeof item.locale !== "string" || !LOCALE_PATTERN.test(item.locale)) {
      throw new Error(prefix + " locale 格式无效");
    }
    if (typeof item.intent !== "string" || !INTENTS.has(item.intent as SearchGoldIntent)) {
      throw new Error(prefix + " intent 无效");
    }
    if (!Array.isArray(item.hits) || item.hits.some((hit) => typeof hit !== "string" || !hit.trim())) {
      throw new Error(prefix + " hits 必须为 siteId 字符串数组");
    }
    const hits = item.hits as string[];
    const hitIds = new Set(hits);
    if (hitIds.size !== hits.length) throw new Error(prefix + " hits 不得包含重复 siteId");
    if (item.intent === "zero_result" && hits.length !== 0) {
      throw new Error(prefix + " 标记为 zero_result 时 hits 必须为空");
    }
    if (!Array.isArray(item.annotations) || item.annotations.length !== 2) {
      throw new Error(prefix + " 必须有且仅有两份独立标注");
    }
    const annotations = item.annotations as unknown[];
    const parsed = annotations.map((annotation, annotatorIndex) => {
      if (!isRecord(annotation) || annotation.independent !== true ||
          typeof annotation.annotatorId !== "string" || !ID_PATTERN.test(annotation.annotatorId)) {
        throw new Error(prefix + " 第 " + (annotatorIndex + 1) + " 份标注缺少独立标注员标识");
      }
      return {
        annotatorId: annotation.annotatorId,
        judgments: assertJudgments(annotation.judgments, hitIds, prefix + " 标注"),
      };
    });
    if (parsed[0]!.annotatorId === parsed[1]!.annotatorId) {
      throw new Error(prefix + " 两份标注必须来自不同标注员");
    }

    const conflicts: string[] = [];
    const finalJudgments: Record<string, number> = {};
    for (const siteId of hits) {
      const a = parsed[0]!.judgments[siteId]!;
      const b = parsed[1]!.judgments[siteId]!;
      if (a === b && typeof a === "number") {
        finalJudgments[siteId] = a;
      } else if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) === 1) {
        // 轻微分歧按较低分计，避免金标对搜索指标过度乐观。
        finalJudgments[siteId] = Math.min(a, b);
      } else {
        conflicts.push(siteId);
      }
    }

    if (conflicts.length > 0) {
      const adjudication = item.adjudication;
      if (!isRecord(adjudication) ||
          typeof adjudication.reviewerId !== "string" ||
          !ID_PATTERN.test(adjudication.reviewerId) ||
          parsed.some((annotation) => annotation.annotatorId === adjudication.reviewerId)) {
        throw new Error(prefix + " 存在重大分歧或不可判断项，必须由第三人仲裁");
      }
      const adjudicated = assertJudgments(
        adjudication.judgments,
        new Set(conflicts),
        prefix + " 仲裁",
      );
      for (const siteId of conflicts) {
        const grade = adjudicated[siteId]!;
        if (typeof grade === "number") finalJudgments[siteId] = grade;
      }
    }

    if (Object.keys(finalJudgments).length !== hits.length) {
      excludedUnjudgeableCases++;
      continue;
    }
    evaluationCases.push({ query: item.query, hits, relevance: finalJudgments });
  }

  return {
    totalCases: input.cases.length,
    eligibleCases: evaluationCases.length,
    excludedUnjudgeableCases,
    evaluationCases,
  };
}
