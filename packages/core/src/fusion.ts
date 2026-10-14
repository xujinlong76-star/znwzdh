/**
 * 多通道召回融合。
 *
 * 采用 RRF（Reciprocal Rank Fusion）——它不把不同尺度的分数硬凑（BM25 分、余弦相似度、
 * LIKE 命中数之间没有可比性），而是只依赖**排名**，因此在异构通道之间天然可比、
 * 无需调参、对单个通道的异常分数不敏感。
 *
 *   score(d) = Σ_ch contribute
 *   contribute(d) = w_ch / (k + rank_ch(d))
 *
 * coverage 乘子：同时被「关键词 + 拼音 + 语义」多路命中的站点，
 * 比只在单路偶然拿到第一名的站点更值得排前面 —— 这是抗「语义答非所问」的主要手段。
 *
 * k=60 取自 RRF 原论文的经验值。
 * 注意：k=60 会把靠前的名次压缩得很近（rrf(1) 与 rrf(10) 仅差约 15%），
 * 这正是个性化必须作为"一路通道"而非"事后加成"的原因，见 personalCandidates()。
 */
import type {
  PersonalizableSite,
  PersonalizationSignals,
  SearchCandidate,
  SearchChannel,
  SearchHit,
} from "./types.ts";
import { channelWeights, searchChannels } from "./channels.ts";

export interface FusionWeights {
  /** coverage 放大强度：0 = 关闭，1 = 标准 */
  coverageStrength: number;
  /** RRF 的 k（原论文经验值 60） */
  k: number;
  /** 每通道权重（含注册表扩展的通道；未列出的通道按 0 处理） */
  [channel: string]: number;
}

/**
 * 默认权重：由通道注册表生成（内置五路 + 任何已注册的扩展通道）。
 * 注意：这是**构造时快照**——运行期 registerChannel 之后，
 * 调用方应显式传新的 weights 对象（fuse 的第二个参数）。
 */
export const DEFAULT_WEIGHTS: FusionWeights = {
  ...channelWeights(),
  coverageStrength: 0.35,
  k: 60,
};

export function fuse(
  candidates: SearchCandidate[],
  weights: FusionWeights = DEFAULT_WEIGHTS,
  limit = 20,
): SearchHit[] {
  const byId = new Map<string, SearchHit>();
  const channelsPerDoc = new Map<string, Set<SearchChannel>>();

  for (const c of candidates) {
    const w = weights[c.channel] ?? 0;
    if (w <= 0) continue;
    const rank = Math.max(1, c.rank);
    const value = w / (weights.k + rank);

    let hit = byId.get(c.siteId);
    if (!hit) {
      hit = { siteId: c.siteId, score: 0, contributions: {} };
      byId.set(c.siteId, hit);
    }
    const prev = hit.contributions[c.channel];
    // 同一通道可能返回重复行，只保留该通道内的最优排名
    if (!prev || rank < prev.rank) {
      if (prev) hit.score -= prev.value;
      hit.contributions[c.channel] = { rank, value };
      hit.score += value;
    }

    let set = channelsPerDoc.get(c.siteId);
    if (!set) { set = new Set(); channelsPerDoc.set(c.siteId, set); }
    set.add(c.channel);
  }

  const hits = [...byId.values()];
  for (const hit of hits) {
    // coverage 只统计"相关性"通道 —— 偏好通道不该抬高共识度
    const coverage = [...(channelsPerDoc.get(hit.siteId) ?? [])].filter((c) => c !== "personal").length || 1;
    hit.score *= 1 + weights.coverageStrength * Math.log2(coverage);
  }

  hits.sort((a, b) => b.score - a.score || a.siteId.localeCompare(b.siteId));
  return hits.slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * 个性化：作为一路通道参与融合
 * ------------------------------------------------------------------ */

/**
 * 把偏好信号转成一路"personal"通道的候选（按偏好强度排名）。
 *
 * 为什么这样做而不是事后乘系数：
 *   RRF 的 k=60 让靠前名次的分数非常接近（排 1 与排 10 只差 ~15%）。
 *   如果先算相关性、再乘一个最高 20% 的偏好系数，就能轻易把排 8 顶到排 1 前面 ——
 *   这正是"越用越懂你"变成"搜什么都搜不到"的典型翻车方式。
 *   作为独立通道后，翻转能力由通道权重（默认 0.3 vs 相关性 1.0）明确限界，
 *   并且能通过 contributions 解释"它为什么排这儿"。
 */
export function personalCandidates(
  sites: Map<string, PersonalizableSite>,
  signals: PersonalizationSignals | undefined,
  opts: { limit?: number } = {},
): SearchCandidate[] {
  if (!signals) return [];
  const catSet = new Set(signals.topCategories ?? []);
  const tagSet = new Set(signals.topTags ?? []);
  const visited = new Set(signals.visitedSiteIds ?? []);
  if (catSet.size === 0 && tagSet.size === 0 && visited.size === 0) return [];

  const scored: Array<{ siteId: string; affinity: number }> = [];
  for (const site of sites.values()) {
    let affinity = 0;
    if (catSet.has(site.categoryId)) affinity += 0.5;
    const tagHits = site.tags.filter((t) => tagSet.has(t)).length;
    if (tagHits > 0) affinity += Math.min(0.3, 0.15 * tagHits);
    if (visited.has(site.siteId)) affinity += 0.2;
    if (affinity > 0) scored.push({ siteId: site.siteId, affinity });
  }
  if (scored.length === 0) return [];

  scored.sort((a, b) => b.affinity - a.affinity || a.siteId.localeCompare(b.siteId));
  const limit = opts.limit ?? scored.length;
  return scored.slice(0, limit).map((s, i) => ({
    siteId: s.siteId,
    channel: "personal" as const,
    rank: i + 1,
    rawScore: s.affinity,
  }));
}

/** 汇总实际参与融合的通道，供前端做诚实的能力提示 */
export function channelsUsed(candidates: SearchCandidate[]): SearchChannel[] {
  const set = new Set(candidates.map((c) => c.channel));
  return searchChannels().filter((c) => set.has(c));
}
