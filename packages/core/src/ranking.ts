/**
 * 排序公式（纯函数）。
 *
 * 两个榜单模式，刻意都是「独立排序」而不是搜索融合后的乘数：
 *   - trend：热度 = 近期点击 + 近期收藏 − 站点年龄惩罚
 *   - fresh：新品 = 创建时间倒序
 *
 * 为什么热度不能进 RRF 融合：实测证明 RRF(k=60) 把靠前名次压得非常近
 * （排 1 与排 8 仅差约 11%），任何事后加成都能轻易翻转相关性顺序——
 * 「越用越懂你」会退化成「搜什么都搜不到」。个性化只走 personal 通道
 * （权重 0.3）就是同一个教训的产物，热度同理：它是浏览场景的排序键，
 * 不是相关性的修正项。
 *
 * 公式取对数：点击从 1 到 10 的边际递减，避免老站点凭累计永远霸榜；
 * 年龄惩罚线性：新站点有曝光机会，但不会仅凭新就压过高热站点。
 */

export interface TrendInput {
  /** 近 7 天点击次数 */
  visits7d: number
  /** 近 7 天被收藏次数 */
  favorites7d: number
  /** 站点年龄（天） */
  ageDays: number
}

export const TREND_WEIGHTS = {
  visits: 1.0,
  favorites: 1.5,
  /** 每天惩罚 0.1：半衰期约 15 天（无新互动时热度减半） */
  agePenaltyPerDay: 0.1,
} as const;

export function trendScore(input: TrendInput, now: number = Date.now()): number {
  const visits = Math.max(0, input.visits7d);
  const favorites = Math.max(0, input.favorites7d);
  const ageDays = Math.max(0, input.ageDays);
  const raw =
    TREND_WEIGHTS.visits * Math.log1p(visits) +
    TREND_WEIGHTS.favorites * Math.log1p(favorites) -
    TREND_WEIGHTS.agePenaltyPerDay * ageDays;
  // 下限 0：没有互动的老站点不会变成负分（浏览排序里排在手工序之前仍 >= 0）
  return Math.max(0, Number(raw.toFixed(6)));
}

/**
 * 新品分：创建时间越晚分越高（与 trend 同向：大 = 好）。
 * 注意曾经写反成 `now - createdAt`（那是「年龄」不是「新鲜度」），
 * 会导致越老的站点分越高——已被单测锁定。
 */
export function freshnessScore(createdAt: number): number {
  return createdAt;
}

export function ageInDays(createdAt: number, now: number = Date.now()): number {
  return Math.max(0, (now - createdAt) / 86_400_000);
}
