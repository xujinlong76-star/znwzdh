/**
 * 搜索建议列表客户端重排（lib/search-rerank）的定向测试。
 *
 * 两条 William 点名的验收（2026-11-20 搜索假空态与相关性修复）：
 *  1. 无意义词 "zzzz不存在的站" → 0 条结果空态（ordered 为空，调用方据此渲染真空态）；
 *  2. "Gemini" 首位即 Google Gemini 本体（精确名称匹配置顶）。
 *
 * 命中形态取自 2026-11-20 对中枢 /api/search 的实测回放（只读，不调后端）：
 *  - 无意义词 12 条全是 semantic 通道、分数 0.016~0.04，首条"在行"带 fts（单字"在"弱匹配）；
 *  - "Gemini" 前三条带 exact 通道（Google Gemini / Google AI for Developers /
 *    Google AI Studio），其余 9 条是 semantic 尾巴。
 */
import { describe, expect, it } from 'vitest'

import type { HubSearchHit } from '../src/lib/navhub-api'
import {
  isBrokenSearchHit,
  isExactNameMatch,
  isStrongSearchHit,
  rankSearchHits,
} from '../src/lib/search-rerank'

function hit(
  title: string,
  channels: string[],
  overrides: Partial<HubSearchHit> = {},
): HubSearchHit {
  const contributions: Record<string, { rank: number; value: number }> = {}
  channels.forEach((c, i) => {
    contributions[c] = { rank: i + 1, value: 0.02 }
  })
  return {
    siteId: `site-${title}`,
    score: 0.02,
    contributions,
    site: {
      id: `site-${title}`,
      title,
      url: `https://example.com/${encodeURIComponent(title)}`,
      status: 'active',
    } as unknown as HubSearchHit['site'],
    ...overrides,
  }
}

/** 2026-11-20 实测回放：无意义词 "zzzz不存在的站" 的前 3 条（其余 9 条同为 semantic） */
function nonsenseHits(): HubSearchHit[] {
  return [
    hit('在行', ['fts', 'semantic'], { score: 0.0396 }),
    hit('Moz', ['semantic'], { score: 0.0189 }),
    hit('哔哩哔哩游戏中心', ['semantic'], { score: 0.0185 }),
    hit('Crazy Egg', ['semantic'], { score: 0.0183 }),
    hit('站长之家', ['semantic'], { score: 0.0177 }),
  ]
}

/** 2026-11-20 实测回放："Gemini" 的前 4 条（其余 8 条同为 semantic 尾巴） */
function geminiHits(): HubSearchHit[] {
  return [
    hit('Google Gemini', ['exact', 'fts', 'semantic'], { score: 0.0905 }),
    hit('Google AI for Developers', ['exact', 'fts', 'semantic'], { score: 0.0886 }),
    hit('Google AI Studio', ['exact', 'fts', 'semantic'], { score: 0.088 }),
    hit('Eurogamer', ['semantic'], { score: 0.018 }),
  ]
}

describe('search-rerank：无意义词返回 0 条结果空态', () => {
  it('"zzzz不存在的站"：12 条弱语义命中全部不算强匹配，ordered 为空', () => {
    const ranked = rankSearchHits(nonsenseHits(), 'zzzz不存在的站')
    expect(ranked.hasStrongMatch).toBe(false)
    expect(ranked.ordered).toHaveLength(0)
    // 弱相关尾巴仍保留在 related 里（可审计），但不进入展示列表
    expect(ranked.related.length).toBeGreaterThan(0)
    expect(ranked.exact).toHaveLength(0)
    expect(ranked.keyword).toHaveLength(0)
  })

  it('单字弱匹配不算强匹配："在" 命中 "在行"（fts 通道）仍是弱相关', () => {
    const [first] = nonsenseHits()
    expect(isStrongSearchHit(first, 'zzzz不存在的站')).toBe(false)
    expect(isExactNameMatch(first, 'zzzz不存在的站')).toBe(false)
  })

  it('纯语义命中不算强匹配', () => {
    const [, second] = nonsenseHits()
    expect(isStrongSearchHit(second, 'zzzz不存在的站')).toBe(false)
  })
})

describe('search-rerank："Gemini" 首位即 Gemini 本体', () => {
  it('精确名称匹配 "Google Gemini" 置顶（exact 通道 + 标题整词命中）', () => {
    const ranked = rankSearchHits(geminiHits(), 'Gemini')
    expect(ranked.hasStrongMatch).toBe(true)
    expect(ranked.ordered[0]?.site?.title).toBe('Google Gemini')
    expect(ranked.exact.map((h) => h.site?.title)).toEqual(['Google Gemini'])
  })

  it('语义尾巴降权进 related 组，不混进主列表前排', () => {
    const ranked = rankSearchHits(geminiHits(), 'Gemini')
    expect(ranked.related.map((h) => h.site?.title)).toEqual(['Eurogamer'])
    // 主列表 = exact + keyword（RRF 原序），related 排在最后
    expect(ranked.ordered.map((h) => h.site?.title)).toEqual([
      'Google Gemini',
      'Google AI for Developers',
      'Google AI Studio',
      'Eurogamer',
    ])
  })

  it('exact 通道命中是强匹配，但标题不含查询词的不算精确名称匹配', () => {
    const [, dev] = geminiHits()
    expect(isStrongSearchHit(dev, 'Gemini')).toBe(true)
    expect(isExactNameMatch(dev, 'Gemini')).toBe(false)
  })
})

describe('search-rerank：失效站点永不进入建议列表', () => {
  it('status=broken 的站点被剔除（visibleCount 与 ordered 都不含它）', () => {
    const broken = hit('死站示例', ['exact'], {
      site: {
        id: 'site-dead',
        title: '死站示例',
        url: 'https://dead.example.com/',
        status: 'broken',
      } as unknown as HubSearchHit['site'],
    })
    expect(isBrokenSearchHit(broken)).toBe(true)
    const ranked = rankSearchHits([broken, ...geminiHits()], 'Gemini')
    expect(ranked.visibleCount).toBe(4)
    expect(ranked.ordered.map((h) => h.site?.title)).not.toContain('死站示例')
  })

  it('health.ok=false 但 status=active 的活站不剔除（Google Gemini 本体就是 healthOk=false）', () => {
    const gemini = hit('Google Gemini', ['exact', 'fts', 'semantic'], { score: 0.0905 })
    // health 块缺席/ok=false 都不改变 status=active 的判定
    if (gemini.site) (gemini.site as unknown as { health: { ok: boolean } }).health = { ok: false }
    expect(isBrokenSearchHit(gemini)).toBe(false)
    const ranked = rankSearchHits([gemini], 'Gemini')
    expect(ranked.ordered[0]?.site?.title).toBe('Google Gemini')
  })

  it('site 为空的脏数据不渲染也不计入', () => {
    const dirty: HubSearchHit = { siteId: 'x', score: 0, contributions: {}, site: null }
    expect(isBrokenSearchHit(dirty)).toBe(true)
    expect(rankSearchHits([dirty], 'Gemini').ordered).toHaveLength(0)
  })
})

describe('search-rerank：精确名称匹配的边界', () => {
  it('标题等于查询词（忽略大小写与首尾空白）', () => {
    expect(isExactNameMatch(hit('Gemini', ['fts']), '  gemini ')).toBe(true)
  })

  it('拉丁词按整词命中："Gemini" 命中 "Google Gemini"，不命中 "GeminiX"', () => {
    expect(isExactNameMatch(hit('Google Gemini', ['fts']), 'Gemini')).toBe(true)
    expect(isExactNameMatch(hit('GeminiX', ['fts']), 'Gemini')).toBe(false)
  })

  it('中文按子串命中："考研" 命中 "考研帮"', () => {
    expect(isExactNameMatch(hit('考研帮', ['fts']), '考研')).toBe(true)
    expect(isExactNameMatch(hit('考研', ['fts']), '考研')).toBe(true)
  })

  it('fts 标题命中是强匹配："修图" 命中 "修图工具"', () => {
    expect(isStrongSearchHit(hit('修图工具', ['fts']), '修图')).toBe(true)
  })

  it('pinyin 通道是强匹配（标题不含拉丁查询词时）', () => {
    expect(isStrongSearchHit(hit('考研', ['pinyin']), 'kaoyan')).toBe(true)
  })
})
