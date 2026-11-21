import { describe, expect, it } from 'vitest'
import {
  AGING_MAX_MS,
  FRESH_MAX_MS,
  freshnessClass,
  freshnessLabel,
  freshnessLevel,
} from '../src/lib/rank-freshness'

/**
 * 榜单时效分级回归（2026-11-21）。
 *
 * 修的是"今日热榜"配"热度分 4 天前重算"却毫无视觉警示——用户会误以为
 * 看到的是今天的实时热度。现在按 <6h / 6-24h / >24h 三档分级。
 */
describe('freshnessLevel', () => {
  const now = Date.parse('2026-11-21T12:00:00Z')
  const hoursAgo = (h: number) => now - h * 3600 * 1000

  it('门槛常量', () => {
    expect(FRESH_MAX_MS).toBe(6 * 3600 * 1000)
    expect(AGING_MAX_MS).toBe(24 * 3600 * 1000)
  })

  it('< 6 小时 → fresh', () => {
    expect(freshnessLevel(hoursAgo(0), now)).toBe('fresh')
    expect(freshnessLevel(hoursAgo(5.9), now)).toBe('fresh')
  })
  it('6-24 小时 → aging', () => {
    expect(freshnessLevel(hoursAgo(6), now)).toBe('aging')
    expect(freshnessLevel(hoursAgo(23), now)).toBe('aging')
  })
  it('> 24 小时 → stale（当前 4 天前就是这一档）', () => {
    expect(freshnessLevel(hoursAgo(24), now)).toBe('stale')
    expect(freshnessLevel(hoursAgo(96), now)).toBe('stale')
  })
  it('null / 非法值 → unknown（不显示、不编造）', () => {
    expect(freshnessLevel(null, now)).toBe('unknown')
    expect(freshnessLevel(undefined, now)).toBe('unknown')
    expect(freshnessLevel(Number.NaN, now)).toBe('unknown')
  })
  it('未来时间戳（时钟漂移）按最新处理，不报负天数', () => {
    expect(freshnessLevel(now + 3600_000, now)).toBe('fresh')
  })
})

describe('freshnessLabel', () => {
  const now = Date.parse('2026-11-21T12:00:00Z')
  const hoursAgo = (h: number) => now - h * 3600 * 1000

  it('fresh：小时内/几小时前', () => {
    expect(freshnessLabel('fresh', now - 60_000, now)).toBe('热度分刚刚更新')
    expect(freshnessLabel('fresh', hoursAgo(3), now)).toBe('热度分 3 小时前更新')
  })
  it('aging：按小时', () => {
    expect(freshnessLabel('aging', hoursAgo(8), now)).toBe('热度分 8 小时前更新')
  })
  it('stale 明确写"已超过 X 天未更新"而不是"X 天前更新"', () => {
    expect(freshnessLabel('stale', hoursAgo(96), now)).toBe('重算时间戳已超过 4 天未更新')
    // 反例断言：不能退化成没有警示意味的"4 天前更新"
    expect(freshnessLabel('stale', hoursAgo(96), now)).not.toBe('热度分 4 天前更新')
  })
  it('unknown / null 返回空串', () => {
    expect(freshnessLabel('unknown', null, now)).toBe('')
  })
})

describe('freshnessClass', () => {
  it('fresh 用中性灰（不抢注意力）', () => {
    expect(freshnessClass('fresh')).toContain('text-muted-foreground')
    expect(freshnessClass('fresh')).not.toContain('amber')
  })
  it('aging 用轻量 amber 提示', () => {
    expect(freshnessClass('aging')).toContain('amber')
  })
  it('stale 用更强的 amber + 加粗，形成明确警示', () => {
    const stale = freshnessClass('stale')
    expect(stale).toContain('amber')
    expect(stale).toContain('font-medium')
  })
  it('三档样式互不相同', () => {
    const set = new Set([freshnessClass('fresh'), freshnessClass('aging'), freshnessClass('stale')])
    expect(set.size).toBe(3)
  })
})
