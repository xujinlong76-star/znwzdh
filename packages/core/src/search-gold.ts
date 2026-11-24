import type { SearchEvalCase } from "./search-eval.ts";

export type SearchGoldLabel = 0 | 1 | 2 | 3 | "unjudgeable";
export type SearchGoldReasonCode =
  | "exact_match" | "task_fit" | "category_fit" | "partial_fit"
  | "unrelated" | "unavailable" | "insufficient_evidence" | "safety_risk" | "other";
export type SearchGoldIntent =
  | "exact_site" | "task" | "category" | "pinyin" | "mixed_language"
  | "zero_result" | "ambiguous" | "long_tail" | "other";

export interface SearchGoldCandidate {
  siteId: string;
  baselineRank: number;
  evidenceUrl: string;
}
export interface SearchGoldJudgment {
  siteId: string;
  label: SearchGoldLabel;
  rationaleCode: SearchGoldReasonCode;
}
export interface SearchGoldAnnotation {
  annotatorId: string;
  annotatedAt: number;
  judgments: SearchGoldJudgment[];
}
export interface SearchGoldAdjudication {
  adjudicatorId: string;
  adjudicatedAt: number;
  rationale: string;
  judgments: SearchGoldJudgment[];
}
export interface SearchGoldCase {
  schemaVersion: "search-quality-golden-v2";
  datasetVersion: string;
  queryId: string;
  queryText: string;
  locale: string;
  intent: SearchGoldIntent;
  sampledAt: number;
  privacyReviewed: true;
  snapshotId: string;
  candidates: SearchGoldCandidate[];
  annotations: [SearchGoldAnnotation, SearchGoldAnnotation];
  adjudication?: SearchGoldAdjudication;
}
export interface SearchGoldCaseValidation {
  errors: string[];
  needsAdjudication: string[];
  finalLabels: Record<string, number>;
  unjudgeable: boolean;
}
export interface SearchGoldSetValidation {
  totalCases: number;
  eligibleCases: number;
  excludedUnjudgeableCases: number;
  datasetVersion: string | null;
  eligibleIntentCounts: Record<string, number>;
  eligibleLocaleCounts: Record<string, number>;
  errors: string[];
  needsAdjudication: string[];
  evaluationCases: SearchEvalCase[];
}

const INTENTS = new Set<SearchGoldIntent>([
  "exact_site", "task", "category", "pinyin", "mixed_language",
  "zero_result", "ambiguous", "long_tail", "other",
]);
const REASONS = new Set<SearchGoldReasonCode>([
  "exact_match", "task_fit", "category_fit", "partial_fit",
  "unrelated", "unavailable", "insufficient_evidence", "safety_risk", "other",
]);
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{5,79}$/;
const LOCALE_PATTERN = /^(?:[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*|mixed|unknown)$/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const CN_MOBILE_PATTERN = /\b1[3-9]\d{9}\b/;
const GLOBAL_PHONE_PATTERN = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-])\d{3,4}[\s.-]\d{3,4}\b/;
const SECRET_TOKEN_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function validLabel(value: unknown): value is SearchGoldLabel {
  return value === "unjudgeable" || (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3);
}
function validReason(value: unknown): value is SearchGoldReasonCode {
  return typeof value === "string" && REASONS.has(value as SearchGoldReasonCode);
}
function validateEvidenceUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** Validate one v2 case without ever echoing raw query text in errors. */
export function validateSearchGoldCase(input: unknown, index = 0): SearchGoldCaseValidation {
  const errors: string[] = [];
  const needsAdjudication: string[] = [];
  const finalLabels: Record<string, number> = {};
  let unjudgeable = false;
  const prefix = "第 " + (index + 1) + " 条样本";
  if (!isRecord(input)) {
    return { errors: [prefix + "必须是对象"], needsAdjudication, finalLabels, unjudgeable: true };
  }
  const item = input;
  if (item.schemaVersion !== "search-quality-golden-v2") errors.push(prefix + " schemaVersion 必须为 search-quality-golden-v2");
  if (typeof item.datasetVersion !== "string" || !item.datasetVersion.trim()) errors.push(prefix + " datasetVersion 必填");
  if (typeof item.queryId !== "string" || !ID_PATTERN.test(item.queryId)) errors.push(prefix + " queryId 格式无效");
  if (typeof item.queryText !== "string" || !item.queryText.trim() || item.queryText.length > 240) {
    errors.push(prefix + " queryText 必须为 1–240 字符");
  } else if (
    EMAIL_PATTERN.test(item.queryText) || CN_MOBILE_PATTERN.test(item.queryText) ||
    GLOBAL_PHONE_PATTERN.test(item.queryText) || SECRET_TOKEN_PATTERN.test(item.queryText) ||
    IPV4_PATTERN.test(item.queryText)
  ) {
    errors.push(prefix + " queryText 疑似包含邮箱、电话、访问令牌或 IP，必须先脱敏");
  }
  if (typeof item.locale !== "string" || !LOCALE_PATTERN.test(item.locale)) errors.push(prefix + " locale 格式无效");
  if (typeof item.intent !== "string" || !INTENTS.has(item.intent as SearchGoldIntent)) errors.push(prefix + " intent 无效");
  if (!validTimestamp(item.sampledAt)) errors.push(prefix + " sampledAt 必须是有效时间戳");
  if (item.privacyReviewed !== true) errors.push(prefix + " 隐私审查未通过");
  if (typeof item.snapshotId !== "string" || !ID_PATTERN.test(item.snapshotId)) errors.push(prefix + " snapshotId 格式无效");

  const candidates = Array.isArray(item.candidates) ? item.candidates : [];
  if (item.intent === "zero_result" && candidates.length !== 0) errors.push(prefix + " zero_result 的候选列表必须为空");
  if (item.intent !== "zero_result" && candidates.length === 0) errors.push(prefix + " 非 zero_result 查询必须冻结候选快照");
  const candidateIds = new Set<string>();
  const ranks = new Set<number>();
  for (const raw of candidates) {
    if (!isRecord(raw)) { errors.push(prefix + " 候选记录必须是对象"); continue; }
    const siteId = typeof raw.siteId === "string" ? raw.siteId.trim() : "";
    const rank = raw.baselineRank;
    if (!siteId || siteId.length > 128 || !Number.isInteger(rank) || Number(rank) < 1) {
      errors.push(prefix + " 候选 siteId 或 baselineRank 无效");
      continue;
    }
    if (candidateIds.has(siteId)) errors.push(prefix + " 候选 siteId 不得重复");
    if (ranks.has(Number(rank))) errors.push(prefix + " baselineRank 不得重复");
    candidateIds.add(siteId);
    ranks.add(Number(rank));
    if (!validateEvidenceUrl(raw.evidenceUrl)) errors.push(prefix + " 候选 evidenceUrl 必须为不含凭据/查询参数/片段的 HTTP(S) URL");
  }

  const annotations = Array.isArray(item.annotations) ? item.annotations : [];
  if (annotations.length !== 2) errors.push(prefix + " 必须由两名不同标注员独立完成标注");
  const annotatorIds = new Set<string>();
  const parsed: Array<{ annotatorId: string; labels: Map<string, SearchGoldLabel> }> = [];
  for (let i = 0; i < annotations.length; i++) {
    const raw = annotations[i];
    if (!isRecord(raw)) { errors.push(prefix + " 标注员记录必须是对象"); continue; }
    const annotatorId = typeof raw.annotatorId === "string" ? raw.annotatorId.trim() : "";
    if (!ID_PATTERN.test(annotatorId)) errors.push(prefix + " 标注员 ID 格式无效");
    if (annotatorIds.has(annotatorId)) errors.push(prefix + " 必须由两名不同标注员独立标注");
    annotatorIds.add(annotatorId);
    if (!validTimestamp(raw.annotatedAt)) errors.push(prefix + " 标注时间无效");
    if (!Array.isArray(raw.judgments)) {
      errors.push(prefix + " judgments 必须是数组");
      continue;
    }
    const labels = new Map<string, SearchGoldLabel>();
    for (const judgment of raw.judgments) {
      if (!isRecord(judgment)) { errors.push(prefix + " judgment 必须是对象"); continue; }
      const siteId = typeof judgment.siteId === "string" ? judgment.siteId.trim() : "";
      if (!candidateIds.has(siteId)) errors.push(prefix + " judgment 引用了候选快照外 siteId");
      if (labels.has(siteId)) errors.push(prefix + " 同一标注员不得重复标注 siteId");
      if (!validLabel(judgment.label)) errors.push(prefix + " label 必须为 0–3 整数或 unjudgeable");
      if (!validReason(judgment.rationaleCode)) errors.push(prefix + " rationaleCode 无效");
      if (judgment.label === "unjudgeable" &&
          judgment.rationaleCode !== "unavailable" &&
          judgment.rationaleCode !== "insufficient_evidence") {
        errors.push(prefix + " unjudgeable 必须使用 unavailable 或 insufficient_evidence");
      }
      if (validLabel(judgment.label)) labels.set(siteId, judgment.label);
    }
    if (labels.size !== candidateIds.size) errors.push(prefix + " 每位标注员必须覆盖候选快照中的全部 siteId");
    parsed.push({ annotatorId, labels });
  }

  const conflicts: string[] = [];
  if (parsed.length === 2) {
    for (const siteId of candidateIds) {
      const a = parsed[0]!.labels.get(siteId);
      const b = parsed[1]!.labels.get(siteId);
      if (a === undefined || b === undefined) continue;
      if (a === b && typeof a === "number") finalLabels[siteId] = a;
      else if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) === 1) {
        finalLabels[siteId] = Math.min(a, b);
      } else conflicts.push(siteId);
    }
  }

  const adjudication = item.adjudication;
  if (conflicts.length > 0) {
    if (!isRecord(adjudication)) {
      needsAdjudication.push(...conflicts.map(siteId => String(item.queryId ?? "unknown") + ":" + siteId));
    } else {
      const adjudicatorId = typeof adjudication.adjudicatorId === "string" ? adjudication.adjudicatorId.trim() : "";
      if (!ID_PATTERN.test(adjudicatorId) || annotatorIds.has(adjudicatorId)) errors.push(prefix + " 仲裁人必须是独立第三人");
      if (!validTimestamp(adjudication.adjudicatedAt)) errors.push(prefix + " 仲裁时间无效");
      if (typeof adjudication.rationale !== "string" || !adjudication.rationale.trim() || adjudication.rationale.length > 500) {
        errors.push(prefix + " 仲裁理由必须为 1–500 字");
      }
      if (!Array.isArray(adjudication.judgments)) errors.push(prefix + " 仲裁 judgments 必须是数组");
      else {
        const adjudicated = new Map<string, SearchGoldLabel>();
        for (const judgment of adjudication.judgments) {
          if (!isRecord(judgment)) { errors.push(prefix + " 仲裁 judgment 必须是对象"); continue; }
          const siteId = typeof judgment.siteId === "string" ? judgment.siteId.trim() : "";
          if (!conflicts.includes(siteId)) errors.push(prefix + " 仲裁只能覆盖有分歧的候选");
          if (adjudicated.has(siteId)) errors.push(prefix + " 仲裁 siteId 不得重复");
          if (!validLabel(judgment.label) || !validReason(judgment.rationaleCode)) {
            errors.push(prefix + " 仲裁 label 或 rationaleCode 无效");
            continue;
          }
          if (judgment.label === "unjudgeable" &&
              judgment.rationaleCode !== "unavailable" &&
              judgment.rationaleCode !== "insufficient_evidence") {
            errors.push(prefix + " 仲裁 unjudgeable 必须记录不可判断 reasonCode");
          }
          adjudicated.set(siteId, judgment.label);
        }
        for (const siteId of conflicts) {
          const label = adjudicated.get(siteId);
          if (label === undefined) errors.push(prefix + " 仲裁缺少争议候选");
          else if (typeof label === "number") finalLabels[siteId] = label;
        }
      }
    }
  } else if (adjudication !== undefined && adjudication !== null) {
    errors.push(prefix + " 没有争议候选时不应提交仲裁记录");
  }

  if (Object.keys(finalLabels).length !== candidateIds.size) unjudgeable = true;
  return { errors, needsAdjudication, finalLabels, unjudgeable };
}

/** Validates a complete v2 dataset and returns only privacy-safe diagnostics plus local export cases. */
export function validateSearchGoldSet(input: readonly unknown[], minimumCases = 100): SearchGoldSetValidation {
  if (!Number.isInteger(minimumCases) || minimumCases < 1 || minimumCases > 10_000) {
    throw new RangeError("minimumCases 必须是 1–10000 的整数");
  }
  const errors: string[] = [];
  const needsAdjudication: string[] = [];
  const queryIds = new Set<string>();
  const queryKeys = new Set<string>();
  const datasetVersions = new Set<string>();
  const evaluationCases: SearchEvalCase[] = [];
  const eligibleIntentCounts: Record<string, number> = {};
  const eligibleLocaleCounts: Record<string, number> = {};
  let excludedUnjudgeableCases = 0;

  if (input.length < minimumCases) errors.push("金标样本不足：需要至少 " + minimumCases + " 条，当前 " + input.length + " 条");
  if (input.length > 10_000) errors.push("金标样本最多允许 10000 条");
  for (let index = 0; index < input.length; index++) {
    const item = input[index];
    const result = validateSearchGoldCase(item, index);
    errors.push(...result.errors);
    needsAdjudication.push(...result.needsAdjudication);
    if (!isRecord(item)) continue;
    const queryId = typeof item.queryId === "string" ? item.queryId : "";
    if (queryIds.has(queryId)) errors.push("queryId 重复");
    queryIds.add(queryId);
    const queryKey = typeof item.queryText === "string" ? item.queryText.trim().replace(/\s+/g, " ").toLowerCase() : "";
    if (queryKey && queryKeys.has(queryKey)) errors.push("规范化 queryText 重复");
    if (queryKey) queryKeys.add(queryKey);
    if (typeof item.datasetVersion === "string" && item.datasetVersion.trim()) datasetVersions.add(item.datasetVersion);
    if (result.unjudgeable && result.errors.length === 0 && result.needsAdjudication.length === 0) {
      excludedUnjudgeableCases++;
      continue;
    }
    if (result.errors.length > 0 || result.needsAdjudication.length > 0 || result.unjudgeable) continue;
    const candidates = (item.candidates as Array<Record<string, unknown>>)
      .slice().sort((a, b) => Number(a.baselineRank) - Number(b.baselineRank));
    const hits = candidates.map(candidate => String(candidate.siteId));
    evaluationCases.push({
      query: String(item.queryText),
      hits,
      relevance: result.finalLabels,
    });
    const intent = String(item.intent);
    const locale = String(item.locale);
    eligibleIntentCounts[intent] = (eligibleIntentCounts[intent] ?? 0) + 1;
    eligibleLocaleCounts[locale] = (eligibleLocaleCounts[locale] ?? 0) + 1;
  }
  if (evaluationCases.length < minimumCases) {
    errors.push("可评估金标样本不足：需要至少 " + minimumCases + " 条，当前 " + evaluationCases.length + " 条");
  }
  if (datasetVersions.size > 1) errors.push("一个金标集不得混合不同 datasetVersion");
  return {
    totalCases: input.length,
    eligibleCases: evaluationCases.length,
    excludedUnjudgeableCases,
    datasetVersion: datasetVersions.size === 1 ? [...datasetVersions][0]! : null,
    eligibleIntentCounts,
    eligibleLocaleCounts,
    errors,
    needsAdjudication,
    evaluationCases,
  };
}
