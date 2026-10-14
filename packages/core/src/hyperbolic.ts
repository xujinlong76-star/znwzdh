/**
 * Poincaré Ball Hyperbolic Geometry & Alternative Inference Engine
 * (庞加莱双曲空间度量与平替推理引擎)
 *
 * 核心设计目标：
 * 突破欧氏空间在树形分类和深层拓扑中的维度膨胀失真（Distortion）。
 * 利用双曲空间指数级体积增长特性，精确计算技术工具间的测地线距离，
 * 并结合抽象层级模长一致性，推导出高置信度的平替竞品（Alternatives）与上下游依赖。
 */

export const EPSILON = 1e-5;

/**
 * 欧式范数（模长）：||v||
 */
export function euclideanNorm(v: number[]): number {
  const sumSq = v.reduce((sum, val) => sum + val * val, 0);
  return Math.sqrt(sumSq);
}

/**
 * 欧氏内积：<u, v>
 */
export function euclideanDot(u: number[], v: number[]): number {
  return u.reduce((sum, val, idx) => sum + val * (v[idx] ?? 0), 0);
}

/**
 * 将向量约束在开放双曲球内部：||x|| <= 1 - EPSILON
 */
export function clampToBall(v: number[], maxNorm = 1.0 - EPSILON): number[] {
  const norm = euclideanNorm(v);
  if (norm < maxNorm) return [...v];
  const scale = maxNorm / (norm + 1e-12);
  return v.map((val) => val * scale);
}

/**
 * 原点处的指数映射：将欧氏切空间向量映射到庞加莱球
 * exp_0(v) = tanh(||v||) * (v / ||v||)
 */
export function expMap0(v: number[]): number[] {
  const norm = euclideanNorm(v);
  if (norm < 1e-12) return v.map(() => 0);
  const factor = Math.tanh(norm) / norm;
  return clampToBall(v.map((val) => val * factor));
}

/**
 * 原点处的对数映射：将庞加莱球内点映射回欧氏切空间
 * log_0(y) = artanh(||y||) * (y / ||y||)
 */
export function logMap0(y: number[]): number[] {
  const clamped = clampToBall(y);
  const norm = euclideanNorm(clamped);
  if (norm < 1e-12) return clamped.map(() => 0);
  // artanh(x) = 0.5 * ln((1 + x) / (1 - x))
  const safeNorm = Math.min(1.0 - 1e-7, norm);
  const artanh = 0.5 * Math.log((1 + safeNorm) / (1 - safeNorm));
  const factor = artanh / safeNorm;
  return clamped.map((val) => val * factor);
}

/**
 * 莫比乌斯加法 (Möbius Addition in Poincaré Ball)
 * u ⊕ v = ((1 + 2<u, v> + ||v||^2) u + (1 - ||u||^2) v) / (1 + 2<u, v> + ||u||^2 ||v||^2)
 */
export function mobiusAdd(u: number[], v: number[]): number[] {
  const uClamped = clampToBall(u);
  const vClamped = clampToBall(v);

  const uNormSq = uClamped.reduce((sum, val) => sum + val * val, 0);
  const vNormSq = vClamped.reduce((sum, val) => sum + val * val, 0);
  const uDotV = euclideanDot(uClamped, vClamped);

  const denom = 1 + 2 * uDotV + uNormSq * vNormSq;
  if (Math.abs(denom) < 1e-12) return clampToBall(uClamped);

  const coeffU = 1 + 2 * uDotV + vNormSq;
  const coeffV = 1 - uNormSq;

  const result = uClamped.map((ui, idx) => (coeffU * ui + coeffV * (vClamped[idx] ?? 0)) / denom);
  return clampToBall(result);
}

/**
 * 庞加莱测地线距离 (Poincaré Geodesic Distance)
 * d_B(u, v) = arcosh(1 + 2 * ||u - v||^2 / ((1 - ||u||^2) * (1 - ||v||^2)))
 */
export function poincareDistance(u: number[], v: number[]): number {
  const uClamped = clampToBall(u);
  const vClamped = clampToBall(v);

  let diffSq = 0;
  for (let i = 0; i < uClamped.length; i++) {
    const diff = (uClamped[i] ?? 0) - (vClamped[i] ?? 0);
    diffSq += diff * diff;
  }


  const uNormSq = uClamped.reduce((sum, val) => sum + val * val, 0);
  const vNormSq = vClamped.reduce((sum, val) => sum + val * val, 0);

  const denom = (1 - uNormSq) * (1 - vNormSq);
  if (denom <= 0) return 30.0; // 上界截断保护

  const delta = 1 + (2 * diffSq) / denom;
  const safeDelta = Math.max(1.0, delta);

  // arcosh(x) = ln(x + sqrt(x^2 - 1))
  return Math.log(safeDelta + Math.sqrt(Math.max(0, safeDelta * safeDelta - 1)));
}

/**
 * 双曲空间中的平替相关度计算
 * 平替判定原则：
 * 1. 测地线距离相近 (Geodesic proximity)
 * 2. 模长层级一致性 (Norm Equivalence: ||u|| ≈ ||v||，说明处于同级抽象深度)
 */
export function computeHyperbolicAlternativeScore(
  u: number[],
  v: number[],
  options?: { sigma?: number; beta?: number }
): number {
  const sigma = options?.sigma ?? 2.5;
  const beta = options?.beta ?? 1.5;

  const dist = poincareDistance(u, v);
  const uNorm = euclideanNorm(clampToBall(u));
  const vNorm = euclideanNorm(clampToBall(v));

  // 深度一致性惩罚因子 [0, 1]
  const depthDiff = Math.abs(uNorm - vNorm);
  const depthParity = Math.pow(Math.max(0, 1 - depthDiff), beta);

  // 测地线距离衰减
  const distAffinity = Math.exp(-dist / sigma);

  return Number((distAffinity * depthParity).toFixed(4));
}

export interface HyperbolicNode {
  id: string;
  name: string;
  category?: string;
  embedding: number[];
}

export interface HyperbolicAlternativeMatch {
  targetId: string;
  name: string;
  geodesicDistance: number;
  alternativeScore: number;
}

/**
 * 在节点集合中推导 Top-K 最佳平替
 */
export function findTopAlternativesInHyperbolicSpace(
  queryNode: HyperbolicNode,
  candidates: HyperbolicNode[],
  limit = 5
): HyperbolicAlternativeMatch[] {
  const results: HyperbolicAlternativeMatch[] = [];

  for (const cand of candidates) {
    if (cand.id === queryNode.id) continue;
    const dist = poincareDistance(queryNode.embedding, cand.embedding);
    const score = computeHyperbolicAlternativeScore(queryNode.embedding, cand.embedding);

    results.push({
      targetId: cand.id,
      name: cand.name,
      geodesicDistance: Number(dist.toFixed(4)),
      alternativeScore: score,
    });
  }

  results.sort((a, b) => b.alternativeScore - a.alternativeScore);
  return results.slice(0, limit);
}
