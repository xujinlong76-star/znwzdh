export interface FrequencyBandsEnergy {
  subBass: number // 20 - 60 Hz
  bass: number // 60 - 250 Hz
  midrange: number // 250 - 2000 Hz
  presence: number // 2000 - 6000 Hz (Voice intelligibility)
  brilliance: number // 6000 - 20000 Hz
  dominantFrequencyHz: number
}

export interface SpectrogramFrame {
  timestamp: number
  frequencies: Uint8Array
}

/**
 * Calculates energy distribution across perceptual frequency bands
 * and identifies the dominant voice pitch/formant frequency.
 */
export function calculateFrequencyBands(
  frequencyData: Uint8Array,
  sampleRate: number = 44100
): FrequencyBandsEnergy {
  const binCount = frequencyData.length
  if (binCount === 0) {
    return {
      subBass: 0,
      bass: 0,
      midrange: 0,
      presence: 0,
      brilliance: 0,
      dominantFrequencyHz: 0,
    }
  }

  const nyquist = sampleRate / 2
  const hzPerBin = nyquist / binCount

  let subBassSum = 0, subBassCount = 0
  let bassSum = 0, bassCount = 0
  let midSum = 0, midCount = 0
  let presenceSum = 0, presenceCount = 0
  let brillianceSum = 0, brillianceCount = 0

  let maxVal = -1
  let maxBinIndex = 0

  for (let i = 0; i < binCount; i++) {
    const val = frequencyData[i]
    const hz = i * hzPerBin

    if (val > maxVal) {
      maxVal = val
      maxBinIndex = i
    }

    if (hz < 60) {
      subBassSum += val
      subBassCount++
    } else if (hz < 250) {
      bassSum += val
      bassCount++
    } else if (hz < 2000) {
      midSum += val
      midCount++
    } else if (hz < 6000) {
      presenceSum += val
      presenceCount++
    } else {
      brillianceSum += val
      brillianceCount++
    }
  }

  return {
    subBass: subBassCount > 0 ? Math.round(subBassSum / subBassCount) : 0,
    bass: bassCount > 0 ? Math.round(bassSum / bassCount) : 0,
    midrange: midCount > 0 ? Math.round(midSum / midCount) : 0,
    presence: presenceCount > 0 ? Math.round(presenceSum / presenceCount) : 0,
    brilliance: brillianceCount > 0 ? Math.round(brillianceSum / brillianceCount) : 0,
    dominantFrequencyHz: Math.round(maxBinIndex * hzPerBin),
  }
}

/**
 * Maps a frequency amplitude (0..255) to a neon heatmap color (Hex string).
 */
export function getFrequencyColor(value: number): string {
  if (value < 40) return '#09090b' // Background dark
  if (value < 90) return '#0369a1' // Deep blue
  if (value < 140) return '#06b6d4' // Cyan
  if (value < 190) return '#10b981' // Emerald
  if (value < 230) return '#f59e0b' // Amber
  return '#f43f5e' // Bright rose
}

/**
 * Manages a rolling history buffer for a 2D Spectrogram waterfall.
 */
export class SpectrogramWaterfallBuffer {
  private maxHistory: number
  private history: Uint8Array[] = []

  constructor(maxHistory: number = 60) {
    this.maxHistory = maxHistory
  }

  pushFrame(frequencies: Uint8Array): void {
    const copy = new Uint8Array(frequencies)
    this.history.unshift(copy)
    if (this.history.length > this.maxHistory) {
      this.history.pop()
    }
  }

  getFrames(): Uint8Array[] {
    return this.history
  }

  clear(): void {
    this.history = []
  }
}
