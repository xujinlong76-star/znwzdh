import type { VideoChapter, VideoDanmakuItem } from '@/types/navigation'
import { chapterStartSec } from '@/types/navigation'

export interface SpriteConfig {
  spriteUrl: string
  cellWidth: number
  cellHeight: number
  cols: number
  rows: number
  intervalSec: number
  totalFrames?: number
}

export interface SpriteCoordinate {
  offsetX: number
  offsetY: number
  cellWidth: number
  cellHeight: number
  spriteUrl: string
  frameIndex: number
}

export interface EngagementHeatmapPoint {
  timeSec: number
  normalizedTime: number // 0.0 - 1.0
  density: number // 0.0 - 1.0
  isPeak: boolean
  label?: string
}

/**
 * Calculates exact CSS background sprite offset for a given playback timestamp.
 */
export function getSpriteCoordinate(
  timeSec: number,
  config: SpriteConfig
): SpriteCoordinate {
  const safeTime = Math.max(0, timeSec)
  const frameIndex = Math.floor(safeTime / Math.max(1, config.intervalSec))
  const maxFrames = (config.cols * config.rows) - 1
  const clampedIndex = Math.min(config.totalFrames ? config.totalFrames - 1 : maxFrames, frameIndex)

  const col = clampedIndex % config.cols
  const row = Math.floor(clampedIndex / config.cols)

  return {
    offsetX: col * config.cellWidth,
    offsetY: row * config.cellHeight,
    cellWidth: config.cellWidth,
    cellHeight: config.cellHeight,
    spriteUrl: config.spriteUrl,
    frameIndex: clampedIndex,
  }
}

/**
 * Generates an engagement density curve (like YouTube's "Most Replayed" waveform)
 * based on chapter markers, code milestone locations, and danmaku/pitfall clusters.
 */
export function generateEngagementHeatmap(params: {
  durationSec: number
  chapters?: VideoChapter[]
  danmaku?: VideoDanmakuItem[]
  samplesCount?: number
}): EngagementHeatmapPoint[] {
  const { durationSec, chapters = [], danmaku = [], samplesCount = 100 } = params
  const validDuration = Math.max(10, durationSec)
  const step = validDuration / samplesCount

  const rawWeights = new Array(samplesCount).fill(0.15) // Baseline interest

  // 1. Chapter boundaries & code blocks increase engagement
  chapters.forEach((ch) => {
    const centerIdx = Math.floor((chapterStartSec(ch) / validDuration) * samplesCount)
    const weightBonus = ch.codeSnippet ? 0.7 : 0.4
    const radius = ch.codeSnippet ? 6 : 4

    for (let offset = -radius; offset <= radius; offset++) {
      const idx = centerIdx + offset
      if (idx >= 0 && idx < samplesCount) {
        const factor = Math.exp(-Math.pow(offset / (radius * 0.5), 2))
        rawWeights[idx] += weightBonus * factor
      }
    }
  })

  // 2. Danmaku clusters and especially pitfall warnings create major attention spikes
  danmaku.forEach((dm) => {
    const centerIdx = Math.floor((dm.timeSec / validDuration) * samplesCount)
    const dmBonus = dm.isPitfallWarning ? 0.85 : 0.35
    const radius = 3

    for (let offset = -radius; offset <= radius; offset++) {
      const idx = centerIdx + offset
      if (idx >= 0 && idx < samplesCount) {
        const factor = Math.exp(-Math.pow(offset / 1.5, 2))
        rawWeights[idx] += dmBonus * factor
      }
    }
  })

  // 3. Normalization and peak detection
  let maxWeight = 0.001
  for (let i = 0; i < samplesCount; i++) {
    if (rawWeights[i] > maxWeight) maxWeight = rawWeights[i]
  }

  const result: EngagementHeatmapPoint[] = []

  for (let i = 0; i < samplesCount; i++) {
    const timeSec = Math.round(i * step)
    const normalizedDensity = Math.min(1.0, Math.max(0.05, rawWeights[i] / maxWeight))
    const isPeak = normalizedDensity > 0.8

    let label: string | undefined
    if (isPeak) {
      const matchingCh = chapters.find(c => Math.abs(chapterStartSec(c) - timeSec) < step * 2)
      if (matchingCh) {
        label = matchingCh.codeSnippet ? `高能代码实操: ${matchingCh.title}` : matchingCh.title
      }
    }

    result.push({
      timeSec,
      normalizedTime: i / (samplesCount - 1),
      density: Number(normalizedDensity.toFixed(3)),
      isPeak,
      label,
    })
  }

  return result
}

/**
 * Creates SVG Path representation for engagement density waveform.
 */
export function buildHeatmapSvgPath(
  points: EngagementHeatmapPoint[],
  width: number,
  height: number
): { areaPath: string; linePath: string } {
  if (points.length === 0) {
    return { areaPath: '', linePath: '' }
  }

  const coords = points.map((p) => {
    const x = p.normalizedTime * width
    const y = height - (p.density * (height * 0.85)) // Keep 15% top margin
    return { x, y }
  })

  let linePath = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1]
    const curr = coords[i]
    const midX = (prev.x + curr.x) / 2
    linePath += ` Q ${prev.x.toFixed(1)} ${prev.y.toFixed(1)}, ${midX.toFixed(1)} ${((prev.y + curr.y) / 2).toFixed(1)}`
  }
  linePath += ` L ${coords[coords.length - 1].x.toFixed(1)} ${coords[coords.length - 1].y.toFixed(1)}`

  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`

  return { areaPath, linePath }
}
