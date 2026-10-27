/**
 * 检索离线评测（NDCG@k / MRR@k / Recall@k）。
 *
 * 为什么单独成模块：排序改动（RRF 的 k、通道权重、个性化档位）此前只能靠
 * 「看起来更准」判断，改错也没有回归信号。把评测指标做成纯函数后，
 * 金标集可以放在 fixture 里跑 CI，排序实验至少有一道可复现的闸门。
 *
 * 分级相关性采用 0–3（0=不相关，3=最相关）；未标注的站点按 0 处理。
 * 同一站点在 hits 里重复出现只算第一次，避免重复命中刷高分数。
 */

export interface SearchEvalCase {
  query: string;
  /** 检索返回的站点 id，按名次从前往后 */
  hits: string[];
  /** siteId -> 分级相关性（0–3） */
  relevance: Record<string, number>;
}

export interface SearchEvalMetrics {
  queries: number;
  ndcgAtK: number;
  mrrAtK: number;
  recallAtK: number;
}

function normalizeK(k: number): number {
  if (!Number.isFinite(k) || k <= 0) return 0;
  return Math.floor(k);
}

/** 取前 k 个唯一命中，并映射成相关性等级 */
function gradedHitsAtK(testCase: SearchEvalCase, k: number): number[] {
  const seen = new Set<string>();
  const grades: number[] = [];
  for (const siteId of testCase.hits) {
    if (seen.has(siteId)) continue;
    seen.add(siteId);
    if (grades.length >= k) break;
    const grade = testCase.relevance[siteId];
    grades.push(typeof grade === "number" && Number.isFinite(grade) ? Math.max(0, grade) : 0);
  }
  return grades;
}

function dcg(grades: number[]): number {
  let sum = 0;
  for (let i = 0; i < grades.length; i++) {
    sum += (2 ** grades[i]! - 1) / Math.log2(i + 2);
  }
  return sum;
}

export function ndcgAtK(testCase: SearchEvalCase, k: number): number {
  const limit = normalizeK(k);
  if (limit === 0) return 0;
  const actual = dcg(gradedHitsAtK(testCase, limit));
  if (actual === 0) return 0;
  const ideal = dcg(
    Object.values(testCase.relevance)
      .filter((g) => typeof g === "number" && Number.isFinite(g) && g > 0)
      .sort((a, b) => b - a)
      .slice(0, limit),
  );
  return ideal === 0 ? 0 : actual / ideal;
}

export function mrrAtK(testCase: SearchEvalCase, k: number): number {
  const limit = normalizeK(k);
  if (limit === 0) return 0;
  const seen = new Set<string>();
  let rank = 0;
  for (const siteId of testCase.hits) {
    if (seen.has(siteId)) continue;
    seen.add(siteId);
    rank++;
    if (rank > limit) break;
    const grade = testCase.relevance[siteId];
    if (typeof grade === "number" && Number.isFinite(grade) && grade > 0) return 1 / rank;
  }
  return 0;
}

export function recallAtK(testCase: SearchEvalCase, k: number): number {
  const limit = normalizeK(k);
  if (limit === 0) return 0;
  const relevant = new Set(
    Object.entries(testCase.relevance)
      .filter(([, g]) => typeof g === "number" && Number.isFinite(g) && g > 0)
      .map(([siteId]) => siteId),
  );
  if (relevant.size === 0) return 0;
  const seen = new Set<string>();
  let hit = 0;
  for (const siteId of testCase.hits) {
    if (seen.has(siteId)) continue;
    seen.add(siteId);
    if (seen.size > limit) break;
    if (relevant.has(siteId)) hit++;
  }
  return hit / relevant.size;
}

/** 对一组评测样本求宏平均；空集合返回全 0，避免 CLI 输出 NaN */
export function evaluateSearch(cases: SearchEvalCase[], k = 10): SearchEvalMetrics {
  if (cases.length === 0) return { queries: 0, ndcgAtK: 0, mrrAtK: 0, recallAtK: 0 };
  let ndcg = 0;
  let mrr = 0;
  let recall = 0;
  for (const testCase of cases) {
    ndcg += ndcgAtK(testCase, k);
    mrr += mrrAtK(testCase, k);
    recall += recallAtK(testCase, k);
  }
  return {
    queries: cases.length,
    ndcgAtK: ndcg / cases.length,
    mrrAtK: mrr / cases.length,
    recallAtK: recall / cases.length,
  };
}
