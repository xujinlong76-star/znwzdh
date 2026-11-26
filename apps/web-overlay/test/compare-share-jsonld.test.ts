/**
 * 对比分享 WebPage JSON-LD 单测（P13）。
 *
 * 盯三条红线：
 * 1. 与可见文本逐字一致：LD 里的字段文案只能是调用方传来的 valueText /
 *    noteText（即 compareShareCellDisplay 的输出），本 builder 不重算；
 * 2. 过期 / 未核实字段退出 JSON-LD：调用方不传，本函数也不兜底；
 * 3. dateModified 只随实质更新改：取快照冻结时间，null 时省略、不编造。
 */
import { describe, expect, it } from 'vitest'
import { compareShareWebPageLd } from '../src/lib/seo/json-ld'
import { compareShareCellDisplay } from '../src/lib/compare-share-ttl'
import type { ComparisonCell } from '../src/lib/compare'

const ORIGIN = 'https://navhub.example.com'
const FROZEN = Date.UTC(2026, 10, 20, 0, 0, 0)
const NOW = Date.UTC(2026, 10, 26, 4, 0, 0)
const DAY = 24 * 60 * 60 * 1000

function cell(over: Partial<ComparisonCell> = {}): ComparisonCell {
  return { value: '免费', source: '官网定价页', verified: true, verifiedAt: NOW - 5 * DAY, ...over }
}

describe('compareShareWebPageLd', () => {
  it('WebPage 骨架：@type/URL/语言/dateModified 取快照冻结时间', () => {
    const ld = compareShareWebPageLd(ORIGIN, {
      slug: 'abc123',
      title: '对照表分享',
      description: '此对照表冻结于 2026/11/20，内容不再更新 · 共 2 个站点',
      frozenAtMs: FROZEN,
      items: [{ name: '甲站', url: 'https://a.example/', fields: [] }],
    })
    expect(ld['@type']).toBe('WebPage')
    expect(ld.url).toBe('https://navhub.example.com/pub/compare/abc123')
    expect(ld.inLanguage).toBe('zh-CN')
    expect(ld.dateModified).toBe(new Date(FROZEN).toISOString())
    expect(ld.description).toBe('此对照表冻结于 2026/11/20，内容不再更新 · 共 2 个站点')
  })

  it('已核验字段逐字进 LD：与 compareShareCellDisplay 的输出逐字一致', () => {
    const display = compareShareCellDisplay(cell({ value: '免费版+付费版' }), 'pricing', NOW)
    expect(display.state).toBe('verified')
    const ld = compareShareWebPageLd(ORIGIN, {
      slug: 'abc123',
      title: '对照表分享',
      description: '冻结对照表',
      frozenAtMs: FROZEN,
      items: [
        {
          name: '甲站',
          url: 'https://a.example/',
          fields: [{ label: '计费方式', valueText: display.valueText, noteText: display.noteText }],
        },
      ],
    })
    const json = JSON.stringify(ld)
    expect(json).toContain('计费方式：免费版+付费版（来源：官网定价页 · 核实于 2026/11/21）')
  })

  it('过期字段退出 JSON-LD：LD 全文不含该格的值', () => {
    const expired = compareShareCellDisplay(cell({ value: '每月 99 元', verifiedAt: NOW - 40 * DAY }), 'price', NOW)
    expect(expired.state).toBe('expired')
    const verified = compareShareCellDisplay(cell({ value: '免费' }), 'pricing', NOW)
    const ld = compareShareWebPageLd(ORIGIN, {
      slug: 'abc123',
      title: '对照表分享',
      description: '冻结对照表',
      frozenAtMs: FROZEN,
      items: [
        {
          name: '甲站',
          url: 'https://a.example/',
          fields: [{ label: '计费方式', valueText: verified.valueText, noteText: verified.noteText }],
        },
      ],
    })
    const json = JSON.stringify(ld)
    expect(json).not.toContain('每月 99 元')
    expect(json).not.toContain('现待复核')
    expect(json).toContain('计费方式：免费')
  })

  it('未核实字段不进 LD：调用方不传，本函数也不补', () => {
    const ld = compareShareWebPageLd(ORIGIN, {
      slug: 'abc123',
      title: '对照表分享',
      description: '冻结对照表',
      frozenAtMs: FROZEN,
      items: [{ name: '甲站', url: 'https://a.example/', fields: [] }],
    })
    const item = (ld.mainEntity as { itemListElement: Array<Record<string, unknown>> }).itemListElement[0]
    expect(item).not.toHaveProperty('description')
    expect(JSON.stringify(ld)).not.toContain('未验证')
  })

  it('frozenAtMs 为 null 时省略 dateModified，不编造日期', () => {
    const ld = compareShareWebPageLd(ORIGIN, {
      slug: 'abc123',
      title: '对照表分享',
      description: '冻结对照表',
      frozenAtMs: null,
      items: [],
    })
    expect(ld).not.toHaveProperty('dateModified')
  })

  it('不写评分/评价/交易字段：全文无 aggregateRating / Review / Offer', () => {
    const ld = compareShareWebPageLd(ORIGIN, {
      slug: 'abc123',
      title: '对照表分享',
      description: '冻结对照表',
      frozenAtMs: FROZEN,
      items: [{ name: '甲站', url: 'https://a.example/', fields: [{ label: '价格（数值）', valueText: '免费', noteText: '来源：官网 · 核实于 2026/11/21' }] }],
    })
    const json = JSON.stringify(ld)
    expect(json).not.toMatch(/aggregateRating|Review|Offer|commission|sponsored/i)
  })

  it('ItemList position 从 1 连续编号，空名条目过滤', () => {
    const ld = compareShareWebPageLd(ORIGIN, {
      slug: 'abc123',
      title: '对照表分享',
      description: '冻结对照表',
      frozenAtMs: FROZEN,
      items: [
        { name: '甲站', url: 'https://a.example/', fields: [] },
        { name: '   ', url: 'https://b.example/', fields: [] },
        { name: '乙站', url: '', fields: [] },
      ],
    })
    const main = ld.mainEntity as { numberOfItems: number; itemListElement: Array<Record<string, unknown>> }
    expect(main.numberOfItems).toBe(2)
    expect(main.itemListElement.map((e) => e.position)).toEqual([1, 2])
    expect(main.itemListElement.map((e) => e.name)).toEqual(['甲站', '乙站'])
    expect(main.itemListElement[1]).not.toHaveProperty('url')
  })
})
