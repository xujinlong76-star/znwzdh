/**
 * P12 对比卡 PoC 纯逻辑测试。
 *
 * 覆盖：快照保守默认（unknown 不写成免费、未巡检/风控拦截不判死活）、
 * 对比篮上限 3/去重/读写往返/损坏丢弃、对照行 6 字段与“未验证”默认、
 * “只看不同”过滤、用户自选在意点上限 3、
 * 无胜者/无总分/无排名断言（输出里不含 winner/verdict/score/rank）。
 */
import { describe, expect, it } from 'vitest'

import {
  addToDecisionBasket,
  buildDecisionCompareHref,
  buildDecisionCompareRows,
  DECISION_COMPARE_BASKET_KEY,
  DECISION_COMPARE_FIELDS,
  decisionRowDiffers,
  formatDecisionCellValue,
  MAX_DECISION_COMPARE_SITES,
  NO_SOURCE_ROWS,
  readDecisionBasket,
  removeFromDecisionBasket,
  snapshotSiteForDecisionCompare,
  toggleDecisionPriority,
  visibleDecisionRows,
  writeDecisionBasket,
  type DecisionCompareEntry,
  type DecisionCompareStore,
} from '../src/lib/decision-compare'

function memoryStore(): DecisionCompareStore & { dump: () => Record<string, string> } {
  const data: Record<string, string> = {}
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    removeItem: (key: string) => {
      delete data[key]
    },
    dump: () => ({ ...data }),
  }
}

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0)
const CHECKED_AT = Date.UTC(2026, 10, 20, 8, 0, 0)

function entry(overrides: Partial<DecisionCompareEntry> = {}): DecisionCompareEntry {
  return {
    siteId: 'site-a',
    title: 'A 站',
    url: 'https://a.example/',
    pricingLabel: '免费增值',
    pricingVerified: true,
    pricingVerifiedAt: NOW,
    freeTier: null,
    liveState: 'reachable',
    lastCheckedAt: CHECKED_AT,
    sceneTags: ['AI 与智能'],
    sceneSource: '站点分面',
    capturedAt: NOW,
    ...overrides,
  }
}

describe('snapshotSiteForDecisionCompare', () => {
  it('pricing 分面映射为中文 label，freeTier 缺失时为 null（不猜免费档）', () => {
    const snap = snapshotSiteForDecisionCompare(
      {
        id: 'x',
        title: 'X',
        url: 'https://x.example/',
        facets: { pricing: ['freemium'], scene: ['ai'] },
        health: { ok: true, lastCheckedAt: CHECKED_AT },
        updatedAt: NOW,
      },
      NOW,
    )
    expect(snap.pricingLabel).toBe('免费增值')
    expect(snap.pricingVerified).toBe(true)
    expect(snap.freeTier).toBe(null)
    expect(snap.liveState).toBe('reachable')
    expect(snap.sceneTags).toEqual(['AI 与智能'])
    expect(snap.sceneSource).toBe('站点分面')
  })

  it('pricing 为 unknown/缺失时 pricingLabel 为 null，绝不写成“免费”', () => {
    for (const facets of [{ pricing: ['unknown'] }, {}, { pricing: [] }]) {
      const snap = snapshotSiteForDecisionCompare(
        { id: 'x', title: 'X', url: 'https://x.example/', facets, updatedAt: NOW },
        NOW,
      )
      expect(snap.pricingLabel).toBe(null)
      expect(snap.pricingVerified).toBe(false)
      expect(snap.pricingVerifiedAt).toBe(null)
    }
  })

  it('从未巡检（lastCheckedAt 为空）时活链状态为 null，不据 ok 推断', () => {
    const snap = snapshotSiteForDecisionCompare(
      {
        id: 'x',
        title: 'X',
        url: 'https://x.example/',
        health: { ok: false, lastCheckedAt: null },
      },
      NOW,
    )
    expect(snap.liveState).toBe(null)
    expect(snap.lastCheckedAt).toBe(null)
  })

  it('风控拦截（BOT_BLOCKED）时活链状态为 null，不把活站判死', () => {
    const snap = snapshotSiteForDecisionCompare(
      {
        id: 'x',
        title: 'X',
        url: 'https://x.example/',
        health: { ok: false, lastCheckedAt: CHECKED_AT, error: 'BOT_BLOCKED: 2 层均被拦截' },
      },
      NOW,
    )
    expect(snap.liveState).toBe(null)
    expect(snap.lastCheckedAt).toBe(CHECKED_AT)
  })

  it('巡检失败且非拦截时活链状态为不可达', () => {
    const snap = snapshotSiteForDecisionCompare(
      {
        id: 'x',
        title: 'X',
        url: 'https://x.example/',
        health: { ok: false, lastCheckedAt: CHECKED_AT },
      },
      NOW,
    )
    expect(snap.liveState).toBe('unreachable')
  })

  it('无 scene 分面时退回站点 tags，来源标为站点标签', () => {
    const snap = snapshotSiteForDecisionCompare(
      {
        id: 'x',
        title: 'X',
        url: 'https://x.example/',
        tags: ['小说', '  ', '阅读'],
      },
      NOW,
    )
    expect(snap.sceneTags).toEqual(['小说', '阅读'])
    expect(snap.sceneSource).toBe('站点标签')
  })
})

describe('对比篮', () => {
  it('上限 3 个：第 4 个不加入并返回提示', () => {
    const full = [entry({ siteId: 'a' }), entry({ siteId: 'b' }), entry({ siteId: 'c' })]
    expect(full.length).toBe(MAX_DECISION_COMPARE_SITES)
    const result = addToDecisionBasket(full, entry({ siteId: 'd' }))
    expect(result.added).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.entries).toHaveLength(3)
    expect(result.message).toMatch(/最多放 3 个站/)
  })

  it('同一站重复加入不重复（added 为 false，长度不变）', () => {
    const one = [entry({ siteId: 'a' })]
    const result = addToDecisionBasket(one, entry({ siteId: 'a', title: 'A 站（新标题）' }))
    expect(result.added).toBe(false)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.title).toBe('A 站')
  })

  it('移出不存在的站时原样返回', () => {
    const one = [entry({ siteId: 'a' })]
    expect(removeFromDecisionBasket(one, 'nope')).toEqual(one)
    expect(removeFromDecisionBasket(one, 'a')).toEqual([])
  })

  it('读写往返：写入后读出内容一致、顺序保留', () => {
    const store = memoryStore()
    const entries = [entry({ siteId: 'a' }), entry({ siteId: 'b', title: 'B 站' })]
    expect(writeDecisionBasket(entries, store)).toBe(true)
    expect(store.dump()[DECISION_COMPARE_BASKET_KEY]).toContain('"siteId":"a"')
    expect(readDecisionBasket(store)).toEqual(entries)
  })

  it('损坏的篮数据读出为空数组，不抛错；结构不对的条目被丢弃', () => {
    const store = memoryStore()
    store.setItem(DECISION_COMPARE_BASKET_KEY, '{not json')
    expect(readDecisionBasket(store)).toEqual([])
    store.setItem(
      DECISION_COMPARE_BASKET_KEY,
      JSON.stringify([{ siteId: 'a' }, entry({ siteId: 'b' }), entry({ siteId: 'b' })]),
    )
    expect(readDecisionBasket(store).map((e) => e.siteId)).toEqual(['b'])
  })

  it('存储写不进去时返回 false', () => {
    const throwing: DecisionCompareStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {},
    }
    expect(writeDecisionBasket([entry()], throwing)).toBe(false)
  })
})

describe('对照行', () => {
  it('6 个字段、顺序与方案一致', () => {
    const rows = buildDecisionCompareRows([entry(), entry({ siteId: 'b' })])
    expect(rows.map((r) => r.key)).toEqual(DECISION_COMPARE_FIELDS.map((f) => f.key))
    expect(rows).toHaveLength(6)
  })

  it('免费行：有免费档时拼“免费档…”，无价格记录时只写计费方式', () => {
    const rows = buildDecisionCompareRows([
      entry({ freeTier: '100次/月' }),
      entry({ siteId: 'b', pricingLabel: '完全免费' }),
    ])
    expect(rows[0]?.cells[0]?.text).toBe('免费增值 · 免费档100次/月')
    expect(rows[0]?.cells[1]?.text).toBe('完全免费')
  })

  it('计费方式缺失时免费格 text 为 null（整格“未验证”）', () => {
    const rows = buildDecisionCompareRows([entry({ pricingLabel: null, pricingVerified: false })])
    expect(rows[0]?.cells[0]?.text).toBe(null)
    expect(rows[0]?.cells[0]?.verified).toBe(false)
    expect(formatDecisionCellValue(rows[0]?.cells[0])).toBe('未验证')
  })

  it('是否需注册 / 有无广告暂无数据源，恒为未验证', () => {
    expect(NO_SOURCE_ROWS).toEqual(['registration', 'ads'])
    const rows = buildDecisionCompareRows([entry(), entry({ siteId: 'b' })])
    for (const key of NO_SOURCE_ROWS) {
      const row = rows.find((r) => r.key === key)!
      expect(row.cells.every((c) => c.text === null && c.verified === false)).toBe(true)
      expect(row.cells[0]?.source).toBe('暂无该字段')
    }
  })

  it('活链行：可达/不可达/未验证三种状态如实呈现', () => {
    const rows = buildDecisionCompareRows([
      entry({ liveState: 'reachable' }),
      entry({ siteId: 'b', liveState: 'unreachable', lastCheckedAt: CHECKED_AT }),
      entry({ siteId: 'c', liveState: null, lastCheckedAt: null }),
    ])
    const live = rows.find((r) => r.key === 'live')!
    expect(live.cells.map((c) => c.text)).toEqual(['可达', '不可达', null])
    expect(live.cells[2]?.verified).toBe(false)
  })

  it('最后核验时间行：有巡检时间显示日期，无巡检时间整格未验证', () => {
    const rows = buildDecisionCompareRows([
      entry({ lastCheckedAt: CHECKED_AT }),
      entry({ siteId: 'b', lastCheckedAt: null }),
    ])
    const row = rows.find((r) => r.key === 'lastVerified')!
    expect(row.cells[0]?.text).toMatch(/^\d{4}\/\d{1,2}\/\d{1,2}$/)
    expect(row.cells[0]?.verified).toBe(true)
    expect(row.cells[1]?.text).toBe(null)
    expect(row.cells[1]?.verified).toBe(false)
  })

  it('适用场景行：多标签用“、”连接，无标签整格未验证', () => {
    const rows = buildDecisionCompareRows([
      entry({ sceneTags: ['AI 与智能', '内容创作'] }),
      entry({ siteId: 'b', sceneTags: [] }),
    ])
    const row = rows.find((r) => r.key === 'scene')!
    expect(row.cells[0]?.text).toBe('AI 与智能、内容创作')
    expect(row.cells[1]?.text).toBe(null)
  })
})

describe('只看不同', () => {
  it('默认开：各站完全相同时过滤后 0 行', () => {
    const rows = buildDecisionCompareRows([entry(), entry({ siteId: 'b' })])
    expect(rows.some(decisionRowDiffers)).toBe(false)
    expect(visibleDecisionRows(rows, true)).toHaveLength(0)
    expect(visibleDecisionRows(rows, false)).toHaveLength(6)
  })

  it('任一格不同即整行算不同，null 与有值也算不同', () => {
    const rows = buildDecisionCompareRows([
      entry({ pricingLabel: '免费增值' }),
      entry({ siteId: 'b', pricingLabel: '商业付费' }),
    ])
    const free = rows.find((r) => r.key === 'free')!
    expect(decisionRowDiffers(free)).toBe(true)
    expect(visibleDecisionRows(rows, true).map((r) => r.key)).toEqual(['free'])
  })

  it('只过滤行，不改变站列顺序', () => {
    const rows = buildDecisionCompareRows([
      entry({ siteId: 'c', pricingLabel: '商业付费' }),
      entry({ siteId: 'a', pricingLabel: '免费增值' }),
    ])
    const free = rows.find((r) => r.key === 'free')!
    expect(free.cells.map((c) => c.text)).toEqual(['商业付费', '免费增值'])
  })
})

describe('用户自选在意点', () => {
  it('勾选/取消切换，超 3 个不加入并返回提示', () => {
    let selected = toggleDecisionPriority([], 'free').selected
    selected = toggleDecisionPriority(selected, 'live').selected
    selected = toggleDecisionPriority(selected, 'scene').selected
    expect(selected).toEqual(['free', 'live', 'scene'])
    const blocked = toggleDecisionPriority(selected, 'ads')
    expect(blocked.blocked).toBe(true)
    expect(blocked.selected).toEqual(['free', 'live', 'scene'])
    if (blocked.blocked) expect(blocked.message).toMatch(/最多勾选 3 个/)
    const removed = toggleDecisionPriority(selected, 'live')
    expect(removed.blocked).toBe(false)
    expect(removed.selected).toEqual(['free', 'scene'])
  })

  it('非法 key 被忽略，不抛错', () => {
    const result = toggleDecisionPriority(['free'], 'not-a-field')
    expect(result.selected).toEqual(['free'])
  })
})

describe('硬约束：无胜者 / 无总分 / 无排名', () => {
  it('对照行与篮条目输出里不含 winner/verdict/score/rank', () => {
    const rows = buildDecisionCompareRows([
      entry(),
      entry({ siteId: 'b', pricingLabel: '商业付费', liveState: 'unreachable' }),
    ])
    const blob = JSON.stringify({ rows, entries: [entry()] })
    for (const banned of ['winner', 'verdict', 'score', 'rank']) {
      expect(blob.toLowerCase()).not.toContain(banned)
    }
  })

  it('篮模式入口不带站 id、不带任何追踪参数', () => {
    expect(buildDecisionCompareHref()).toBe('/compare?basket=1')
  })
})
