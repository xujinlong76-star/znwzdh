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
  // 入参净化：任一通道拿到 NaN/Infinity 都按 0 处理（调用方数据脏不该让全站任务失败）
  const safe = (v: number) => (Number.isFinite(v) ? Math.max(0, v) : 0);
  const visits = safe(input.visits7d);
  const favorites = safe(input.favorites7d);
  const ageDays = safe(input.ageDays);
  const raw =
    TREND_WEIGHTS.visits * Math.log1p(visits) +
    TREND_WEIGHTS.favorites * Math.log1p(favorites) -
    TREND_WEIGHTS.agePenaltyPerDay * ageDays;
  // 下限 0：没有互动的老站点不会变成负分（浏览排序里排在手工序之前仍 >= 0）
  //
  // 2026-11-08：补一道有限性闸门。`Math.max(0, NaN) === NaN`，`NaN.toFixed`
  // 得到字符串 "NaN"，`Number("NaN")` 还是 NaN —— 也就是原本这三步「看起来在兜底」
  // 的写法对 NaN 完全无效，NaN 会直接进 SQL 绑定参数变成 NULL。
  // 任何非有限中间值都归零：热度算不出来时，正确结果是「没有热度」而不是让任务崩。
  const rounded = Number(raw.toFixed(6));
  return Number.isFinite(rounded) ? Math.max(0, rounded) : 0;
}

/**
 * 新品分：创建时间越晚分越高（与 trend 同向：大 = 好）。
 * 注意曾经写反成 `now - createdAt`（那是「年龄」不是「新鲜度」），
 * 会导致越老的站点分越高——已被单测锁定。
 */
export function freshnessScore(createdAt: number): number {
  return createdAt;
}

/**
 * 站点年龄（天）。
 *
 * 2026-11-08 修复：入参可能是「看起来像数字、其实是脏数据」的值——
 * 库里实测有 3 条站的 created_at 存成了 TEXT 日期串（"2026-11-07 06:47:11"），
 * `Number()` 之后是 NaN，于是 (now - NaN)/86400000 = NaN，
 * `Math.max(0, NaN)` 仍然是 NaN（Math.max 不吞 NaN），一路传到 SQL 参数里
 * 被 SQLite 当成 NULL，撞上 `sites.weight NOT NULL` —— 整个 recompute_rank
 * 任务每小时失败一次，全站 trend_score 永远停在 0。
 *
 * 这里把「算不出年龄」收敛成一个明确的有限值（视为 0 天，即按新站处理），
 * 而不是让 NaN 继续外泄。脏数据本身由调用方负责修正。
 */
export function ageInDays(createdAt: number, now: number = Date.now()): number {
  const created = Number(createdAt);
  if (!Number.isFinite(created)) return 0;
  const days = (now - created) / 86_400_000;
  return Number.isFinite(days) ? Math.max(0, days) : 0;
}
