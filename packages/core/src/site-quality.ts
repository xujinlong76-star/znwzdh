/**
 * 站点质量证据契约（v1）。
 *
 * 这是搜索、推荐、采集和治理共用的纯函数评分层，不负责发布/删除站点。
 * 每个维度都区分「未知」与「已测得的低分」；数值评分必须带可追溯证据。
 * risk 使用风险严重度（越高越危险），汇总时反向折算为质量贡献。
 */

export const SITE_QUALITY_VERSION = "site-quality-v1" as const;

export const SITE_QUALITY_DIMENSIONS = [
  "accessibility",
  "contentCompleteness",
  "sourceTrust",
  "relevance",
  "uniqueness",
  "freshness",
  "risk",
] as const;

export type SiteQualityDimension = (typeof SITE_QUALITY_DIMENSIONS)[number];

export interface SiteQualityEvidence {
  /** 0–100；null 表示未知，不等于 0 分。 */
  score: number | null;
  /** 支撑该判断的证据描述/证据引用。数值分必须至少有一条证据。 */
  evidence: readonly string[];
}

export type SiteQualityAssessments = Record<SiteQualityDimension, SiteQualityEvidence>;

export type SiteQualityBand = "high" | "medium" | "low" | "high_risk" | "insufficient_evidence";

export interface SiteQualityResult {
  version: typeof SITE_QUALITY_VERSION;
  evaluatedAt: number;
  /** 已知维度按权重归一后的质量分；证据不足时为 null。 */
  score: number | null;
  /** 已覆盖权重百分比（0–100），未知维度不按 0 分计。 */
  evidenceCoverage: number;
  observedDimensions: number;
  /** 原始风险严重度；未知时为 null。 */
  riskScore: number | null;
  band: SiteQualityBand;
  dimensions: SiteQualityAssessments;
}

export const SITE_QUALITY_WEIGHTS: Readonly<Record<SiteQualityDimension, number>> = {
  accessibility: 0.2,
  contentCompleteness: 0.15,
  sourceTrust: 0.2,
  relevance: 0.15,
  uniqueness: 0.1,
  freshness: 0.1,
  risk: 0.1,
};

const MIN_OBSERVED_DIMENSIONS = 3;
const MIN_EVIDENCE_COVERAGE = 40;
const HIGH_RISK_THRESHOLD = 80;

function validateAssessment(
  dimension: SiteQualityDimension,
  assessment: SiteQualityEvidence,
): void {
  if (!assessment || !Array.isArray(assessment.evidence)) {
    throw new TypeError(`质量维度 ${dimension} 缺少 evidence 数组`);
  }
  if (assessment.score === null) return;
  if (
    typeof assessment.score !== "number" ||
    !Number.isFinite(assessment.score) ||
    assessment.score < 0 ||
    assessment.score > 100
  ) {
    throw new RangeError(`质量维度 ${dimension} 的 score 必须是 0–100 或 null`);
  }
  if (!assessment.evidence.some((item) => typeof item === "string" && item.trim().length > 0)) {
    throw new TypeError(`质量维度 ${dimension} 有数值评分但没有有效证据`);
  }
}

export function evaluateSiteQuality(
  dimensions: SiteQualityAssessments,
  evaluatedAt = Date.now(),
): SiteQualityResult {
  if (!Number.isFinite(evaluatedAt) || evaluatedAt <= 0) {
    throw new RangeError("evaluatedAt 必须是正数时间戳");
  }

  let weightedScore = 0;
  let observedWeight = 0;
  let observedDimensions = 0;
  let riskScore: number | null = null;

  for (const dimension of SITE_QUALITY_DIMENSIONS) {
    const assessment = dimensions[dimension];
    validateAssessment(dimension, assessment);
    if (assessment.score === null) continue;

    observedDimensions++;
    const weight = SITE_QUALITY_WEIGHTS[dimension];
    observedWeight += weight;
    const contribution = dimension === "risk" ? 100 - assessment.score : assessment.score;
    weightedScore += contribution * weight;
    if (dimension === "risk") riskScore = assessment.score;
  }

  const evidenceCoverage = Number((observedWeight * 100).toFixed(2));
  const enoughEvidence =
    observedDimensions >= MIN_OBSERVED_DIMENSIONS && evidenceCoverage >= MIN_EVIDENCE_COVERAGE;
  const score = enoughEvidence && observedWeight > 0
    ? Number((weightedScore / observedWeight).toFixed(2))
    : null;

  let band: SiteQualityBand;
  if (!enoughEvidence || score === null) {
    band = "insufficient_evidence";
  } else if (riskScore !== null && riskScore >= HIGH_RISK_THRESHOLD) {
    band = "high_risk";
  } else if (score >= 80) {
    band = "high";
  } else if (score >= 60) {
    band = "medium";
  } else {
    band = "low";
  }

  // 输出副本，避免调用方之后修改输入对象，导致已生成结果被静默篡改。
  const snapshot = Object.fromEntries(
    SITE_QUALITY_DIMENSIONS.map((dimension) => {
      const item = dimensions[dimension];
      return [dimension, { score: item.score, evidence: [...item.evidence] }];
    }),
  ) as SiteQualityAssessments;

  return {
    version: SITE_QUALITY_VERSION,
    evaluatedAt,
    score,
    evidenceCoverage,
    observedDimensions,
    riskScore,
    band,
    dimensions: snapshot,
  };
}
