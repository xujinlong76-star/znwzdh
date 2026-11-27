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

/**
 * 校验人工金标评测样本。相关性等级严格限定为整数 0–3，避免越界值
 * 在指数型 DCG 中放大分数，造成评测结果虚高。
 */
export function validateSearchEvalCase(value: unknown, index = 0): SearchEvalCase {
  const prefix = "第 " + index + " 条样本";
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(prefix + "不是对象");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.query !== "string" || record.query.trim() === "") {
    throw new Error(prefix + "缺少 query");
  }
  if (!Array.isArray(record.hits) || record.hits.some((hit) => typeof hit !== "string" || hit.trim() === "")) {
    throw new Error(prefix + "的 hits 必须是非空字符串组成的数组");
  }
  if (!record.relevance || typeof record.relevance !== "object" || Array.isArray(record.relevance)) {
    throw new Error(prefix + "缺少 relevance 对象");
  }
  for (const [siteId, grade] of Object.entries(record.relevance)) {
    if (!siteId.trim()) throw new Error(prefix + "包含空 siteId");
    if (typeof grade !== "number" || !Number.isInteger(grade) || grade < 0 || grade > 3) {
      throw new Error(prefix + " relevance['" + siteId + "'] 必须是 0–3 的整数");
    }
  }
  return {
    query: record.query,
    hits: record.hits as string[],
    relevance: record.relevance as Record<string, number>,
  };
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


export interface SearchEvalQueryDiagnostics {
  /** 1-based row index; never includes raw query text. */
  queryIndex: number;
  zeroResult: boolean;
  hasPositiveJudgment: boolean;
  relevantCandidates: number;
  relevantRetrievedAtK: number;
}

export interface SearchEvalDiagnostics {
  metrics: SearchEvalMetrics;
  zeroResultQueries: number;
  queriesWithoutPositiveJudgments: number;
  relevantCandidates: number;
  relevantRetrievedAtK: number;
  /** Micro coverage over all human-labelled relevant candidates. */
  relevantCandidateCoverage: number;
  cases: SearchEvalQueryDiagnostics[];
}

/**
 * Privacy-safe diagnostics for evaluation reports.
 * It deliberately reports row indices and counts, never query text or user identifiers.
 * Existing macro metrics remain unchanged for backwards compatibility.
 */
export function evaluateSearchDiagnostics(cases: SearchEvalCase[], k = 10): SearchEvalDiagnostics {
  const metrics = evaluateSearch(cases, k);
  const limit = normalizeK(k);
  let zeroResultQueries = 0;
  let queriesWithoutPositiveJudgments = 0;
  let relevantCandidates = 0;
  let relevantRetrievedAtK = 0;
  const details = cases.map((testCase, index) => {
    const relevant = Object.entries(testCase.relevance)
      .filter(([, grade]) => typeof grade === "number" && Number.isFinite(grade) && grade > 0)
      .map(([siteId]) => siteId);
    const relevantSet = new Set(relevant);
    const uniqueHits: string[] = [];
    const seen = new Set<string>();
    for (const siteId of testCase.hits) {
      if (seen.has(siteId)) continue;
      seen.add(siteId);
      uniqueHits.push(siteId);
    }
    const retrieved = uniqueHits.slice(0, limit).filter(siteId => relevantSet.has(siteId)).length;
    const zeroResult = uniqueHits.length === 0;
    const hasPositiveJudgment = relevant.length > 0;
    if (zeroResult) zeroResultQueries++;
    if (!hasPositiveJudgment) queriesWithoutPositiveJudgments++;
    relevantCandidates += relevant.length;
    relevantRetrievedAtK += retrieved;
    return {
      queryIndex: index + 1,
      zeroResult,
      hasPositiveJudgment,
      relevantCandidates: relevant.length,
      relevantRetrievedAtK: retrieved,
    };
  });
  return {
    metrics,
    zeroResultQueries,
    queriesWithoutPositiveJudgments,
    relevantCandidates,
    relevantRetrievedAtK,
    relevantCandidateCoverage: relevantCandidates > 0 ? relevantRetrievedAtK / relevantCandidates : 0,
    cases: details,
  };
}
