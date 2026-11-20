/**
 * Batch 1 W6 PoC：MRU 升级（04 §3）——`mruScore` / `topFrequentVisits`。
 *
 * 验收：C1（Wox 公式手算三例，误差 < 0.01）、C2 后半（旧重度站不压新站，
 * lib 层）、C4（`topFrequentVisits` 现有单测期望值不变）。
 *
 * fib 边界说明（方案 §3.2 的 7 元表只有下标 0..6）：`daysAgo` 在 7 天内
 * 一支里按 1..7 取——ceil 取整下「当天内」算出的 daysAgo 是 0 或 1，
 * 两者都按「当天」取 fib[6]=89；visitedAt 恰好等于 now 时同样处理，
 * 不取 fib[7] 越界。见 `offline-recent.ts` 的 `MRU_FIB_BONUS` 注释。
 *
 * C2 前半（count=1 的误点站不进空查询「最近访问」置顶区）与 C3 的
 * 300ms/IndexedDB 延迟模拟不在本文件：前者是空面板分区接线（不在 W6
 * 的四处改动内，见 PoC 报告遗留），后者需要 IndexedDB 延迟注入，
 * node 环境无 IndexedDB——两者都记为「需真人/真机验证」，不伪造通过。
 */
import { describe, expect, it, vi, afterEach } from 'vitest'

import {
  MRU_MIN_USES_FOR_BOOST,
  mruScore,
  topFrequentVisits,
  type RecentVisit,
} from '../src/lib/offline-recent'

const DAY = 86400000
/** 固定「现在」：2026-11-20 12:00 UTC，手算三例都以它为准。 */
const NOW = Date.parse('2026-11-20T12:00:00Z')
/** 建库起点：最早一条 visit 在 30 天前，建库天数 = 30。 */
const LIBRARY_START = NOW - 30 * DAY

const visit = (id: string, visitedAt: number, extra: Partial<RecentVisit> = {}): RecentVisit => ({
  id,
  title: `站点 ${id}`,
  href: `https://example.com/${id}`,
  visitedAt,
  ...extra,
})

describe('mruScore（C1：对照 Wox 公式手算三例，误差 < 0.01）', () => {
  it('count=1 当天：0 + 89 + min(1/30*10, 50) = 89.3333', () => {
    // 次数分 log(1)*15 = 0；时间分当天 fib[6] = 89；频率分 1/30*10 = 1/3
    expect(mruScore(visit('a', NOW, { count: 1 }), NOW, LIBRARY_START)).toBeCloseTo(89.3333, 2)
  })

  it('count=3 七天前：log(3)*15 + 5 + 1 = 22.4792', () => {
    // 次数分 ln3*15 ≈ 16.4792；时间分 7 天前 fib[0] = 5；频率分 3/30*10 = 1
    expect(mruScore(visit('b', NOW - 7 * DAY, { count: 3 }), NOW, LIBRARY_START)).toBeCloseTo(22.4792, 2)
  })

  it('count=50 三十天前：log(50)*15 + 3 + 50/3 = 78.3470', () => {
    // 次数分 ln50*15 ≈ 58.6803；时间分 7–30 天统一 +3；频率分 50/30*10 ≈ 16.6667
    expect(mruScore(visit('c', NOW - 30 * DAY, { count: 50 }), NOW, LIBRARY_START)).toBeCloseTo(78.347, 2)
  })

  it('频率分封顶：count=50 当天、建库 1 天时频率分 = 50（不是 500）', () => {
    // 58.6803 + 89 + min(50/1*10, 50) = 197.6803
    expect(mruScore(visit('x', NOW, { count: 50 }), NOW, NOW)).toBeCloseTo(197.6803, 2)
  })

  it('时间分边界：8 天前 +3、31 天前 +0', () => {
    // 8 天前：0 + 3 + 1/30*10 ≈ 3.3333
    expect(mruScore(visit('d', NOW - 8 * DAY, { count: 1 }), NOW, LIBRARY_START)).toBeCloseTo(3.3333, 2)
    // 31 天前（建库 31 天）：0 + 0 + 1/31*10 ≈ 0.3226
    expect(mruScore(visit('e', NOW - 31 * DAY, { count: 1 }), NOW, NOW - 31 * DAY)).toBeCloseTo(0.3226, 2)
  })

  it('count 缺失按 1 计；MRU_MIN_USES_FOR_BOOST = 3', () => {
    expect(MRU_MIN_USES_FOR_BOOST).toBe(3)
    expect(mruScore(visit('f', NOW), NOW, LIBRARY_START)).toBeCloseTo(89.3333, 2)
  })
})

describe('topFrequentVisits（C2 后半 + C4）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('C2 后半：三个月前连点 20 次的旧站，不压住昨天刚用的站', () => {
    // 建库 90 天：旧站 44.9360 + 0 + 20/90*10 ≈ 47.1582；
    // 昨天 1 次：0 + 89 + 1/90*10 ≈ 89.1111；3 天前 3 次：16.4792 + 34 + 3/90*10 ≈ 50.8125
    const earliest = NOW - 90 * DAY
    expect(mruScore(visit('old', NOW - 90 * DAY, { count: 20 }), NOW, earliest)).toBeCloseTo(47.1582, 2)
    expect(mruScore(visit('new', NOW - 1 * DAY, { count: 1 }), NOW, earliest)).toBeCloseTo(89.1111, 2)
    expect(mruScore(visit('mid', NOW - 3 * DAY, { count: 3 }), NOW, earliest)).toBeCloseTo(50.8125, 2)
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const list = [
      visit('old-heavy', NOW - 90 * DAY, { count: 20 }),
      visit('fresh-once', NOW - 1 * DAY, { count: 1 }),
      visit('mid', NOW - 3 * DAY, { count: 3 }),
    ]
    expect(topFrequentVisits(list).map((v) => v.id)).toEqual(['fresh-once', 'mid', 'old-heavy'])
  })

  it('时间分可以翻盘纯次数：100 天前 9 次输给今天 2 次', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const list = [
      visit('ancient', NOW - 100 * DAY, { count: 9 }),
      visit('fresh', NOW, { count: 2 }),
    ]
    // 旧：32.9584 + 0 + 0.9 ≈ 33.8584；新：10.3972 + 89 + 0.2 ≈ 99.5972
    expect(topFrequentVisits(list).map((v) => v.id)).toEqual(['fresh', 'ancient'])
  })

  it('C4：现有单测期望值不变（小 epoch 时间戳下 fib/频率分趋近 0，退化为次数序）', () => {
    const list = [
      visit('a', 10, { count: 2 }),
      visit('b', 1, { count: 9 }),
      visit('c', 20, { count: 2 }),
      visit('d', 5, { count: 1 }),
    ]
    expect(topFrequentVisits(list).map((v) => v.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(topFrequentVisits([visit('a', 1), visit('b', 2, { count: 2 })]).map((v) => v.id)).toEqual(['b', 'a'])
    const limited = [
      visit('a', 1, { count: 3 }),
      visit('b', 2, { count: 2 }),
      visit('c', 3, { count: 1 }),
    ]
    const snapshot = JSON.stringify(limited)
    expect(topFrequentVisits(limited, 2).map((v) => v.id)).toEqual(['a', 'b'])
    expect(JSON.stringify(limited)).toBe(snapshot)
    expect(topFrequentVisits(limited, 0)).toEqual([])
    expect(topFrequentVisits([])).toEqual([])
  })
})
