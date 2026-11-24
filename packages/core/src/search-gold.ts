/** Human-labelled query-to-site relevance contract. Never fabricates queries or labels. */
export type RelevanceGrade = 0 | 1 | 2 | 3;
export type AnnotationLabel = RelevanceGrade | "unjudgeable";
export interface SearchGoldCandidate { siteId: string; baselineRank: number; evidenceUrl?: string; }
export interface SearchGoldJudgment { siteId: string; label: AnnotationLabel; rationaleCode: string; }
export interface SearchGoldAnnotation { annotatorId: string; judgments: SearchGoldJudgment[]; annotatedAt: number; }
export interface SearchGoldAdjudication {
  adjudicatorId: string;
  /** Only disputed query-site pairs need adjudication. */
  judgments: SearchGoldJudgment[];
  rationale: string;
  adjudicatedAt: number;
}
export interface SearchGoldCase {
  queryId: string;
  queryText: string;
  locale: string;
  intent: string;
  sampledAt: number;
  /** Must be true only after a human privacy review of the de-identified query. */
  privacyReviewed: boolean;
  candidates: SearchGoldCandidate[];
  snapshotId: string;
  annotations: SearchGoldAnnotation[];
  adjudication?: SearchGoldAdjudication;
}
export interface SearchGoldValidation { valid: boolean; errors: string[]; needsAdjudication: string[]; }

type RecordValue = Record<string, unknown>;
function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateJudgments(
  judgments: unknown,
  candidateIds: ReadonlySet<string>,
  label: string,
  requireAll = true,
): { errors: string[]; labels: Map<string, AnnotationLabel> } {
  const errors: string[] = [];
  const labels = new Map<string, AnnotationLabel>();
  if (!Array.isArray(judgments)) return { errors: [`${label}: judgments 必须是数组`], labels };
  for (const raw of judgments) {
    if (!isRecord(raw)) {
      errors.push(`${label}: judgment 必须是对象`);
      continue;
    }
    const siteId = typeof raw.siteId === "string" ? raw.siteId.trim() : "";
    if (!siteId) {
      errors.push(`${label}: siteId 必填`);
      continue;
    }
    if (!candidateIds.has(siteId)) errors.push(`${label}: judgment 引用了候选快照外站点 ${siteId}`);
    if (labels.has(siteId)) errors.push(`${label}: siteId ${siteId} 重复标注`);
    const grade = raw.label;
    if (![0, 1, 2, 3, "unjudgeable"].includes(grade as AnnotationLabel)) {
      errors.push(`${label}: 标注等级必须为 0–3 或 unjudgeable`);
    } else {
      labels.set(siteId, grade as AnnotationLabel);
    }
    if (typeof raw.rationaleCode !== "string" || !raw.rationaleCode.trim()) {
      errors.push(`${label}: rationaleCode 必填`);
    }
  }
  if (requireAll) {
    for (const siteId of candidateIds) if (!labels.has(siteId)) errors.push(`${label}: 缺少候选 ${siteId} 的标注`);
  }
  return { errors, labels };
}

export function validateSearchGoldCase(value: unknown): SearchGoldValidation {
  const errors: string[] = [];
  const needsAdjudication: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["样本必须是对象"], needsAdjudication };
  const item = value;

  if (typeof item.queryId !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(item.queryId)) {
    errors.push("queryId 必须是脱敏后的稳定 ID");
  }
  if (typeof item.queryText !== "string" || !item.queryText.trim()) errors.push("queryText 不能为空");
  if (typeof item.locale !== "string" || !item.locale.trim() ||
      typeof item.intent !== "string" || !item.intent.trim() ||
      typeof item.snapshotId !== "string" || !item.snapshotId.trim()) {
    errors.push("locale、intent、snapshotId 必填");
  }
  if (typeof item.sampledAt !== "number" || !Number.isFinite(item.sampledAt) || item.sampledAt <= 0) {
    errors.push("sampledAt 必须是有效时间戳");
  }
  if (item.privacyReviewed !== true) errors.push("隐私审查未通过：privacyReviewed 必须为 true");

  const candidates = Array.isArray(item.candidates) ? item.candidates : [];
  if (candidates.length === 0) errors.push("必须冻结至少一个候选结果");
  const candidateIds = new Set<string>();
  for (const raw of candidates) {
    if (!isRecord(raw)) {
      errors.push("候选记录必须是对象");
      continue;
    }
    const siteId = typeof raw.siteId === "string" ? raw.siteId.trim() : "";
    if (!siteId || !Number.isInteger(raw.baselineRank) || Number(raw.baselineRank) < 1) {
      errors.push("候选站点 ID 或 baselineRank 无效");
      continue;
    }
    if (candidateIds.has(siteId)) errors.push("候选 siteId 不得重复");
    candidateIds.add(siteId);
    if (raw.evidenceUrl !== undefined) {
      if (typeof raw.evidenceUrl !== "string") errors.push(`候选 ${siteId} evidenceUrl 必须是字符串`);
      else {
        try {
          const url = new URL(raw.evidenceUrl);
          if (url.protocol !== "https:" && url.protocol !== "http:") errors.push(`候选 ${siteId} evidenceUrl 协议无效`);
        } catch {
          errors.push(`候选 ${siteId} evidenceUrl 格式无效`);
        }
      }
    }
  }

  const annotations = Array.isArray(item.annotations) ? item.annotations : [];
  if (annotations.length !== 2) errors.push("必须由两名不同标注员独立完成标注");
  const annotatorIds = new Set<string>();
  const annotationLabels: Array<{ annotatorId: string; labels: Map<string, AnnotationLabel> }> = [];
  for (let index = 0; index < annotations.length; index++) {
    const raw = annotations[index];
    if (!isRecord(raw)) {
      errors.push(`第 ${index + 1} 名标注员记录必须是对象`);
      continue;
    }
    const annotatorId = typeof raw.annotatorId === "string" ? raw.annotatorId.trim() : "";
    if (!annotatorId) errors.push("标注员 ID 必填");
    if (annotatorIds.has(annotatorId)) errors.push("必须由两名不同标注员独立完成标注");
    annotatorIds.add(annotatorId);
    if (typeof raw.annotatedAt !== "number" || !Number.isFinite(raw.annotatedAt) || raw.annotatedAt <= 0) {
      errors.push("标注时间必填");
    }
    const result = validateJudgments(raw.judgments, candidateIds, annotatorId || `annotator-${index + 1}`);
    errors.push(...result.errors);
    annotationLabels.push({ annotatorId, labels: result.labels });
  }

  const disputed = new Set<string>();
  if (annotationLabels.length === 2) {
    const [left, right] = annotationLabels;
    for (const [siteId, label] of left!.labels) {
      if (right!.labels.has(siteId) && right!.labels.get(siteId) !== label) disputed.add(siteId);
    }
  }

  const adjudication = item.adjudication;
  if (adjudication !== undefined && adjudication !== null) {
    if (!isRecord(adjudication)) {
      errors.push("adjudication 必须是对象");
    } else {
      const adjudicatorId = typeof adjudication.adjudicatorId === "string" ? adjudication.adjudicatorId.trim() : "";
      if (!adjudicatorId) errors.push("仲裁人必填");
      if (annotatorIds.has(adjudicatorId)) errors.push("仲裁人必须独立于两名标注员");
      if (typeof adjudication.rationale !== "string" || !adjudication.rationale.trim()) errors.push("仲裁理由必填");
      if (typeof adjudication.adjudicatedAt !== "number" || !Number.isFinite(adjudication.adjudicatedAt) || adjudication.adjudicatedAt <= 0) {
        errors.push("仲裁时间必填");
      }
      if (disputed.size === 0) errors.push("没有争议候选时不应提交仲裁记录");
      const result = validateJudgments(adjudication.judgments, disputed, "adjudication", false);
      errors.push(...result.errors);
      for (const siteId of disputed) if (!result.labels.has(siteId)) errors.push(`adjudication: 缺少争议候选 ${siteId} 的仲裁`);
    }
  } else {
    for (const siteId of disputed) needsAdjudication.push(`${typeof item.queryId === "string" ? item.queryId : "unknown"}:${siteId}`);
  }

  return { valid: errors.length === 0 && needsAdjudication.length === 0, errors, needsAdjudication };
}

export function validateSearchGoldSet(cases: readonly SearchGoldCase[], minimumCases = 100): SearchGoldValidation {
  const errors: string[] = [], needsAdjudication: string[] = [];
  if (!Number.isInteger(minimumCases) || minimumCases < 1) throw new RangeError("minimumCases 必须是正整数");
  if (cases.length < minimumCases) errors.push(`金标样本不足：需要至少 ${minimumCases} 条，当前 ${cases.length} 条`);
  const ids = new Set<string>();
  for (const item of cases) {
    const queryId = isRecord(item) && typeof item.queryId === "string" ? item.queryId : "invalid-query";
    if (ids.has(queryId)) errors.push(`queryId 重复：${queryId}`);
    ids.add(queryId);
    const result = validateSearchGoldCase(item);
    errors.push(...result.errors.map(error => `${queryId}: ${error}`));
    needsAdjudication.push(...result.needsAdjudication);
  }
  return { valid: errors.length === 0 && needsAdjudication.length === 0, errors, needsAdjudication };
}

/** Returns consensus grades plus adjudicated replacements; unresolved disagreements are omitted. */
export function finalSearchGoldLabels(item: SearchGoldCase): Record<string, AnnotationLabel> {
  if (!Array.isArray(item.annotations) || item.annotations.length !== 2) return {};
  const left = new Map(item.annotations[0]!.judgments.map(j => [j.siteId, j.label]));
  const right = new Map(item.annotations[1]!.judgments.map(j => [j.siteId, j.label]));
  const result: Record<string, AnnotationLabel> = {};
  for (const [siteId, label] of left) if (right.has(siteId) && right.get(siteId) === label) result[siteId] = label;
  for (const judgment of item.adjudication?.judgments ?? []) result[judgment.siteId] = judgment.label;
  return result;
}
