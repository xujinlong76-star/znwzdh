/**
 * 成长系统懒加载门面（首屏瘦身 Step 3）。
 *
 * lib/growth.ts 是 101 KB 的成长引擎（等级/连胜/赛季/任务/徽章全套结算），
 * 首屏同步引用方只有几处轻量调用（埋点、连胜条、设为首页横幅、全局感知层），
 * 却把整座引擎拖进首屏同步集。本门面只放首屏路径真正需要的东西：
 *
 *  - 常量与纯函数（日期 key、连胜、赛季历法、空档案）从 growth.ts 逐字搬入，
 *    growth.ts 改为从这里 re-export，单一来源不变；
 *  - loadGrowthProfile() 同步轻读：v2 全量档案直接 JSON.parse 返回（结算由后台
 *    完整加载补跑，完成后发 GROWTH_UPDATED_EVENT 触发刷新）；旧版/损坏档案
 *    先给空档案，后台走完整解析迁移；
 *  - 记账类动作（recordGrowthEvent 等）一律动态 import 后 fire-and-forget，
 *    调用方只改 import 路径，丢事件可接受，不改调用时序。
 *
 * 本模块零值 import（只 import type + growth-season 配置常量），
 * 绝不静态 import growth.ts；类型全部 import type，不占字节。
 * /me 侧的重型面板（growth-panel / growth-tasks / growth-season-panel /
 * homepage-guide / growth-heatmap）仍直接 import growth.ts——它们不在首屏
 * 同步集里，把它们也搬进门面等于把整座引擎再搬回来。
 */

import { SEASON_EPOCH_KEY, SEASON_LENGTH_DAYS } from './growth-season'
import type {
  AwardOpts,
  DayState,
  GrowthFeature,
  GrowthProfile,
  SeasonCalendar,
  SeasonState,
} from './growth'

export type { AwardOpts, DayState, GrowthFeature, GrowthProfile, SeasonCalendar, SeasonState } from './growth'

/* ---------------- 常量（自 growth.ts 逐字搬入） ---------------- */

export const GROWTH_STORAGE_KEY = 'navhub.growth.v1'
export const GROWTH_BACKUP_KEY = 'navhub.growth.v1.backup'
/** 给挂件的只读摘要（等级/连胜/今日任务点），引擎落盘时顺手写，挂件不复刻任务逻辑 */
export const GROWTH_SUMMARY_KEY = 'navhub.growth.summary.v1'
export const GROWTH_UPDATED_EVENT = 'navhub:growth-updated'
/**
 * 小猫猫挂件的聊天事件桥（A12）：挂件是独立脚本、按设计只读成长档案，
 * 它在用户发出一条聊天消息时只 dispatch 这个事件、不写任何成长数据；
 * 站内 GrowthTracker 监听后走 recordGrowthEvent('ai_chat') 统一落账。
 */
export const AI_CHAT_USED_EVENT = 'navhub:ai-chat-used'
/**
 * 小猫猫挂件的喂猫事件桥（互动玩法第一批 Top 3：拖链接喂猫收藏）：挂件只 dispatch
 * 这个事件、不写任何成长数据；站内 GrowthTracker 监听后走
 * recordGrowthEvent('favorite_add', { siteId }) 统一落账（与坞里收藏同一口径）。
 */
export const FAVORITE_ADDED_EVENT = 'navhub:favorite-added'
export const HOMEPAGE_BANNER_DISMISSED_KEY = 'navhub.growth.homepageBannerDismissed.v1'
/** 设为首页一次性奖励（自 growth.ts 逐字搬入，rebase 合流时补进门面） */
export const HOMEPAGE_CLAIM_XP = 100

/* ---------------- 日期 key 纯函数（自 growth.ts 逐字搬入） ---------------- */

export function todayKey(d: Date = new Date()): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * 成长日 key：本地时区 04:00 切日——04:00 前的时刻归前一个成长日。
 * 短剧人群活跃高峰在 23:00–02:00，00:00 切日会把同一次晚间使用劈成两天。
 */
export function growthDayKey(d: Date = new Date()): string {
  // 按本地时钟的小时数判断（不用毫秒平移）：夏令时换季日也不会漂移
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getHours() < 4 ? 1 : 0))
  return todayKey(local)
}

const DAY_MS = 24 * 60 * 60 * 1000

/** key → UTC 毫秒（只做日期算术，与时区无关的纯日历计算） */
function keyToMs(key: string): number {
  const [y, m, dd] = key.split('-').map((x) => Number(x))
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, dd ?? 1)
}

export function keyAddDays(key: string, n: number): string {
  const d = new Date(keyToMs(key) + n * DAY_MS)
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${d.getUTCDate()}`.padStart(2, '0')
  return `${d.getUTCFullYear()}-${m}-${day}`
}

/** b - a 的天数（a、b 均为日期 key） */
export function keyDiffDays(a: string, b: string): number {
  return Math.round((keyToMs(b) - keyToMs(a)) / DAY_MS)
}

/** 日期 key 的星期（0=周日 … 6=周六），纯日历计算 */
export function keyWeekday(key: string): number {
  return new Date(keyToMs(key)).getUTCDay()
}

/** 所在周的周一 key（每周任务按周一换周） */
export function mondayKeyOf(key: string): string {
  const wd = keyWeekday(key)
  const delta = wd === 0 ? -6 : 1 - wd
  return keyAddDays(key, delta)
}

/* ---------------- 连胜纯函数（自 growth.ts 逐字搬入） ---------------- */

export function dayStateOf(profile: GrowthProfile, key: string): DayState | undefined {
  return profile.dayStates[key] ?? (profile.activeDates.includes(key) ? 'lit' : undefined)
}

/** 当前连胜：从今天（未点亮则从昨天）往回数 present 日；休息日透明跳过 */
export function currentStreak(profile: GrowthProfile, now: Date = new Date()): number {
  const today = growthDayKey(now)
  let cursor = today
  if (!dayStateOf(profile, cursor)) cursor = keyAddDays(cursor, -1)
  let streak = 0
  let guard = 0
  while (guard < 4000) {
    const s = dayStateOf(profile, cursor)
    if (s === 'lit' || s === 'frozen' || s === 'rescued') streak += 1
    else if (s === 'rest') {
      /* 透明：不计不算断 */
    } else break
    cursor = keyAddDays(cursor, -1)
    guard += 1
  }
  return streak
}

/** 真连胜（无垫付无抢救的连续点亮段，当前值） */
export function currentPureStreak(profile: GrowthProfile, now: Date = new Date()): number {
  const today = growthDayKey(now)
  let cursor = today
  if (!dayStateOf(profile, cursor)) cursor = keyAddDays(cursor, -1)
  let streak = 0
  let guard = 0
  while (guard < 4000) {
    const s = dayStateOf(profile, cursor)
    if (s === 'lit') streak += 1
    else if (s === 'rest') {
      /* 透明 */
    } else break
    cursor = keyAddDays(cursor, -1)
    guard += 1
  }
  return streak
}

/* ---------------- 赛季历法（自 growth.ts 逐字搬入） ---------------- */

export function seasonCalendar(now: Date = new Date()): SeasonCalendar {
  const today = growthDayKey(now)
  const diff = keyDiffDays(SEASON_EPOCH_KEY, today)
  const index = Math.max(0, Math.floor(diff / SEASON_LENGTH_DAYS))
  const startKey = keyAddDays(SEASON_EPOCH_KEY, index * SEASON_LENGTH_DAYS)
  return { index, dayOfSeason: diff - index * SEASON_LENGTH_DAYS + 1, startKey, endKey: keyAddDays(startKey, SEASON_LENGTH_DAYS - 1) }
}

/* ---------------- 空档案（自 growth.ts 逐字搬入） ---------------- */

export function emptySeason(index: number): SeasonState {
  return {
    index,
    sp: 0,
    tasksGranted: [],
    levelGranted: 0,
    milestonesGranted: [],
    roamingGranted: 0,
    eventGranted: [],
    midMilestonesGranted: [],
    contributionApproved: 0,
  }
}

export function emptyProfile(now: Date = new Date()): GrowthProfile {
  return {
    v: 2,
    totalXp: 0,
    boost: false,
    homepageClaimedAt: null,
    pwaInstalledAt: null,
    memberSeen: false,
    createdAt: now.toISOString(),
    days: {},
    features: {},
    categories: [],
    scenes: [],
    activeDates: [],
    dramaDates: [],
    idleTotalMinutes: 0,
    dayStates: {},
    streakChain: null,
    streakSettledThrough: null,
    freezeCards: 0,
    freezeGiftLevel3: false,
    restWeekday: null,
    restChangedKey: null,
    earnBack: null,
    earnBackUses: [],
    longestStreak: 0,
    pureLongestStreak: 0,
    rewardedFavIds: [],
    sitesOpened: [],
    weeks: {},
    season: emptySeason(seasonCalendar(now).index),
    seasonHistory: [],
    returnPack: null,
    lastReturnPackKey: null,
    pioneerLegend: false,
    legacyBadgeIds: [],
    catalogBonusGranted: false,
    milestoneDays: [],
    chestNoCardStreak: 0,
    rookiePanelSeen: false,
    lastSeenLevel: 1,
    pendingNotices: [],
    lastActiveKey: null,
  }
}

/* ---------------- 同步轻读档案 ---------------- */

/** 后台跑一次完整加载：解析迁移 + 结算（冻结/连胜/赛季）+ 落盘 + 发事件。 */
function kickFullLoad(): void {
  void import('@/lib/growth')
    .then((m) => {
      m.loadGrowthProfile()
    })
    .catch(() => {
      /* 后台完整加载失败不影响首屏：成长是增强不是主链路，轻读已返回数据 */
    })
}

/**
 * 同步读档案（供首屏连胜条 / 设为首页横幅在挂载后 effect 里调用）。
 *
 * v2 全量档案：saveGrowthProfile 原样落盘，字段齐全，直接返回；
 * 结算（冻结垫付/连胜断签/赛季滚动）由后台完整加载补跑，完成后发
 * GROWTH_UPDATED_EVENT，调用方监听后刷新——首 paint 可能短暂看到
 * 结算前的数据，随即被事件纠正。旧版/损坏档案先给空档案，后台迁移。
 */
export function loadGrowthProfile(): GrowthProfile {
  if (typeof window === 'undefined') return emptyProfile()
  try {
    const raw = window.localStorage.getItem(GROWTH_STORAGE_KEY)
    if (!raw) return emptyProfile()
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as { v?: unknown }).v === 2) {
      kickFullLoad()
      return parsed as GrowthProfile
    }
    kickFullLoad()
    return emptyProfile()
  } catch {
    return emptyProfile()
  }
}

/* ---------------- 记账动作：动态 import，fire-and-forget ---------------- */

/** 动态 import 引擎后执行动作；加载失败或异常都静默丢弃（成长是增强不是主链路）。 */
function withGrowth(fn: (m: typeof import('@/lib/growth')) => void): void {
  void import('@/lib/growth')
    .then((m) => {
      try {
        fn(m)
      } catch {
        /* 记账失败不阻塞调用方 */
      }
    })
    .catch(() => {
      /* 动态 import 失败静默丢弃：成长是增强不是主链路，记账动作可丢 */
    })
}

export function recordGrowthEvent(kind: GrowthFeature, opts: AwardOpts = {}): void {
  withGrowth((m) => {
    m.recordGrowthEvent(kind, opts)
  })
}

export function recordCustomSiteAddedAction(): void {
  withGrowth((m) => {
    m.recordCustomSiteAddedAction()
  })
}

export function recordDailyVisitOnce(): void {
  withGrowth((m) => {
    m.recordDailyVisitOnce()
  })
}

export function recordIdleMinute(): void {
  withGrowth((m) => {
    m.recordIdleMinute()
  })
}

export function recordPageVisitAction(page: string): void {
  withGrowth((m) => {
    m.recordPageVisitAction(page)
  })
}

export function claimPwaInstallAction(): void {
  withGrowth((m) => {
    m.claimPwaInstallAction()
  })
}

export function claimHomepageAction(): void {
  withGrowth((m) => {
    m.claimHomepage()
  })
}

export function markMemberSeenAction(seen: boolean): void {
  withGrowth((m) => {
    m.markMemberSeenAction(seen)
  })
}
