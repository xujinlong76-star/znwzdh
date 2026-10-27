export interface SilenceDetectorConfig {
  enabled: boolean
  silenceThresholdDb: number // e.g. -45 dBFS
  minSilenceDurationMs: number // e.g. 400ms
  baseRate: number // normal speed (e.g. 1.0x, 1.25x)
  skipRate: number // accelerated speed during silence (e.g. 2.5x, 3.0x)
  smoothingFactor: number // EMA easing 0.1 - 0.5
}

export interface SilenceDetectorState {
  currentLoudnessDb: number
  isSilent: boolean
  currentDynamicRate: number
  silenceDurationMs: number
  totalTimeSavedSec: number
}

/**
 * Calculates Root-Mean-Square (RMS) amplitude from audio time-domain byte samples
 * and converts to full-scale decibels (dBFS).
 */
export function calculateRmsDb(timeDomainData: Uint8Array | Float32Array): number {
  if (timeDomainData.length === 0) return -100

  let sumSquares = 0
  const isFloat = timeDomainData instanceof Float32Array

  for (let i = 0; i < timeDomainData.length; i++) {
    let normalized = 0
    if (isFloat) {
      normalized = timeDomainData[i] as number
    } else {
      // 0..255 byte data -> -1.0 .. 1.0
      normalized = ((timeDomainData[i] as number) - 128) / 128
    }
    sumSquares += normalized * normalized
  }

  const meanSquare = sumSquares / timeDomainData.length
  const rms = Math.sqrt(meanSquare)
  if (rms <= 0.00001) {
    return -100
  }

  // 20 * log10(rms)
  const db = 20 * Math.log10(rms)
  return Math.max(-100, Math.min(0, Math.round(db * 10) / 10))
}

/**
 * Computes smoothly interpolated playback rate given current loudness and silence duration.
 */
export function computeDynamicPlaybackRate(
  loudnessDb: number,
  state: SilenceDetectorState,
  config: SilenceDetectorConfig,
  deltaTimeMs: number
): { isSilent: boolean; newRate: number; newSilenceDurationMs: number } {
  if (!config.enabled) {
    return {
      isSilent: false,
      newRate: config.baseRate,
      newSilenceDurationMs: 0,
    }
  }

  const isLoudnessBelow = loudnessDb <= config.silenceThresholdDb
  let newSilenceDurationMs = state.silenceDurationMs

  if (isLoudnessBelow) {
    newSilenceDurationMs += deltaTimeMs
  } else {
    newSilenceDurationMs = 0
  }

  const isSilent = isLoudnessBelow && (newSilenceDurationMs >= config.minSilenceDurationMs)
  const targetRate = isSilent ? config.skipRate : config.baseRate

  // Exponential moving average for click-free smooth audio rate transitions
  const alpha = Math.max(0.05, Math.min(0.5, config.smoothingFactor || 0.2))
  const newRate = Number(((state.currentDynamicRate * (1 - alpha)) + (targetRate * alpha)).toFixed(2))

  return {
    isSilent,
    newRate,
    newSilenceDurationMs,
  }
}

/**
 * Creates an audio silence detection controller connected to HTMLMediaElement and AudioContext.
 */
export class SmartSpeedController {
  private config: SilenceDetectorConfig
  private state: SilenceDetectorState
  private lastUpdateTime: number = Date.now()

  constructor(initialConfig?: Partial<SilenceDetectorConfig>) {
    this.config = {
      enabled: false,
      silenceThresholdDb: -42,
      minSilenceDurationMs: 400,
      baseRate: 1.0,
      skipRate: 2.5,
      smoothingFactor: 0.25,
      ...initialConfig,
    }

    this.state = {
      currentLoudnessDb: -100,
      isSilent: false,
      currentDynamicRate: this.config.baseRate,
      silenceDurationMs: 0,
      totalTimeSavedSec: 0,
    }
  }

  setConfig(newConfig: Partial<SilenceDetectorConfig>): void {
    Object.assign(this.config, newConfig)
    if (!this.config.enabled) {
      this.state.currentDynamicRate = this.config.baseRate
      this.state.isSilent = false
      this.state.silenceDurationMs = 0
    }
  }

  getConfig(): SilenceDetectorConfig {
    return { ...this.config }
  }

  getState(): SilenceDetectorState {
    return { ...this.state }
  }

  /**
   * Processes a slice of time-domain data and updates internal rate state.
   */
  processAudioSample(timeDomainData: Uint8Array | Float32Array): number {
    const now = Date.now()
    const deltaTimeMs = Math.min(200, Math.max(16, now - this.lastUpdateTime))
    this.lastUpdateTime = now

    const db = calculateRmsDb(timeDomainData)
    this.state.currentLoudnessDb = db

    const result = computeDynamicPlaybackRate(db, this.state, this.config, deltaTimeMs)
    this.state.isSilent = result.isSilent
    this.state.silenceDurationMs = result.newSilenceDurationMs

    if (result.isSilent && result.newRate > this.config.baseRate) {
      const normalDuration = deltaTimeMs / 1000
      const acceleratedDuration = normalDuration / (result.newRate / this.config.baseRate)
      this.state.totalTimeSavedSec += Math.max(0, normalDuration - acceleratedDuration)
    }

    this.state.currentDynamicRate = result.newRate
    return this.state.currentDynamicRate
  }
}
