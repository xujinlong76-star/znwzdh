import type { HubPluginItem } from '@/lib/navhub-api'
import type { PluginRankGroups, RankingGroupKey } from '@/lib/plugins/marketplace-rankings'

/**
 * 插件四榜的入榜资格与跨榜去重（2026-11-21）。
 *
 * ## 修的是什么
 *
 * 实测数据库：77 个插件里只有 10 个有安装记录、最高 2 次，
 * 且 `review_count` 字段根本不存在（评价还没上线）。
 * 但旧实现把 `/api/plugins?sort=trending&limit=5` 的结果**原样透传**，
 * 于是出现三个明显 Bug：
 *
 *  1. 飙升榜第 1 名是"AI 效率组合包（暂无安装）"——0 安装排在 2 次安装前面；
 *  2. 口碑榜 5 条全是"暂无评价"——零评价硬排 1-5 名，等于凭空发认证；
 *  3. 三个榜单重复展示同一批主题皮肤（因为总共就这几个有数据）。
 *
 * ## 处置
 *
 * 入榜即"资格"，不是"文案"。展示层把 "暂无安装" 当兜底文案是不够的：
 * 它的语义就是"这个插件没有资格出现在安装榜里"。
 */

/** 安装/飙升榜的最低安装数（>0 才有资格） */
export const MIN_INSTALLS_FOR_RANK = 1
/** 口碑榜的最低评价数（>0 才有资格） */
export const MIN_REVIEWS_FOR_RANK = 1
/** 两榜重合率超过此值时合并展示 */
export const MERGE_OVERLAP_RATIO = 0.8

/**
 * 按资格过滤某组榜单。
 *
 * - trending / popular：installCount > 0
 * - rating：reviewCount > 0（当前库无此字段时自然全部落空 → 空态，符合预期）
 * - fresh：只看上架时间，无需资格门槛
 */
export function filterRankEligible(
  key: RankingGroupKey,
  items: readonly HubPluginItem[],
): HubPluginItem[] {
  if (key === 'trending' || key === 'popular') {
    return items.filter((p) => Number(p.installCount ?? 0) >= MIN_INSTALLS_FOR_RANK)
  }
  if (key === 'rating') {
    return items.filter((p) => Number(p.reviewCount ?? 0) >= MIN_REVIEWS_FOR_RANK)
  }
  return [...items]
}

/** 对四组同时应用资格过滤 */
export function filterAllRankGroups(groups: PluginRankGroups): PluginRankGroups {
  return {
    trending: filterRankEligible('trending', groups.trending),
    popular: filterRankEligible('popular', groups.popular),
    rating: filterRankEligible('rating', groups.rating),
    fresh: filterRankEligible('fresh', groups.fresh),
  }
}

/**
 * 两榜重合率（按插件 id 交集 / 较小榜长度）。
 * 任一为空时返回 0——空榜之间谈不上"重合"。
 */
export function overlapRatio(a: readonly HubPluginItem[], b: readonly HubPluginItem[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const set = new Set(a.map((p) => p.id))
  const shared = b.filter((p) => set.has(p.id)).length
  return shared / Math.min(a.length, b.length)
}

/**
 * 是否应把"安装榜 + 飙升榜"合并成双栏卡片。
 *
 * 冷启动期两榜几乎必然是同一批插件（有安装的总共就 10 个），
 * 分成两个一模一样的小榜单只会让用户觉得"怎么都是这几个"。
 * 合并成「热门装机 / 最新上架」双栏：信息量不减，还消除了重复感。
 */
export function shouldMergeInstallRanks(
  trending: readonly HubPluginItem[],
  popular: readonly HubPluginItem[],
): boolean {
  if (trending.length === 0 && popular.length === 0) return false
  return overlapRatio(trending, popular) > MERGE_OVERLAP_RATIO
}
