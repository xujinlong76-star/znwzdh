/**
 * 站点质量感知搜索重排实验（shadow only）。
 *
 * 只生成对照排序，不连接数据库、不修改生产 fuse()、不改变用户搜索结果。
 * 未知/证据不足/高风险候选保持原始名次，避免把数据缺口或安全风险当作普通质量分。
 */
import type { SiteQualityBand } from "./site-quality.ts";

export interface SiteQualityShadowCandidate {
  siteId: string;
  /** 按现有搜索融合结果的顺序传入；数组位置即 baseline rank。 */
  qualityScore: number | null;
  evidenceCoverage: number;
  band: SiteQualityBand;
}

export interface SiteQualityShadowRankedCandidate extends SiteQualityShadowCandidate {
  baselineRank: number;
  shadowRank: number;
  baselineScore: number;
  shadowScore: number;
  applied: boolean;
  excludedReason: "unknown_score" | "insufficient_coverage" | "high_risk" | null;
}

export interface SiteQualityShadowOptions {
  /** 质量分占影子总分的比例。限制在 0–0.25，防止实验权重压过检索相关性。 */
  qualityWeight?: number;
  /** 最低证据覆盖率；低于阈值时不应用质量重排。 */
  minEvidenceCoverage?: number;
}

export function rerankBySiteQualityShadow(
  candidates: readonly SiteQualityShadowCandidate[],
  options: SiteQualityShadowOptions = {},
): SiteQualityShadowRankedCandidate[] {
  const qualityWeight = options.qualityWeight ?? 0.12;
  const minEvidenceCoverage = options.minEvidenceCoverage ?? 40;
  if (!Number.isFinite(qualityWeight) || qualityWeight < 0 || qualityWeight > 0.25) {
    throw new RangeError("qualityWeight 必须在 0–0.25 之间");
  }
  if (!Number.isFinite(minEvidenceCoverage) || minEvidenceCoverage < 0 || minEvidenceCoverage > 100) {
    throw new RangeError("minEvidenceCoverage 必须在 0–100 之间");
  }

  const seen = new Set<string>();
  const ranked = candidates.map((candidate, index) => {
    if (!candidate.siteId || seen.has(candidate.siteId)) {
      throw new TypeError("影子重排候选 siteId 必须非空且唯一");
    }
    seen.add(candidate.siteId);
    if (!Number.isFinite(candidate.evidenceCoverage) || candidate.evidenceCoverage < 0 || candidate.evidenceCoverage > 100) {
      throw new RangeError("evidenceCoverage 必须在 0–100 之间");
    }
    if (candidate.qualityScore !== null && (
      !Number.isFinite(candidate.qualityScore) || candidate.qualityScore < 0 || candidate.qualityScore > 100
    )) {
      throw new RangeError("qualityScore 必须在 0–100 之间或为 null");
    }

    const baselineRank = index + 1;
    const baselineScore = candidates.length <= 1
      ? 100
      : Number((100 * (1 - index / (candidates.length - 1))).toFixed(4));
    let excludedReason: SiteQualityShadowRankedCandidate["excludedReason"] = null;
    if (candidate.band === "high_risk") excludedReason = "high_risk";
    else if (candidate.band === "insufficient_evidence") excludedReason = "unknown_score";
    else if (candidate.qualityScore === null) excludedReason = "unknown_score";
    else if (candidate.evidenceCoverage < minEvidenceCoverage) excludedReason = "insufficient_coverage";

    const applied = excludedReason === null && qualityWeight > 0;
    const shadowScore = applied
      ? Number((baselineScore * (1 - qualityWeight) + candidate.qualityScore! * qualityWeight).toFixed(4))
      : baselineScore;
    return {
      ...candidate,
      baselineRank,
      shadowRank: 0,
      baselineScore,
      shadowScore,
      applied,
      excludedReason,
    };
  });

  return ranked
    .sort((a, b) => b.shadowScore - a.shadowScore || a.baselineRank - b.baselineRank || a.siteId.localeCompare(b.siteId))
    .map((candidate, index) => ({ ...candidate, shadowRank: index + 1 }));
}
