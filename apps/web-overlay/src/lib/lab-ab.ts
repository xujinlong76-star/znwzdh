import type { HubSearchHit } from './navhub-api'

/**
 * 算法实验室：静态 RRF 与动态 LinUCB 的本地复算。
 * 仅供实验室 A/B 对比使用；复算分数不写回生产权重。
 */

/** 静态 RRF 权重，与生产检索默认权重一致（packages/store/src/search.ts）。 */
export const LAB_STATIC_WEIGHTS: Record<string, number> = {
  exact: 1.4,
  fts: 1.0,
  pinyin: 0.9,
  semantic: 1.15,
  personal: 0.3,
}
/**
 * 覆盖因子：参与的非 personal 通道越多，分值越高；
 * personal 通道不计入（避免个性化权重抬高通用命中）。
 */
export function labCoverageFactor(hit: HubSearchHit): number {
  const nonPersonal = Object.keys(hit.contributions ?? {}).filter((c) => c !== 'personal')
  return 1 + 0.35 * Math.log2(Math.max(nonPersonal.length, 1))
}

/** 单条命中的 RRF 分数：分数 = 求和 权重/(60+名次)，再乘覆盖因子。 */
export function labScoreHit(hit: HubSearchHit, weights: Record<string, number>): number {
  const coverage = labCoverageFactor(hit)
  let sum = 0
  for (const [channel, c] of Object.entries(hit.contributions ?? {})) {
    const w = weights[channel]
    if (w === undefined) continue
    sum += w / (60 + c.rank)
  }
  return sum * coverage
}
export interface LabScoredHit {
  hit: HubSearchHit
  score: number
  usedChannels: string[]
}

/** 按给定权重取 Top 3（分数降序；同分按 siteId 稳定排序）。 */
export function labTop3(hits: HubSearchHit[], weights: Record<string, number>): LabScoredHit[] {
  return hits
    .map((hit) => ({
      hit,
      score: labScoreHit(hit, weights),
      usedChannels: Object.keys(hit.contributions ?? {}),
    }))
    .sort((a, b) => b.score - a.score || a.hit.siteId.localeCompare(b.hit.siteId))
    .slice(0, 3)
}
