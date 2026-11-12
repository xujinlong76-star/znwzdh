/**
 * 成长体系 v2 定稿断言（GROWTH_ADVANCED_PLAN_V2）：
 * 迁移零变化 / 04:00 切日 / 倍率三档与封顶 / 使用类 300 上限 / 同站硬化 /
 * 收藏净增锁 / 冻结垫付与周期补给 / 休息日透明 / Earn Back / 宝箱保底 /
 * 任务发放幂等 / 赛季 SP 镜像与季中事件 / 新手链 D1 达 Lv2 / 回归包。
 * 时间全部用注入的 now 控制（本地时区构造），不依赖真实时钟。
 */
import { describe, expect, it } from 'vitest'
import {
  assignDailySlots,
  awardEvent,
  awardIdleMinute,
  claimHomepageReward,
  currentMultiplier,
  currentStreak,
  dailyTaskStatus,
  deriveBadges,
  emptyProfile,
  growthDayKey,
  isV1Raw,
  levelProgress,
  openDailyChest,
  parseGrowthProfile,
  recordDailyVisit,
  seasonCalendar,
  settleProfile,
  weeklyTaskStatus,
  type GrowthProfile,
} from '../src/lib/growth'

/** 本地时间构造：2026 年（赛季第 4 季窗口内挑普通日） */
function at(month: number, day: number, hour = 12, minute = 0): Date {
  return new Date(2026, month - 1, day, hour, minute)
}

function key(month: number, day: number): string {
  return growthDayKey(at(month, day))
}

/** 造一个「连续点亮 n 天、截至某日」的档案（直接写状态，绕过逐日调用；时间一律正午，避开 04:00 切日平移） */
function streakProfile(days: number, endMonth: number, endDay: number): GrowthProfile {
  const p = emptyProfile(at(endMonth, endDay))
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(2026, endMonth - 1, endDay - i, 12)
    const k = growthDayKey(d)
    p.dayStates[k] = 'lit'
    p.activeDates.push(k)
    p.days[k] = { ...p.days[k], xp: 40, seasonXp: 0, visitGranted: true, usageXp: 40, counts: {}, idleMinutes: 0, sitesOpened: [], categoriesVisited: [], newCategories: [], searchTerms: [], pageVisits: [], favRewarded: 0, watchlistNew: 0, customSiteAdded: 0, dailySlots: null, dailyGranted: [], chestGranted: false, seasonZoneVisit: false, taskXp: 0 }
  }
  p.streakChain = { startKey: growthDayKey(new Date(2026, endMonth - 1, endDay - days + 1, 12)), supplyGiven: Math.floor((days - 1) / 7) }
  p.streakSettledThrough = growthDayKey(new Date(2026, endMonth - 1, endDay, 12))
  p.longestStreak = days
  p.pureLongestStreak = days
  p.lastActiveKey = growthDayKey(new Date(2026, endMonth - 1, endDay, 12))
  return p
}

describe('迁移 v1→v2', () => {
  const v1 = {
    v: 1,
    totalXp: 2100,
    boost: true,
    homepageClaimedAt: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    days: { '2026-11-08': { xp: 40, counts: { site_open: 3 }, idleMinutes: 10 } },
    features: { site_open: { count: 30, firstDate: '2026-09-01' }, favorite_add: { count: 6, firstDate: '2026-09-02' } },
    categories: ['ai'],
    scenes: [],
    activeDates: ['2026-11-06', '2026-11-07', '2026-11-08'],
    dramaDates: ['2026-11-07'],
    idleTotalMinutes: 120,
  }

  it('等级零变化：Lv8 老用户迁移后仍 Lv8，且得绝版纪念与旧徽章快照', () => {
    const p = parseGrowthProfile(JSON.stringify(v1), at(11, 9))
    expect(p.v).toBe(2)
    expect(p.totalXp).toBe(2100)
    expect(levelProgress(p.totalXp).level).toBe(8) // 迁移前后同为 Lv8（Lv1–8 门槛一字未改）
    expect(p.pioneerLegend).toBe(true)
    expect(p.legacyBadgeIds).toContain('collector') // v1 收藏 6 次 ≥5
    expect(p.legacyBadgeIds).toContain('homepage-guardian')
    expect(p.dayStates['2026-11-08']).toBe('lit')
    expect(p.longestStreak).toBe(3)
    expect(isV1Raw(JSON.stringify(v1))).toBe(true)
    expect(isV1Raw(JSON.stringify(p))).toBe(false)
  })

  it('Lv5 老用户迁移后仍 Lv5、无绝版纪念', () => {
    const p = parseGrowthProfile(JSON.stringify({ ...v1, totalXp: 700, activeDates: [] }), at(11, 9))
    expect(levelProgress(p.totalXp).level).toBe(5)
    expect(p.pioneerLegend).toBe(false)
  })

  it('Lv3 老用户迁移：Lv3 首赠标记已置，结算不重复发卡', () => {
    const p = parseGrowthProfile(JSON.stringify({ ...v1, totalXp: 200, activeDates: [] }), at(11, 9))
    expect(p.freezeGiftLevel3).toBe(true)
    const { profile } = settleProfile(p, at(11, 9))
    expect(profile.freezeCards).toBe(0)
  })
})

describe('04:00 切日', () => {
  it('凌晨 02:00 归前一个成长日，04:00 后归当日', () => {
    expect(growthDayKey(at(11, 9, 2, 0))).toBe(key(11, 8))
    expect(growthDayKey(at(11, 9, 3, 59))).toBe(key(11, 8))
    expect(growthDayKey(at(11, 9, 4, 0))).toBe(key(11, 9))
    expect(growthDayKey(at(11, 9, 12, 0))).toBe(key(11, 9))
  })

  it('凌晨到访记在前一个成长日', () => {
    const { profile, isNewDay } = recordDailyVisit(emptyProfile(at(11, 9, 2, 0)), at(11, 9, 2, 0))
    expect(isNewDay).toBe(true)
    expect(profile.activeDates).toEqual([key(11, 8)])
  })
})

describe('倍率与上限', () => {
  it('身份档三档取高、连胜加成、总封顶 ×2.0', () => {
    const base = emptyProfile(at(11, 9))
    expect(currentMultiplier(base, at(11, 9))).toBe(1.0)
    expect(currentMultiplier({ ...base, memberSeen: true }, at(11, 9))).toBeCloseTo(1.2)
    // 30 天连胜 + 设首页：1.5 + 0.3 = 1.8
    const s30 = streakProfile(30, 11, 8)
    s30.homepageClaimedAt = 'x'
    expect(currentMultiplier(s30, at(11, 9))).toBeCloseTo(1.8)
    // 30 天连胜 + 只有登录档也封顶逻辑：1.2 + 0.3 = 1.5
    const s30b = streakProfile(30, 11, 8)
    s30b.memberSeen = true
    expect(currentMultiplier(s30b, at(11, 9))).toBeCloseTo(1.5)
  })

  it('使用类单日 300 封顶，任务类不计入', () => {
    let p = emptyProfile(at(11, 9))
    // 用高倍率快速打满：设首页 ×1.5 后反复用不同功能刷使用类
    p = claimHomepageReward(p, at(11, 9)).profile
    for (let round = 0; round < 40; round += 1) {
      for (const kind of ['search', 'ai_chat', 'scene_open', 'drama_visit'] as const) {
        p = awardEvent(p, kind, {}, at(11, 9)).profile
      }
    }
    const day = p.days[key(11, 9)]!
    expect(day.usageXp).toBeLessThanOrEqual(300)
    const before = p.totalXp
    // 任务类发放（结算每日任务）不受使用上限影响
    p = awardEvent(p, 'brief_read', {}, at(11, 9)).profile
    const settled = settleProfile(p, at(11, 9)).profile
    expect(settled.days[key(11, 9)]!.taskXp).toBeGreaterThan(0)
    expect(settled.totalXp).toBeGreaterThan(before)
  })
})

describe('同站硬化与收藏净增锁', () => {
  it('同站连点 20 次：当日 site_open 入账 = 生涯首次 30，其后重复全 0', () => {
    let p = emptyProfile(at(11, 9))
    let total = 0
    for (let i = 0; i < 20; i += 1) {
      const r = awardEvent(p, 'site_open', { siteKey: 'https://a.example.com' }, at(11, 9))
      p = r.profile
      total += r.gained
    }
    expect(total).toBe(30) // 20 生涯首次 + 10 每日首次，重复段同站归零（v2 自审 #1 断言）
    // 重复段窗口内（当日第 2–5 次使用）换一个站：新站重复分恢复 +2
    let q = emptyProfile(at(11, 9))
    q = awardEvent(q, 'site_open', { siteKey: 'https://a.example.com' }, at(11, 9)).profile
    q = awardEvent(q, 'site_open', { siteKey: 'https://a.example.com' }, at(11, 9)).profile
    const r2 = awardEvent(q, 'site_open', { siteKey: 'https://b.example.com' }, at(11, 9))
    expect(r2.gained).toBe(2)
  })

  it('收藏同一站：终身只给 1 次分，取消再加也是 0', () => {
    const p = emptyProfile(at(11, 9))
    const first = awardEvent(p, 'favorite_add', { siteId: 'site-1' }, at(11, 9))
    expect(first.gained).toBe(30)
    const again = awardEvent(first.profile, 'favorite_add', { siteId: 'site-1' }, at(11, 9))
    expect(again.gained).toBe(0)
    expect(again.profile.features.favorite_add?.count).toBe(1) // 锁定不计任何计数
    const other = awardEvent(first.profile, 'favorite_add', { siteId: 'site-2' }, at(11, 9))
    expect(other.gained).toBe(2) // 新站是当日第 2 次用该功能 → 走重复段 +2（净增锁只拦同站）
  })
})

describe('冻结垫付 / 补给 / 休息日', () => {
  it('断 1 天：冻结卡自动垫付，连胜不断', () => {
    // 连胜 10 天至 11-08，11-09 缺席，11-10 回来结算
    const p = streakProfile(10, 11, 8)
    p.freezeCards = 1
    const { profile, events } = settleProfile(p, at(11, 10))
    expect(profile.dayStates[key(11, 9)]).toBe('frozen')
    expect(profile.freezeCards).toBe(0)
    expect(events.some((e) => e.type === 'freeze_used')).toBe(true)
    expect(currentStreak(profile, at(11, 10))).toBe(11) // 10 天 + 垫付日（今日未点亮按昨日起算含 frozen）
  })

  it('周期补给：链满 7 个自然日发 1 张', () => {
    const p = streakProfile(7, 11, 8) // 第 1 天在 11-02
    p.streakChain = { startKey: key(11, 2), supplyGiven: 0 }
    const { profile } = settleProfile(p, at(11, 9))
    expect(profile.freezeCards).toBe(1) // 11-09 距链首 7 天 → 补给 1
  })

  it('工作日型 90 天推演：每周缺 1 天靠补给+存量卡不断链', () => {
    // 模拟附录 A.4：链从 2026-08-14（周五）起，每周缺周六，周日回来结算垫付
    let p = emptyProfile(new Date(2026, 7, 14, 12))
    const start = new Date(2026, 7, 14, 12)
    for (let i = 0; i < 90; i += 1) {
      const now = new Date(start.getTime() + i * 86400000)
      const weekday = now.getDay()
      if (weekday !== 6) {
        // 非周六：到访点亮
        p = recordDailyVisit(p, now).profile
        p = settleProfile(p, now).profile
      } else {
        // 周六缺席：只在周日结算时走垫付——这里不做任何动作
      }
      if (weekday === 0) {
        // 周日回来时已在上面的分支结算（垫付发生在周日 load 的 settle 里）
      }
    }
    const last = new Date(start.getTime() + 89 * 86400000)
    const settled = settleProfile(p, last).profile
    expect(currentStreak(settled, last)).toBeGreaterThanOrEqual(85)
    expect(settled.longestStreak).toBeGreaterThanOrEqual(85)
  })

  it('休息日透明：设周三休息，周三缺席不断链不耗卡', () => {
    const p = streakProfile(6, 11, 3) // 10-29..11-03，11-04 是周三
    p.restWeekday = 3
    p.freezeCards = 1
    const { profile } = settleProfile(p, at(11, 5))
    expect(profile.dayStates[key(11, 4)]).toBe('rest')
    // 冻结卡 1 → 2：休息日没耗卡，且链龄满 7 个自然日触发周期补给 +1
    expect(profile.freezeCards).toBe(2)
  })
})

describe('Earn Back', () => {
  it('连胜 20 天断签：开 48h 抢救窗；完成简报+2 站后缺口填 rescued、链恢复', () => {
    let p = streakProfile(20, 11, 8)
    p.freezeCards = 0
    // 11-09、11-10 缺席，11-11 回来：结算时开窗
    const opened = settleProfile(p, at(11, 11, 10))
    p = opened.profile
    expect(p.earnBack).not.toBeNull()
    expect(p.earnBack!.brokenStreak).toBe(20)
    expect(opened.events.some((e) => e.type === 'earnback_opened')).toBe(true)
    // 做抢救动作
    p = recordDailyVisit(p, at(11, 11, 10, 5)).profile
    p = awardEvent(p, 'brief_read', {}, at(11, 11, 10, 6)).profile
    p = awardEvent(p, 'site_open', { siteKey: 'https://a.example.com' }, at(11, 11, 10, 7)).profile
    p = awardEvent(p, 'site_open', { siteKey: 'https://b.example.com' }, at(11, 11, 10, 8)).profile
    const done = settleProfile(p, at(11, 11, 11))
    expect(done.profile.earnBack).toBeNull()
    expect(done.profile.dayStates[key(11, 9)]).toBe('rescued')
    expect(done.profile.dayStates[key(11, 10)]).toBe('rescued')
    expect(done.events.some((e) => e.type === 'earnback_done')).toBe(true)
    expect(currentStreak(done.profile, at(11, 11, 12))).toBe(23) // 20 + 2 抢救日 + 今日
    expect(done.profile.earnBackUses).toHaveLength(1)
  })

  it('连胜 <7 天断签不开窗，直接断链并软着陆', () => {
    const p = streakProfile(5, 11, 8)
    const { profile, events } = settleProfile(p, at(11, 10))
    expect(profile.earnBack).toBeNull()
    expect(events.some((e) => e.type === 'streak_broken')).toBe(true)
    expect(profile.longestStreak).toBe(5) // 历史最长永存
  })

  it('抢救窗过期未完成：断链坐实、次数不消耗、旧链不复活', () => {
    let p = streakProfile(9, 11, 8)
    p = settleProfile(p, at(11, 10, 10)).profile
    expect(p.earnBack).not.toBeNull()
    // 49 小时后回来（窗已过）
    const late = settleProfile(p, at(11, 12, 11)).profile
    expect(late.earnBack).toBeNull()
    expect(late.earnBackUses).toHaveLength(0)
    // 复审高危 #1：过期后旧链必须清空，绝不能跨过缺口重锚到断签前的链
    expect(late.streakChain).toBeNull()
    // 重新点亮能正常建新链；冻结卡只有 Lv3 首赠的 1 张，旧链不会凭空发周期补给
    let q = recordDailyVisit(late, at(11, 12, 13)).profile
    q = settleProfile(q, at(11, 13)).profile
    q = recordDailyVisit(q, at(11, 13, 13)).profile
    q = settleProfile(q, at(11, 14)).profile
    expect(q.streakChain?.startKey).toBe(key(11, 12))
    expect(currentStreak(q, at(11, 14))).toBe(2)
    // 冻结卡为 0：旧链没发任何周期补给（本夹具 totalXp 仅到访分，也没触发 Lv3 首赠）
    expect(q.freezeCards).toBe(0)
  })
})

describe('每日任务与宝箱', () => {
  function allDoneDay(p: GrowthProfile, now: Date): GrowthProfile {
    // 用四种动作把三槽谓词都覆盖（浅层/核心/沉淀的候选池任一命中即可）
    p = awardEvent(p, 'brief_read', {}, now).profile
    p = awardEvent(p, 'site_open', { siteKey: 'https://a.example.com' }, now).profile
    p = awardEvent(p, 'site_open', { siteKey: 'https://b.example.com' }, now).profile
    p = awardEvent(p, 'ai_find', {}, now).profile
    p = awardEvent(p, 'search', { term: '新词' }, now).profile
    p = awardEvent(p, 'favorite_add', { siteId: 's1' }, now).profile
    p = awardEvent(p, 'category_visit', { categoryId: 'brand-new-cat' }, now).profile
    return p
  }

  it('三槽全清发 3×10 且幂等；宝箱固定 +15', () => {
    let p = emptyProfile(at(11, 9))
    p = allDoneDay(p, at(11, 9))
    const s1 = settleProfile(p, at(11, 9))
    const day = s1.profile.days[key(11, 9)]!
    expect(day.dailyGranted.sort()).toEqual(['core', 'settle', 'shallow'])
    // taskXp = 每日 3×10 + 每周 W5「满格一天」（当日入账 185 ≥120 同日达标 +40）
    expect(day.taskXp).toBe(70)
    const s2 = settleProfile(s1.profile, at(11, 9))
    expect(s2.profile.days[key(11, 9)]!.taskXp).toBe(70) // 再结算不重发
    const chest = openDailyChest(s2.profile, at(11, 9), () => 0.99)
    expect(chest.result.ok).toBe(true)
    expect(chest.result.fixedXp).toBe(15)
    expect(chest.result.tier).toBe('small')
    expect(chest.result.bonusXp).toBeGreaterThanOrEqual(5)
    const again = openDailyChest(chest.profile, at(11, 9), () => 0.99)
    expect(again.result.ok).toBe(false) // 每天只能开一次
  })

  it('宝箱连空保底：第 4 个必出卡；缺卡时卡档概率 30%', () => {
    let p = emptyProfile(at(11, 9))
    p = allDoneDay(p, at(11, 9))
    p = settleProfile(p, at(11, 9)).profile
    p.chestNoCardStreak = 3
    const chest = openDailyChest(p, at(11, 9), () => 0.99) // rng 指向小奖档也必出卡
    expect(chest.result.tier).toBe('card')
    expect(chest.result.gotCard).toBe(true)
    expect(chest.profile.chestNoCardStreak).toBe(0)
    // 缺卡概率：rng=0.25 在 18% 口径落中档、在 30% 口径落卡档
    let p2 = emptyProfile(at(11, 9))
    p2 = allDoneDay(p2, at(11, 9))
    p2 = settleProfile(p2, at(11, 9)).profile
    p2.freezeCards = 0
    const chest2 = openDailyChest(p2, at(11, 9), () => 0.25)
    expect(chest2.result.tier).toBe('card')
  })

  it('槽位分配确定性：同一天多次计算一致', () => {
    const p = emptyProfile(at(11, 9))
    expect(assignDailySlots(p, key(11, 9))).toEqual(assignDailySlots(p, key(11, 9)))
    expect(dailyTaskStatus(p, at(11, 9)).slots).toHaveLength(3)
  })
})

describe('赛季与季中内容', () => {
  it('赛季历法：第 4 季第 45 天 = 季中追光窗口（2026-11-11）', () => {
    const cal = seasonCalendar(at(11, 11))
    expect(cal.index).toBe(3)
    expect(cal.dayOfSeason).toBe(45)
  })

  it('成长值镜像 SP、赛季奖励不镜像（防自循环）', () => {
    let p = emptyProfile(at(11, 9))
    p = awardEvent(p, 'site_open', { siteKey: 'https://a.example.com' }, at(11, 9)).profile
    const spAfterAward = p.season.sp
    expect(spAfterAward).toBe(30)
    // 手工把 SP 顶到 100 → 结算发赛季 1 级小奖 +10，总 XP 增 10 但 SP 不增
    p.season.sp = 100
    const before = p.totalXp
    const { profile } = settleProfile(p, at(11, 9))
    expect(profile.season.levelGranted).toBe(1)
    expect(profile.totalXp).toBe(before + 10)
    expect(profile.season.sp).toBe(100)
  })

  it('季中事件：窗口内计数达标自动发奖，窗口外不发', () => {
    // 季中追光窗口 = 本季第 45–60 天 = 2026-11-11..11-26；事件指标只数窗口内的日子
    let p = emptyProfile(at(11, 11))
    for (const d of [11, 12, 13]) {
      p = awardEvent(p, 'ai_find', {}, at(11, d)).profile
      p = settleProfile(p, at(11, d)).profile
    }
    expect(p.season.eventGranted).toContain('mid-stage:ms-ai')
    // 季中寻宝（30–44 天）已过窗：收藏计数再多也不发它的奖
    let p2 = emptyProfile(at(11, 11))
    for (const s of ['a', 'b', 'c']) {
      p2 = awardEvent(p2, 'favorite_add', { siteId: s }, at(11, 11)).profile
    }
    p2 = settleProfile(p2, at(11, 11)).profile
    expect(p2.season.eventGranted).not.toContain('mid-treasure:mt-fav')
  })

  it('季中 SP 里程碑：窗口内 SP 达 800 发 +25（非镜像）', () => {
    const p = emptyProfile(at(11, 11))
    p.season.sp = 800
    const before = p.totalXp
    const { profile } = settleProfile(p, at(11, 11))
    expect(profile.season.midMilestonesGranted).toContain(800)
    expect(profile.totalXp).toBeGreaterThanOrEqual(before + 25)
    expect(profile.season.sp).toBe(800)
  })
})

describe('新手链与回归包', () => {
  it('新手 D1 靠生涯首次池自然达 Lv2（累计 ≥60）', () => {
    let p = emptyProfile(at(11, 9))
    let total = 0
    const acts: [Parameters<typeof awardEvent>[1], Parameters<typeof awardEvent>[2]][] = [
      ['site_open', { siteKey: 'https://a.example.com' }],
      ['brief_read', {}],
      ['favorite_add', { siteId: 's1' }],
      ['ai_find', {}],
      ['search', { term: 'x' }],
    ]
    for (const [kind, opts] of acts) {
      const r = awardEvent(p, kind, opts, at(11, 9))
      p = r.profile
      total += r.gained
    }
    expect(total).toBeGreaterThanOrEqual(95) // 附录 A.1：D1 理论 95 点（含到访另计）
    expect(levelProgress(p.totalXp).level).toBeGreaterThanOrEqual(2)
  })

  it('断档 30 天回归：今天真到访才发回归包（纯结算不触发；长断口不开抢救窗）', () => {
    const p = streakProfile(10, 10, 1) // 最后活跃 10-01
    const dry = settleProfile(p, at(11, 9)).profile
    expect(dry.returnPack).toBeNull() // 今天未点亮：纯结算不发（防每 30 天凭空再领）
    expect(dry.earnBack).toBeNull() // 断口在 38 天前：不开 Earn Back（复审高危 #2）
    const visited = recordDailyVisit(p, at(11, 9)).profile
    const { profile } = settleProfile(visited, at(11, 9))
    expect(profile.returnPack).not.toBeNull()
    expect(profile.pendingNotices.some((n) => n.kind === 'return')).toBe(true)
    expect(profile.freezeCards).toBeGreaterThanOrEqual(1)
  })

  it('挂机封顶口径：原始分钟 30 封顶，与倍率无关', () => {
    let p = claimHomepageReward(emptyProfile(at(11, 9)), at(11, 9)).profile // ×1.5
    for (let i = 0; i < 35; i += 1) p = awardIdleMinute(p, at(11, 9)).profile
    const day = p.days[key(11, 9)]!
    expect(day.idleMinutes).toBe(30)
  })
})

describe('复审回归（agy 独立复审 14 项）', () => {
  it('#5 冻结卡不够垫完整段缺口时一张都不扣，也不发矛盾通知', () => {
    const p = streakProfile(5, 11, 8)
    p.freezeCards = 1
    const { profile } = settleProfile(p, at(11, 11)) // 缺 11-09、11-10 两天，卡只有 1 张
    expect(profile.freezeCards).toBe(1)
    expect(currentStreak(profile, at(11, 11))).toBe(0)
    expect(profile.pendingNotices.some((n) => n.text.includes('留住了连胜'))).toBe(false)
    expect(profile.longestStreak).toBe(5)
  })

  it('#3 每日到访分与调用顺序无关：先做别的动作，到访分照发', () => {
    let p = emptyProfile(at(11, 9))
    p = awardEvent(p, 'site_open', { siteKey: 'https://a.com' }, at(11, 9)).profile
    const v = recordDailyVisit(p, at(11, 9))
    expect(v.gained).toBe(5)
    const v2 = recordDailyVisit(v.profile, at(11, 9))
    expect(v2.gained).toBe(0) // 但也只发一次
  })

  it('#8 同站连点不挤占新站的重复分窗口', () => {
    let p = emptyProfile(at(11, 9))
    for (let i = 0; i < 5; i += 1) {
      p = awardEvent(p, 'site_open', { siteKey: 'https://a.com' }, at(11, 9)).profile
    }
    const r = awardEvent(p, 'site_open', { siteKey: 'https://b.com' }, at(11, 9))
    expect(r.gained).toBe(2) // 当日第 2 个不同站点的新站重复分（×1.0）
  })

  it('#8 Earn Back 不能靠同站连点凑满「打开 2 个站」', () => {
    let p = streakProfile(9, 11, 8)
    p = settleProfile(p, at(11, 10, 10)).profile
    expect(p.earnBack).not.toBeNull()
    p = awardEvent(p, 'brief_read', {}, at(11, 10, 12)).profile
    p = awardEvent(p, 'site_open', { siteKey: 'https://a.com' }, at(11, 10, 12)).profile
    p = awardEvent(p, 'site_open', { siteKey: 'https://a.com' }, at(11, 10, 12)).profile
    const after = settleProfile(p, at(11, 10, 13)).profile
    expect(after.earnBack).not.toBeNull() // 只真正打开了 1 个站，抢救不算完成
  })

  it('#4 跨季：新季首笔入账不污染旧季足迹、旧季待发等级奖不清零、endedKey 是真实结束日', () => {
    const raw = {
      v: 2,
      totalXp: 0,
      createdAt: '2026-06-01T00:00:00.000Z',
      season: {
        index: 2, // 2026-06-30 .. 2026-09-27
        sp: 190, // 赛季 1 级（100 SP/级）待发奖
        levelGranted: 0,
        roamingGranted: 0,
        tasksGranted: [],
        eventGranted: [],
        milestonesGranted: [],
        midMilestonesGranted: [],
        contributionApproved: 0,
      },
      days: { '2026-09-20': { xp: 190, counts: {} } },
    }
    let p = parseGrowthProfile(JSON.stringify(raw), new Date(2026, 8, 20, 12))
    // 新季第一天先有一笔入账（结算之前）——旧实现会把这笔同时算进旧季足迹和新季 SP
    p = awardEvent(p, 'site_open', { siteKey: 'https://a.com' }, new Date(2026, 8, 28, 12)).profile
    const { profile } = settleProfile(p, new Date(2026, 8, 28, 12))
    expect(profile.seasonHistory).toHaveLength(1)
    expect(profile.seasonHistory[0]!.sp).toBe(190) // 没被新季入账污染成 220
    expect(profile.seasonHistory[0]!.endedKey).toBe('2026-09-27')
    expect(profile.season.index).toBe(3)
    expect(profile.season.sp).toBe(30) // 新季 SP 只含新季入账（30），旧季奖励记在旧季末日、不虚增今日
    expect(profile.totalXp).toBe(40) // 30（开站）+ 10（旧季 1 级待发奖，收尾补发没被抹掉）
  })

  it('#9 赛季满级漫游节点 + 里程碑卡满库存折算：赛季自身发放一概不镜像 SP', () => {
    const p = emptyProfile(at(11, 9))
    p.totalXp = 2000 // Lv8：冻结卡上限 3
    p.freezeCards = 3 // 满库存
    p.freezeGiftLevel3 = true // 首赠已领过，排除干扰
    p.season.sp = 2400 // 赛季 20 级（2000）+ 漫游 1 节点（400）
    p.weeks['2026-11-09'] = { granted: ['w1', 'w2', 'w3', 'w4', 'w5'] } // 本周（11-09 周一）任务预发完，隔离赛季不镜像断言
    const { profile } = settleProfile(p, at(11, 9))
    expect(profile.season.sp).toBe(2400)
    expect(profile.season.levelGranted).toBe(20)
    expect(profile.season.roamingGranted).toBe(1)
    expect(profile.freezeCards).toBe(3) // 满库存折算成经验，不超上限
    expect(profile.days[key(11, 9)]!.seasonXp).toBeGreaterThan(0)
  })

  it('#6 迁移快照：v1 集满 9 种功能的老用户保住「全能小猫」', () => {
    const v1full = {
      v: 1,
      totalXp: 100,
      createdAt: '2026-09-01T00:00:00.000Z',
      features: Object.fromEntries(
        ['ai_find', 'ai_chat', 'scene_open', 'category_visit', 'search', 'drama_visit', 'site_open', 'favorite_add', 'watchlist_progress'].map(
          (k) => [k, { count: 1, firstDate: '2026-09-01' }],
        ),
      ),
      activeDates: ['2026-11-08'],
      days: {},
    }
    const p = parseGrowthProfile(JSON.stringify(v1full), at(11, 9))
    expect(p.legacyBadgeIds).toContain('catalog-master')
    expect(deriveBadges(p, at(11, 9)).find((b) => b.id === 'catalog-master')?.earned).toBe(true)
  })

  it('#11 未来日期清洗：天记录/日期/指针全部钳制到当前成长日', () => {
    const raw = {
      v: 2,
      totalXp: 10,
      createdAt: '2026-11-01T00:00:00.000Z',
      days: { '2026-11-20': { xp: 10, counts: {} } },
      dayStates: { '2026-11-20': 'lit' },
      activeDates: ['2026-11-20'],
      streakSettledThrough: '2026-11-19',
      streakChain: { startKey: '2026-11-20', supplyGiven: 0 },
    }
    const p = parseGrowthProfile(JSON.stringify(raw), at(11, 9))
    expect(p.days['2026-11-20']).toBeUndefined()
    expect(p.activeDates).toEqual([])
    expect(p.streakChain).toBeNull()
    expect(p.streakSettledThrough === null || p.streakSettledThrough <= key(11, 9)).toBe(true)
  })

  it('#10 v1 迁移档案的点亮天数在周任务里不被漏计（activeDates 有、days 无）', () => {
    const v1w = {
      v: 1,
      totalXp: 2100,
      boost: true,
      homepageClaimedAt: '2026-10-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
      days: { '2026-11-08': { xp: 40, counts: {} } },
      features: {},
      activeDates: ['2026-11-06', '2026-11-07', '2026-11-08'],
    }
    const p = parseGrowthProfile(JSON.stringify(v1w), at(11, 8)) // 周日
    const w4 = weeklyTaskStatus(p, at(11, 8)).find((t) => t.id === 'w4')!
    expect(w4.current).toBe(3)
    expect(w4.done).toBe(true)
  })
})

describe('复审回归第二轮（agy 聚焦复核 5 点）', () => {
  it('R2-2 跨休息日的缺口按真实缺席天数前瞻：卡不够整段就不扣卡', () => {
    const p = streakProfile(1, 11, 2) // 只点亮周一 11-02
    p.restWeekday = 3 // 周三休息
    p.freezeCards = 1
    // 周二、周四缺席（周三休息透明），周五回来：真实缺口 2 天 > 卡 1 张
    const { profile } = settleProfile(p, at(11, 6))
    expect(profile.freezeCards).toBe(1) // 一张都不扣
    expect(profile.dayStates['2026-11-03']).toBeUndefined() // 没被白垫付
    expect(currentStreak(profile, at(11, 6))).toBe(0)
  })

  it('R2-3 抢救窗跨天：窗内不扣卡、不报断链；完成时缺口填 rescued 且卡保留', () => {
    let p = streakProfile(10, 11, 8)
    p = settleProfile(p, at(11, 10, 10)).profile
    expect(p.earnBack).not.toBeNull()
    p.freezeGiftLevel3 = true
    p.freezeCards = 1
    p = recordDailyVisit(p, at(11, 10, 12)).profile // 窗内点亮 11-10（还没做满抢救动作）
    const mid = settleProfile(p, at(11, 12, 9)) // 11-11 没来，窗还剩 1 小时
    expect(mid.profile.earnBack).not.toBeNull()
    expect(mid.profile.freezeCards).toBe(1) // 没被拿去垫 11-11
    expect(mid.profile.dayStates['2026-11-11']).toBeUndefined()
    expect(mid.events.some((e) => e.type === 'streak_broken')).toBe(false)
    // 窗内完成抢救动作
    let q = mid.profile
    q = awardEvent(q, 'brief_read', {}, at(11, 12, 9, 30)).profile
    q = awardEvent(q, 'site_open', { siteKey: 'https://a.com' }, at(11, 12, 9, 30)).profile
    q = awardEvent(q, 'site_open', { siteKey: 'https://b.com' }, at(11, 12, 9, 30)).profile
    const done = settleProfile(q, at(11, 12, 9, 31)).profile
    expect(done.earnBack).toBeNull()
    expect(done.dayStates['2026-11-11']).toBe('rescued')
    expect(done.freezeCards).toBe(1)
    expect(currentStreak(done, at(11, 12))).toBeGreaterThanOrEqual(13)
  })

  it('R2-4 未来结算点钳制到最后活跃日：时钟回拨后合法连胜链不被误毁', () => {
    const raw = {
      v: 2,
      totalXp: 300,
      createdAt: '2026-11-01T00:00:00.000Z',
      dayStates: { '2026-11-06': 'lit', '2026-11-07': 'lit', '2026-11-08': 'lit' },
      activeDates: ['2026-11-06', '2026-11-07', '2026-11-08'],
      lastActiveKey: '2026-11-08',
      streakChain: { startKey: '2026-11-06', supplyGiven: 0 },
      streakSettledThrough: '2026-11-19', // 时钟曾拨到未来留下的脏指针
    }
    const p = parseGrowthProfile(JSON.stringify(raw), at(11, 9))
    expect(p.streakSettledThrough).toBe('2026-11-08')
    const { profile } = settleProfile(p, at(11, 9))
    expect(profile.streakChain?.startKey).toBe('2026-11-06')
    expect(currentStreak(profile, at(11, 9))).toBe(3)
  })

  it('R2-1 换季收尾季中里程碑按第 60 天口径：窗口后才攒够的不补发，窗口内达标的补发', () => {
    const mk = (sp: number, levelGranted: number, days: Record<string, { xp: number }>) => ({
      v: 2,
      totalXp: 0,
      createdAt: '2026-06-01T00:00:00.000Z',
      season: {
        index: 2,
        sp,
        levelGranted,
        roamingGranted: 0,
        tasksGranted: [],
        eventGranted: [],
        milestonesGranted: [],
        midMilestonesGranted: [],
        contributionApproved: 0,
      },
      days,
    })
    // 第 60 天（08-28）时只有 500 SP，第 60 天后才攒到 900：收尾不补发 mid-800
    const late = parseGrowthProfile(
      JSON.stringify(mk(900, 9, { '2026-08-28': { xp: 500 }, '2026-09-20': { xp: 400 } })),
      new Date(2026, 8, 20, 12),
    )
    const lateDone = settleProfile(late, new Date(2026, 8, 28, 12))
    expect(lateDone.events.some((e) => e.detail === 'mid-800')).toBe(false)
    expect(lateDone.profile.totalXp).toBe(0)
    // 第 60 天时已有 850 SP：收尾补发 mid-800（+25）
    const early = parseGrowthProfile(
      JSON.stringify(mk(850, 8, { '2026-08-28': { xp: 850 } })),
      new Date(2026, 8, 20, 12),
    )
    const earlyDone = settleProfile(early, new Date(2026, 8, 28, 12))
    expect(earlyDone.events.some((e) => e.detail === 'mid-800')).toBe(true)
    expect(earlyDone.profile.totalXp).toBe(25)
  })
})
