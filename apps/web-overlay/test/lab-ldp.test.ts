import { describe, expect, it } from 'vitest'
import {
  LDP_EPSILON_MAX,
  LDP_EPSILON_MIN,
  LDP_EPSILON_PRESETS,
  LDP_EPSILON_STEP,
  LDP_HISTOGRAM_BINS,
  LDP_NOISE_THRESHOLD,
  LDP_SAMPLE_COUNT,
  originalPosition,
  rankChangeLabel,
  sampleLdpDimension,
} from '../src/lib/lab-ldp'

/** 确定性采样器：恒返回固定噪声，便于锁死统计量。 */
const fixed = (noise: number) => () => noise

describe('实验室 LDP ε 滑块 + 分布对比', () => {
  it('滑块常量：0.2–5、步长 0.1、5 档预设', () => {
    expect(LDP_EPSILON_MIN).toBe(0.2)
    expect(LDP_EPSILON_MAX).toBe(5)
    expect(LDP_EPSILON_STEP).toBe(0.1)
    expect([...LDP_EPSILON_PRESETS]).toEqual([0.2, 0.5, 1.0, 2.0, 5.0])
    expect(LDP_SAMPLE_COUNT).toBe(200)
    expect(LDP_HISTOGRAM_BINS).toBe(10)
    expect(LDP_NOISE_THRESHOLD).toBe(0.5)
  })

  it('确定性采样：均值/SD/P 值与直方图桶总和可算', () => {
    const dim = sampleLdpDimension(0.9, 1.0, 4, 0, fixed(0.1))
    expect(dim.original).toBe(0.9)
    expect(dim.mean).toBeCloseTo(1.0, 10)
    expect(dim.sd).toBeCloseTo(0, 10)
    expect(dim.pAbsNoiseGtHalf).toBe(0)
    expect(dim.buckets.reduce((sum, count) => sum + count, 0)).toBe(4)
    expect(dim.buckets.length).toBe(LDP_HISTOGRAM_BINS)
  })

  it('P(|噪声|>0.5)：固定 0.6 噪声时全部超阈值', () => {
    const dim = sampleLdpDimension(0.5, 1.0, 10, 1, fixed(0.6))
    expect(dim.pAbsNoiseGtHalf).toBe(1)
    expect(dim.mean).toBeCloseTo(1.1, 10)
  })

  it('原始值刻度位置：区间端点与中点', () => {
    const base = { index: 0, mean: 0.5, sd: 0.1, pAbsNoiseGtHalf: 0, min: 0.2, max: 0.8, buckets: [] as number[] }
    expect(originalPosition({ ...base, original: 0.2 })).toBeCloseTo(0, 10)
    expect(originalPosition({ ...base, original: 0.8 })).toBeCloseTo(1, 10)
    expect(originalPosition({ ...base, original: 0.5 })).toBeCloseTo(0.5, 10)
    expect(originalPosition({ ...base, original: 0.5, min: 0.5, max: 0.5, sd: 0 })).toBe(0.5)
  })

  it('名次变化标记：上升/下降/不变', () => {
    expect(rankChangeLabel(2, 1)).toBe('↑1')
    expect(rankChangeLabel(1, 3)).toBe('↓2')
    expect(rankChangeLabel(2, 2)).toBe('—')
  })

  it('默认采样器：200 次采样桶总和等于采样数、均值贴近原始值', () => {
    const dim = sampleLdpDimension(0.7, 1.0)
    expect(dim.buckets.reduce((sum, count) => sum + count, 0)).toBe(LDP_SAMPLE_COUNT)
    expect(Math.abs(dim.mean - 0.7)).toBeLessThan(0.5)
    expect(dim.sd).toBeGreaterThan(0)
    expect(dim.pAbsNoiseGtHalf).toBeGreaterThanOrEqual(0)
    expect(dim.pAbsNoiseGtHalf).toBeLessThanOrEqual(1)
  })
})
