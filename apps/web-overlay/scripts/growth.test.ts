/**
 * 成长档案（等级/经验/徽章/挂机/设为首页加速）的客户端逻辑测试。
 *
 * 锁定四条纪律：
 *  1. 经验规则：生涯首次/每日首次给得多，反复刷递减并封顶为 0；
 *  2. 挂机每日封顶、跨天重置；连续访问天数按本地日期算；
 *  3. 「设为首页」领取一次性生效、重复领取拦住；加速只乘之后赚到的经验；
 *  4. localStorage 坏数据回空档案，等级/徽章全部由档案纯派生。
 */
import { describe, expect, it } from 'vitest'
import {
  BOOST_MULTIPLIER,
  DAILY_FIRST_XP,
  FEATURE_FIRST_EVER_XP,
  GROWTH_STORAGE_KEY,
  HOMEPAGE_CLAIM_XP,
  IDLE_DAILY_CAP_MINUTES,
  awardEvent,
  awardIdleMinute,
  claimHomepageReward,
  currentStreak,
  deriveBadges,
  emptyProfile,
  levelProgress,
  parseGrowthProfile,
  recordDailyVisit,
  todayKey,
} from '../src/lib/growth'
import { detectBrowser, homepageSteps } from '../src/lib/homepage-guide'

const day = (s: string) => new Date(`${s}T12:00:00`)

describe('经验规则', () => {
  it('生涯首次 = 首次奖励+每日首次，当日第 2 次起递减，第 6 次起为 0', () => {
    let p = emptyProfile(day('2026-11-10'))
    const first = awardEvent(p, 'search', {}, day('2026-11-10'))
    expect(first.gained).toBe(FEATURE_FIRST_EVER_XP + DAILY_FIRST_XP)
    p = first.profile
    let last = 0
    for (let i = 0; i < 4; i++) {
      const r = awardEvent(p, 'search', {}, day('2026-11-10'))
      expect(r.gained).toBe(2)
      p = r.profile
      last = r.gained
    }
    expect(last).toBe(2)
    const sixth = awardEvent(p, 'search', {}, day('2026-11-10'))
    expect(sixth.gained).toBe(0)
    // 计数照常累积（徽章看真实用量）
    expect(sixth.profile.features.search?.count).toBe(6)
  })

  it('跨天后每日首次奖励恢复', () => {
    let p = emptyProfile(day('2026-11-10'))
    p = awardEvent(p, 'search', {}, day('2026-11-10')).profile
    const nextDay = awardEvent(p, 'search', {}, day('2026-11-11'))
    expect(nextDay.gained).toBe(DAILY_FIRST_XP)
  })

  it('新分类探索给 15，同分类再逛走普通规则', () => {
    let p = emptyProfile(day('2026-11-10'))
    const r1 = awardEvent(p, 'category_visit', { categoryId: 'ai-tools' }, day('2026-11-10'))
    expect(r1.gained).toBe(15 + FEATURE_FIRST_EVER_XP)
    p = r1.profile
    const r2 = awardEvent(p, 'category_visit', { categoryId: 'ai-tools' }, day('2026-11-10'))
    expect(r2.gained).toBe(2)
    expect(r2.profile.categories).toEqual(['ai-tools'])
  })

  it('场景包按不同 sceneId 计数，重复打开不重复计徽章进度', () => {
    let p = emptyProfile(day('2026-11-10'))
    p = awardEvent(p, 'scene_open', { sceneId: 'make-ppt' }, day('2026-11-10')).profile
    p = awardEvent(p, 'scene_open', { sceneId: 'make-ppt' }, day('2026-11-10')).profile
    p = awardEvent(p, 'scene_open', { sceneId: 'edit-video' }, day('2026-11-10')).profile
    expect(p.scenes).toEqual(['make-ppt', 'edit-video'])
  })
})

describe('挂机与连续访问', () => {
  it('挂机每分钟 +1，达到每日上限后为 0；跨天重新计', () => {
    let p = emptyProfile(day('2026-11-10'))
    for (let i = 0; i < IDLE_DAILY_CAP_MINUTES; i++) {
      const r = awardIdleMinute(p, day('2026-11-10'))
      expect(r.gained).toBe(1)
      p = r.profile
    }
    expect(awardIdleMinute(p, day('2026-11-10')).gained).toBe(0)
    expect(awardIdleMinute(p, day('2026-11-11')).gained).toBe(1)
    expect(p.idleTotalMinutes).toBe(IDLE_DAILY_CAP_MINUTES)
  })

  it('每日首次到访只给一次，连续天数正确', () => {
    let p = emptyProfile(day('2026-11-08'))
    expect(recordDailyVisit(p, day('2026-11-08')).isNewDay).toBe(true)
    p = recordDailyVisit(p, day('2026-11-08')).profile
    expect(recordDailyVisit(p, day('2026-11-08')).gained).toBe(0)
    p = recordDailyVisit(p, day('2026-11-09')).profile
    p = recordDailyVisit(p, day('2026-11-10')).profile
    expect(currentStreak(p, day('2026-11-10'))).toBe(3)
    const badges = deriveBadges(p, day('2026-11-10'))
    expect(badges.find((b) => b.id === 'streak-3')?.earned).toBe(true)
    expect(badges.find((b) => b.id === 'streak-7')?.earned).toBe(false)
  })
})

describe('设为首页领取与加速', () => {
  it('领取一次性 +100 并开启加速，重复领取为 0', () => {
    const p0 = emptyProfile(day('2026-11-10'))
    const r = claimHomepageReward(p0, day('2026-11-10'))
    expect(r.gained).toBe(HOMEPAGE_CLAIM_XP)
    expect(r.profile.boost).toBe(true)
    expect(r.profile.totalXp).toBe(HOMEPAGE_CLAIM_XP)
    const again = claimHomepageReward(r.profile, day('2026-11-10'))
    expect(again.gained).toBe(0)
    const badge = deriveBadges(r.profile, day('2026-11-10')).find((b) => b.id === 'homepage-guardian')
    expect(badge?.earned).toBe(true)
  })

  it('加速只乘领取之后赚到的经验（×1.5 向下取整）', () => {
    let p = claimHomepageReward(emptyProfile(day('2026-11-10')), day('2026-11-10')).profile
    const r = awardEvent(p, 'search', {}, day('2026-11-10'))
    expect(r.gained).toBe(Math.floor((FEATURE_FIRST_EVER_XP + DAILY_FIRST_XP) * BOOST_MULTIPLIER))
    expect(BOOST_MULTIPLIER).toBe(1.5)
  })
})

describe('等级与档案解析', () => {
  it('等级进度：0 经验 Lv1，跨过门槛升级，满级 toNext=0', () => {
    expect(levelProgress(0).level).toBe(1)
    expect(levelProgress(59).level).toBe(1)
    expect(levelProgress(60).level).toBe(2)
    expect(levelProgress(60).toNext).toBe(120)
    expect(levelProgress(99999).level).toBe(16) // v2 扩容至 16 级（Lv1–8 门槛不变）
    expect(levelProgress(99999).toNext).toBe(0)
  })

  it('坏数据回空档案，好数据字段保全', () => {
    expect(parseGrowthProfile(null).totalXp).toBe(0)
    expect(parseGrowthProfile('{oops').totalXp).toBe(0)
    expect(parseGrowthProfile('[]').totalXp).toBe(0)
    const p = emptyProfile(day('2026-11-10'))
    p.totalXp = 123
    p.boost = true
    const back = parseGrowthProfile(JSON.stringify(p))
    expect(back.totalXp).toBe(123)
    expect(back.boost).toBe(true)
    expect(GROWTH_STORAGE_KEY).toContain('growth')
    expect(todayKey(day('2026-11-10'))).toBe('2026-11-10')
  })
})

describe('设为首页浏览器识别', () => {
  it('UA 分支：Edge 优先于 Chrome，iOS 独立，Firefox/Safari 正确', () => {
    expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0')).toBe('edge')
    expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36')).toBe('chrome')
    expect(detectBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0')).toBe('firefox')
    expect(detectBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15')).toBe('safari')
    expect(detectBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('ios')
    expect(detectBrowser('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36')).toBe('android')
    expect(detectBrowser('curl/8.0')).toBe('unknown')
  })

  it('每种浏览器都有非空步骤', () => {
    for (const kind of ['edge', 'chrome', 'firefox', 'safari', 'ios', 'android', 'unknown'] as const) {
      expect(homepageSteps(kind).length).toBeGreaterThanOrEqual(3)
    }
  })
})
