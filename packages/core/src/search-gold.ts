/** Human-labelled query-to-site relevance contract. Never fabricates queries or labels. */
export type RelevanceGrade = 0 | 1 | 2 | 3;
export type AnnotationLabel = RelevanceGrade | "unjudgeable";
export interface SearchGoldCandidate { siteId: string; baselineRank: number; }
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
  queryId: string; queryText: string; locale: string; intent: string;
  candidates: SearchGoldCandidate[]; snapshotId: string;
  annotations: SearchGoldAnnotation[]; adjudication?: SearchGoldAdjudication;
}
export interface SearchGoldValidation { valid: boolean; errors: string[]; needsAdjudication: string[]; }

function validateJudgments(judgments: readonly SearchGoldJudgment[], candidateIds: ReadonlySet<string>, label: string): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const judgment of judgments) {
    if (!candidateIds.has(judgment.siteId)) errors.push(`${label}: judgment 引用了快照外站点 ${judgment.siteId}`);
    if (seen.has(judgment.siteId)) errors.push(`${label}: siteId ${judgment.siteId} 重复标注`);
    seen.add(judgment.siteId);
    if (![0, 1, 2, 3, "unjudgeable"].includes(judgment.label)) errors.push(`${label}: 标注等级必须为 0–3 或 unjudgeable`);
    if (!judgment.rationaleCode.trim()) errors.push(`${label}: rationaleCode 必填`);
  }
  for (const siteId of candidateIds) if (!seen.has(siteId)) errors.push(`${label}: 缺少候选 ${siteId} 的标注`);
  return errors;
}

export function validateSearchGoldCase(item: SearchGoldCase): SearchGoldValidation {
  const errors: string[] = [];
  const needsAdjudication: string[] = [];
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(item.queryId)) errors.push("queryId 必须是脱敏后的稳定 ID");
  if (!item.queryText.trim()) errors.push("queryText 不能为空");
  if (!item.locale.trim() || !item.intent.trim() || !item.snapshotId.trim()) errors.push("locale、intent、snapshotId 必填");
  if (!item.candidates.length) errors.push("必须冻结至少一个候选结果");
  const candidateIds = new Set<string>();
  for (const candidate of item.candidates) {
    if (!candidate.siteId.trim() || !Number.isInteger(candidate.baselineRank) || candidate.baselineRank < 1) errors.push("候选站点 ID 或 baselineRank 无效");
    if (candidateIds.has(candidate.siteId)) errors.push("候选 siteId 不得重复");
    candidateIds.add(candidate.siteId);
  }
  const annotators = new Set(item.annotations.map(a => a.annotatorId));
  if (item.annotations.length !== 2 || annotators.size !== 2 || [...annotators].some(id => !id.trim())) errors.push("必须由两名不同标注员独立完成标注");
  for (const annotation of item.annotations) {
    errors.push(...validateJudgments(annotation.judgments, candidateIds, annotation.annotatorId));
    if (!Number.isFinite(annotation.annotatedAt)) errors.push("标注时间必填");
  }
  let disputed = new Set<string>();
  if (item.annotations.length === 2) {
    const [a, b] = item.annotations;
    const bMap = new Map(b!.judgments.map(j => [j.siteId, j.label]));
    disputed = new Set(a!.judgments.filter(j => bMap.has(j.siteId) && bMap.get(j.siteId) !== j.label).map(j => j.siteId));
    for (const siteId of disputed) if (!item.adjudication) needsAdjudication.push(`${item.queryId}:${siteId}`);
  }
  if (item.adjudication) {
    const adjudicatedIds = new Set(item.adjudication.judgments.map(j => j.siteId));
    for (const siteId of disputed) if (!adjudicatedIds.has(siteId)) errors.push(`adjudication: 缺少争议候选 ${siteId} 的仲裁`);
    errors.push(...item.adjudication.judgments.flatMap(j => {
      const rowErrors: string[] = [];
      if (!disputed.has(j.siteId)) rowErrors.push(`adjudication: ${j.siteId} 不是争议候选`);
      if (![0, 1, 2, 3, "unjudgeable"].includes(j.label)) rowErrors.push("adjudication: 标注等级必须为 0–3 或 unjudgeable");
      if (!j.rationaleCode.trim()) rowErrors.push("adjudication: rationaleCode 必填");
      return rowErrors;
    }));
    if (adjudicatedIds.size !== item.adjudication.judgments.length) errors.push("adjudication: siteId 不得重复");
    if (!item.adjudication.adjudicatorId.trim() || !item.adjudication.rationale.trim() || !Number.isFinite(item.adjudication.adjudicatedAt)) errors.push("仲裁人、仲裁理由和仲裁时间必填");
  }
  return { valid: errors.length === 0 && needsAdjudication.length === 0, errors, needsAdjudication };
}

export function validateSearchGoldSet(cases: readonly SearchGoldCase[], minimumCases = 100): SearchGoldValidation {
  const errors: string[] = [], needsAdjudication: string[] = [];
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

/** Returns consensus grades plus adjudicated replacements; unresolved disagreements are omitted. */
export function finalSearchGoldLabels(item: SearchGoldCase): Record<string, AnnotationLabel> {
  if (item.annotations.length !== 2) return {};
  const left = new Map(item.annotations[0]!.judgments.map(j => [j.siteId, j.label]));
  const right = new Map(item.annotations[1]!.judgments.map(j => [j.siteId, j.label]));
  const result: Record<string, AnnotationLabel> = {};
  for (const [siteId, label] of left) if (right.has(siteId) && right.get(siteId) === label) result[siteId] = label;
  for (const judgment of item.adjudication?.judgments ?? []) result[judgment.siteId] = judgment.label;
  return result;
}
