/**
 * 对比分享字段级 TTL 三态单测（P13）。
 *
 * 口径见 src/lib/compare-share-ttl.ts：价格/套餐 30 天、功能清单 90 天、
 * 上线状态 180 天；无 verified_at 或 verified !== true 的格子永远是「未核实」。
 */
import { describe, expect, it } from 'vitest'
import {
  COMPARE_SHARE_FIELD_TTL_DAYS,
  compareShareCellDisplay,
  fieldFreshness,
  formatIsoDate,
} from '../src/lib/compare-share-ttl'
import type { ComparisonCell } from '../src/lib/compare'

const DAY = 24 * 60 * 60 * 1000
/** 固定“现在”：2026-11-26 12:00 CST */
const NOW = Date.UTC(2026, 10, 26, 4, 0, 0)

function cell(over: Partial<ComparisonCell> = {}): ComparisonCell {
  return {
    value: '免费',
    source: '官网定价页',
    verified: true,
    verifiedAt: NOW - 10 * DAY,
    ...over,
  }
}

describe('TTL 分档', () => {
  it('价格/套餐 30 天、功能清单 90 天、上线状态 180 天', () => {
    expect(COMPARE_SHARE_FIELD_TTL_DAYS).toEqual({
      pricing: 30,
      price: 30,
      platform: 90,
      form: 90,
      maintenance: 180,
    })
  })
})

describe('fieldFreshness 三态', () => {
  it('TTL 内是已核验：price 格 10 天前核实', () => {
    expect(fieldFreshness(cell(), 'price', NOW)).toBe('verified')
  })

  it('超出 TTL 是已过期：price 格 31 天前核实', () => {
    expect(fieldFreshness(cell({ verifiedAt: NOW - 31 * DAY }), 'price', NOW)).toBe('expired')
  })

  it('边界：now 恰等于 verifiedAt + TTL 仍算已核验，超出 1 毫秒即过期', () => {
    const at = NOW - 30 * DAY
    expect(fieldFreshness(cell({ verifiedAt: at }), 'price', NOW)).toBe('verified')
    expect(fieldFreshness(cell({ verifiedAt: at }), 'price', NOW + 1)).toBe('expired')
  })

  it('分档生效：同一核实时间，platform 90 天内已核验、price 30 天外已过期', () => {
    const at = NOW - 40 * DAY
    expect(fieldFreshness(cell({ verifiedAt: at }), 'platform', NOW)).toBe('verified')
    expect(fieldFreshness(cell({ verifiedAt: at }), 'price', NOW)).toBe('expired')
  })

  it('maintenance 180 天档：179 天前已核验、181 天前已过期', () => {
    expect(fieldFreshness(cell({ verifiedAt: NOW - 179 * DAY }), 'maintenance', NOW)).toBe('verified')
    expect(fieldFreshness(cell({ verifiedAt: NOW - 181 * DAY }), 'maintenance', NOW)).toBe('expired')
  })

  it('verified=false 即未核实（值再真也不算已核实）', () => {
    expect(fieldFreshness(cell({ verified: false }), 'price', NOW)).toBe('unverified')
  })

  it('无 verifiedAt 即未核实（红线：缺核实日期绝不渲染为已核实）', () => {
    expect(fieldFreshness(cell({ verifiedAt: null }), 'price', NOW)).toBe('unverified')
  })

  it('值为空即未核实', () => {
    expect(fieldFreshness(cell({ value: null }), 'price', NOW)).toBe('unverified')
    expect(fieldFreshness(cell({ value: '   ' }), 'price', NOW)).toBe('unverified')
  })

  it('格子缺失 / 未知字段键即未核实，不编造', () => {
    expect(fieldFreshness(null, 'price', NOW)).toBe('unverified')
    expect(fieldFreshness(cell(), 'note', NOW)).toBe('unverified')
  })

  it('price 的 stale 旧标记不参与判定：verifiedAt 在 TTL 内即已核验', () => {
    expect(fieldFreshness(cell({ stale: true }), 'price', NOW)).toBe('verified')
  })
})

describe('formatIsoDate', () => {
  it('毫秒戳 → YYYY-MM-DD（Asia/Shanghai）', () => {
    expect(formatIsoDate(Date.UTC(2026, 10, 14, 0, 0, 0))).toBe('2026-11-14')
  })

  it('非法 / 缺失返回 null，不编造日期', () => {
    expect(formatIsoDate(null)).toBeNull()
    expect(formatIsoDate(Number.NaN)).toBeNull()
  })
})

describe('compareShareCellDisplay 可见文案', () => {
  it('已核验：主值 + 来源 · 核实于 YYYY/MM/DD', () => {
    const d = compareShareCellDisplay(cell({ verifiedAt: Date.UTC(2026, 10, 14, 0, 0, 0) }), 'price', NOW)
    expect(d.state).toBe('verified')
    expect(d.valueText).toBe('免费')
    expect(d.noteText).toBe('来源：官网定价页 · 核实于 2026/11/14')
    expect(d.verifiedDateText).toBe('2026-11-14')
  })

  it('已过期：灰显文案含“截至 YYYY-MM-DD 核验，现待复核”', () => {
    const d = compareShareCellDisplay(cell({ verifiedAt: Date.UTC(2026, 9, 20, 0, 0, 0) }), 'price', NOW)
    expect(d.state).toBe('expired')
    expect(d.noteText).toBe('来源：官网定价页 · 截至 2026-10-20 核验，现待复核')
  })

  it('未核实：副行标“未验证”，无来源时写“来源未标注”', () => {
    const d = compareShareCellDisplay(cell({ verified: false, source: '' }), 'price', NOW)
    expect(d.state).toBe('unverified')
    expect(d.noteText).toBe('来源未标注 · 未验证')
  })

  it('值为空的格子主值就是“未验证”', () => {
    const d = compareShareCellDisplay(cell({ value: null, verified: false }), 'price', NOW)
    expect(d.valueText).toBe('未验证')
  })
})
