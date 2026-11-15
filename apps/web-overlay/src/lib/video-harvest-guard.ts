/**
 * 采集入库严标准守卫（纯函数，零依赖）。
 *
 * Ryan 定稿的入库门槛（2026-11-13）——只认真实互动数据，四条满足其一即放行：
 *   1. 置顶 / 人工 / 精选（人明确要的，不看数据）；
 *   2. 播放 ≥ 50,000；
 *   3. 播放 ≥ 10,000 且点赞 ≥ 100；
 *   4. 播放 ≥ 5,000 且点赞 ≥ 200 且弹幕 ≥ 50。
 * 其余一律拒绝入库；无数据（播放/点赞/弹幕全为零或缺失）直接拒绝，不给默认值。
 *
 * 为什么是独立文件而不是散在各采集器里：
 *   - 同一条标准被 B 站搜索、多平台搜索、自主采集、入库三个关口共用，
 *     各写一份必然悄悄分叉（此前 minQualityScore 就是教训：多平台路径
 *     根本不读它，B 站路径拿不可信的 qualityScore 去比 60 分）。
 *   - qualityScore 刻意不参与判定：库里 4134 条正好都是 65 分，不可信，
 *     评分公式去垫高是另一路工作，本守卫只认平台返回的真实播放/点赞/弹幕。
 *
 * 调用方约定：所有采集入库路径在「把候选项写进分类之前」必须调
 * `checkHarvestEligibility`（或 `isHarvestEligibleForItem`），拒绝的要把
 * `rejectReason` 写进 failures / 日志，不许静默丢弃。
 */

import type { NavigationSubItem, VideoStats } from '@/types/navigation'

/**
 * 入库严标准（HARVEST_GATE）：单一配置对象，写死在本文件，不从 harvestPolicy /
 * 环境变量读，避免策略漂移。调用方一律读它，不许各写一份播放量比较。
 *
 * 定值（2026-11-14，5 个真实关键词 × 前 15 条实测，WBI 签名真实请求）：
 * 守卫通过率 53.3%（40/75）；热门词 8–10/15、冷门词（Playwright）3/15 仍能填满
 * 每词 3 条的采量；端到端 5 词采满 15 条。B 站搜索响应里 favorites 75/75 存在、
 * coins 0/75 不存在——守卫只用播放/点赞/弹幕三项（响应里 100% 存在），不依赖收藏/投币。
 * 通过项新公式分数 p50 59、最高 83，无 65 扎堆；门槛不需要分数项。
 */
export const HARVEST_GATE = {
  viewsHigh: 50000,
  viewsMid: 10000,
  likesMid: 100,
  viewsLow: 5000,
  likesLow: 200,
  danmakuLow: 50,
} as const

/** 放行命中的是哪一条规则（写进日志/报告，便于事后审计）。 */
export type HarvestAllowRule =
  | 'pinned'
  | 'manual'
  | 'curated'
  | 'views_high'
  | 'views_likes'
  | 'views_likes_danmaku'

export interface HarvestEligibilityInput {
  /** 平台返回的真实互动数据；缺失按零算，绝不补默认值。 */
  stats?: VideoStats | null
  /** 置顶（videoConfig.pinned）。 */
  pinned?: boolean
  /** 人工来源（videoConfig.sourceType === 'manual'，如人工粘贴 URL 解析）。 */
  isManual?: boolean
  /** 精选选题池（CURATED_TRENDING_TOPICS 这类人工精选清单）。 */
  isCurated?: boolean
}

export interface HarvestEligibilityVerdict {
  eligible: boolean
  /** 放行时命中的规则；拒绝时为 undefined。 */
  matchedRule?: HarvestAllowRule
  /** 拒绝时的人话原因（含真实数值）；放行时为 undefined。 */
  rejectReason?: string
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0
}

/**
 * 严标准判定：四条满足其一即放行，否则拒绝。
 *
 * 注意顺序：人工豁免（置顶/人工/精选）先于数据判定——人明确要的条目
 * 本来就没打算用播放量卡；但豁免只认这三个显式标记，不认「AI 评分高」、
 * 「标题好」或任何默认值。
 */
export function checkHarvestEligibility(
  input: HarvestEligibilityInput,
): HarvestEligibilityVerdict {
  if (input.pinned) {
    return { eligible: true, matchedRule: 'pinned' }
  }
  if (input.isManual) {
    return { eligible: true, matchedRule: 'manual' }
  }
  if (input.isCurated) {
    return { eligible: true, matchedRule: 'curated' }
  }

  const views = toCount(input.stats?.views)
  const likes = toCount(input.stats?.likes)
  const danmaku = toCount(input.stats?.danmaku)

  if (views === 0 && likes === 0 && danmaku === 0) {
    return {
      eligible: false,
      rejectReason:
        '无真实互动数据（播放/点赞/弹幕均为零或缺失），不许靠默认值入库',
    }
  }

  if (views >= HARVEST_GATE.viewsHigh) {
    return { eligible: true, matchedRule: 'views_high' }
  }
  if (views >= HARVEST_GATE.viewsMid && likes >= HARVEST_GATE.likesMid) {
    return { eligible: true, matchedRule: 'views_likes' }
  }
  if (
    views >= HARVEST_GATE.viewsLow &&
    likes >= HARVEST_GATE.likesLow &&
    danmaku >= HARVEST_GATE.danmakuLow
  ) {
    return { eligible: true, matchedRule: 'views_likes_danmaku' }
  }

  return {
    eligible: false,
    rejectReason:
      `播放 ${views} / 点赞 ${likes} / 弹幕 ${danmaku}，未达严标准` +
      `（播放≥${HARVEST_GATE.viewsHigh}，或播放≥${HARVEST_GATE.viewsMid}且点赞≥${HARVEST_GATE.likesMid}，` +
      `或播放≥${HARVEST_GATE.viewsLow}且点赞≥${HARVEST_GATE.likesLow}且弹幕≥${HARVEST_GATE.danmakuLow}）`,
  }
}

/**
 * 对一条已成形的候选项（NavigationSubItem）做判定：读它的 videoConfig。
 * `curated` 只有调用方明确知道该条来自人工精选清单时才传 true。
 */
export function isHarvestEligibleForItem(
  item: NavigationSubItem,
  opts?: { curated?: boolean },
): HarvestEligibilityVerdict {
  const config = item.videoConfig
  return checkHarvestEligibility({
    stats: config?.stats,
    pinned: config?.pinned,
    isManual: config?.sourceType === 'manual',
    isCurated: opts?.curated,
  })
}

/** 守卫拒收在 failures 里的标记前缀：调用方据此统计，不靠文案匹配。 */
export const HARVEST_GUARD_REJECT_PREFIX = '守卫拒收：'

export function harvestGuardRejectReason(
  verdict: HarvestEligibilityVerdict,
): string {
  return `${HARVEST_GUARD_REJECT_PREFIX}${verdict.rejectReason ?? '未达严标准'}`
}
