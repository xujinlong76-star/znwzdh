// @core-mirror:parity-ignore-start
// 本文件由 scripts/sync-core-mirrors.mjs 自动生成，请勿手工编辑。
// 事实源：packages/core/src/federated-recommendation.ts
// 同步命令：node scripts/sync-core-mirrors.mjs
// 一致性守门：node scripts/sync-core-mirrors.mjs --check（CI 可加）
// @core-mirror:parity-ignore-end
/**
 * 客户端联邦协同与本地差分隐私推荐引擎 (Federated Recommendation & Local Differential Privacy)
 *
 * 核心设计目标：
 * 1. 本地差分隐私 (Local Differential Privacy, LDP)：在客户端对用户的标签偏好注入 Laplace 噪声
 * 2. 保证个体隐私不可重构的同时，在无中心化数据库收集用户历史的前提下实现群体协同推荐
 * 3. 混合打分机制：结合私有本地偏好与脱敏群体共识向量
 */

/**
 * 从拉普拉斯分布 Lap(0, b) 采样噪声
 * 其中 b = sensitivity / epsilon
 */
export function sampleLaplace(b: number): number {
  if (b <= 0) return 0;
  const u = Math.random() - 0.5;
  // 避免正好为 0 导致 log(1)
  if (u === 0) return 0;
  return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

/**
 * 对特征向量进行本地差分隐私加噪 (Laplace 机制)
 * @param vector 用户本地特征计数或偏好向量
 * @param epsilon 隐私预算 (通常取 0.5 ~ 2.0，越小越私密、噪声越大)
 * @param sensitivity 敏感度 (单个事件对向量的最大改变量，默认 1.0)
 */
export function privatizeVector(
  vector: number[],
  epsilon = 1.0,
  sensitivity = 1.0
): number[] {
  if (epsilon <= 0) {
    throw new Error('Epsilon must be greater than 0');
  }
  const scale = sensitivity / epsilon;
  return vector.map((val) => {
    const noisy = val + sampleLaplace(scale);
    // 保留两位小数，避免暴露浮点指纹
    return Math.round(noisy * 100) / 100;
  });
}

/**
 * 聚合多个客户端上传的脱敏偏好向量 (无偏均值估计)
 */
export function aggregatePrivatizedContributions(
  contributions: number[][]
): number[] {
  if (contributions.length === 0) return [];
  const dim = contributions[0]!.length;
  const result = new Array(dim).fill(0);

  for (const contrib of contributions) {
    for (let i = 0; i < dim; i++) {
      result[i] += contrib[i] ?? 0;
    }
  }

  // 计算均值并截断非负
  return result.map((sum) => Math.max(0, Math.round((sum / contributions.length) * 100) / 100));
}

/**
 * 计算余弦相似度
 */
export function computeCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}

export interface CandidateItem {
  id: string;
  name: string;
  featureVector: number[];
}

export interface RecommendationResult {
  itemId: string;
  name: string;
  score: number;
  personalMatch: number;
  globalTrendMatch: number;
}

/**
 * 隐私协同排序推荐
 * 结合用户本地私有偏好 (personal) 与脱敏群体共识 (globalTrend)
 * @param localVector 本地私有偏好
 * @param globalVector 聚合脱敏偏好
 * @param candidates 候选站点/技术条目
 * @param personalWeight 本地偏好权重 (0.0 ~ 1.0，默认 0.6)
 */
export function rankItemsWithPrivacy(
  localVector: number[],
  globalVector: number[],
  candidates: CandidateItem[],
  personalWeight = 0.6
): RecommendationResult[] {
  const pWeight = Math.max(0, Math.min(1, personalWeight));
  const gWeight = 1 - pWeight;

  const results: RecommendationResult[] = candidates.map((item) => {
    const pSim = computeCosineSimilarity(localVector, item.featureVector);
    const gSim = computeCosineSimilarity(globalVector, item.featureVector);
    const combinedScore = Math.round((pSim * pWeight + gSim * gWeight) * 1000) / 1000;

    return {
      itemId: item.id,
      name: item.name,
      score: combinedScore,
      personalMatch: Math.round(pSim * 100) / 100,
      globalTrendMatch: Math.round(gSim * 100) / 100,
    };
  });

  return results.sort((a, b) => b.score - a.score);
}
