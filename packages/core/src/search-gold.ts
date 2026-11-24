/** Human-labelled search gold-set contract. This module never fabricates queries or relevance labels. */
export type RelevanceGrade = 0 | 1 | 2 | 3;
export type AnnotationLabel = RelevanceGrade | "unjudgeable";
export interface SearchGoldAnnotation {
  annotatorId: string;
  label: AnnotationLabel;
  rationaleCode: string;
  annotatedAt: number;
}
export interface SearchGoldCase {
  queryId: string;
  queryText: string;
  locale: string;
  intent: string;
  /** Frozen candidate IDs and retrieval positions from the same search snapshot. */
  candidates: Array<{ siteId: string; baselineRank: number }>;
  snapshotId: string;
  annotations: SearchGoldAnnotation[];
  adjudication?: { adjudicatorId: string; label: AnnotationLabel; rationale: string; adjudicatedAt: number };
}
export interface SearchGoldValidation {
  valid: boolean;
  errors: string[];
  needsAdjudication: string[];
}

export function validateSearchGoldCase(item: SearchGoldCase): SearchGoldValidation {
  const errors: string[] = [];
  const needsAdjudication: string[] = [];
  if (!item.queryId.trim() || !/^[a-zA-Z0-9_-]{8,80}$/.test(item.queryId)) errors.push("queryId 必须是脱敏后的稳定 ID");
  if (!item.queryText.trim()) errors.push("queryText 不能为空");
  if (!item.locale.trim() || !item.intent.trim() || !item.snapshotId.trim()) errors.push("locale、intent、snapshotId 必填");
  if (!item.candidates.length) errors.push("必须冻结至少一个候选结果");
  const seen = new Set<string>();
  for (const candidate of item.candidates) {
    if (!candidate.siteId.trim() || !Number.isInteger(candidate.baselineRank) || candidate.baselineRank < 1) errors.push("候选站点 ID 或 baselineRank 无效");
    if (seen.has(candidate.siteId)) errors.push("候选 siteId 不得重复");
    seen.add(candidate.siteId);
  }
  const annotators = new Set(item.annotations.map(a => a.annotatorId));
  if (item.annotations.length !== 2 || annotators.size !== 2 || [...annotators].some(id => !id.trim())) {
    errors.push("必须由两名不同标注员独立完成标注");
  }
  for (const annotation of item.annotations) {
    if (![0, 1, 2, 3, "unjudgeable"].includes(annotation.label)) errors.push("标注等级必须为 0–3 或 unjudgeable");
    if (!annotation.rationaleCode.trim() || !Number.isFinite(annotation.annotatedAt)) errors.push("标注理由代码和时间必填");
  }
  const disagreement = item.annotations.length === 2 && item.annotations[0]!.label !== item.annotations[1]!.label;
  if (disagreement && !item.adjudication) needsAdjudication.push(item.queryId);
  if (item.adjudication && (!item.adjudication.adjudicatorId.trim() || !item.adjudication.rationale.trim() || !Number.isFinite(item.adjudication.adjudicatedAt))) {
    errors.push("仲裁人、仲裁理由和仲裁时间必填");
  }
  return { valid: errors.length === 0 && needsAdjudication.length === 0, errors, needsAdjudication };
}

export function validateSearchGoldSet(cases: readonly SearchGoldCase[], minimumCases = 100): SearchGoldValidation {
  const errors: string[] = [];
  const needsAdjudication: string[] = [];
  if (!Number.isInteger(minimumCases) || minimumCases < 1) throw new RangeError("minimumCases 必须是正整数");
  if (cases.length < minimumCases) errors.push(`金标样本不足：需要至少 ${minimumCases} 条，当前 ${cases.length} 条`);
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.queryId)) errors.push(`queryId 重复：${item.queryId}`);
    ids.add(item.queryId);
    const result = validateSearchGoldCase(item);
    errors.push(...result.errors.map(error => `${item.queryId}: ${error}`));
    needsAdjudication.push(...result.needsAdjudication);
  }
  return { valid: errors.length === 0 && needsAdjudication.length === 0, errors, needsAdjudication };
}

export function finalSearchGoldLabel(item: SearchGoldCase): AnnotationLabel | null {
  if (item.adjudication) return item.adjudication.label;
  if (item.annotations.length !== 2 || item.annotations[0]!.label !== item.annotations[1]!.label) return null;
  return item.annotations[0]!.label;
}
