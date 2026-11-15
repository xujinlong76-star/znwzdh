import { describe, expect, it } from 'vitest'

import {
  DAY_MS,
  DEFAULT_HIBERNATION_SETTINGS,
  HIBERNATION_RENDER_LIMIT,
  addManualHibernated,
  describeHibernation,
  hibernationBadgeLabel,
  hibernationReason,
  hibernationSectionTitle,
  isHibernating,
  manualHibernatedSet,
  normalizeHibernationSettings,
  parseManualHibernated,
  partitionFavorites,
  removeManualHibernated,
  serializeManualHibernated,
  type HibernatableFavoriteLike,
  type HibernationSettings,
  type ManualHibernatedItem,
} from '@/lib/favorites-hibernation'

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0)

function fav(over: Partial<HibernatableFavoriteLike> & { siteId: string }): HibernatableFavoriteLike {
  return {
    title: over.siteId,
    href: `https://${over.siteId}.example/`,
    createdAt: NOW - 200 * DAY_MS,
    ...over,
  }
}

const ENABLED: HibernationSettings = { enabled: true, thresholdDays: 180 }
const DISABLED: HibernationSettings = { enabled: false, thresholdDays: 180 }
const EMPTY_VISITS: never[] = []
const NO_MANUAL: ManualHibernatedItem[] = []
const EMPTY_MAP = new Map<string, number>()
const NO_MANUAL_SET = new Set<string>()

describe('normalizeHibernationSettings', () => {
  it('非法输入回落默认，不抛', () => {
    expect(normalizeHibernationSettings(undefined)).toEqual(DEFAULT_HIBERNATION_SETTINGS)
    expect(normalizeHibernationSettings(null)).toEqual(DEFAULT_HIBERNATION_SETTINGS)
    expect(normalizeHibernationSettings('180')).toEqual(DEFAULT_HIBERNATION_SETTINGS)
    expect(normalizeHibernationSettings([])).toEqual(DEFAULT_HIBERNATION_SETTINGS)
  })

  it('非法档位回落默认档位，合法档位保留', () => {
    expect(normalizeHibernationSettings({ thresholdDays: 30 })).toEqual({
      enabled: true,
      thresholdDays: 180,
    })
    expect(normalizeHibernationSettings({ enabled: false, thresholdDays: 365 })).toEqual({
      enabled: false,
      thresholdDays: 365,
    })
    expect(normalizeHibernationSettings({ enabled: true, thresholdDays: 90 })).toEqual({
      enabled: true,
      thresholdDays: 90,
    })
  })
})

describe('parseManualHibernated', () => {
  it('坏 JSON / 非数组 / 脏条目按空集合或跳过脏条，不抛', () => {
    expect(parseManualHibernated(null)).toEqual([])
    expect(parseManualHibernated('')).toEqual([])
    expect(parseManualHibernated('{bad')).toEqual([])
    expect(parseManualHibernated('{"a":1}')).toEqual([])
    expect(
      parseManualHibernated(
        JSON.stringify([
          { siteId: 'a', hibernatedAt: NOW },
          { siteId: '', hibernatedAt: NOW },
          { siteId: 'b' },
          { siteId: 'a', hibernatedAt: NOW - 1 },
        ]),
      ),
    ).toEqual([{ siteId: 'a', hibernatedAt: NOW }])
  })

  it('序列化往返保持集合', () => {
    const list = [
      { siteId: 'a', hibernatedAt: NOW },
      { siteId: 'b', hibernatedAt: NOW - 1000 },
    ]
    expect(parseManualHibernated(serializeManualHibernated(list))).toEqual(list)
  })
})

describe('addManualHibernated / removeManualHibernated', () => {
  it('重复冬眠只刷新时间，不重复占位；新冬眠的放最前', () => {
    const once = addManualHibernated([], 'a', NOW - 1000)
    const twice = addManualHibernated(once, 'a', NOW)
    expect(twice).toEqual([{ siteId: 'a', hibernatedAt: NOW }])
    const third = addManualHibernated(twice, 'b', NOW)
    expect(third.map((i) => i.siteId)).toEqual(['b', 'a'])
  })

  it('唤醒不存在的条目返回 removed=false 且原样返回', () => {
    const list = [{ siteId: 'a', hibernatedAt: NOW }]
    const { items, removed } = removeManualHibernated(list, 'missing')
    expect(removed).toBe(false)
    expect(items).toBe(list)
    expect(removeManualHibernated(list, 'a')).toEqual({ items: [], removed: true })
  })

  it('manualHibernatedSet 转快查集', () => {
    expect(manualHibernatedSet([{ siteId: 'a', hibernatedAt: NOW }])).toEqual(new Set(['a']))
  })
})

describe('isHibernating', () => {
  it('开关关了全不冬眠，哪怕 200 天没打开、哪怕手动冬眠过', () => {
    const old = fav({ siteId: 'old' })
    expect(isHibernating(old, EMPTY_MAP, DISABLED, NO_MANUAL_SET, NOW)).toBe(false)
    expect(
      isHibernating(old, EMPTY_MAP, DISABLED, new Set(['old']), NOW),
    ).toBe(false)
  })

  it('严格大于阈值才冬眠：正好 180 天不冬眠，第 181 天冬眠', () => {
    const atThreshold = fav({ siteId: 'edge', createdAt: NOW - 180 * DAY_MS })
    const overThreshold = fav({ siteId: 'over', createdAt: NOW - 181 * DAY_MS })
    expect(isHibernating(atThreshold, EMPTY_MAP, ENABLED, NO_MANUAL_SET, NOW)).toBe(false)
    expect(isHibernating(overThreshold, EMPTY_MAP, ENABLED, NO_MANUAL_SET, NOW)).toBe(true)
  })

  it('待读箱 / 已读不参与冬眠，哪怕超过阈值', () => {
    const inbox = fav({ siteId: 'inbox', triageStatus: 'inbox', triageAt: NOW - 200 * DAY_MS })
    const read = fav({ siteId: 'read', triageStatus: 'read', triageAt: NOW - 200 * DAY_MS })
    expect(isHibernating(inbox, EMPTY_MAP, ENABLED, NO_MANUAL_SET, NOW)).toBe(false)
    expect(isHibernating(read, EMPTY_MAP, ENABLED, NO_MANUAL_SET, NOW)).toBe(false)
  })

  it('手动冬眠粘性：刚收藏的也能手动冬眠；阈值改了也不影响手动冬眠', () => {
    const fresh = fav({ siteId: 'fresh', createdAt: NOW })
    expect(isHibernating(fresh, EMPTY_MAP, ENABLED, NO_MANUAL_SET, NOW)).toBe(false)
    expect(isHibernating(fresh, EMPTY_MAP, ENABLED, new Set(['fresh']), NOW)).toBe(true)
    expect(
      isHibernating(fresh, EMPTY_MAP, { enabled: true, thresholdDays: 365 }, new Set(['fresh']), NOW),
    ).toBe(true)
  })

  it('最近访问能把收藏从冬眠里捞出来（复用 resurface 锚点）', () => {
    const old = fav({ siteId: 'old' })
    const visits = new Map([['old', NOW - 10 * DAY_MS]])
    expect(isHibernating(old, visits, ENABLED, NO_MANUAL_SET, NOW)).toBe(false)
    // 未来时间戳忽略：脏数据不能把收藏洗成「刚打开过」
    const future = new Map([['old', NOW + DAY_MS]])
    expect(isHibernating(old, future, ENABLED, NO_MANUAL_SET, NOW)).toBe(true)
  })

  it('lastOpenedAt 同样是有效信号', () => {
    const old = fav({ siteId: 'old', lastOpenedAt: NOW - 5 * DAY_MS })
    expect(isHibernating(old, EMPTY_MAP, ENABLED, NO_MANUAL_SET, NOW)).toBe(false)
  })

  it('阈值档位生效：90 天档下 100 天的收藏冬眠，365 天档下不冬眠', () => {
    const item = fav({ siteId: 'mid', createdAt: NOW - 100 * DAY_MS })
    expect(isHibernating(item, EMPTY_MAP, { enabled: true, thresholdDays: 90 }, NO_MANUAL_SET, NOW)).toBe(true)
    expect(isHibernating(item, EMPTY_MAP, { enabled: true, thresholdDays: 365 }, NO_MANUAL_SET, NOW)).toBe(false)
  })
})

describe('hibernationReason / badge / describe', () => {
  it('手动与自动原因分开；徽标手动不带天数', () => {
    const fresh = fav({ siteId: 'fresh', createdAt: NOW })
    const old = fav({ siteId: 'old' })
    expect(hibernationReason(fresh, EMPTY_MAP, ENABLED, new Set(['fresh']), NOW)).toBe('manual')
    expect(hibernationReason(old, EMPTY_MAP, ENABLED, NO_MANUAL_SET, NOW)).toBe('auto')
    expect(hibernationReason(fresh, EMPTY_MAP, ENABLED, NO_MANUAL_SET, NOW)).toBe(null)
    expect(hibernationBadgeLabel('manual', 5)).toBe('冬眠中')
    expect(hibernationBadgeLabel('auto', 200)).toBe('冬眠中 · 200天')
    expect(hibernationBadgeLabel(null, 200)).toBe('')
  })

  it('文案诚实口径：只说本机记录，不说「你没看过」', () => {
    const old = fav({ siteId: 'old' })
    expect(describeHibernation(old, EMPTY_MAP, ENABLED, NO_MANUAL_SET, NOW)).toBe(
      '收藏 200 天了，本机没记录到打开',
    )
    const opened = fav({ siteId: 'opened', createdAt: NOW - 300 * DAY_MS, lastOpenedAt: NOW - 200 * DAY_MS })
    expect(describeHibernation(opened, EMPTY_MAP, ENABLED, NO_MANUAL_SET, NOW)).toBe(
      '上次打开是 200 天前（按本机记录算），已冬眠',
    )
    const fresh = fav({ siteId: 'fresh', createdAt: NOW })
    expect(describeHibernation(fresh, EMPTY_MAP, ENABLED, new Set(['fresh']), NOW)).toBe(
      '你手动把它冬眠了，打开一次就能唤醒',
    )
    expect(describeHibernation(fresh, EMPTY_MAP, ENABLED, NO_MANUAL_SET, NOW)).toBe('')
  })
})

describe('partitionFavorites', () => {
  it('开关关了全进 awake，hibernating 为空', () => {
    const items = [fav({ siteId: 'a' }), fav({ siteId: 'b', createdAt: NOW })]
    expect(partitionFavorites(items, EMPTY_VISITS, DISABLED, NO_MANUAL, NOW)).toEqual({
      awake: items,
      hibernating: [],
    })
  })

  it('分区保持 awake 原顺序；hibernating 按最久没打开排前面', () => {
    const items = [
      fav({ siteId: 'fresh', createdAt: NOW }),
      fav({ siteId: 'old-200', createdAt: NOW - 200 * DAY_MS }),
      fav({ siteId: 'mid', createdAt: NOW - 100 * DAY_MS }),
      fav({ siteId: 'old-300', createdAt: NOW - 300 * DAY_MS }),
      fav({ siteId: 'inbox', triageStatus: 'inbox', triageAt: NOW - 200 * DAY_MS }),
    ]
    const { awake, hibernating } = partitionFavorites(items, EMPTY_VISITS, ENABLED, NO_MANUAL, NOW)
    expect(awake.map((i) => i.siteId)).toEqual(['fresh', 'mid', 'inbox'])
    expect(hibernating.map((i) => i.siteId)).toEqual(['old-300', 'old-200'])
  })

  it('同 siteId 去重只留第一条；手动冬眠的进 hibernating', () => {
    const items = [
      fav({ siteId: 'dup', createdAt: NOW }),
      fav({ siteId: 'dup', createdAt: NOW - 300 * DAY_MS }),
      fav({ siteId: 'manual', createdAt: NOW }),
    ]
    const manual = [{ siteId: 'manual', hibernatedAt: NOW }]
    const { awake, hibernating } = partitionFavorites(items, EMPTY_VISITS, ENABLED, manual, NOW)
    expect(awake.map((i) => i.siteId)).toEqual(['dup'])
    expect(hibernating.map((i) => i.siteId)).toEqual(['manual'])
  })

  it('最近访问（offline-recent）参与判定：访问过的 200 天收藏不冬眠', () => {
    const items = [fav({ siteId: 'visited' }), fav({ siteId: 'unvisited' })]
    const visits = [{ id: 'visited', visitedAt: NOW - DAY_MS }]
    const { awake, hibernating } = partitionFavorites(items, visits, ENABLED, NO_MANUAL, NOW)
    expect(awake.map((i) => i.siteId)).toEqual(['visited'])
    expect(hibernating.map((i) => i.siteId)).toEqual(['unvisited'])
  })

  it('同一份输入永远得到同一份输出（并列时按 createdAt 再按 siteId 兜底）', () => {
    const items = [
      fav({ siteId: 'b', createdAt: NOW - 200 * DAY_MS }),
      fav({ siteId: 'a', createdAt: NOW - 200 * DAY_MS }),
    ]
    const first = partitionFavorites(items, EMPTY_VISITS, ENABLED, NO_MANUAL, NOW)
    const second = partitionFavorites(items, EMPTY_VISITS, ENABLED, NO_MANUAL, NOW)
    expect(first).toEqual(second)
    expect(first.hibernating.map((i) => i.siteId)).toEqual(['a', 'b'])
  })
})

describe('hibernationSectionTitle', () => {
  it('只写条数', () => {
    expect(hibernationSectionTitle(3)).toBe('冬眠收藏 · 3 条')
    expect(HIBERNATION_RENDER_LIMIT).toBe(100)
  })
})
