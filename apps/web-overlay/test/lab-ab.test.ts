import { describe, expect, it } from 'vitest'
import { LAB_STATIC_WEIGHTS, labCoverageFactor, labScoreHit, labTop3 } from '../src/lib/lab-ab'
import type { HubSearchHit } from '../src/lib/navhub-api'

function hit(siteId: string, contributions: Record<string, { rank: number; value: number }>): HubSearchHit {
  return { siteId, score: 0, contributions, site: null }
}

describe('实验室 A/B 本地复算', () => {
  it('静态权重与生产默认一致', () => {
    expect(LAB_STATIC_WEIGHTS).toEqual({ exact: 1.4, fts: 1.0, pinyin: 0.9, semantic: 1.15, personal: 0.3 })
  })

  it('单通道 exact 名次 0：覆盖因子为 1', () => {
    const h = hit('a', { exact: { rank: 0, value: 1 } })
    expect(labCoverageFactor(h)).toBe(1)
    expect(labScoreHit(h, LAB_STATIC_WEIGHTS)).toBeCloseTo(1.4 / 60, 10)
  })

  it('两通道覆盖因子 1.35；personal 不计入', () => {
    const two = hit('a', { exact: { rank: 0, value: 1 }, fts: { rank: 0, value: 1 } })
    expect(labCoverageFactor(two)).toBe(1.35)
    const withPersonal = hit('a', { exact: { rank: 0, value: 1 }, personal: { rank: 0, value: 1 } })
    expect(labCoverageFactor(withPersonal)).toBe(1)
  })

  it('静态与动态权重可排出不同首位', () => {
    const hits = [hit('exact-only', { exact: { rank: 0, value: 1 } }), hit('fts-only', { fts: { rank: 0, value: 1 } })]
    expect(labTop3(hits, LAB_STATIC_WEIGHTS)[0].hit.siteId).toBe('exact-only')
    const dynamic = { exact: 0.1, fts: 3.0, pinyin: 0.9, semantic: 1.15, personal: 0.3 }
    expect(labTop3(hits, dynamic)[0].hit.siteId).toBe('fts-only')
  })

  it('只取 Top 3 且分数降序', () => {
    const hits = Array.from({ length: 5 }, (_, i) => hit('s' + i, { exact: { rank: i, value: 1 } }))
    const top = labTop3(hits, LAB_STATIC_WEIGHTS)
    expect(top).toHaveLength(3)
    expect(top.map((s) => s.hit.siteId)).toEqual(['s0', 's1', 's2'])
  })

  it('无 contributions 的命中分数为 0', () => {
    const h = hit('a', {})
    expect(labScoreHit(h, LAB_STATIC_WEIGHTS)).toBe(0)
    expect(labTop3([h], LAB_STATIC_WEIGHTS)).toHaveLength(1)
  })
})
