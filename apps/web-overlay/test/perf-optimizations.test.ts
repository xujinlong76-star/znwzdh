import { describe, expect, it } from 'vitest'
import {
  computeInpFromInteractions,
  parseRumSampleRate,
  rateWebVital,
  shouldSampleRum,
} from '@/lib/web-vitals-metrics'

describe('web-vitals-metrics (P0-1)', () => {
  it('computes INP as max when interactions <= 50', () => {
    expect(computeInpFromInteractions([])).toBe(0)
    expect(computeInpFromInteractions([48, 120, 96, 180])).toBe(180)
  })

  it('computes INP at p98 (ignoring 1 outlier per 50 interactions) when interactions > 50', () => {
    const durations = Array.from({ length: 55 }, (_, i) => (i === 54 ? 640 : 100 + i))
    // 55 interactions -> floor(55 / 50) = 1 outlier ignored -> index 53 = 153ms (not 640ms)
    expect(computeInpFromInteractions(durations)).toBe(153)
  })

  it('parses and clamps RUM sample rate safely', () => {
    expect(parseRumSampleRate(undefined)).toBe(0.1)
    expect(parseRumSampleRate('')).toBe(0.1)
    expect(parseRumSampleRate('bad')).toBe(0.1)
    expect(parseRumSampleRate('0.25')).toBe(0.25)
    expect(parseRumSampleRate('5')).toBe(1)
    expect(parseRumSampleRate('-1')).toBe(0)
    expect(shouldSampleRum(0, 0)).toBe(false)
    expect(shouldSampleRum(1, 0.99)).toBe(true)
    expect(shouldSampleRum(0.1, 0.05)).toBe(true)
    expect(shouldSampleRum(0.1, 0.2)).toBe(false)
  })

  it('rates Core Web Vitals according to Google 2024 thresholds', () => {
    expect(rateWebVital('LCP', 2400)).toBe('good')
    expect(rateWebVital('LCP', 3200)).toBe('needs-improvement')
    expect(rateWebVital('LCP', 4200)).toBe('poor')
    expect(rateWebVital('INP', 180)).toBe('good')
    expect(rateWebVital('INP', 300)).toBe('needs-improvement')
    expect(rateWebVital('INP', 520)).toBe('poor')
    expect(rateWebVital('CLS', 0.05)).toBe('good')
    expect(rateWebVital('CLS', 0.15)).toBe('needs-improvement')
    expect(rateWebVital('CLS', 0.3)).toBe('poor')
  })
})
