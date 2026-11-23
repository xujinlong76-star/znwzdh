/**
 * 「常去却未收藏」——网址管家轻版（2026-11-23 21:22 轮 W3，候选 6）。
 *
 * 反向是 lib/resurface.ts 的 selectStaleFavorites（已收藏却 90 天没打开 →
 * 重温）；这里是正向缺口：本机真实点击记录里常点（count ≥ 3）却从没收藏
 * 的站，提醒用户一键收藏，给高频站一个换设备 / 清数据也不丢的兜底。
 *
 * 数据口径与首页坞同一份本机快照（@/lib/offline-recent）：
 *   - 门槛复用 MRU_MIN_USES_FOR_BOOST（= 3），与速览坞置顶门槛同一口径，
 *     不另写一个 3；误点一次（count 1–2）的站不进榜；
 *   - 排序复用 topFrequentVisits（MRU 分降序），不另写排序；
 *   - 只读本机快照：登录用户在另一设备的高频点击不进榜，调用方文案须写
 *     “按本机记录算”，不谎称跨设备准确（与 stale 横幅同口径）。
 *
 * 本文件只放纯函数：`now` 不由调用方注入——排序用的 Date.now() 在
 * topFrequentVisits 内部取（与 home-frequent-visits 同款）；单测用
 * count 主导的固定输入断言顺序（时间分在旧时间戳下趋近 0，见测试）。
 */

import {
  MRU_MIN_USES_FOR_BOOST,
  topFrequentVisits,
  type RecentVisit,
} from './offline-recent'

/** 建议区最多露几条：轻推，不是清单（与 /brief 每日重温 3 条同量级）。 */
export const FREQUENT_UNFAVORITED_LIMIT = 3

/** 进榜最低点击次数：复用速览坞置顶门槛，不另写一个 3。 */
export const FREQUENT_UNFAVORITED_MIN_USES = MRU_MIN_USES_FOR_BOOST

/**
 * 从本机最近访问快照里挑「常去却未收藏」的站。
 *
 *   - 已收藏（id 在 favoriteSiteIds 里）的不进榜；
 *   - count 缺失按 1 计（与 topFrequentVisits 同口径），达不到门槛；
 *   - id / title / href 缺失或空白的行跳过：没标题没链接的行没法渲染、
 *     也没法一键收藏；
 *   - 返回按 MRU 分排好的前 limit 条；输入为空或无一达标时返回 []。
 */
export function selectFrequentUnfavoritedVisits(
  visits: RecentVisit[],
  favoriteSiteIds: ReadonlySet<string>,
  limit: number = FREQUENT_UNFAVORITED_LIMIT,
): RecentVisit[] {
  const cap = Math.max(0, Math.trunc(limit))
  if (cap === 0) return []
  const candidates = visits.filter((v) => {
    if (!v || typeof v.id !== 'string' || v.id === '') return false
    if (typeof v.title !== 'string' || v.title.trim() === '') return false
    if (typeof v.href !== 'string' || v.href.trim() === '') return false
    if ((v.count ?? 1) < FREQUENT_UNFAVORITED_MIN_USES) return false
    if (favoriteSiteIds.has(v.id)) return false
    return true
  })
  return topFrequentVisits(candidates, cap)
}
