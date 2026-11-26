/**
 * Web Vitals 纯计算辅助函数（P0-1 性能基线升级）。
 *
 * 独立成纯模块供单测直接验证：
 * - INP 严格按 interactionId 聚合，单页超过 50 次交互取 p98（Chrome/web-vitals 口径）；
 * - 支持可配置采样率（默认 10%）；
 * - 统一的 Google 2024 Core Web Vitals 评级阈值。
 */

export type VitalName = 'LCP' | 'INP' | 'CLS' | 'TTFB' | 'FCP'
export type VitalRating = 'good' | 'needs-improvement' | 'poor'

export const WEB_VITAL_THRESHOLDS: Record<VitalName, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  TTFB: [800, 1800],
  FCP: [1800, 3000],
}

export function rateWebVital(name: VitalName, value: number): VitalRating {
  const [good, poor] = WEB_VITAL_THRESHOLDS[name]
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor'
}

/**
 * 解析采样率字符串（0~1），非法值回退默认 0.1（10%）。
 */
export function parseRumSampleRate(raw: string | undefined, fallback = 0.1): number {
  if (raw == null || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(1, n))
}

export function shouldSampleRum(sampleRate: number, randomValue = Math.random()): boolean {
  if (sampleRate <= 0) return false
  if (sampleRate >= 1) return true
  return randomValue < sampleRate
}

/**
 * 按 Chrome / web-vitals 规范计算 INP：
 * - 传入各次用户交互（按 interactionId 归并后的最大耗时）列表；
 * - 交互数 <= 50 取最大值；> 50 时每多 50 次交互忽略 1 个极端离群值（即 p98）。
 */
export function computeInpFromInteractions(durations: Iterable<number>): number {
  const list: number[] = []
  for (const d of durations) {
    if (Number.isFinite(d) && d >= 0) list.push(d)
  }
  if (list.length === 0) return 0
  list.sort((a, b) => a - b)
  const ignoreCount = Math.floor(list.length / 50)
  const idx = Math.max(0, list.length - 1 - ignoreCount)
  return list[idx]
}
