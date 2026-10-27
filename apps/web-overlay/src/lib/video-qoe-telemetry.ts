export interface QoEMetrics {
  videoId: string
  mirrorId: string
  ttfbMs: number
  rebufferCount: number
  totalStallDurationMs: number
  watchTimeMs: number
  rebufferRatio: number // 0.0 - 1.0 (stall / total watch)
  estimatedBandwidthMbps: number
  networkType: string
  healthScore: number // 0 - 100
  status: 'excellent' | 'good' | 'degraded' | 'critical'
}

export interface QoETracker {
  recordTTFB: (ms: number) => void
  recordStallStart: () => void
  recordStallEnd: () => void
  recordPlaybackTick: (durationMs: number) => void
  updateBandwidthSample: (bytes: number, durationMs: number) => void
  getMetrics: () => QoEMetrics
  shouldTriggerAutoFailover: () => boolean
}

/**
 * Initializes a client-side Quality of Experience (QoE) telemetry session.
 */
export function createQoETracker(
  videoId: string,
  initialMirrorId: string
): QoETracker {
  let ttfb = 180
  let rebufferCount = 0
  let totalStallDurationMs = 0
  let watchTimeMs = 1000
  let currentStallStart: number | null = null
  let bandwidthSamples: number[] = [12.5] // Default ~12.5 Mbps

  let networkType = 'wifi'
  if (typeof navigator !== 'undefined' && 'connection' in navigator) {
    const conn = (navigator as any).connection
    if (conn && conn.effectiveType) {
      networkType = conn.effectiveType
    }
  }

  function calculateHealthScore(): { score: number; status: QoEMetrics['status'] } {
    const ratio = totalStallDurationMs / Math.max(1000, watchTimeMs)

    // Formula: 100 - (stall ratio * 150) - (rebuffer count * 8) - (TTFB / 80)
    let score = 100 - (ratio * 150) - (rebufferCount * 8) - (Math.min(1000, ttfb) / 80)
    score = Math.max(10, Math.min(100, Math.round(score)))

    let status: QoEMetrics['status'] = 'excellent'
    if (score < 40 || ratio > 0.15 || rebufferCount >= 4) {
      status = 'critical'
    } else if (score < 65 || ratio > 0.06 || rebufferCount >= 2) {
      status = 'degraded'
    } else if (score < 85) {
      status = 'good'
    }

    return { score, status }
  }

  return {
    recordTTFB: (ms: number) => {
      ttfb = Math.max(10, ms)
    },
    recordStallStart: () => {
      if (currentStallStart === null) {
        currentStallStart = Date.now()
        rebufferCount++
      }
    },
    recordStallEnd: () => {
      if (currentStallStart !== null) {
        const stallMs = Date.now() - currentStallStart
        totalStallDurationMs += Math.max(0, stallMs)
        currentStallStart = null
      }
    },
    recordPlaybackTick: (durationMs: number) => {
      watchTimeMs += Math.max(0, durationMs)
    },
    updateBandwidthSample: (bytes: number, durationMs: number) => {
      if (durationMs > 0 && bytes > 0) {
        const mbps = (bytes * 8) / (durationMs / 1000) / 1_000_000
        bandwidthSamples.push(mbps)
        if (bandwidthSamples.length > 10) bandwidthSamples.shift()
      }
    },
    getMetrics: () => {
      const avgBw = bandwidthSamples.reduce((a, b) => a + b, 0) / bandwidthSamples.length
      const { score, status } = calculateHealthScore()
      const ratio = totalStallDurationMs / Math.max(1000, watchTimeMs)

      return {
        videoId,
        mirrorId: initialMirrorId,
        ttfbMs: ttfb,
        rebufferCount,
        totalStallDurationMs,
        watchTimeMs,
        rebufferRatio: Number(ratio.toFixed(4)),
        estimatedBandwidthMbps: Number(avgBw.toFixed(2)),
        networkType,
        healthScore: score,
        status,
      }
    },
    shouldTriggerAutoFailover: () => {
      const { status } = calculateHealthScore()
      return status === 'critical'
    },
  }
}
