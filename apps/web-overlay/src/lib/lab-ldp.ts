import { sampleLaplace } from './federated-recommendation'

/** W1-2：LDP ε 滑块 + 每维噪声分布采样的实验室侧工具（纯本地，无网络请求）。 */

export const LDP_EPSILON_MIN = 0.2
export const LDP_EPSILON_MAX = 5
export const LDP_EPSILON_STEP = 0.1
export const LDP_EPSILON_PRESETS = [0.2, 0.5, 1.0, 2.0, 5.0] as const
export const LDP_SAMPLE_COUNT = 200
export const LDP_HISTOGRAM_BINS = 10
export const LDP_NOISE_THRESHOLD = 0.5

export interface LdpDimensionSample {
  index: number
  original: number
  mean: number
  sd: number
  pAbsNoiseGtHalf: number
  min: number
  max: number
  buckets: number[]
}

/** 对单维原始值采样 count 次加噪值（原始值 + Laplace(0, 1/ε)），汇总均值、SD 与 P(|噪声|>0.5)。 */
export function sampleLdpDimension(
  original: number,
  epsilon: number,
  count: number = LDP_SAMPLE_COUNT,
  index: number = 0,
  sampler: (b: number) => number = sampleLaplace,
): LdpDimensionSample {
  const b = 1 / epsilon
  const samples: number[] = []
  for (let i = 0; i < count; i++) samples.push(original + sampler(b))
  const mean = samples.reduce((sum, value) => sum + value, 0) / count
  const variance = samples.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / count
  const sd = Math.sqrt(variance)
  const beyond = samples.filter((value) => Math.abs(value - original) > LDP_NOISE_THRESHOLD).length
  const pAbsNoiseGtHalf = beyond / count
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  const buckets = new Array<number>(LDP_HISTOGRAM_BINS).fill(0)
  const span = max - min
  for (const value of samples) {
    const bucket = span === 0 ? 0 : Math.min(LDP_HISTOGRAM_BINS - 1, Math.floor(((value - min) / span) * LDP_HISTOGRAM_BINS))
    buckets[bucket] += 1
  }
  return { index, original, mean, sd, pAbsNoiseGtHalf, min, max, buckets }
}

/** 原始值在样本区间中的相对位置（0–1），供直方图上的原始值刻度线定位。 */
export function originalPosition(sample: LdpDimensionSample): number {
  if (sample.max === sample.min) return 0.5
  return (sample.original - sample.min) / (sample.max - sample.min)
}

/** 名次变化标记：oldRank/newRank 均为 1 起的名次。 */
export function rankChangeLabel(oldRank: number, newRank: number): string {
  const delta = oldRank - newRank
  if (delta > 0) return `↑${delta}`
  if (delta < 0) return `↓${-delta}`
  return '—'
}
