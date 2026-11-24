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


/* ------------------------------------------------------------------ *
 * 统一搜索排序器（第一阶段：Shadow only）
 * ------------------------------------------------------------------ */

/**
 * 版本化搜索特征。未提供的特征按中性值处理；policyEligible 是硬门禁，
 * 必须在召回/过滤阶段执行，绝不能被软排序分数覆盖。
 */
export interface SearchRankingFeatures {
  qualityScore?: number;
  freshnessDays?: number;
  localeMatch?: boolean;
  preferenceScore?: number;
  policyEligible?: boolean;
}

export interface SearchRankingShadowDiagnostics {
  rankerVersion: "search-shadow-v1";
  featureVersion: "search-features-v1";
  mode: "shadow";
  topK: number;
  compared: number;
  overlap: number;
  changed: number;
  overlapRate: number;
}

const SEARCH_RANKER_MAX_ADJUSTMENT = 0.08;
const clampFinite = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 0;

/**
 * 对现有 RRF 结果运行有界影子重排，不修改线上顺序。
 *
 * 第一阶段只使用已经存在的通道证据；质量、新鲜度、语言和偏好特征
 * 只有在调用方提供可信元数据时才参与，缺失值严格中性。
 */
export function evaluateSearchRankingShadow(
  hits: import("./types.ts").SearchHit[],
  topK = 10,
  featuresBySite: ReadonlyMap<string, SearchRankingFeatures> = new Map(),
): SearchRankingShadowDiagnostics {
  const safeTopK = Math.max(1, Math.min(100, Math.floor(Number.isFinite(topK) ? topK : 10)));
  const baseline = hits.slice(0, safeTopK).map((hit) => hit.siteId);
  const baselineSet = new Set(baseline);
  const scored = hits.map((hit, index) => {
    const channels = Object.keys(hit.contributions ?? {});
    const lexicalCount = channels.filter((channel) =>
      channel === "exact" || channel === "fts" || channel === "pinyin"
    ).length;
    const hasSemantic = channels.includes("semantic");
    const hasPersonal = channels.includes("personal");
    let adjustment = 0;

    if (lexicalCount > 0) adjustment += 0.025 + Math.min(0.02, Math.max(0, lexicalCount - 1) * 0.01);
    else if (hasSemantic) adjustment -= 0.06;
    if (hasPersonal && lexicalCount === 0 && !hasSemantic) adjustment -= 0.02;

    const features = featuresBySite.get(hit.siteId);
    if (features?.qualityScore !== undefined) {
      adjustment += clampFinite((clampFinite(features.qualityScore, 0, 100) - 50) / 50, -1, 1) * 0.02;
    }
    if (features?.freshnessDays !== undefined) {
      const age = clampFinite(features.freshnessDays, 0, 365);
      adjustment += (1 - age / 365) * 0.01;
    }
    if (features?.localeMatch === true) adjustment += 0.01;
    if (features?.preferenceScore !== undefined) {
      adjustment += clampFinite(features.preferenceScore, 0, 1) * 0.01;
    }

    adjustment = clampFinite(adjustment, -SEARCH_RANKER_MAX_ADJUSTMENT, SEARCH_RANKER_MAX_ADJUSTMENT);
    const baseScore = Number.isFinite(hit.score) ? hit.score : 0;
    return { siteId: hit.siteId, index, shadowScore: baseScore * (1 + adjustment) };
  });

  scored.sort((a, b) => b.shadowScore - a.shadowScore || a.index - b.index);
  const shadowTop = scored.slice(0, safeTopK).map((item) => item.siteId);
  const overlap = shadowTop.filter((siteId) => baselineSet.has(siteId)).length;
  const compared = Math.min(baseline.length, shadowTop.length);
  // changed 表示 top-K 内位置发生变化的条数；overlap 单独表示成员集合重合。
  const changed = baseline.reduce(
    (count, siteId, index) => count + (shadowTop[index] === siteId ? 0 : 1),
    0,
  );

  return {
    rankerVersion: "search-shadow-v1",
    featureVersion: "search-features-v1",
    mode: "shadow",
    topK: safeTopK,
    compared,
    overlap,
    changed,
    overlapRate: compared === 0 ? 1 : Number((overlap / compared).toFixed(4)),
  };
}
