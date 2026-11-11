/**
 * 用户成长档案（等级 / 经验 / 徽章 / 挂机）——纯本机实现。
 *
 * 为什么是本机档案：站内帐号体系（NextAuth + 中枢用户）目前没有成长数据的
 * 服务端落点，本模块与 scene-usage.ts 同一条纪律——数据只存浏览器
 * localStorage、不回传服务端，用户中心页面会如实标注「本机成长档案」。
 * 换设备/清缓存不会同步，这一点不藏着。
 *
 * 经验纪律（防刷与诚实）：
 *  - 鼓励「把功能用全」：每个功能生涯首次使用 +20、每日首次 +10；
 *  - 同一功能当日反复用：第 2–5 次每次 +2，之后 0——刷不出等级；
 *  - 探索不同一级分类：每个新分类生涯一次 +15；
 *  - 挂机：页面可见时每分钟 +1，每日上限 30，切后台即停（组件侧控制）；
 *  - 「设为首页」领取：一次性 +100 并开启 ×1.5 加速。网页无法检测用户
 *    是否真的设了主页，所以这是自述领取、只放大他之后真实用功能赚的
 *    经验，机制自平衡，文案如实写「设置好回来领取」。
 */

export const GROWTH_STORAGE_KEY = 'navhub.growth.v1'
export const GROWTH_UPDATED_EVENT = 'navhub:growth-updated'
/**
 * 小猫猫挂件的聊天事件桥（A12）：挂件是独立脚本、按设计只读成长档案，
 * 它在用户发出一条聊天消息时只 dispatch 这个事件、不写任何成长数据；
 * 站内 GrowthTracker 监听后走 recordGrowthEvent('ai_chat') 统一落账，
 * 经验口径（首次/每日/重复递减）与其它功能完全一致。
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

export const FEATURE_META: Record<GrowthFeature, { title: string; desc: string; href: string }> = {
  ai_find: { title: 'AI 智能找站', desc: '在首页用一句话描述想找的网站', href: '/' },
  ai_chat: { title: '和小猫猫聊天', desc: '点右下角小猫猫，问它找站', href: '/' },
  scene_open: { title: '场景包', desc: '做 PPT、追短剧等成套工具链，一点就开工', href: '/' },
  category_visit: { title: '逛分类', desc: '14 个一级分类挨个逛逛，总有新发现', href: '/' },
  search: { title: '站内搜索', desc: '记得名字时直接搜最快', href: '/search' },
  drama_visit: { title: '短剧专区', desc: '免费短剧和各大平台短剧都在这', href: '/category/duanju' },
  site_open: { title: '打开站点', desc: '点开任意站点卡片去逛逛', href: '/' },
  favorite_add: { title: '收藏站点', desc: '把常用的站收进「我的收藏」', href: '/favorites' },
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
export const BOOST_MULTIPLIER = 1.5

export interface LevelDef {
  level: number
  title: string
  xp: number
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
]

export interface GrowthDay {
  xp: number
  counts: Partial<Record<GrowthFeature, number>>
  idleMinutes: number
}

export interface GrowthProfile {
  v: 1
  totalXp: number
  /** 「设为首页」领取后的经验加速是否开启 */
  boost: boolean
  homepageClaimedAt: string | null
  createdAt: string
  days: Record<string, GrowthDay>
  features: Partial<Record<GrowthFeature, { count: number; firstDate: string }>>
  categories: string[]
  scenes: string[]
  activeDates: string[]
  dramaDates: string[]
  idleTotalMinutes: number
}

/** 本地时区的 YYYY-MM-DD（ streak 与每日重置都按访客本地天算） */
export function todayKey(d: Date = new Date()): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function emptyProfile(now: Date = new Date()): GrowthProfile {
  return {
    v: 1,
    totalXp: 0,
    boost: false,
    homepageClaimedAt: null,
    createdAt: now.toISOString(),
    days: {},
    features: {},
    categories: [],
    scenes: [],
    activeDates: [],
    dramaDates: [],
    idleTotalMinutes: 0,
  }
}

/** 解析存储原始值：坏数据一律回空档案，本地脏数据不许把页面搞崩 */
export function parseGrowthProfile(raw: string | null): GrowthProfile {
  if (!raw) return emptyProfile()
  try {
    const p = JSON.parse(raw) as Partial<GrowthProfile>
    if (!p || typeof p !== 'object' || Array.isArray(p)) return emptyProfile()
    const base = emptyProfile()
    return {
      ...base,
      totalXp: typeof p.totalXp === 'number' && Number.isFinite(p.totalXp) && p.totalXp >= 0 ? Math.floor(p.totalXp) : 0,
      boost: p.boost === true,
      homepageClaimedAt: typeof p.homepageClaimedAt === 'string' ? p.homepageClaimedAt : null,
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : base.createdAt,
      days: p.days && typeof p.days === 'object' && !Array.isArray(p.days) ? p.days : {},
      features: p.features && typeof p.features === 'object' && !Array.isArray(p.features) ? p.features : {},
      categories: Array.isArray(p.categories) ? p.categories.filter((x) => typeof x === 'string') : [],
      scenes: Array.isArray(p.scenes) ? p.scenes.filter((x) => typeof x === 'string') : [],
      activeDates: Array.isArray(p.activeDates) ? p.activeDates.filter((x) => typeof x === 'string') : [],
      dramaDates: Array.isArray(p.dramaDates) ? p.dramaDates.filter((x) => typeof x === 'string') : [],
      idleTotalMinutes:
        typeof p.idleTotalMinutes === 'number' && Number.isFinite(p.idleTotalMinutes) && p.idleTotalMinutes >= 0
          ? Math.floor(p.idleTotalMinutes)
          : 0,
    }
  } catch {
    return emptyProfile()
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function loadGrowthProfile(storage: Storage | null = defaultStorage()): GrowthProfile {
  if (!storage) return emptyProfile()
  try {
    return parseGrowthProfile(storage.getItem(GROWTH_STORAGE_KEY))
  } catch {
    return emptyProfile()
  }
}

export function saveGrowthProfile(profile: GrowthProfile, storage: Storage | null = defaultStorage()): void {
  if (!storage) return
  try {
    storage.setItem(GROWTH_STORAGE_KEY, JSON.stringify(profile))
  } catch {
    /* 写不进去就只丢这一次记录，不抛错崩页 */
  }
  try {
    window.dispatchEvent(new CustomEvent(GROWTH_UPDATED_EVENT))
  } catch {
    /* 非浏览器环境无事件可发 */
  }
}

function cloneProfile(p: GrowthProfile): GrowthProfile {
  return JSON.parse(JSON.stringify(p)) as GrowthProfile
}

function dayOf(profile: GrowthProfile, key: string): GrowthDay {
  const day = profile.days[key] ?? { xp: 0, counts: {}, idleMinutes: 0 }
  profile.days[key] = day
  return day
}

function applyXp(profile: GrowthProfile, day: GrowthDay, base: number): number {
  const gained = profile.boost && base > 0 ? Math.floor(base * BOOST_MULTIPLIER) : base
  profile.totalXp += gained
  day.xp += gained
  return gained
}

export interface AwardResult {
  profile: GrowthProfile
  gained: number
}

/**
 * 记一次功能使用并结算经验。opts.categoryId / opts.sceneId 用于探索类奖励与徽章计数。
 * 规则见文件头；同一天同一功能超过 REPEAT_LIMIT 次后 gained=0，但使用计数照常累积（徽章要看真实用量）。
 */
export function awardEvent(
  input: GrowthProfile,
  kind: GrowthFeature,
  opts: { categoryId?: string; sceneId?: string } = {},
  now: Date = new Date(),
): AwardResult {
  const profile = cloneProfile(input)
  const key = todayKey(now)
  const day = dayOf(profile, key)
  if (!profile.activeDates.includes(key)) profile.activeDates.push(key)

  const feature = profile.features[kind] ?? { count: 0, firstDate: key }
  const isFirstEver = feature.count === 0
  feature.count += 1
  profile.features[kind] = feature
  day.counts[kind] = (day.counts[kind] ?? 0) + 1
  const todayCount = day.counts[kind]

  if (kind === 'scene_open' && opts.sceneId && !profile.scenes.includes(opts.sceneId)) {
    profile.scenes.push(opts.sceneId)
  }
  if (kind === 'drama_visit' && !profile.dramaDates.includes(key)) {
    profile.dramaDates.push(key)
  }

  let base = 0
  if (kind === 'category_visit' && opts.categoryId) {
    if (!profile.categories.includes(opts.categoryId)) {
      profile.categories.push(opts.categoryId)
      base = CATEGORY_NEW_XP + (isFirstEver ? FEATURE_FIRST_EVER_XP : 0)
    }
  }
  if (base === 0) {
    if (isFirstEver) base = FEATURE_FIRST_EVER_XP + DAILY_FIRST_XP
    else if (todayCount === 1) base = DAILY_FIRST_XP
    else if (todayCount <= REPEAT_LIMIT) base = REPEAT_XP
  }

  const gained = applyXp(profile, day, base)
  return { profile, gained }
}

/** 挂机一分钟：每日封顶 IDLE_DAILY_CAP_MINUTES 分钟，封顶后 gained=0 */
export function awardIdleMinute(input: GrowthProfile, now: Date = new Date()): AwardResult {
  const profile = cloneProfile(input)
  const key = todayKey(now)
  const day = dayOf(profile, key)
  if (!profile.activeDates.includes(key)) profile.activeDates.push(key)
  if (day.idleMinutes >= IDLE_DAILY_CAP_MINUTES) return { profile, gained: 0 }
  day.idleMinutes += 1
  profile.idleTotalMinutes += 1
  const gained = applyXp(profile, day, IDLE_XP_PER_MINUTE)
  return { profile, gained }
}

/** 每日首次到访：记活跃日（连续访问徽章靠它）+ 小额经验，一天只给一次 */
export function recordDailyVisit(input: GrowthProfile, now: Date = new Date()): AwardResult & { isNewDay: boolean } {
  const key = todayKey(now)
  if (input.activeDates.includes(key)) return { profile: input, gained: 0, isNewDay: false }
  const profile = cloneProfile(input)
  profile.activeDates.push(key)
  const day = dayOf(profile, key)
  const gained = applyXp(profile, day, DAILY_VISIT_XP)
  return { profile, gained, isNewDay: true }
}

/** 「设为首页」自述领取：一次性 +100 并开启加速；重复领取 gained=0 且不改状态 */
export function claimHomepageReward(input: GrowthProfile, now: Date = new Date()): AwardResult {
  if (input.homepageClaimedAt) return { profile: input, gained: 0 }
  const profile = cloneProfile(input)
  const key = todayKey(now)
  const day = dayOf(profile, key)
  if (!profile.activeDates.includes(key)) profile.activeDates.push(key)
  profile.homepageClaimedAt = now.toISOString()
  profile.boost = true
  // 领取奖励本身不再乘加速（加速从领取之后才生效），直接入账
  profile.totalXp += HOMEPAGE_CLAIM_XP
  day.xp += HOMEPAGE_CLAIM_XP
  return { profile, gained: HOMEPAGE_CLAIM_XP }
}

/* ---------------- 存储包装（组件侧只调这些） ---------------- */

export function recordGrowthEvent(
  kind: GrowthFeature,
  opts: { categoryId?: string; sceneId?: string } = {},
): AwardResult {
  const { profile, gained } = awardEvent(loadGrowthProfile(), kind, opts)
  saveGrowthProfile(profile)
  return { profile, gained }
}

export function recordIdleMinute(): AwardResult {
  const { profile, gained } = awardIdleMinute(loadGrowthProfile())
  // 封顶后每分钟还写一次盘没意义：gained=0 且分钟数没变时跳过保存
  if (gained > 0) saveGrowthProfile(profile)
  return { profile, gained }
}

export function recordDailyVisitOnce(): AwardResult {
  const { profile, gained, isNewDay } = recordDailyVisit(loadGrowthProfile())
  if (isNewDay) saveGrowthProfile(profile)
  return { profile, gained }
}

export function claimHomepage(): AwardResult {
  const { profile, gained } = claimHomepageReward(loadGrowthProfile())
  if (gained > 0) saveGrowthProfile(profile)
  return { profile, gained }
}

/* ---------------- 等级与徽章（纯派生） ---------------- */

export interface LevelProgress {
  level: number
  title: string
  floorXp: number
  nextLevel: number | null
  nextTitle: string | null
  nextXp: number | null
  /** 距下一级还差多少经验，满级为 0 */
  toNext: number
  /** 本级内进度 0..1 */
  progress: number
}

export function levelProgress(totalXp: number): LevelProgress {
  let current = LEVELS[0]!
  for (const def of LEVELS) {
    if (totalXp >= def.xp) current = def
  }
  const next = LEVELS.find((d) => d.level === current.level + 1) ?? null
  const span = next ? next.xp - current.xp : 0
  return {
    level: current.level,
    title: current.title,
    floorXp: current.xp,
    nextLevel: next?.level ?? null,
    nextTitle: next?.title ?? null,
    nextXp: next?.xp ?? null,
    toNext: next ? Math.max(0, next.xp - totalXp) : 0,
    progress: next ? Math.min(1, Math.max(0, (totalXp - current.xp) / span)) : 1,
  }
}

/** 当前连续访问天数：以今天（或昨天，容忍还没打开的今天）为终点往回数 */
export function currentStreak(profile: GrowthProfile, now: Date = new Date()): number {
  const set = new Set(profile.activeDates)
  let streak = 0
  const cursor = new Date(now)
  if (!set.has(todayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (set.has(todayKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export interface Badge {
  id: string
  title: string
  desc: string
  icon: string
  earned: boolean
  progressText: string
}

export function deriveBadges(profile: GrowthProfile, now: Date = new Date()): Badge[] {
  const usedCount = Object.keys(profile.features).length
  const sceneCount = profile.scenes.length
  const catCount = profile.categories.length
  const streak = currentStreak(profile, now)
  const favCount = profile.features.favorite_add?.count ?? 0
  const dramaDays = profile.dramaDates.length
  return [
    { id: 'first-step', title: '第一步', desc: '用过任意一个站内功能', icon: '🐾', earned: usedCount >= 1, progressText: `${usedCount} / 1 个功能` },
    { id: 'ai-helper', title: 'AI 找站新手', desc: '第一次用 AI 智能找站', icon: '🔍', earned: (profile.features.ai_find?.count ?? 0) >= 1, progressText: `${profile.features.ai_find?.count ?? 0} / 1 次` },
    { id: 'cat-talk', title: '猫语者', desc: '第一次和小猫猫聊天', icon: '💬', earned: (profile.features.ai_chat?.count ?? 0) >= 1, progressText: `${profile.features.ai_chat?.count ?? 0} / 1 次` },
    { id: 'scene-explorer', title: '场景探索者', desc: '用过 5 个不同的场景包', icon: '🧭', earned: sceneCount >= 5, progressText: `${sceneCount} / 5 个场景` },
    { id: 'scene-master', title: '场景大师', desc: '用过 12 个不同的场景包', icon: '🎒', earned: sceneCount >= 12, progressText: `${sceneCount} / 12 个场景` },
    { id: 'category-explorer', title: '分类漫游者', desc: '逛过 5 个不同的一级分类', icon: '🗺️', earned: catCount >= 5, progressText: `${catCount} / 5 个分类` },
    { id: 'category-master', title: '全站通', desc: '逛过 10 个不同的一级分类', icon: '🌏', earned: catCount >= 10, progressText: `${catCount} / 10 个分类` },
    { id: 'drama-fan', title: '追剧达人', desc: '3 个不同的日子来过短剧专区', icon: '🎬', earned: dramaDays >= 3, progressText: `${dramaDays} / 3 天` },
    { id: 'collector', title: '收藏家', desc: '收藏过 5 个站点', icon: '⭐', earned: favCount >= 5, progressText: `${favCount} / 5 个收藏` },
    { id: 'streak-3', title: '三天打卡', desc: '连续访问 3 天', icon: '🔥', earned: streak >= 3, progressText: `连续 ${streak} / 3 天` },
    { id: 'streak-7', title: '一周不断档', desc: '连续访问 7 天', icon: '🏆', earned: streak >= 7, progressText: `连续 ${streak} / 7 天` },
    { id: 'idle-buddy', title: '陪伴时光', desc: '挂机陪伴累计 60 分钟', icon: '🌙', earned: profile.idleTotalMinutes >= 60, progressText: `${profile.idleTotalMinutes} / 60 分钟` },
    { id: 'homepage-guardian', title: '首页守护者', desc: '把本站设为浏览器首页', icon: '🏠', earned: profile.homepageClaimedAt !== null, progressText: profile.homepageClaimedAt ? '已点亮' : '未设置' },
  ]
}

export function todayXp(profile: GrowthProfile, now: Date = new Date()): number {
  return profile.days[todayKey(now)]?.xp ?? 0
}

export function todayIdleMinutes(profile: GrowthProfile, now: Date = new Date()): number {
  return profile.days[todayKey(now)]?.idleMinutes ?? 0
}
