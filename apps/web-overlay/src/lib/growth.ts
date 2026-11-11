/**
 * 用户成长档案 v2（等级 / 连胜 / 赛季 / 任务 / 徽章）——纯本机实现。
 *
 * 施工口径：GROWTH_ADVANCED_PLAN_V2 定稿。三引擎分工——等级管资历、
 * 连胜管回访、赛季管中期目标；成长值是唯一货币，赛季积分（SP）是
 * 赛季内成长值的 1:1 镜像，不设第二货币。
 *
 * 与 v1 的关系：Lv1–8 门槛与称号逐字不变、功能经验曲线（生涯首次 +20 /
 * 每日首次 +10 / 重复 +2 至第 5 次封底 0 / 新分类 +15 / 挂机 +1 每分钟
 * 每日 30 分钟 / 每日到访 +5 / 设首页 +100）全部沿用；v2 新增——
 *  - brief_read 功能（图鉴扩到 10 种）；
 *  - 倍率体系：身份档（基础 ×1.0 / 登录 ×1.2 / 设首页或 PWA ×1.5，取高）
 *    + 连胜加成（每满 7 天 +0.1，封顶 +0.3），总倍率封顶 ×2.0，只放大使用类；
 *  - 使用类日上限 300（任务类不计入，防熔断误伤真实重度用户）；
 *  - 04:00 切日（本地时区）：一个「成长日」= 04:00 → 次日 04:00；
 *  - 连胜三层保护：冻结卡自动垫付（补给按连续周期每满 7 个自然日 +1）、
 *    每周休息日（透明日）、Earn Back 48 小时抢救（断签时连胜 ≥7 才开）；
 *  - 任务三层：每日 3 槽 + 全清宝箱（概率公示、缺卡/连空双保底）、
 *    每周 5 个、赛季 8 个 + 季中事件与里程碑（配置在 growth-season.ts）；
 *  - 徽章套系化（铜/银/金）与里程碑阶梯，老徽章 id 与门槛只降不升；
 *  - 档案 v1→v2 迁移：先把 v1 原始数据备份到 GROWTH_BACKUP_KEY 再迁移，
 *    迁移后 Lv1–8 用户等级零变化；上线前已达 Lv8 者发绝版纪念章「初代传说」。
 *
 * 诚实口径（沿 v1）：数据只存浏览器 localStorage、不回传服务端，
 * 用户中心如实标注「本机成长档案」；设为首页是自述领取（网页无法检测）；
 * 宝箱只给加法、无付费入口、概率在成长页公示。
 */

import {
  MID_SEASON_MILESTONES,
  MID_SEASON_WINDOW,
  ROAMING_NODE_REWARD_XP,
  ROAMING_SP_PER_NODE,
  SEASON_EPOCH_KEY,
  SEASON_EVENTS,
  SEASON_LENGTH_DAYS,
  SEASON_LEVEL_COUNT,
  SEASON_LEVEL_REWARD_XP,
  SEASON_SP_PER_LEVEL,
  type SeasonEventDef,
  type SeasonEventTaskDef,
} from './growth-season'
import { trackGrowthEvent } from './growth-analytics'

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
export const HOMEPAGE_BANNER_DISMISSED_KEY = 'navhub.growth.homepageBannerDismissed.v1'

export type GrowthFeature =
  | 'ai_find'
  | 'ai_chat'
  | 'scene_open'
  | 'category_visit'
  | 'search'
  | 'drama_visit'
  | 'site_open'
  | 'favorite_add'
  | 'watchlist_progress'
  | 'brief_read'

export const FEATURE_META: Record<GrowthFeature, { title: string; desc: string; href: string }> = {
  ai_find: { title: 'AI 智能找站', desc: '在首页用一句话描述想找的网站', href: '/' },
  ai_chat: { title: '和小猫猫聊天', desc: '点右下角小猫猫，问它找站', href: '/' },
  scene_open: { title: '场景包', desc: '做 PPT、追短剧等成套工具链，一点就开工', href: '/' },
  category_visit: { title: '逛分类', desc: '14 个一级分类挨个逛逛，总有新发现', href: '/' },
  search: { title: '站内搜索', desc: '记得名字时直接搜最快', href: '/search' },
  drama_visit: { title: '短剧专区', desc: '免费短剧和各大平台短剧都在这', href: '/category/duanju' },
  site_open: { title: '打开站点', desc: '点开任意站点卡片去逛逛', href: '/' },
  favorite_add: { title: '收藏站点', desc: '把常用的站收进「我的收藏」', href: '/favorites' },
  watchlist_progress: { title: '追剧记进度', desc: '在追剧清单里更新一部剧的观看进度', href: '/me/watchlist' },
  brief_read: { title: '每日简报', desc: '打开今天的简报，看看热榜和在追的剧', href: '/brief' },
}

export const FEATURE_FIRST_EVER_XP = 20
export const DAILY_FIRST_XP = 10
export const REPEAT_XP = 2
/** 当日同一功能第几次使用起不再给重复经验（第 2..REPEAT_LIMIT 次给 REPEAT_XP） */
export const REPEAT_LIMIT = 5
export const CATEGORY_NEW_XP = 15
export const IDLE_XP_PER_MINUTE = 1
export const IDLE_DAILY_CAP_MINUTES = 30
export const DAILY_VISIT_XP = 5
export const HOMEPAGE_CLAIM_XP = 100
export const PWA_CLAIM_XP = 60
/** v1 的单一加速倍率（= v2 的设首页/PWA 身份档，保留导出给旧测试与文案） */
export const BOOST_MULTIPLIER = 1.5
export const MEMBER_MULTIPLIER = 1.2
export const MULTIPLIER_CAP = 2.0
/** 使用类（吃倍率来源）单日入账上限；任务类不计入 */
export const USAGE_DAILY_CAP = 300
export const DAILY_TASK_XP = 10
export const WEEKLY_TASK_XP = 40
export const SEASON_TASK_XP = 60
export const CHEST_FIXED_XP = 15
/** 宝箱变量档出冻结卡的基础概率（缺卡时升至 0.30，连空 3 次后第 4 个必出） */
export const CHEST_CARD_PROB = 0.18
/** 身份档：基础 / 登录 / 设首页或装为应用（取高不叠，与连胜加成合计封顶 ×2.0） */
export const IDENTITY_TIER = { base: 1.0, member: MEMBER_MULTIPLIER, homeOrPwa: BOOST_MULTIPLIER } as const
/** 连胜加成上限（每满 7 天 +0.1） */
export const STREAK_BONUS_CAP = 0.3
/** 冻结卡库存上限：Lv8 前 2 张，Lv8 起 3 张 */
export const FREEZE_CAP_LOW = 2
export const FREEZE_CAP_HIGH = 3
export const FREEZE_CAP_HIGH_LEVEL = 8
/** Earn Back：断签时连胜 ≥7 天才开抢救窗，窗口 48 小时，动作 = 简报 1 + 开站 2 */
export const EARNBACK_MIN_STREAK = 7
export const EARNBACK_WINDOW_MS = 48 * 3600 * 1000
export const EARNBACK_BRIEF_NEED = 1
export const EARNBACK_SITES_NEED = 2
/** 回归包宽松任务单个奖励 */
export const RETURN_TASK_XP = 20
/** 图鉴全满一次性追加 */
export const CATALOG_BONUS_XP = 40
/** 赛季里程碑等级（到达发冻结卡） */
export const SEASON_MILESTONE_LEVELS = [5, 10, 15, 20] as const
/** 全部成长功能键（图鉴口径，含 v2 新增的 brief_read） */
export const FEATURES = Object.keys(FEATURE_META) as GrowthFeature[]
export const FREEZE_CONVERT_XP = 20
export const FREEZE_CHEST_FULL_XP = 25

export interface LevelDef {
  level: number
  title: string
  xp: number
}

/** 四阶进位：猫爪（1–4）→ 铃铛（5–8）→ 鱼干（9–12）→ 猫冠（13–16），阶内数 = 点亮枚数 */
export type LevelTierKind = 'paw' | 'bell' | 'fish' | 'crown'
export const LEVEL_TIER_LABEL: Record<LevelTierKind, string> = {
  paw: '猫爪',
  bell: '铃铛',
  fish: '鱼干',
  crown: '猫冠',
}

export function levelTier(level: number): { kind: LevelTierKind; count: number } {
  if (level <= 4) return { kind: 'paw', count: level }
  if (level <= 8) return { kind: 'bell', count: level - 4 }
  if (level <= 12) return { kind: 'fish', count: level - 8 }
  return { kind: 'crown', count: level - 12 }
}

export const LEVELS: LevelDef[] = [
  { level: 1, title: '初来乍到小奶猫', xp: 0 },
  { level: 2, title: '好奇小猫', xp: 60 },
  { level: 3, title: '探险小猫', xp: 180 },
  { level: 4, title: '铃铛收藏家', xp: 360 },
  { level: 5, title: '夜行捕手', xp: 600 },
  { level: 6, title: '云端漫游猫', xp: 950 },
  { level: 7, title: '星空领航猫', xp: 1400 },
  { level: 8, title: '传说大猫猫', xp: 2000 },
  { level: 9, title: '浅滩试水猫', xp: 2900 },
  { level: 10, title: '鱼干品鉴师', xp: 4000 },
  { level: 11, title: '深海垂钓猫', xp: 5300 },
  { level: 12, title: '月光守夜猫', xp: 6800 },
  { level: 13, title: '云端长老猫', xp: 8500 },
  { level: 14, title: '星图绘制者', xp: 10500 },
  { level: 15, title: '银河放牧猫', xp: 13000 },
  { level: 16, title: '导航守护神猫', xp: 16000 },
]

/* ---------------- 日期口径（04:00 切日） ---------------- */

/** 本地时区的 YYYY-MM-DD（00:00 口径，仅保留给旧调用方与日期工具） */
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

/* ---------------- 档案结构（v2） ---------------- */

export type DayState = 'lit' | 'frozen' | 'rest' | 'rescued'

export interface GrowthDay {
  /** 当日总入账（使用类 + 任务类 + 固定类） */
  xp: number
  /** 当日赛季类发放（不镜像 SP 的那部分），换季重建 SP 时剔除 */
  seasonXp: number
  /** 每日到访 +5 是否已发放（与「是否点亮」分离：任何动作都会点亮，但到访分只认此标记） */
  visitGranted: boolean
  /** 当日使用类入账（吃倍率后），300 上限记账用 */
  usageXp: number
  /** 当日任务类入账（不吃倍率、不计入使用上限） */
  taskXp: number
  counts: Partial<Record<GrowthFeature, number>>
  idleMinutes: number
  /** 当日打开过的不同站点 key（同站同日硬化 + 任务计数） */
  sitesOpened: string[]
  /** 当日到访过的不同一级分类（周/赛季任务派生用） */
  categoriesVisited: string[]
  /** 当日首次到访的新分类（沉淀槽判定用） */
  newCategories: string[]
  /** 当日搜索过的词（核心任务「换个问法」的新词判定） */
  searchTerms: string[]
  /** 当日页面到访标记（如 'hot' 热榜页） */
  pageVisits: string[]
  /** 当日过净增锁的收藏数 */
  favRewarded: number
  /** 当日新开的剧（追剧清单新增条目）计数 */
  watchlistNew: number
  /** 当日新增自定义站点数 */
  customSiteAdded: number
  /** 当日每日任务槽位（首次结算时定格） */
  dailySlots: { shallow: string; coreA: string; coreB: string; settle: string } | null
  /** 当日已发放的每日任务槽（'shallow' | 'core' | 'settle'） */
  dailyGranted: string[]
  chestGranted: boolean
  /** 当日是否到访过赛季主题专区（成长页赛季区） */
  seasonZoneVisit: boolean
}

export interface EarnBackState {
  /** 断签时被中断的连胜天数 */
  brokenStreak: number
  /** 断掉的连胜段起始日（抢救成功后恢复链锚点用） */
  chainStartKey: string
  chainSupplyGiven: number
  /** 抢救窗开启时刻 / 截止时刻（ISO） */
  openedAt: string
  deadline: string
  /** 开启时刻的动作计数快照（完成判定 = 增量） */
  briefAtOpen: number
  siteOpensAtOpen: number
}

export interface SeasonState {
  index: number
  /** 赛季积分（赛季内成长值镜像，赛季奖励类发放不镜像防自循环） */
  sp: number
  tasksGranted: string[]
  /** 已发放小奖的最高赛季等级 */
  levelGranted: number
  /** 已发放的里程碑等级（5/10/15/20，冻结卡） */
  milestonesGranted: number[]
  /** 已发放的漫游节点数 */
  roamingGranted: number
  /** 已发放的事件任务（'eventId:taskId'） */
  eventGranted: string[]
  /** 已发放的季中 SP 里程碑（sp 门槛值） */
  midMilestonesGranted: number[]
  /** S8 共建者：已确认的投稿收录数（P1 由服务端钩子写入，本地无自动来源） */
  contributionApproved: number
}

export interface SeasonFootprint {
  index: number
  sp: number
  level: number
  roamingNodes: number
  endedKey: string
}

export interface GrowthNotice {
  id: string
  kind: 'freeze' | 'earnback' | 'broken' | 'return'
  text: string
  key: string
  deadline?: string
}

export interface GrowthProfile {
  v: 2
  totalXp: number
  /** 「设为首页」领取后的加速档是否开启（= 身份档 ×1.5 的来源之一，兼容 v1 字段） */
  boost: boolean
  homepageClaimedAt: string | null
  pwaInstalledAt: string | null
  /** 曾探测到登录态（身份档 ×1.2 的来源，GrowthTracker 每次挂载刷新） */
  memberSeen: boolean
  createdAt: string
  days: Record<string, GrowthDay>
  features: Partial<Record<GrowthFeature, { count: number; firstDate: string }>>
  categories: string[]
  scenes: string[]
  /** 真实点亮日（到访日）key 列表 */
  activeDates: string[]
  dramaDates: string[]
  idleTotalMinutes: number
  /** 每日状态（连胜结算写入）：点亮/垫付/休息/抢救 */
  dayStates: Record<string, DayState>
  /** 连胜链锚点：当前链起始日 + 本链已发周期补给数；无链为 null */
  streakChain: { startKey: string; supplyGiven: number } | null
  /** 连胜结算到的最后一个成长日（该日及之前已判定完毕） */
  streakSettledThrough: string | null
  freezeCards: number
  freezeGiftLevel3: boolean
  /** 每周休息日（0=周日…6=周六），null = 未设置 */
  restWeekday: number | null
  restChangedKey: string | null
  earnBack: EarnBackState | null
  /** Earn Back 成功使用的日期（滚动 30 天至多 1 次） */
  earnBackUses: string[]
  longestStreak: number
  pureLongestStreak: number
  /** 收藏净增锁：终身只给 1 次收藏分的站点 id */
  rewardedFavIds: string[]
  /** 生涯打开过的不同站点 key（百站寻宝） */
  sitesOpened: string[]
  weeks: Record<string, { granted: string[] }>
  season: SeasonState
  seasonHistory: SeasonFootprint[]
  /** 回归包（断档 ≥30 天触发）：7 天窗口内的宽松任务链 */
  returnPack: { startKey: string; granted: string[] } | null
  lastReturnPackKey: string | null
  /** 初代传说：v2 上线前已达 Lv8 的绝版纪念 */
  pioneerLegend: boolean
  /** v1 迁移时按旧口径快照的已得徽章 id（并轨保权益用，新用户为空） */
  legacyBadgeIds: string[]
  catalogBonusGranted: boolean
  /** 里程碑日（升级日/连胜里程碑日），热力图金格 */
  milestoneDays: string[]
  /** 宝箱连空计数（连空保底：连续未出卡次数） */
  chestNoCardStreak: number
  /** 新手链 D6：是否已看过自己的成长档案 */
  rookiePanelSeen: boolean
  lastSeenLevel: number
  pendingNotices: GrowthNotice[]
  lastActiveKey: string | null
}

function emptyDay(): GrowthDay {
  return {
    xp: 0,
    seasonXp: 0,
    visitGranted: false,
    usageXp: 0,
    taskXp: 0,
    counts: {},
    idleMinutes: 0,
    sitesOpened: [],
    categoriesVisited: [],
    newCategories: [],
    searchTerms: [],
    pageVisits: [],
    favRewarded: 0,
    watchlistNew: 0,
    customSiteAdded: 0,
    dailySlots: null,
    dailyGranted: [],
    chestGranted: false,
    seasonZoneVisit: false,
  }
}

function emptySeason(index: number): SeasonState {
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

/* ---------------- 赛季历法 ---------------- */

export interface SeasonCalendar {
  index: number
  /** 本季第几天（1 起） */
  dayOfSeason: number
  startKey: string
  endKey: string
}

export function seasonCalendar(now: Date = new Date()): SeasonCalendar {
  const today = growthDayKey(now)
  const diff = keyDiffDays(SEASON_EPOCH_KEY, today)
  const index = Math.max(0, Math.floor(diff / SEASON_LENGTH_DAYS))
  const startKey = keyAddDays(SEASON_EPOCH_KEY, index * SEASON_LENGTH_DAYS)
  return { index, dayOfSeason: diff - index * SEASON_LENGTH_DAYS + 1, startKey, endKey: keyAddDays(startKey, SEASON_LENGTH_DAYS - 1) }
}

export function seasonLevelOf(sp: number): number {
  return Math.min(SEASON_LEVEL_COUNT, Math.floor(sp / SEASON_SP_PER_LEVEL))
}

export function roamingNodesOf(sp: number): number {
  const over = sp - SEASON_LEVEL_COUNT * SEASON_SP_PER_LEVEL
  return over > 0 ? Math.floor(over / ROAMING_SP_PER_NODE) : 0
}

/* ---------------- 档案解析与 v1→v2 迁移 ---------------- */

function num(x: unknown, fallback = 0): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : fallback
}

function strArr(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []
}

function parseDay(raw: unknown): GrowthDay {
  const base = emptyDay()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const d = raw as Record<string, unknown>
  const counts: GrowthDay['counts'] = {}
  if (d.counts && typeof d.counts === 'object' && !Array.isArray(d.counts)) {
    for (const [k, v] of Object.entries(d.counts as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) counts[k as GrowthFeature] = Math.floor(v)
    }
  }
  const slots = d.dailySlots as GrowthDay['dailySlots']
  return {
    xp: num(d.xp),
    seasonXp: num(d.seasonXp),
    visitGranted: d.visitGranted === true,
    // v1 的天记录没有使用/任务拆分：usageXp 按 xp 全额估（只影响历史展示，不回溯封顶）
    usageXp: typeof d.usageXp === 'number' ? num(d.usageXp) : num(d.xp),
    taskXp: num(d.taskXp),
    counts,
    idleMinutes: num(d.idleMinutes),
    sitesOpened: strArr(d.sitesOpened),
    categoriesVisited: strArr(d.categoriesVisited),
    newCategories: strArr(d.newCategories),
    searchTerms: strArr(d.searchTerms),
    pageVisits: strArr(d.pageVisits),
    favRewarded: num(d.favRewarded),
    watchlistNew: num(d.watchlistNew),
    customSiteAdded: num(d.customSiteAdded),
    dailySlots:
      slots && typeof slots === 'object' && typeof slots.shallow === 'string'
        ? { shallow: slots.shallow, coreA: String(slots.coreA ?? ''), coreB: String(slots.coreB ?? ''), settle: String(slots.settle ?? '') }
        : null,
    dailyGranted: strArr(d.dailyGranted),
    chestGranted: d.chestGranted === true,
    seasonZoneVisit: d.seasonZoneVisit === true,
  }
}

/** 连续段扫描：返回历史最长连胜 / 最长真连胜（只认已落账的日状态，休息日透明） */
export function scanStreakExtremes(profile: Pick<GrowthProfile, 'dayStates' | 'activeDates'>): { longest: number; pureLongest: number } {
  const keys = new Set<string>([...Object.keys(profile.dayStates), ...profile.activeDates])
  if (keys.size === 0) return { longest: 0, pureLongest: 0 }
  const sorted = [...keys].sort()
  let cursor = sorted[0]!
  const end = sorted[sorted.length - 1]!
  let cur = 0
  let pureCur = 0
  let longest = 0
  let pureLongest = 0
  while (cursor <= end) {
    const s = profile.dayStates[cursor] ?? (profile.activeDates.includes(cursor) ? 'lit' : undefined)
    if (s === 'lit') {
      cur += 1
      pureCur += 1
    } else if (s === 'frozen' || s === 'rescued') {
      cur += 1
      pureCur = 0
    } else if (s === 'rest') {
      /* 透明：不断不计 */
    } else {
      cur = 0
      pureCur = 0
    }
    longest = Math.max(longest, cur)
    pureLongest = Math.max(pureLongest, pureCur)
    cursor = keyAddDays(cursor, 1)
  }
  return { longest, pureLongest }
}

/**
 * 解析存储原始值（v1 与 v2 都收）：坏数据回空档案；v1 形状在此完成字段级
 * 迁移（原样保留总经验/等级，activeDates 映射为点亮日）。真正的备份落盘与
 * 结算在 loadGrowthProfile 里做——本函数保持纯函数、可单测。
 */
export function parseGrowthProfile(raw: string | null, now: Date = new Date()): GrowthProfile {
  const base = emptyProfile(now)
  if (!raw) return base
  let p: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base
    p = parsed as Record<string, unknown>
  } catch {
    return base
  }
  const isV1 = p.v !== 2
  const days: Record<string, GrowthDay> = {}
  if (p.days && typeof p.days === 'object' && !Array.isArray(p.days)) {
    for (const [k, v] of Object.entries(p.days as Record<string, unknown>)) days[k] = parseDay(v)
  }
  const features: GrowthProfile['features'] = {}
  if (p.features && typeof p.features === 'object' && !Array.isArray(p.features)) {
    for (const [k, v] of Object.entries(p.features as Record<string, unknown>)) {
      const f = v as { count?: unknown; firstDate?: unknown }
      features[k as GrowthFeature] = {
        count: num(f?.count),
        firstDate: typeof f?.firstDate === 'string' ? f.firstDate : growthDayKey(now),
      }
    }
  }
  const weeks: GrowthProfile['weeks'] = {}
  if (p.weeks && typeof p.weeks === 'object' && !Array.isArray(p.weeks)) {
    for (const [k, v] of Object.entries(p.weeks as Record<string, unknown>)) {
      const w = v as { granted?: unknown }
      weeks[k] = { granted: strArr(w?.granted) }
    }
  }
  const seasonHistory: SeasonFootprint[] = []
  if (Array.isArray(p.seasonHistory)) {
    for (const item of p.seasonHistory as Record<string, unknown>[]) {
      if (item && typeof item === 'object' && typeof item.endedKey === 'string') {
        seasonHistory.push({
          index: num(item.index),
          sp: num(item.sp),
          level: num(item.level),
          roamingNodes: num(item.roamingNodes),
          endedKey: item.endedKey,
        })
      }
    }
  }
  const pendingNotices: GrowthNotice[] = []
  if (Array.isArray(p.pendingNotices)) {
    for (const item of p.pendingNotices as Record<string, unknown>[]) {
      if (item && typeof item === 'object' && typeof item.id === 'string' && typeof item.text === 'string') {
        pendingNotices.push({
          id: item.id,
          kind: (['freeze', 'earnback', 'broken', 'return'] as const).includes(item.kind as GrowthNotice['kind'])
            ? (item.kind as GrowthNotice['kind'])
            : 'broken',
          text: item.text,
          key: typeof item.key === 'string' ? item.key : '',
          deadline: typeof item.deadline === 'string' ? item.deadline : undefined,
        })
      }
    }
  }
  const returnPackRaw = (p.returnPack && typeof p.returnPack === 'object' ? p.returnPack : null) as { startKey?: unknown; granted?: unknown } | null
  const activeDates = strArr(p.activeDates)
  // v1 迁移：旧 activeDates（00:00 口径）按「同名窗口」映射为点亮日，只多不少
  const dayStates: Record<string, DayState> = {}
  if (p.dayStates && typeof p.dayStates === 'object' && !Array.isArray(p.dayStates)) {
    for (const [k, v] of Object.entries(p.dayStates as Record<string, unknown>)) {
      if (v === 'lit' || v === 'frozen' || v === 'rest' || v === 'rescued') dayStates[k] = v
    }
  }
  if (isV1) {
    for (const k of activeDates) if (!dayStates[k]) dayStates[k] = 'lit'
  }
  const totalXp = num(p.totalXp)
  const seasonRaw = (p.season && typeof p.season === 'object' ? p.season : {}) as Record<string, unknown>
  const profile: GrowthProfile = {
    ...base,
    totalXp,
    boost: p.boost === true,
    homepageClaimedAt: typeof p.homepageClaimedAt === 'string' ? p.homepageClaimedAt : null,
    pwaInstalledAt: typeof p.pwaInstalledAt === 'string' ? p.pwaInstalledAt : null,
    memberSeen: p.memberSeen === true,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : base.createdAt,
    days,
    features,
    categories: strArr(p.categories),
    scenes: strArr(p.scenes),
    activeDates,
    dramaDates: strArr(p.dramaDates),
    idleTotalMinutes: num(p.idleTotalMinutes),
    dayStates,
    streakChain:
      p.streakChain && typeof p.streakChain === 'object' && typeof (p.streakChain as { startKey?: unknown }).startKey === 'string'
        ? { startKey: (p.streakChain as { startKey: string }).startKey, supplyGiven: num((p.streakChain as { supplyGiven?: unknown }).supplyGiven) }
        : null,
    streakSettledThrough: typeof p.streakSettledThrough === 'string' ? p.streakSettledThrough : null,
    freezeCards: num(p.freezeCards),
    freezeGiftLevel3: p.freezeGiftLevel3 === true,
    restWeekday: typeof p.restWeekday === 'number' && p.restWeekday >= 0 && p.restWeekday <= 6 ? p.restWeekday : null,
    restChangedKey: typeof p.restChangedKey === 'string' ? p.restChangedKey : null,
    earnBack: (() => {
      if (isV1) return null
      const e = p.earnBack as EarnBackState | null
      if (!e || typeof e !== 'object' || typeof e.deadline !== 'string' || typeof e.chainStartKey !== 'string') return null
      return {
        brokenStreak: num(e.brokenStreak),
        chainStartKey: e.chainStartKey,
        chainSupplyGiven: num(e.chainSupplyGiven),
        openedAt: typeof e.openedAt === 'string' ? e.openedAt : '',
        deadline: e.deadline,
        briefAtOpen: num(e.briefAtOpen),
        siteOpensAtOpen: num(e.siteOpensAtOpen),
      }
    })(),
    earnBackUses: strArr(p.earnBackUses),
    rewardedFavIds: strArr(p.rewardedFavIds),
    sitesOpened: strArr(p.sitesOpened),
    season: isV1
      ? emptySeason(seasonCalendar(now).index)
      : {
          index: num(seasonRaw.index),
          sp: num(seasonRaw.sp),
          tasksGranted: strArr(seasonRaw.tasksGranted),
          levelGranted: num(seasonRaw.levelGranted),
          milestonesGranted: Array.isArray(seasonRaw.milestonesGranted)
            ? (seasonRaw.milestonesGranted as unknown[]).filter((x): x is number => typeof x === 'number')
            : [],
          roamingGranted: num(seasonRaw.roamingGranted),
          eventGranted: strArr(seasonRaw.eventGranted),
          midMilestonesGranted: Array.isArray(seasonRaw.midMilestonesGranted)
            ? (seasonRaw.midMilestonesGranted as unknown[]).filter((x): x is number => typeof x === 'number')
            : [],
          contributionApproved: num(seasonRaw.contributionApproved),
        },
    pioneerLegend: p.pioneerLegend === true,
    legacyBadgeIds: strArr(p.legacyBadgeIds),
    catalogBonusGranted: p.catalogBonusGranted === true,
    weeks,
    seasonHistory,
    returnPack:
      returnPackRaw && typeof returnPackRaw.startKey === 'string'
        ? { startKey: returnPackRaw.startKey, granted: strArr(returnPackRaw.granted) }
        : null,
    lastReturnPackKey: typeof p.lastReturnPackKey === 'string' ? p.lastReturnPackKey : null,
    milestoneDays: strArr(p.milestoneDays),
    chestNoCardStreak: num(p.chestNoCardStreak),
    rookiePanelSeen: p.rookiePanelSeen === true,
    pendingNotices,
    lastSeenLevel: Math.max(1, num(p.lastSeenLevel, 1)),
    lastActiveKey: typeof p.lastActiveKey === 'string' ? p.lastActiveKey : (activeDates[activeDates.length - 1] ?? null),
  }
  if (isV1) {
    // 收藏净增锁回填：v1 没有逐站记录，用「收藏过的站」不可知——以 features 计数
    // 无法反推具体站点，净增锁从迁移日起对新收藏生效（老收藏重复加分窗口仅存于
    // 「迁移前已收藏、迁移后取消再加」这一条路径，如实接受并在方案回报中登记）
    const extremes = scanStreakExtremes(profile)
    profile.longestStreak = extremes.longest
    profile.pureLongestStreak = extremes.pureLongest
    // 迁移时已达 Lv8（旧满级）→ 绝版纪念「初代传说」
    profile.pioneerLegend = totalXp >= (LEVELS[7]?.xp ?? 2000)
    // 当前链锚点：无条件锚到「最后活跃日结尾的连续段」起点——哪怕昨天已缺席，
    // 也交给随后的 settleStreak 统一走账判定（垫付/抢救/断链），不在迁移层静默丢链
    if (activeDates.length > 0) {
      const last = activeDates[activeDates.length - 1]!
      let start = last
      while (dayStates[keyAddDays(start, -1)] === 'lit') start = keyAddDays(start, -1)
      profile.streakChain = { startKey: start, supplyGiven: Math.floor(keyDiffDays(start, last) / 7) }
      profile.streakSettledThrough = last
      profile.lastActiveKey = last
    }
    // 赛季 SP 按天记录重建（v1 天记录的 xp 即当季入账，赛季奖励类当时不存在，口径精确）
    const cal = seasonCalendar(now)
    let sp = 0
    for (const [k, d] of Object.entries(days)) {
      if (k >= cal.startKey && k <= cal.endKey) sp += d.xp
    }
    profile.season = { ...emptySeason(cal.index), sp }
    profile.freezeGiftLevel3 = totalXp >= (LEVELS[2]?.xp ?? 180)
    profile.lastSeenLevel = levelProgress(totalXp).level
    profile.legacyBadgeIds = computeV1LegacyBadges(profile, now)
  } else {
    const extremes = scanStreakExtremes(profile)
    profile.longestStreak = Math.max(num(p.longestStreak), extremes.longest)
    profile.pureLongestStreak = Math.max(num(p.pureLongestStreak), extremes.pureLongest)
  }
  // 防未来日期入账（对抗自审 #5）：合法记录的 key 永远 ≤ 当前成长日，
  // 超出的天记录/日期一律丢弃，并同步钳制所有日期指针（防时钟回拨后指针悬空坏链）
  const today = growthDayKey(now)
  for (const k of Object.keys(profile.days)) if (k > today) delete profile.days[k]
  profile.activeDates = profile.activeDates.filter((k) => k <= today)
  for (const k of Object.keys(profile.dayStates)) if (k > today) delete profile.dayStates[k]
  if (profile.streakSettledThrough && profile.streakSettledThrough > today) {
    // 结算点只能到昨天：钳到 today 的话，未点亮的今天会让 chainLengthThrough 误判断链
    const yesterdayKey = keyAddDays(today, -1)
    profile.streakSettledThrough =
      profile.lastActiveKey && profile.lastActiveKey <= yesterdayKey ? profile.lastActiveKey : null
  }
  if (profile.lastActiveKey && profile.lastActiveKey > today) {
    profile.lastActiveKey = profile.activeDates[profile.activeDates.length - 1] ?? null
  }
  if (profile.streakChain && profile.streakChain.startKey > today) profile.streakChain = null
  profile.milestoneDays = profile.milestoneDays.filter((k) => k <= today)
  profile.earnBackUses = profile.earnBackUses.filter((k) => k <= today)
  if (profile.returnPack && profile.returnPack.startKey > today) profile.returnPack = null
  if (profile.lastReturnPackKey && profile.lastReturnPackKey > today) profile.lastReturnPackKey = null
  return profile
}

/** 原始存储是否为 v1 档案（迁移备份判定用） */
export function isV1Raw(raw: string | null): boolean {
  if (!raw) return false
  try {
    const p = JSON.parse(raw) as { v?: unknown }
    return !!p && typeof p === 'object' && p.v !== 2
  } catch {
    return false
  }
}

/* ---------------- 等级 ---------------- */

export interface LevelProgress {
  level: number
  title: string
  /** 本级门槛经验（= v1 接口 floorXp） */
  floorXp: number
  /** 下一级门槛经验，满级为 null */
  nextXp: number | null
  nextLevel: number | null
  nextTitle: string | null
  toNext: number
  progress: number
}

export function levelProgress(totalXp: number): LevelProgress {
  let idx = 0
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (totalXp >= (LEVELS[i]?.xp ?? 0)) idx = i
  }
  const cur = LEVELS[idx]!
  const next = LEVELS[idx + 1] ?? null
  const span = next ? next.xp - cur.xp : 0
  return {
    level: cur.level,
    title: cur.title,
    floorXp: cur.xp,
    nextXp: next ? next.xp : null,
    nextLevel: next ? next.level : null,
    nextTitle: next ? next.title : null,
    toNext: next ? next.xp - totalXp : 0,
    progress: next ? Math.min(1, Math.max(0, (totalXp - cur.xp) / span)) : 1,
  }
}

/* ---------------- 连胜（按日状态派生） ---------------- */

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

/* ---------------- 倍率（v2 表 2.2） ---------------- */

/** 身份档：基础 ×1.0 / 登录 ×1.2 / 设首页或装为应用 ×1.5（取高不叠；boost 为 v1 兼容来源） */
export function identityMultiplier(profile: GrowthProfile): number {
  if (profile.boost || profile.homepageClaimedAt || profile.pwaInstalledAt) return IDENTITY_TIER.homeOrPwa
  if (profile.memberSeen) return IDENTITY_TIER.member
  return IDENTITY_TIER.base
}

/** 连胜加成：当前连胜（含今日已点亮）每满 7 天 +0.1，封顶 +0.3——与面板展示的连胜数同口径 */
export function streakBonus(profile: GrowthProfile, now: Date = new Date()): number {
  return Math.min(STREAK_BONUS_CAP, Math.floor(currentStreak(profile, now) / 7) * 0.1)
}

export function currentMultiplier(profile: GrowthProfile, now: Date = new Date()): number {
  // 一位小数口径：先按 0.1 步进取整再封顶，消除浮点尾差（1.5 + 0.3 ≠ 1.8000000000000003）
  return Math.min(MULTIPLIER_CAP, Math.round((identityMultiplier(profile) + streakBonus(profile, now)) * 10) / 10)
}

/* ---------------- 入账内核 ---------------- */

function cloneProfile(p: GrowthProfile): GrowthProfile {
  return JSON.parse(JSON.stringify(p)) as GrowthProfile
}

function dayOf(profile: GrowthProfile, key: string): GrowthDay {
  const existing = profile.days[key]
  if (existing) return existing
  const created = emptyDay()
  profile.days[key] = created
  return created
}

export type XpClass = 'usage' | 'task' | 'fixed' | 'season'

/**
 * 统一入账：totalXp / 当日 xp / 拆分账 / 赛季 SP 镜像。
 * kind='season' 的发放（赛季等级小奖、漫游奖、季中里程碑）不镜像进 SP，防自循环，
 * 单独记 day.seasonXp 供换季重建时剔除；其余类只在「入账日属于档案当前赛季窗口」
 * 时镜像——跨季未结算时先落 days，换季重建会精确归入新赛季，不污染旧季足迹。
 */
function addXp(profile: GrowthProfile, day: GrowthDay, amount: number, kind: XpClass): void {
  if (amount <= 0) return
  profile.totalXp += amount
  day.xp += amount
  if (kind === 'usage') day.usageXp += amount
  if (kind === 'task') day.taskXp += amount
  if (kind === 'season') {
    day.seasonXp += amount
    return
  }
  const dayKey = Object.keys(profile.days).find((k) => profile.days[k] === day)
  const seasonStart = keyAddDays(SEASON_EPOCH_KEY, profile.season.index * SEASON_LENGTH_DAYS)
  const seasonEnd = keyAddDays(seasonStart, SEASON_LENGTH_DAYS - 1)
  if (dayKey && dayKey >= seasonStart && dayKey <= seasonEnd) profile.season.sp += amount
}

/** 发一张冻结卡；库存满则转 +20 成长值（默认任务类镜像 SP；赛季来源传 'season' 不镜像）。返回 'card' | 'converted' */
export function grantFreezeCard(profile: GrowthProfile, day: GrowthDay, xpKind: XpClass = 'task'): 'card' | 'converted' {
  const cap = levelProgress(profile.totalXp).level >= FREEZE_CAP_HIGH_LEVEL ? FREEZE_CAP_HIGH : FREEZE_CAP_LOW
  if (profile.freezeCards < cap) {
    profile.freezeCards += 1
    return 'card'
  }
  addXp(profile, day, FREEZE_CONVERT_XP, xpKind)
  return 'converted'
}

/** 标记今日真实活跃（到访点亮）：任何入账动作都会点亮当日 */
function markActive(profile: GrowthProfile, key: string): void {
  if (!profile.activeDates.includes(key)) profile.activeDates.push(key)
  if (!profile.dayStates[key]) profile.dayStates[key] = 'lit'
  if (!profile.lastActiveKey || key > profile.lastActiveKey) profile.lastActiveKey = key
}

/* ---------------- 功能曲线与入账（v2 表 2.1） ---------------- */

export interface AwardOpts {
  categoryId?: string
  sceneId?: string  /** 收藏的站点 id（净增锁） */
  siteId?: string
  /** 打开站点的规范化 URL key（同站同日硬化 / 百站寻宝） */
  siteKey?: string
  /** 搜索词（每日核心任务「换个问法」的新词判定） */
  term?: string
  /** 追剧清单新增一条剧（与进度推进区分） */
  newDrama?: boolean
}

/** 入账结果（v1 接口保留） */
export interface AwardResult {
  profile: GrowthProfile
  gained: number
}

export function awardEvent(
  input: GrowthProfile,
  kind: GrowthFeature,
  opts: AwardOpts = {},
  now: Date = new Date(),
): { profile: GrowthProfile; gained: number } {
  const profile = cloneProfile(input)
  const key = growthDayKey(now)
  const day = dayOf(profile, key)
  // 收藏净增锁：同一站点终身只给 1 次收藏分，重复加/取消再加一律 0 分且不计任何计数
  if (kind === 'favorite_add' && opts.siteId && profile.rewardedFavIds.includes(opts.siteId)) {
    return { profile, gained: 0 }
  }
  // 同站同日硬化（与净增锁同口径）：同一站点当日已打开过 → 0 分且不计任何计数——
  // 否则连点会挤占当日新站的重复分窗口，还能凑满 Earn Back 的「打开 2 个站」
  if (kind === 'site_open' && opts.siteKey && (input.days[key]?.sitesOpened ?? []).includes(opts.siteKey)) {
    return { profile, gained: 0 }
  }
  markActive(profile, key)
  const rec = profile.features[kind]
  const firstEver = !rec
  const prevCount = rec?.count ?? 0
  profile.features[kind] = { count: prevCount + 1, firstDate: rec?.firstDate ?? key }
  const todayCount = (day.counts[kind] ?? 0) + 1
  day.counts[kind] = todayCount

  let newCategory = false
  if (kind === 'category_visit') {
    if (opts.categoryId) {
      if (!day.categoriesVisited.includes(opts.categoryId)) day.categoriesVisited.push(opts.categoryId)
      if (!profile.categories.includes(opts.categoryId)) {
        profile.categories.push(opts.categoryId)
        newCategory = true
        if (!day.newCategories.includes(opts.categoryId)) day.newCategories.push(opts.categoryId)
      }
    }
  }
  if (kind === 'scene_open' && opts.sceneId && !profile.scenes.includes(opts.sceneId)) {
    profile.scenes.push(opts.sceneId)
  }
  if (kind === 'drama_visit' && !profile.dramaDates.includes(key)) {
    profile.dramaDates.push(key)
  }
  if (kind === 'site_open' && opts.siteKey) {
    if (!profile.sitesOpened.includes(opts.siteKey)) profile.sitesOpened.push(opts.siteKey)
    if (!day.sitesOpened.includes(opts.siteKey)) day.sitesOpened.push(opts.siteKey)
  }
  if (kind === 'search' && opts.term) {
    const term = opts.term.trim().slice(0, 40)
    if (term && !day.searchTerms.includes(term)) day.searchTerms.push(term)
  }
  if (kind === 'favorite_add') {
    if (opts.siteId) profile.rewardedFavIds.push(opts.siteId)
    day.favRewarded += 1
  }
  if (kind === 'watchlist_progress' && opts.newDrama) day.watchlistNew += 1

  // 基础分（v2 表 2.1；分类探索与 v1 同语义：当日曲线被新分类分替换）
  let base: number
  if (newCategory) {
    base = CATEGORY_NEW_XP + (firstEver ? FEATURE_FIRST_EVER_XP : 0)
  } else if (firstEver) {
    base = FEATURE_FIRST_EVER_XP + DAILY_FIRST_XP
  } else if (todayCount === 1) {
    base = DAILY_FIRST_XP
  } else if (todayCount <= REPEAT_LIMIT) {
    base = REPEAT_XP
  } else {
    base = 0
  }
  if (base <= 0) return { profile, gained: 0 }
  const mult = currentMultiplier(profile, now)
  let gained = Math.round(base * mult)
  const room = USAGE_DAILY_CAP - day.usageXp
  gained = Math.max(0, Math.min(gained, room))
  addXp(profile, day, gained, 'usage')
  return { profile, gained }
}

/** 挂机一分钟：前台停留，每分钟 +1（吃倍率、floor 取整保手感），每日原始分钟封顶 30 */
export function awardIdleMinute(input: GrowthProfile, now: Date = new Date()): { profile: GrowthProfile; gained: number } {
  const profile = cloneProfile(input)
  const key = growthDayKey(now)
  const day = dayOf(profile, key)
  markActive(profile, key)
  if (day.idleMinutes >= IDLE_DAILY_CAP_MINUTES) return { profile, gained: 0 }
  day.idleMinutes += 1
  profile.idleTotalMinutes += 1
  const room = USAGE_DAILY_CAP - day.usageXp
  const gained = Math.max(0, Math.min(Math.floor(1 * currentMultiplier(profile, now)), room))
  addXp(profile, day, gained, 'usage')
  return { profile, gained }
}

/** 每日到访：每天第一次 +5（使用类，吃倍率）。是否已发只认 day.visitGranted——
 * 其他动作也会 markActive 点亮当日，不能用 activeDates 判到访分（会吞分） */
export function recordDailyVisit(input: GrowthProfile, now: Date = new Date()): { profile: GrowthProfile; gained: number; isNewDay: boolean } {
  const profile = cloneProfile(input)
  const key = growthDayKey(now)
  markActive(profile, key)
  const day = dayOf(profile, key)
  // isNewDay 与到访分同口径：以 visitGranted 为准（其他动作先点亮不算「已到访」）
  const isNewDay = !day.visitGranted
  if (day.visitGranted) return { profile, gained: 0, isNewDay }
  day.visitGranted = true
  const room = USAGE_DAILY_CAP - day.usageXp
  const gained = Math.max(0, Math.min(Math.round(DAILY_VISIT_XP * currentMultiplier(profile, now)), room))
  addXp(profile, day, gained, 'usage')
  return { profile, gained, isNewDay }
}

/** 设为首页：+100 一次性（不吃倍率），并开启 ×1.5 身份档 */
export function claimHomepageReward(input: GrowthProfile, now: Date = new Date()): { profile: GrowthProfile; gained: number } {
  const profile = cloneProfile(input)
  if (profile.homepageClaimedAt) return { profile, gained: 0 }
  const key = growthDayKey(now)
  const day = dayOf(profile, key)
  markActive(profile, key)
  profile.homepageClaimedAt = now.toISOString()
  profile.boost = true
  addXp(profile, day, HOMEPAGE_CLAIM_XP, 'fixed')
  return { profile, gained: HOMEPAGE_CLAIM_XP }
}

/** 装为应用（PWA 真实安装事件）：+60 一次性（不吃倍率），开启 ×1.5 身份档 */
export function claimPwaInstall(input: GrowthProfile, now: Date = new Date()): { profile: GrowthProfile; gained: number } {
  const profile = cloneProfile(input)
  if (profile.pwaInstalledAt) return { profile, gained: 0 }
  const key = growthDayKey(now)
  const day = dayOf(profile, key)
  markActive(profile, key)
  profile.pwaInstalledAt = now.toISOString()
  profile.boost = true // 与设首页同为 ×1.5 身份档来源，兼容 v1 的 boost 语义
  addXp(profile, day, PWA_CLAIM_XP, 'fixed')
  return { profile, gained: PWA_CLAIM_XP }
}

/** 新增自定义站点（沉淀槽信号）：无直接分，只记账给任务判定 */
export function recordCustomSiteAdded(input: GrowthProfile, now: Date = new Date()): { profile: GrowthProfile; gained: number } {
  const profile = cloneProfile(input)
  const key = growthDayKey(now)
  const day = dayOf(profile, key)
  markActive(profile, key)
  day.customSiteAdded += 1
  return { profile, gained: 0 }
}

/** 页面到访记账（如热榜页，浅层槽信号） */
export function recordPageVisit(input: GrowthProfile, page: string, now: Date = new Date()): { profile: GrowthProfile; gained: number } {
  const profile = cloneProfile(input)
  const key = growthDayKey(now)
  const day = dayOf(profile, key)
  markActive(profile, key)
  if (!day.pageVisits.includes(page)) day.pageVisits.push(page)
  return { profile, gained: 0 }
}

/** 赛季主题专区停留记账（赛季任务 S1 信号：用户中心成长页） */
export function recordSeasonZoneVisit(input: GrowthProfile, now: Date = new Date()): { profile: GrowthProfile; gained: number } {
  const profile = cloneProfile(input)
  const key = growthDayKey(now)
  const day = dayOf(profile, key)
  markActive(profile, key)
  day.seasonZoneVisit = true
  return { profile, gained: 0 }
}

export function todayXp(profile: GrowthProfile, now: Date = new Date()): number {
  return profile.days[growthDayKey(now)]?.xp ?? 0
}

export function todayUsageXp(profile: GrowthProfile, now: Date = new Date()): number {
  return profile.days[growthDayKey(now)]?.usageXp ?? 0
}

export function todayIdleMinutes(profile: GrowthProfile, now: Date = new Date()): number {
  return profile.days[growthDayKey(now)]?.idleMinutes ?? 0
}

/* ---------------- 任务层：定义与状态派生 ---------------- */

export interface DailyTaskDef {
  id: string
  title: string
  hint: string
  check: (day: GrowthDay) => boolean
}

const DAILY_SHALLOW: DailyTaskDef[] = [
  { id: 'sh-brief', title: '晨读简报', hint: '读一期今日简报', check: (d) => (d.counts.brief_read ?? 0) >= 1 },
  { id: 'sh-sites', title: '开两扇门', hint: '打开 2 个不同的站', check: (d) => d.sitesOpened.length >= 2 },
  { id: 'sh-hot', title: '看看热榜', hint: '逛一逛热榜页', check: (d) => d.pageVisits.includes('hot') },
]
const DAILY_CORE_AI: DailyTaskDef[] = [
  { id: 'core-ai-find', title: 'AI 寻站', hint: '用 AI 找一个站', check: (d) => (d.counts.ai_find ?? 0) >= 1 },
  { id: 'core-search', title: '换个问法', hint: '用一个新词搜一次', check: (d) => d.searchTerms.length >= 1 },
]
const DAILY_CORE_DRAMA: DailyTaskDef[] = [
  { id: 'core-drama-progress', title: '今晚这一集', hint: '推进一集追剧进度', check: (d) => (d.counts.watchlist_progress ?? 0) >= 1 },
  { id: 'core-drama-new', title: '先码住', hint: '把一部想看的剧加入清单', check: (d) => d.watchlistNew >= 1 },
]
const DAILY_SETTLE: DailyTaskDef[] = [
  { id: 'st-fav', title: '留个记号', hint: '收藏 1 个站', check: (d) => d.favRewarded >= 1 },
  { id: 'st-cat', title: '新大陆', hint: '逛一个没去过的分类', check: (d) => d.newCategories.length >= 1 },
  { id: 'st-custom', title: '添个自留地', hint: '添加 1 个自己的站', check: (d) => d.customSiteAdded >= 1 },
]

function hashKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h
}

/** 每日槽位分配：日期轮换 + 近 7 日行为偏向选核心主轨（另一轨作备选，任一完成即算） */
export function assignDailySlots(profile: GrowthProfile, key: string): NonNullable<GrowthDay['dailySlots']> {
  const h = hashKey(key)
  let aiOps = 0
  let dramaOps = 0
  for (let i = 1; i <= 7; i += 1) {
    const d = profile.days[keyAddDays(key, -i)]
    if (!d) continue
    aiOps += (d.counts.ai_find ?? 0) + (d.counts.ai_chat ?? 0) + (d.counts.search ?? 0)
    dramaOps += (d.counts.drama_visit ?? 0) + (d.counts.watchlist_progress ?? 0)
  }
  const aiMain = aiOps >= dramaOps
  const mainPool = aiMain ? DAILY_CORE_AI : DAILY_CORE_DRAMA
  const altPool = aiMain ? DAILY_CORE_DRAMA : DAILY_CORE_AI
  return {
    shallow: DAILY_SHALLOW[h % DAILY_SHALLOW.length]!.id,
    coreA: mainPool[h % mainPool.length]!.id,
    coreB: altPool[(h >> 2) % altPool.length]!.id,
    settle: DAILY_SETTLE[(h >> 3) % DAILY_SETTLE.length]!.id,
  }
}

function dailyDef(id: string): DailyTaskDef | undefined {
  return [...DAILY_SHALLOW, ...DAILY_CORE_AI, ...DAILY_CORE_DRAMA, ...DAILY_SETTLE].find((d) => d.id === id)
}

export interface DailySlotStatus {
  slot: 'shallow' | 'core' | 'settle'
  title: string
  hint: string
  done: boolean
  granted: boolean
}

export function dailyTaskStatus(profile: GrowthProfile, now: Date = new Date()): {
  slots: DailySlotStatus[]
  allDone: boolean
  chestOpened: boolean
  chestAvailable: boolean
} {
  const key = growthDayKey(now)
  const day = profile.days[key]
  const slotsDef = day?.dailySlots ?? assignDailySlots(profile, key)
  const blank = emptyDay()
  const d = day ?? blank
  const shallowDef = dailyDef(slotsDef.shallow)
  const coreADef = dailyDef(slotsDef.coreA)
  const coreBDef = dailyDef(slotsDef.coreB)
  const settleDef = dailyDef(slotsDef.settle)
  const slots: DailySlotStatus[] = [
    {
      slot: 'shallow',
      title: shallowDef?.title ?? '',
      hint: shallowDef?.hint ?? '',
      done: shallowDef ? shallowDef.check(d) : false,
      granted: d.dailyGranted.includes('shallow'),
    },
    {
      slot: 'core',
      title: coreADef?.title ?? '',
      hint: `${coreADef?.hint ?? ''}${coreBDef ? `（或：${coreBDef.hint}）` : ''}`,
      done: (coreADef ? coreADef.check(d) : false) || (coreBDef ? coreBDef.check(d) : false),
      granted: d.dailyGranted.includes('core'),
    },
    {
      slot: 'settle',
      title: settleDef?.title ?? '',
      hint: settleDef?.hint ?? '',
      done: settleDef ? settleDef.check(d) : false,
      granted: d.dailyGranted.includes('settle'),
    },
  ]
  const allDone = slots.every((s) => s.done)
  return { slots, allDone, chestOpened: d.chestGranted, chestAvailable: allDone && !d.chestGranted }
}

function daysInRange(profile: GrowthProfile, fromKey: string, toKey: string): { key: string; day: GrowthDay }[] {
  // 区间内每一天都产出（无记录的日子给空记录）：点亮天数等按 dayStateOf 判定的
  // 统计不能因为「那天没有 days 记录」被漏计（v1 迁移档案常见 activeDates 有而 days 无）
  const out: { key: string; day: GrowthDay }[] = []
  let cursor = fromKey
  let guard = 0
  while (cursor <= toKey && guard < 400) {
    out.push({ key: cursor, day: profile.days[cursor] ?? emptyDay() })
    cursor = keyAddDays(cursor, 1)
    guard += 1
  }
  return out
}

export interface TaskProgress {
  id: string
  title: string
  target: number
  current: number
  done: boolean
  xp: number
}

export function weeklyTaskStatus(profile: GrowthProfile, now: Date = new Date()): TaskProgress[] {
  const today = growthDayKey(now)
  const monday = mondayKeyOf(today)
  const days = daysInRange(profile, monday, today)
  const litDays = days.filter(({ key }) => dayStateOf(profile, key) === 'lit').length
  const catUnion = new Set(days.flatMap(({ day }) => day.categoriesVisited))
  const briefDays = days.filter(({ day }) => (day.counts.brief_read ?? 0) > 0).length
  const tidyOps = days.reduce((s, { day }) => s + (day.counts.favorite_add ?? 0) + (day.counts.watchlist_progress ?? 0), 0)
  const maxDayXp = days.reduce((m, { day }) => Math.max(m, day.xp), 0)
  const defs: { id: string; title: string; target: number; current: number }[] = [
    { id: 'w1', title: '五日同行', target: 5, current: litDays },
    { id: 'w2', title: '跨界漫游', target: 4, current: catUnion.size },
    { id: 'w3', title: '有始有终', target: 3, current: Math.max(briefDays, tidyOps) },
    { id: 'w4', title: '两日之约', target: 2, current: litDays },
    { id: 'w5', title: '满格一天', target: 120, current: maxDayXp },
  ]
  return defs.map((d) => ({ ...d, done: d.current >= d.target, xp: WEEKLY_TASK_XP }))
}

function seasonWindowDays(profile: GrowthProfile, cal: SeasonCalendar, now: Date): { key: string; day: GrowthDay }[] {
  const today = growthDayKey(now)
  return daysInRange(profile, cal.startKey, today > cal.endKey ? cal.endKey : today)
}

function seasonRunInWindow(profile: GrowthProfile, cal: SeasonCalendar, now: Date): number {
  const today = growthDayKey(now)
  const end = today > cal.endKey ? cal.endKey : today
  let cur = 0
  let best = 0
  let cursor = cal.startKey
  let guard = 0
  while (cursor <= end && guard < 200) {
    const s = dayStateOf(profile, cursor)
    if (s === 'lit' || s === 'frozen' || s === 'rescued') cur += 1
    else if (s === 'rest') {
      /* 透明 */
    } else cur = 0
    best = Math.max(best, cur)
    cursor = keyAddDays(cursor, 1)
    guard += 1
  }
  return best
}

export function seasonTaskStatus(profile: GrowthProfile, now: Date = new Date(), cal: SeasonCalendar = seasonCalendar(now)): TaskProgress[] {
  const days = seasonWindowDays(profile, cal, now)
  const sum = (fn: (d: GrowthDay) => number) => days.reduce((s, { day }) => s + fn(day), 0)
  const countDays = (fn: (d: GrowthDay) => boolean) => days.filter(({ day }) => fn(day)).length
  const catUnion = new Set(days.flatMap(({ day }) => day.categoriesVisited))
  const defs: { id: string; title: string; target: number; current: number }[] = [
    { id: 's1', title: '专区常客', target: 3, current: countDays((d) => d.seasonZoneVisit) },
    { id: 's2', title: '收藏成册', target: 5, current: sum((d) => d.favRewarded) },
    { id: 's3', title: '简报读者', target: 20, current: countDays((d) => (d.counts.brief_read ?? 0) > 0) },
    { id: 's4', title: '追剧达人', target: 10, current: sum((d) => d.counts.watchlist_progress ?? 0) },
    { id: 's5', title: 'AI 领航', target: 10, current: countDays((d) => (d.counts.ai_find ?? 0) > 0) },
    { id: 's6', title: '全境漫游', target: 10, current: catUnion.size },
    { id: 's7', title: '季内长跑', target: 14, current: seasonRunInWindow(profile, cal, now) },
    { id: 's8', title: '共建者', target: 1, current: profile.season.contributionApproved },
  ]
  return defs.map((d) => ({ ...d, done: d.current >= d.target, xp: SEASON_TASK_XP }))
}

export function eventMetricValue(profile: GrowthProfile, event: SeasonEventDef, metric: SeasonEventTaskDef['metric'], cal: SeasonCalendar): number {
  const from = keyAddDays(cal.startKey, event.dayFrom - 1)
  const to = keyAddDays(cal.startKey, event.dayTo - 1)
  const days = daysInRange(profile, from, to)
  switch (metric) {
    case 'fav_adds':
      return days.reduce((s, { day }) => s + day.favRewarded, 0)
    case 'distinct_categories':
      return new Set(days.flatMap(({ day }) => day.categoriesVisited)).size
    case 'brief_days':
      return days.filter(({ day }) => (day.counts.brief_read ?? 0) > 0).length
    case 'watchlist_progress':
      return days.reduce((s, { day }) => s + (day.counts.watchlist_progress ?? 0), 0)
    case 'drama_days':
      return days.filter(({ day }) => (day.counts.drama_visit ?? 0) > 0).length
    case 'ai_find_days':
      return days.filter(({ day }) => (day.counts.ai_find ?? 0) > 0).length
    default:
      return 0
  }
}

export function activeSeasonEvents(cal: SeasonCalendar): SeasonEventDef[] {
  return SEASON_EVENTS.filter((e) => cal.dayOfSeason >= e.dayFrom && cal.dayOfSeason <= e.dayTo)
}

/** 事件可发放范围：展示只认进行中；结算放行「窗口刚结束 2 天内」的补评
 * （窗口最后一天达标、次日才回来的用户不该丢奖励）；换季收尾结算用 'all' 全量补评 */
export function seasonEventStatus(
  profile: GrowthProfile,
  now: Date = new Date(),
  cal: SeasonCalendar = seasonCalendar(now),
  scope: 'active' | 'grantable' | 'all' = 'active',
): { event: SeasonEventDef; tasks: (TaskProgress & { granted: boolean })[] }[] {
  const events =
    scope === 'all'
      ? SEASON_EVENTS
      : scope === 'grantable'
        ? SEASON_EVENTS.filter((e) => cal.dayOfSeason >= e.dayFrom && cal.dayOfSeason <= e.dayTo + 2)
        : activeSeasonEvents(cal)
  return events.map((event) => ({
    event,
    tasks: event.tasks.map((t) => {
      const current = eventMetricValue(profile, event, t.metric, cal)
      return {
        id: `${event.id}:${t.id}`,
        title: t.title,
        target: t.target,
        current,
        done: current >= t.target,
        xp: t.xp,
        granted: profile.season.eventGranted.includes(`${event.id}:${t.id}`),
      }
    }),
  }))
}

/** 任意赛季索引的日历（换季收尾结算按旧赛季口径评估用） */
export function seasonCalendarForIndex(index: number): SeasonCalendar {
  const startKey = keyAddDays(SEASON_EPOCH_KEY, index * SEASON_LENGTH_DAYS)
  return {
    index,
    startKey,
    endKey: keyAddDays(startKey, SEASON_LENGTH_DAYS - 1),
    dayOfSeason: SEASON_LENGTH_DAYS,
  }
}

/** 从每日记录重建某赛季的 SP：只算镜像类（总 xp 剔除赛季类发放 seasonXp），精确不双计 */
export function rebuildSeasonSp(profile: GrowthProfile, cal: SeasonCalendar): number {
  let sp = 0
  for (const [k, d] of Object.entries(profile.days)) {
    if (k >= cal.startKey && k <= cal.endKey) sp += d.xp - d.seasonXp
  }
  return sp
}

/* ---------------- 结算引擎 ---------------- */

export type SettleEventType =
  | 'freeze_used'
  | 'earnback_opened'
  | 'earnback_done'
  | 'streak_broken'
  | 'task_granted'
  | 'season_level'
  | 'level_up'

export interface SettleEvent {
  type: SettleEventType
  detail?: string
  value?: number
}

const STREAK_MILESTONE_DAYS = [7, 30, 100, 200, 365]

function pushNotice(profile: GrowthProfile, notice: GrowthNotice): void {
  if (profile.pendingNotices.some((n) => n.id === notice.id)) return
  profile.pendingNotices.push(notice)
  if (profile.pendingNotices.length > 5) profile.pendingNotices = profile.pendingNotices.slice(-5)
}

function earnBackAvailable(profile: GrowthProfile, today: string): boolean {
  const from = keyAddDays(today, -29)
  return !profile.earnBackUses.some((k) => k >= from && k <= today)
}

/** 链在已结算区间的长度；中途发现断口返回 null（数据异常时防御） */
function chainLengthThrough(profile: GrowthProfile, chain: { startKey: string }, throughKey: string): number | null {
  let n = 0
  let cursor = chain.startKey
  let guard = 0
  while (cursor <= throughKey && guard < 4000) {
    const s = dayStateOf(profile, cursor)
    if (s === 'lit' || s === 'frozen' || s === 'rescued') n += 1
    else if (s === 'rest') {
      /* 透明 */
    } else return null
    cursor = keyAddDays(cursor, 1)
    guard += 1
  }
  return n
}

/** Lv3 首赠检查（幂等）：走账垫付前与任务发放后各调一次，防「任务升 Lv3 当次没卡、次日先断签后发卡」 */
function ensureLevel3Gift(profile: GrowthProfile, today: string): void {
  if (!profile.freezeGiftLevel3 && levelProgress(profile.totalXp).level >= 3) {
    grantFreezeCard(profile, dayOf(profile, today))
    profile.freezeGiftLevel3 = true
  }
}

function settleStreak(profile: GrowthProfile, now: Date, events: SettleEvent[]): void {
  const today = growthDayKey(now)
  const yesterday = keyAddDays(today, -1)

  // 1) Earn Back：先判完成 / 过期（动作计数已由 awards 更新）
  if (profile.earnBack) {
    const eb = profile.earnBack
    if (now.getTime() > new Date(eb.deadline).getTime()) {
      profile.earnBack = null
      events.push({ type: 'streak_broken', value: eb.brokenStreak })
      pushNotice(profile, {
        id: `broken-${today}`,
        kind: 'broken',
        key: today,
        text: `上次的 ${eb.brokenStreak} 天没有接上，也没关系——它已经记进你的历史最长里了。今天，重新从第 1 天开始。`,
      })
      // 过期收尾不做「重锚」：把结算点回退到断链的最后点亮日，链作废，
      // 交由第 2 步走账统一处理缺口后的新点亮日（休息日/垫付都在走账里落账，不会误清新链）
      let lastPresent = eb.chainStartKey
      let scan = eb.chainStartKey
      let scanGuard = 0
      while (scanGuard < 4000) {
        const s = dayStateOf(profile, scan)
        if (s === 'lit' || s === 'frozen' || s === 'rescued') {
          lastPresent = scan
          scan = keyAddDays(scan, 1)
        } else if (profile.restWeekday != null && keyWeekday(scan) === profile.restWeekday) {
          scan = keyAddDays(scan, 1)
        } else break
        scanGuard += 1
      }
      profile.streakChain = null
      profile.streakSettledThrough = lastPresent
    } else {
      const briefDelta = (profile.features.brief_read?.count ?? 0) - eb.briefAtOpen
      const siteDelta = (profile.features.site_open?.count ?? 0) - eb.siteOpensAtOpen
      if (briefDelta >= EARNBACK_BRIEF_NEED && siteDelta >= EARNBACK_SITES_NEED) {
        let cursor = eb.chainStartKey
        let guard = 0
        while (cursor < today && guard < 4000) {
          if (!dayStateOf(profile, cursor)) {
            profile.dayStates[cursor] =
              profile.restWeekday != null && keyWeekday(cursor) === profile.restWeekday ? 'rest' : 'rescued'
          }
          cursor = keyAddDays(cursor, 1)
          guard += 1
        }
        profile.streakChain = { startKey: eb.chainStartKey, supplyGiven: eb.chainSupplyGiven }
        profile.earnBackUses.push(today)
        profile.earnBack = null
        events.push({ type: 'earnback_done', value: eb.brokenStreak })
      }
    }
  }

  // 1.5) Lv3 首赠先行：历史上已达 Lv3 但还没领卡的，先把卡发了再走账垫付
  ensureLevel3Gift(profile, today)

  // 抢救窗仍开着时（未完成未过期）：第 2–4 步整体跳过——不走账、不推进结算点、
  // 不在窗内建临时链/扣卡/报断链；等窗口完成（第 1 步恢复链）或过期（回退结算点）后统一走账
  if (!profile.earnBack) {
  // 2) 逐日走账：从已结算日 +1 走到昨天
  const allKeys = [...Object.keys(profile.dayStates), ...profile.activeDates].sort()
  const from = profile.streakSettledThrough
    ? keyAddDays(profile.streakSettledThrough, 1)
    : (allKeys[0] ?? today)
  let chain = profile.streakChain
  let chainLen = 0
  if (chain) {
    const len = chainLengthThrough(profile, chain, profile.streakSettledThrough ?? yesterday)
    if (len == null) {
      // 档案里的链与日状态对不上（时钟回拨清洗等）：链与局部变量同步作废，防坏死链
      chain = null
      profile.streakChain = null
    } else chainLen = len
  }
  let freezeUsed = 0
  let cursor = from
  let guard = 0
  while (cursor <= yesterday && guard < 4000) {
    const s = dayStateOf(profile, cursor)
    if (s === 'lit' || s === 'frozen' || s === 'rescued') {
      if (!chain && s === 'lit') {
        // 无链状态下走到的点亮日就是新链起点（断链后重新点亮、结算晚一天的情形）
        chain = { startKey: cursor, supplyGiven: 0 }
        chainLen = 0
      }
      chainLen += 1
      if (!profile.dayStates[cursor]) profile.dayStates[cursor] = s
    } else if (s === 'rest') {
      /* 透明日：不断不计 */
    } else if (profile.restWeekday != null && keyWeekday(cursor) === profile.restWeekday) {
      profile.dayStates[cursor] = 'rest'
    } else if (chain) {
      // 缺口日：先前瞻整段缺口——卡够垫完整段才扣卡，不够一张都不扣，
      // 否则卡白白扣光、连胜照样断，还会算出「留住了连胜——现在是 0 天」的矛盾通知
      let runLen = 0
      let probe = cursor
      while (probe <= yesterday) {
        const ps = dayStateOf(profile, probe)
        if (ps === 'lit' || ps === 'frozen' || ps === 'rescued') break
        if (ps === 'rest' || (profile.restWeekday != null && keyWeekday(probe) === profile.restWeekday)) {
          // 休息日透明：不计入缺口长度、也不阻断前瞻（跨休息日的缺口按真实缺席天数算）
          probe = keyAddDays(probe, 1)
          continue
        }
        runLen += 1
        probe = keyAddDays(probe, 1)
      }
      if (runLen > 0 && profile.freezeCards >= runLen) {
        profile.freezeCards -= 1
        profile.dayStates[cursor] = 'frozen'
        chainLen += 1
        freezeUsed += 1
      } else if (chainLen > 0) {
        // Earn Back 只救「刚断」的连胜：断口距今天 ≤2 个成长日才开窗；
        // 断了很久的（比如 38 天前）直接断链，交给回归包承接，不许把数十天缺口填成 rescued
        const recentBreak = keyDiffDays(cursor, today) <= 2
        if (recentBreak && chainLen >= EARNBACK_MIN_STREAK && !profile.earnBack && earnBackAvailable(profile, today)) {
          const deadline = new Date(now.getTime() + EARNBACK_WINDOW_MS)
          profile.earnBack = {
            brokenStreak: chainLen,
            chainStartKey: chain.startKey,
            chainSupplyGiven: chain.supplyGiven,
            openedAt: now.toISOString(),
            deadline: deadline.toISOString(),
            briefAtOpen: profile.features.brief_read?.count ?? 0,
            siteOpensAtOpen: profile.features.site_open?.count ?? 0,
          }
          events.push({ type: 'earnback_opened', value: chainLen })
          pushNotice(profile, {
            id: `earnback-${today}`,
            kind: 'earnback',
            key: today,
            deadline: deadline.toISOString(),
            text: `昨天没来，${chainLen} 天的连胜先帮你留着——在明天这个时候之前，读 1 期简报、打开 2 个站，它就接上了。`,
          })
        } else {
          events.push({ type: 'streak_broken', value: chainLen })
          pushNotice(profile, {
            id: `broken-${today}`,
            kind: 'broken',
            key: today,
            text: `${chainLen} 天的连胜先记进历史最长里了。今天，重新从第 1 天开始。`,
          })
        }
        chain = null
        chainLen = 0
        profile.streakChain = null
      } else {
        // 链锚点异常（长度为 0 却存在）：弃链
        chain = null
        profile.streakChain = null
      }
    }
    cursor = keyAddDays(cursor, 1)
    guard += 1
  }
  profile.streakSettledThrough = yesterday

  if (freezeUsed > 0) {
    events.push({ type: 'freeze_used', value: freezeUsed })
    const cs = currentStreak(profile, now)
    // 链最终没保住时不发「留住了连胜」的通知（哪怕今日已点亮使 cs=1 也一样自相矛盾）；
    // 判定以走账后的链存活（chain 非空）为准，垫付日已计入历史最长
    if (chain && cs > 0) {
      pushNotice(profile, {
        id: `freeze-${today}`,
        kind: 'freeze',
        key: today,
        text: `你不在的日子，冻结卡帮你留住了连胜——现在是 ${cs} 天。`,
      })
    }
  }

  // 3) 链状态以局部变量为准回写（防旧链残留）；今日已点亮且无链、无待抢救 → 今日起链
  profile.streakChain = chain
  if (!profile.streakChain && !profile.earnBack && dayStateOf(profile, today)) {
    profile.streakChain = { startKey: today, supplyGiven: 0 }
  }

  // 4) 周期补给：链存活期间每满 7 个自然日 +1 张（满库存转 +20）
  if (profile.streakChain) {
    const anchor = profile.streakChain
    const due = Math.floor(keyDiffDays(anchor.startKey, today) / 7) - anchor.supplyGiven
    if (due > 0) {
      const todayDay = dayOf(profile, today)
      for (let i = 0; i < due; i += 1) {
        grantFreezeCard(profile, todayDay)
        anchor.supplyGiven += 1
      }
    }
  }
  } // 抢救窗开启时跳过第 2–4 步（见上方说明）

  // 5) Lv3 首赠（走账后再查一次：本次结算的入账也可能刚把用户推上 Lv3）
  ensureLevel3Gift(profile, today)

  // 6) 历史最长刷新（只增不减）
  const extremes = scanStreakExtremes(profile)
  profile.longestStreak = Math.max(profile.longestStreak, extremes.longest)
  profile.pureLongestStreak = Math.max(profile.pureLongestStreak, extremes.pureLongest)
}

function settleSeasonRollover(profile: GrowthProfile, now: Date): void {
  const cal = seasonCalendar(now)
  if (profile.season.index === cal.index) return
  if (profile.season.index > cal.index) {
    // 档案赛季比当前日历还新（时钟曾拨到未来又拨回）：不归档未来数据，
    // 直接按当前赛季口径重建状态（days 记录没动，SP 精确重算）
    profile.season = { ...emptySeason(cal.index), sp: rebuildSeasonSp(profile, cal) }
    return
  }
  const oldCal = seasonCalendarForIndex(profile.season.index)
  profile.seasonHistory.push({
    index: profile.season.index,
    sp: profile.season.sp,
    level: seasonLevelOf(profile.season.sp),
    roamingNodes: roamingNodesOf(profile.season.sp),
    endedKey: oldCal.endKey, // 真实结束日，不用「昨天」冒充（断档跨季回来时差几十天）
  })
  profile.season = { ...emptySeason(cal.index), sp: rebuildSeasonSp(profile, cal) }
}

function settleReturnPack(profile: GrowthProfile, now: Date): void {
  const today = growthDayKey(now)
  // 回归包只发给「今天真的回来了」的人：今日未点亮不触发——
  // 否则纯结算（没到访）每 30 天就能凭空再领一次
  if (dayStateOf(profile, today) !== 'lit') return
  if (profile.returnPack && keyDiffDays(profile.returnPack.startKey, today) < 30) return
  const pastActives = profile.activeDates.filter((k) => k < today)
  const last = pastActives.reduce<string | null>((m, k) => (m == null || k > m ? k : m), null)
  if (!last) return
  if (keyDiffDays(last, today) < 30) return
  if (profile.lastReturnPackKey && keyDiffDays(profile.lastReturnPackKey, today) < 30) return
  const got = grantFreezeCard(profile, dayOf(profile, today))
  profile.returnPack = { startKey: today, granted: [] }
  profile.lastReturnPackKey = today
  pushNotice(profile, {
    id: `return-${today}`,
    kind: 'return',
    key: today,
    text:
      got === 'card'
        ? '欢迎回来。你的小猫和收藏都还在，冻结卡 +1 已放进口袋——慢慢逛，不用赶。'
        : '欢迎回来。你的小猫和收藏都还在——慢慢逛，不用赶。',
  })
}

function grantInto(
  profile: GrowthProfile,
  day: GrowthDay,
  list: string[],
  id: string,
  xp: number,
  kind: XpClass,
  events: SettleEvent[],
): boolean {
  if (list.includes(id)) return false
  list.push(id)
  addXp(profile, day, xp, kind)
  events.push({ type: 'task_granted', detail: id, value: xp })
  return true
}

/** 赛季侧发放（任务/季中事件/等级小奖/里程碑/漫游/季中里程碑），按给定日历口径评估。
 * closing=true 是换季收尾：对已结束的旧赛季做最后一次全量补评（事件全量、季中里程碑不限窗口），
 * 奖励记在今天——不让用户已达标的奖励随换季被抹掉 */
function settleSeasonGrants(
  profile: GrowthProfile,
  day: GrowthDay,
  now: Date,
  cal: SeasonCalendar,
  events: SettleEvent[],
  closing: boolean,
): void {
  for (const t of seasonTaskStatus(profile, now, cal)) {
    if (t.done) grantInto(profile, day, profile.season.tasksGranted, t.id, SEASON_TASK_XP, 'task', events)
  }
  for (const { tasks } of seasonEventStatus(profile, now, cal, closing ? 'all' : 'grantable')) {
    for (const t of tasks) {
      if (t.done) grantInto(profile, day, profile.season.eventGranted, t.id, t.xp, 'task', events)
    }
  }
  // 赛季等级小奖 / 里程碑冻结卡 / 漫游节点（赛季类发放，不镜像 SP 防自循环；
  // 里程碑卡满库存折算也走 'season'，不能把赛季奖励镜像回 SP）
  const sLevel = seasonLevelOf(profile.season.sp)
  while (profile.season.levelGranted < sLevel) {
    profile.season.levelGranted += 1
    addXp(profile, day, SEASON_LEVEL_REWARD_XP, 'season')
    events.push({ type: 'season_level', value: profile.season.levelGranted })
    if (
      (SEASON_MILESTONE_LEVELS as readonly number[]).includes(profile.season.levelGranted) &&
      !profile.season.milestonesGranted.includes(profile.season.levelGranted)
    ) {
      profile.season.milestonesGranted.push(profile.season.levelGranted)
      grantFreezeCard(profile, day, 'season')
    }
  }
  const nodes = roamingNodesOf(profile.season.sp)
  while (profile.season.roamingGranted < nodes) {
    profile.season.roamingGranted += 1
    addXp(profile, day, ROAMING_NODE_REWARD_XP, 'season')
  }
  // 季中 SP 里程碑：当前赛季在配置窗口内评估；收尾结算按「窗口最后一天（第 60 天）
  // 当时的累计 SP」判定——季末才攒够的不补发，窗口内达标没领的才补
  const midWindowOpen = cal.dayOfSeason >= MID_SEASON_WINDOW.dayFrom && cal.dayOfSeason <= MID_SEASON_WINDOW.dayTo
  if (closing || midWindowOpen) {
    let midSp = profile.season.sp
    if (closing) {
      const cutoff = keyAddDays(cal.startKey, MID_SEASON_WINDOW.dayTo - 1)
      midSp = 0
      for (const [k, d] of Object.entries(profile.days)) {
        if (k >= cal.startKey && k <= cutoff) midSp += d.xp - d.seasonXp
      }
    }
    for (const m of MID_SEASON_MILESTONES) {
      if (midSp >= m.sp && !profile.season.midMilestonesGranted.includes(m.sp)) {
        profile.season.midMilestonesGranted.push(m.sp)
        addXp(profile, day, m.xp, 'season')
        if (m.freezeCard) grantFreezeCard(profile, day, 'season')
        events.push({ type: 'task_granted', detail: `mid-${m.sp}`, value: m.xp })
      }
    }
  }
}

function settleTasksAndSeason(profile: GrowthProfile, now: Date, events: SettleEvent[]): void {
  const today = growthDayKey(now)
  const day = dayOf(profile, today)

  // 每日任务（先定格槽位再判定，双轨在 status 层已合并）
  if (!day.dailySlots) day.dailySlots = assignDailySlots(profile, today)
  for (const s of dailyTaskStatus(profile, now).slots) {
    if (s.done) grantInto(profile, day, day.dailyGranted, s.slot, DAILY_TASK_XP, 'task', events)
  }
  // 每周任务（两遍：第二遍兜住「被本次其他奖励推过门槛」的 w5 满格一天等）
  const grantWeekly = () => {
    const monday = mondayKeyOf(today)
    const wk = (profile.weeks[monday] ??= { granted: [] })
    for (const t of weeklyTaskStatus(profile, now)) {
      if (!t.done) continue
      const isNew = grantInto(profile, day, wk.granted, t.id, WEEKLY_TASK_XP, 'task', events)
      if (isNew && t.id === 'w1') grantFreezeCard(profile, day)
    }
  }
  grantWeekly()
  // 回归包任务（7 天窗口）
  const rp = profile.returnPack
  if (rp && keyDiffDays(rp.startKey, today) <= 6) {
    const days = daysInRange(profile, rp.startKey, today)
    const lit = days.filter(({ key }) => dayStateOf(profile, key) === 'lit').length
    const brief = days.filter(({ day: d }) => (d.counts.brief_read ?? 0) > 0).length
    const fav = days.reduce((s, { day: d }) => s + d.favRewarded, 0)
    const checks: { id: string; ok: boolean }[] = [
      { id: 'r1', ok: lit >= 3 },
      { id: 'r2', ok: brief >= 2 },
      { id: 'r3', ok: fav >= 1 },
    ]
    for (const c of checks) {
      if (c.ok) grantInto(profile, day, rp.granted, c.id, RETURN_TASK_XP, 'task', events)
    }
  }
  // 图鉴全满追加（一次性）
  if (!profile.catalogBonusGranted && FEATURES.every((f) => (profile.features[f]?.count ?? 0) > 0)) {
    profile.catalogBonusGranted = true
    addXp(profile, day, CATALOG_BONUS_XP, 'task')
    events.push({ type: 'task_granted', detail: 'catalog', value: CATALOG_BONUS_XP })
  }
  // 赛季侧（当前赛季口径）
  settleSeasonGrants(profile, day, now, seasonCalendar(now), events, false)
  grantWeekly()
}

/** 全量结算：连胜走账 → 旧赛季收尾补评 → 赛季滚动 → 回归包 → 任务与赛季发放 → 里程碑日 */
export function settleProfile(input: GrowthProfile, now: Date = new Date()): { profile: GrowthProfile; events: SettleEvent[] } {
  const profile = cloneProfile(input)
  const events: SettleEvent[] = []
  const today = growthDayKey(now)
  const calNow = seasonCalendar(now)
  // 先走账：旧季最后一天的垫付/休息日先落账，收尾评估 s7 等才不漏算
  settleStreak(profile, now, events)
  if (profile.season.index < calNow.index) {
    // 按旧赛季口径把待发奖励结清再归档——奖励记在旧季最后一天的天记录上：
    // 'task' 类落在旧窗口内才镜像旧季 SP，也不会被新季 SP 重建误吞、不会虚增今日 xp
    const oldCal = seasonCalendarForIndex(profile.season.index)
    settleSeasonGrants(profile, dayOf(profile, oldCal.endKey), now, oldCal, events, true)
  }
  settleSeasonRollover(profile, now)
  settleReturnPack(profile, now)
  settleTasksAndSeason(profile, now, events)
  // 任务入账可能刚把人推上 Lv3：首赠卡在结算末尾再兜一次（settleStreak 内也查过，幂等）
  ensureLevel3Gift(profile, today)
  const lp = levelProgress(profile.totalXp)
  if (lp.level > profile.lastSeenLevel) {
    profile.lastSeenLevel = lp.level
    if (!profile.milestoneDays.includes(today)) profile.milestoneDays.push(today)
    events.push({ type: 'level_up', value: lp.level })
  }
  const cs = currentStreak(profile, now)
  if (STREAK_MILESTONE_DAYS.includes(cs) && dayStateOf(profile, today) === 'lit' && !profile.milestoneDays.includes(today)) {
    profile.milestoneDays.push(today)
  }
  return { profile, events }
}

/* ---------------- 宝箱（v2 表 1.5：三重保底） ---------------- */

export interface ChestResult {
  ok: boolean
  /** 固定奖励（全清必得） */
  fixedXp: number
  tier: 'small' | 'medium' | 'card' | null
  bonusXp: number
  gotCard: boolean
}

/**
 * 全清宝箱：固定 +15 + 变量档（小 50% +5~10 / 中 32% +12~20 / 卡 18% 冻结卡）。
 * 保底：缺卡（库存 0）时卡档概率升至 30%；连空 3 次第 4 个必出卡；满库存时卡档转 +25。
 */
export function openDailyChest(
  input: GrowthProfile,
  now: Date = new Date(),
  rng: () => number = Math.random,
): { profile: GrowthProfile; result: ChestResult } {
  const profile = cloneProfile(input)
  const key = growthDayKey(now)
  const day = dayOf(profile, key)
  if (!day.dailySlots) day.dailySlots = assignDailySlots(profile, key)
  const status = dailyTaskStatus(profile, now)
  const fail: ChestResult = { ok: false, fixedXp: 0, tier: null, bonusXp: 0, gotCard: false }
  if (!status.allDone || day.chestGranted) return { profile, result: fail }
  day.chestGranted = true
  addXp(profile, day, CHEST_FIXED_XP, 'task')
  const cap = levelProgress(profile.totalXp).level >= FREEZE_CAP_HIGH_LEVEL ? FREEZE_CAP_HIGH : FREEZE_CAP_LOW
  let cardProb = CHEST_CARD_PROB
  if (profile.freezeCards === 0) cardProb = 0.3
  let tier: 'small' | 'medium' | 'card'
  if (profile.chestNoCardStreak >= 3) {
    tier = 'card'
  } else {
    const roll = rng()
    if (roll < cardProb) tier = 'card'
    else if (roll < cardProb + 0.32) tier = 'medium'
    else tier = 'small'
  }
  let bonusXp = 0
  let gotCard = false
  if (tier === 'card') {
    if (profile.freezeCards < cap) {
      profile.freezeCards += 1
      gotCard = true
    } else {
      bonusXp = FREEZE_CHEST_FULL_XP
      addXp(profile, day, bonusXp, 'task')
    }
    profile.chestNoCardStreak = 0
  } else if (tier === 'medium') {
    bonusXp = 12 + Math.floor(rng() * 9)
    addXp(profile, day, bonusXp, 'task')
    profile.chestNoCardStreak += 1
  } else {
    bonusXp = 5 + Math.floor(rng() * 6)
    addXp(profile, day, bonusXp, 'task')
    profile.chestNoCardStreak += 1
  }
  return { profile, result: { ok: true, fixedXp: CHEST_FIXED_XP, tier, bonusXp, gotCard } }
}

/* ---------------- 徽章（v2 整合：套系化 + 旧章并轨） ---------------- */

export interface Badge {
  id: string
  title: string
  desc: string
  icon: string
  earned: boolean
  progressText: string
}

/** v1 旧口径已得徽章（迁移时快照，并轨保权益：已得永不收回） */
export function computeV1LegacyBadges(profile: GrowthProfile, now: Date = new Date()): string[] {
  const f = (k: GrowthFeature) => profile.features[k]?.count ?? 0
  const usedKinds = FEATURES.filter((k) => f(k) > 0).length
  const streak = currentStreak(profile, now)
  const ids: string[] = []
  if (usedKinds >= 1) ids.push('first-step')
  if (f('ai_find') >= 1) ids.push('ai-helper')
  if (f('ai_chat') >= 1) ids.push('cat-talk')
  if (profile.scenes.length >= 5) ids.push('scene-explorer')
  if (profile.scenes.length >= 12) ids.push('scene-master')
  if (profile.categories.length >= 5) ids.push('category-explorer')
  if (profile.categories.length >= 10) ids.push('category-master')
  if (streak >= 3) ids.push('streak-3')
  if (streak >= 7) ids.push('streak-7')
  if (profile.dramaDates.length >= 3) ids.push('drama-fan')
  if (f('favorite_add') >= 5) ids.push('collector')
  if (profile.idleTotalMinutes >= 60) ids.push('idle-buddy')
  if (profile.homepageClaimedAt) ids.push('homepage-guardian')
  // 全能小猫：v1 图鉴只有 9 种功能（无 brief_read），集满 9 种即已点亮——必须快照，
  // 否则 v2 把图鉴扩到 10 种后老用户的这枚徽章会被收回（违反只降不升）
  if (FEATURES.filter((k) => k !== 'brief_read').every((k) => f(k) > 0)) ids.push('catalog-master')
  return ids
}

export function deriveBadges(profile: GrowthProfile, now: Date = new Date()): Badge[] {
  const f = (k: GrowthFeature) => profile.features[k]?.count ?? 0
  const usedKinds = FEATURES.filter((k) => f(k) > 0).length
  const legacy = new Set(profile.legacyBadgeIds)
  const allDays = Object.values(profile.days)
  const aiFindDays = allDays.filter((d) => (d.counts.ai_find ?? 0) > 0).length
  const briefDays = allDays.filter((d) => (d.counts.brief_read ?? 0) > 0).length
  const dramaDays = profile.dramaDates.length
  const watchlistCount = f('watchlist_progress')
  const effectiveFav = Math.max(profile.rewardedFavIds.length, f('favorite_add'))
  const longest = Math.max(profile.longestStreak, currentStreak(profile, now))
  const B = (
    id: string,
    title: string,
    desc: string,
    icon: string,
    earned: boolean,
    cur: number,
    target: number,
    unit: string,
    progressOverride?: string,
  ): Badge => ({
    id,
    title,
    desc,
    icon,
    earned,
    progressText: earned ? '已点亮' : (progressOverride ?? `${Math.min(cur, target)} / ${target} ${unit}`),
  })
  return [
    B('first-step', '初入小站', '用过任意一个站内功能', '🐾', usedKinds >= 1, usedKinds, 1, '种功能'),
    // AI 领航员：铜阶对 v1「AI 小帮手」持有者自动并轨（legacy），新口径门槛 3 次
    B('ai-navigator-1', 'AI 领航员 · 铜', '用 AI 成功找到并打开 3 个站', '🧭', f('ai_find') >= 3 || legacy.has('ai-helper'), f('ai_find'), 3, '次'),
    B('ai-navigator-2', 'AI 领航员 · 银', '在 10 个不同的日子用过 AI 找站', '🧭', aiFindDays >= 10, aiFindDays, 10, '天'),
    B('ai-navigator-3', 'AI 领航员 · 金', '在 30 个不同的日子用过 AI 找站', '🧭', aiFindDays >= 30, aiFindDays, 30, '天'),
    B('cat-talk', '猫语翻译官', '和 AI 小猫聊过一次', '💬', f('ai_chat') >= 1 || legacy.has('cat-talk'), f('ai_chat'), 1, '次'),
    B('scene-roamer-1', '场景漫游 · 铜', '打开过 5 个场景包', '🗺️', profile.scenes.length >= 5 || legacy.has('scene-explorer'), profile.scenes.length, 5, '个场景'),
    B('scene-roamer-2', '场景漫游 · 银', '打开过 12 个场景包', '🗺️', profile.scenes.length >= 12 || legacy.has('scene-master'), profile.scenes.length, 12, '个场景'),
    B('scene-roamer-3', '场景漫游 · 金', '打开过 24 个场景包', '🗺️', profile.scenes.length >= 24, profile.scenes.length, 24, '个场景'),
    B('category-roamer-1', '分类漫游 · 铜', '逛过 5 个分类', '🧩', profile.categories.length >= 5 || legacy.has('category-explorer'), profile.categories.length, 5, '个分类'),
    B('category-roamer-2', '全站通', '逛过 10 个分类', '🧩', profile.categories.length >= 10 || legacy.has('category-master'), profile.categories.length, 10, '个分类'),
    B('category-roamer-3', '分类漫游 · 金', '逛过全站 14 个一级分类', '🧩', profile.categories.length >= 14, profile.categories.length, 14, '个分类'),
    B('dual-habitat-1', '双栖客 · 铜', '读过 7 期简报，或追过 3 天短剧', '🎬', briefDays >= 7 || dramaDays >= 3 || legacy.has('drama-fan'), Math.max(briefDays, dramaDays), 7, '期/天', `简报 ${briefDays} / 7 期 · 追剧 ${dramaDays} / 3 天（任一达标）`),
    B('dual-habitat-2', '双栖客 · 银', '读过 30 期简报，或推进 15 次追剧进度', '🎬', briefDays >= 30 || watchlistCount >= 15, Math.max(briefDays, watchlistCount), 30, '期/次', `简报 ${briefDays} / 30 期 · 追剧 ${watchlistCount} / 15 次（任一达标）`),
    B('dual-habitat-3', '双栖客 · 金', '读过 100 期简报，或推进 50 次追剧进度', '🎬', briefDays >= 100 || watchlistCount >= 50, Math.max(briefDays, watchlistCount), 100, '期/次', `简报 ${briefDays} / 100 期 · 追剧 ${watchlistCount} / 50 次（任一达标）`),
    B('drama-fan', '追剧小达人', '在 3 个不同的日子逛过短剧专区（原章保留）', '🍿', dramaDays >= 3 || legacy.has('drama-fan'), dramaDays, 3, '天'),
    B('collector-1', '收藏家 · 铜', '收藏过 5 个站', '⭐', effectiveFav >= 5 || legacy.has('collector'), effectiveFav, 5, '个站'),
    B('collector-2', '收藏家 · 银', '收藏过 20 个站', '⭐', effectiveFav >= 20, effectiveFav, 20, '个站'),
    B('collector-3', '收藏家 · 金', '收藏过 60 个站', '⭐', effectiveFav >= 60, effectiveFav, 60, '个站'),
    B('treasure-1', '百站寻宝 · 铜', '打开过 15 个不同的站', '🔍', profile.sitesOpened.length >= 15, profile.sitesOpened.length, 15, '个站'),
    B('treasure-2', '百站寻宝 · 银', '打开过 80 个不同的站', '🔍', profile.sitesOpened.length >= 80, profile.sitesOpened.length, 80, '个站'),
    B('treasure-3', '百站寻宝 · 金', '打开过 200 个不同的站', '🔍', profile.sitesOpened.length >= 200, profile.sitesOpened.length, 200, '个站'),
    B('streak-3', '三日之约', '历史最长连胜 3 天', '🔥', longest >= 3 || legacy.has('streak-3'), longest, 3, '天'),
    B('streak-7', '一周同行', '历史最长连胜 7 天', '🔥', longest >= 7 || legacy.has('streak-7'), longest, 7, '天'),
    B('streak-30', '月度同行', '历史最长连胜 30 天', '🔥', longest >= 30, longest, 30, '天'),
    B('streak-100', '百日同行', '历史最长连胜 100 天', '🔥', longest >= 100, longest, 100, '天'),
    B('streak-200', '长情陪伴', '历史最长连胜 200 天', '🔥', longest >= 200, longest, 200, '天'),
    B('streak-365', '周年同行', '历史最长连胜 365 天', '🔥', longest >= 365, longest, 365, '天'),
    B('idle-buddy', '陪伴 · 铜', '在站里停留满 60 分钟', '⏳', profile.idleTotalMinutes >= 60 || legacy.has('idle-buddy'), profile.idleTotalMinutes, 60, '分钟'),
    B('idle-2', '陪伴 · 银', '在站里停留满 600 分钟', '⏳', profile.idleTotalMinutes >= 600, profile.idleTotalMinutes, 600, '分钟'),
    B('idle-3', '陪伴 · 金', '在站里停留满 3000 分钟', '⏳', profile.idleTotalMinutes >= 3000, profile.idleTotalMinutes, 3000, '分钟'),
    B('homepage-guardian', '首页守护者', '把小站设为浏览器首页（或装为应用）', '🏠', !!profile.homepageClaimedAt || !!profile.pwaInstalledAt || legacy.has('homepage-guardian'), profile.homepageClaimedAt || profile.pwaInstalledAt ? 1 : 0, 1, '次'),
    B('catalog-master', '全能小猫', '站内 10 种功能全部用过', '📚', usedKinds >= FEATURES.length || legacy.has('catalog-master'), usedKinds, FEATURES.length, '种功能'),
    {
      id: 'pioneer-legend',
      title: '初代传说',
      desc: '新版成长体系上线前就已达到 Lv8 的老朋友（绝版）',
      icon: '👑',
      earned: profile.pioneerLegend,
      progressText: profile.pioneerLegend ? '已点亮 · 绝版' : '绝版徽章，不可再得',
    },
  ]
}

export function returnPackStatus(profile: GrowthProfile, now: Date = new Date()): {
  active: boolean
  tasks: (TaskProgress & { granted: boolean })[]
} {
  const rp = profile.returnPack
  if (!rp) return { active: false, tasks: [] }
  const today = growthDayKey(now)
  const days = daysInRange(profile, rp.startKey, today)
  const lit = days.filter(({ key }) => dayStateOf(profile, key) === 'lit').length
  const brief = days.filter(({ day: d }) => (d.counts.brief_read ?? 0) > 0).length
  const fav = days.reduce((s, { day: d }) => s + d.favRewarded, 0)
  const defs = [
    { id: 'r1', title: '回来看看：本周到访 3 天', target: 3, current: lit },
    { id: 'r2', title: '补补课：读 2 期简报', target: 2, current: brief },
    { id: 'r3', title: '还是老样子：收藏 1 个站', target: 1, current: fav },
  ]
  return {
    active: keyDiffDays(rp.startKey, today) <= 6,
    tasks: defs.map((d) => ({ ...d, done: d.current >= d.target, xp: RETURN_TASK_XP, granted: rp.granted.includes(d.id) })),
  }
}

/* ---------------- 新手链（D1–D7，只引导不发分） ---------------- */

export interface RookieTaskStatus {
  day: number
  id: string
  title: string
  done: boolean
}

export function rookieStatus(profile: GrowthProfile, now: Date = new Date()): {
  active: boolean
  chainDay: number
  tasks: RookieTaskStatus[]
} {
  const f = (k: GrowthFeature) => profile.features[k]?.count ?? 0
  const createdKey = growthDayKey(new Date(profile.createdAt))
  const today = growthDayKey(now)
  const age = keyDiffDays(createdKey, today)
  const chainDay = Math.min(7, Math.max(1, age + 1))
  const lifetimeWatchlistNew = Object.values(profile.days).reduce((s, d) => s + d.watchlistNew, 0)
  const effectiveFav = Math.max(profile.rewardedFavIds.length, f('favorite_add'))
  const anyWeekly = Object.values(profile.weeks).some((w) => w.granted.length > 0)
  const anyChest = Object.values(profile.days).some((d) => d.chestGranted)
  const tasks: RookieTaskStatus[] = [
    { day: 1, id: 'd1', title: '打开 1 个站、读 1 期简报、收藏 1 个站', done: f('site_open') >= 1 && f('brief_read') >= 1 && f('favorite_add') >= 1 },
    { day: 2, id: 'd2', title: '用一次 AI 找站', done: f('ai_find') >= 1 },
    { day: 3, id: 'd3', title: '把小站设为首页，或装为应用', done: !!profile.homepageClaimedAt || !!profile.pwaInstalledAt },
    { day: 4, id: 'd4', title: '把 1 部剧加入追剧清单，或逛 2 个分类', done: lifetimeWatchlistNew >= 1 || profile.categories.length >= 2 },
    { day: 5, id: 'd5', title: '收藏到 3 个站，或推进 2 次追剧进度', done: effectiveFav >= 3 || f('watchlist_progress') >= 2 },
    { day: 6, id: 'd6', title: '看一眼自己的成长档案', done: profile.rookiePanelSeen },
    { day: 7, id: 'd7', title: '完成 1 个每周任务，并打开 1 次全清宝箱', done: anyWeekly && anyChest },
  ]
  return { active: age >= 0 && age < 7, chainDay, tasks }
}

/* ---------------- 热力图与摘要 ---------------- */

export interface HeatmapCell {
  key: string
  xp: number
  state: DayState | null
  milestone: boolean
}

/** 近 N 周热力（旧→新，周一起列由 UI 分组）：强度看当日 xp，金格 = 里程碑日 */
export function heatmapCells(profile: GrowthProfile, now: Date = new Date(), weeks = 16): HeatmapCell[] {
  const today = growthDayKey(now)
  const cells: HeatmapCell[] = []
  for (let i = weeks * 7 - 1; i >= 0; i -= 1) {
    const key = keyAddDays(today, -i)
    cells.push({
      key,
      xp: profile.days[key]?.xp ?? 0,
      state: dayStateOf(profile, key) ?? null,
      milestone: profile.milestoneDays.includes(key),
    })
  }
  return cells
}

export interface GrowthSummary {
  level: number
  title: string
  tier: string
  streak: number
  dots: boolean[]
  freezeCards: number
  chestAvailable: boolean
}

/** 摘要（挂件只读此对象显示等级标，不复刻引擎逻辑） */
export function growthSummary(profile: GrowthProfile, now: Date = new Date()): GrowthSummary {
  const lp = levelProgress(profile.totalXp)
  const daily = dailyTaskStatus(profile, now)
  return {
    level: lp.level,
    title: lp.title,
    tier: LEVEL_TIER_LABEL[levelTier(lp.level).kind],
    streak: currentStreak(profile, now),
    dots: daily.slots.map((s) => s.done),
    freezeCards: profile.freezeCards,
    chestAvailable: daily.chestAvailable,
  }
}

/* ---------------- 存储包装（浏览器端） ---------------- */

function emitSettleEvents(events: SettleEvent[]): void {
  for (const e of events) {
    if (e.type === 'freeze_used') trackGrowthEvent('streak_freeze_used', { count: e.value ?? 1 })
    else if (e.type === 'earnback_opened') trackGrowthEvent('streak_earnback_opened', { streak: e.value ?? 0 })
    else if (e.type === 'earnback_done') trackGrowthEvent('streak_earnback_done', { streak: e.value ?? 0 })
    else if (e.type === 'streak_broken') trackGrowthEvent('streak_broken', { streak: e.value ?? 0 })
    else if (e.type === 'task_granted') trackGrowthEvent('growth_task_completed', { task: e.detail ?? '', xp: e.value ?? 0 })
    else if (e.type === 'season_level') trackGrowthEvent('season_level_up', { level: e.value ?? 0 })
    else if (e.type === 'level_up') trackGrowthEvent('growth_level_up', { level: e.value ?? 0 })
  }
}

export function saveGrowthProfile(profile: GrowthProfile): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(GROWTH_STORAGE_KEY, JSON.stringify(profile))
    window.localStorage.setItem(GROWTH_SUMMARY_KEY, JSON.stringify(growthSummary(profile)))
    window.dispatchEvent(new CustomEvent(GROWTH_UPDATED_EVENT))
  } catch {
    /* 隐私模式/配额满：静默降级，成长是增强不是主链路 */
  }
}

export function loadGrowthProfile(): GrowthProfile {
  if (typeof window === 'undefined') return emptyProfile()
  try {
    const raw = window.localStorage.getItem(GROWTH_STORAGE_KEY)
    // 迁移第一步：v1 原始档案先原样备份（已有备份不覆盖，保留最早版本），再解析迁移
    if (isV1Raw(raw) && raw && !window.localStorage.getItem(GROWTH_BACKUP_KEY)) {
      try {
        window.localStorage.setItem(GROWTH_BACKUP_KEY, raw)
      } catch {
        /* 备份失败不阻塞迁移 */
      }
    }
    const parsed = parseGrowthProfile(raw)
    const { profile, events } = settleProfile(parsed)
    if (JSON.stringify(profile) !== JSON.stringify(parsed)) {
      saveGrowthProfile(profile)
      emitSettleEvents(events)
    } else {
      // 即使档案无变化也保证摘要键存在（挂件依赖）
      if (!window.localStorage.getItem(GROWTH_SUMMARY_KEY)) {
        try {
          window.localStorage.setItem(GROWTH_SUMMARY_KEY, JSON.stringify(growthSummary(profile)))
        } catch {
          /* 同上 */
        }
      }
    }
    return profile
  } catch {
    return emptyProfile()
  }
}

/** 统一变更通道：load（已结算）→ 纯函数变更 → 再结算 → 有变化才落盘并发事件/埋点 */
function mutate(
  fn: (p: GrowthProfile) => { profile: GrowthProfile; gained?: number },
  xpEvent?: { feature: string },
): { profile: GrowthProfile; gained: number } {
  const base = loadGrowthProfile()
  const before = JSON.stringify(base)
  const r = fn(base)
  const { profile, events } = settleProfile(r.profile)
  const gained = r.gained ?? 0
  if (JSON.stringify(profile) !== before) {
    saveGrowthProfile(profile)
    emitSettleEvents(events)
    if (gained > 0 && xpEvent) trackGrowthEvent('growth_xp_credited', { feature: xpEvent.feature, amount: gained })
  }
  return { profile, gained }
}

export function recordGrowthEvent(kind: GrowthFeature, opts: AwardOpts = {}): GrowthProfile {
  return mutate((p) => awardEvent(p, kind, opts), { feature: kind }).profile
}

export function recordIdleMinute(): GrowthProfile {
  return mutate((p) => awardIdleMinute(p), { feature: 'idle' }).profile
}

export function recordDailyVisitOnce(): GrowthProfile {
  const base = loadGrowthProfile()
  const key = growthDayKey(new Date())
  // 到访分是否已发只认 visitGranted（其他动作先点亮当日也不能吞掉到访分）
  if (base.days[key]?.visitGranted) return base
  const r = mutate((p) => recordDailyVisit(p), { feature: 'daily_visit' })
  trackGrowthEvent('streak_day_lit', { streak: currentStreak(r.profile) })
  return r.profile
}

export function claimHomepage(): { profile: GrowthProfile; gained: number } {
  const r = mutate((p) => claimHomepageReward(p), { feature: 'homepage' })
  return { profile: r.profile, gained: r.gained }
}

export function claimPwaInstallAction(): GrowthProfile {
  return mutate((p) => claimPwaInstall(p), { feature: 'pwa_install' }).profile
}

export function recordCustomSiteAddedAction(): GrowthProfile {
  return mutate((p) => recordCustomSiteAdded(p)).profile
}

export function recordPageVisitAction(page: string): GrowthProfile {
  return mutate((p) => recordPageVisit(p, page)).profile
}

export function recordSeasonZoneVisitAction(): GrowthProfile {
  return mutate((p) => recordSeasonZoneVisit(p)).profile
}

export function openDailyChestAction(rng?: () => number): { profile: GrowthProfile; result: ChestResult } {
  const base = loadGrowthProfile()
  const before = JSON.stringify(base)
  const { profile: opened, result } = openDailyChest(base, new Date(), rng)
  const { profile, events } = settleProfile(opened)
  if (JSON.stringify(profile) !== before) {
    saveGrowthProfile(profile)
    emitSettleEvents(events)
    if (result.ok) {
      trackGrowthEvent('growth_chest_opened', {
        tier: result.tier ?? '',
        xp: result.fixedXp + result.bonusXp,
        card: result.gotCard ? 1 : 0,
      })
    }
  }
  return { profile, result }
}

/** 设置/修改每周休息日：首次设置免费，之后每月可改 1 次 */
export function setRestWeekdayAction(weekday: number): { profile: GrowthProfile; ok: boolean; reason?: string } {
  const base = loadGrowthProfile()
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { profile: base, ok: false, reason: 'invalid' }
  if (base.restWeekday === weekday) return { profile: base, ok: true }
  const today = growthDayKey(new Date())
  if (base.restWeekday != null && base.restChangedKey && base.restChangedKey.slice(0, 7) === today.slice(0, 7)) {
    return { profile: base, ok: false, reason: 'monthly-limit' }
  }
  const next: GrowthProfile = {
    ...base,
    restWeekday: weekday,
    restChangedKey: base.restWeekday != null ? today : base.restChangedKey,
  }
  const { profile, events } = settleProfile(next)
  saveGrowthProfile(profile)
  emitSettleEvents(events)
  return { profile, ok: true }
}

export function dismissNoticeAction(id: string): GrowthProfile {
  const base = loadGrowthProfile()
  if (!base.pendingNotices.some((n) => n.id === id)) return base
  const next: GrowthProfile = { ...base, pendingNotices: base.pendingNotices.filter((n) => n.id !== id) }
  saveGrowthProfile(next)
  return next
}

export function markRookiePanelSeenAction(): GrowthProfile {
  const base = loadGrowthProfile()
  if (base.rookiePanelSeen) return base
  const next: GrowthProfile = { ...base, rookiePanelSeen: true }
  saveGrowthProfile(next)
  return next
}

/** 登录态探测结果同步进身份档（tracker 挂载时调用；登出置 false，倍率即时回落） */
export function markMemberSeenAction(seen: boolean): GrowthProfile {
  const base = loadGrowthProfile()
  if (base.memberSeen === seen) return base
  const next: GrowthProfile = { ...base, memberSeen: seen }
  saveGrowthProfile(next)
  return next
}
