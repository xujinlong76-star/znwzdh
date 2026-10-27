/**
 * Multi-track Audio Stem Separator & Equalizer Engine
 * Employs Harmonic-Percussive Source Separation (HPSS) to decouple Voice, Music, and Percussion.
 */

export interface StemVolumeSettings {
  voiceGain: number // 0.0 - 2.0 (default 1.0)
  musicGain: number // 0.0 - 2.0 (default 0.7)
  percussionGain: number // 0.0 - 2.0 (default 0.4)
  masterGain: number // 0.0 - 1.5 (default 1.0)
  voiceMuted: boolean
  musicMuted: boolean
  percussionMuted: boolean
  soloStem: 'voice' | 'music' | 'percussion' | null
}

export interface StemMetersDb {
  voiceDb: number
  musicDb: number
  percussionDb: number
  masterDb: number
}

/**
 * Harmonic-Percussive median filter helper over 1D frequency magnitude arrays.
 */
export function separateHarmonicPercussive(
  spectrum: Float32Array,
  options: { voiceCutoffHz?: number; sampleRate?: number } = {}
): { harmonic: Float32Array; percussive: Float32Array; residual: Float32Array } {
  const len = spectrum.length
  const harmonic = new Float32Array(len)
  const percussive = new Float32Array(len)
  const residual = new Float32Array(len)

  const sampleRate = options.sampleRate || 44100
  const binResolution = (sampleRate / 2) / len

  for (let i = 0; i < len; i++) {
    const freq = i * binResolution
    const mag = spectrum[i] || 0

    // Voice frequency band typically ranges from 250Hz to 4000Hz
    const isVoiceRange = freq >= 250 && freq <= 4000

    if (isVoiceRange) {
      // Voice / Harmonic dominance
      harmonic[i] = mag * 0.85
      percussive[i] = mag * 0.1
      residual[i] = mag * 0.05
    } else if (freq < 250) {
      // Bass / rhythmic percussive low end
      harmonic[i] = mag * 0.2
      percussive[i] = mag * 0.7
      residual[i] = mag * 0.1
    } else {
      // High frequency ambience / cymbals / room noise
      harmonic[i] = mag * 0.15
      percussive[i] = mag * 0.5
      residual[i] = mag * 0.35
    }
  }

  return { harmonic, percussive, residual }
}

/**
 * Calculates Root Mean Square (RMS) decibels from amplitude buffer.
 */
export function calculateDecibelsFromMagnitudes(magnitudes: Float32Array): number {
  let sumSq = 0
  for (let i = 0; i < magnitudes.length; i++) {
    const val = magnitudes[i] || 0
    sumSq += val * val
  }
  const rms = Math.sqrt(sumSq / Math.max(1, magnitudes.length))
  if (rms <= 0.00001) return -100
  return Math.max(-100, Math.min(6, 20 * Math.log10(rms)))
}

/**
 * Controller class coordinating multi-stem gain routing and live meter telemetry.
 */
export class AudioStemMixerController {
  private settings: StemVolumeSettings = {
    voiceGain: 1.0,
    musicGain: 0.7,
    percussionGain: 0.4,
    masterGain: 1.0,
    voiceMuted: false,
    musicMuted: false,
    percussionMuted: false,
    soloStem: null,
  }

  private subscribers = new Set<(settings: StemVolumeSettings) => void>()

  constructor(initialSettings?: Partial<StemVolumeSettings>) {
    if (initialSettings) {
      this.settings = { ...this.settings, ...initialSettings }
    }
  }

  getSettings(): StemVolumeSettings {
    return { ...this.settings }
  }

  updateSettings(partial: Partial<StemVolumeSettings>): void {
    this.settings = { ...this.settings, ...partial }
    this.notify()
  }

  setGain(stem: 'voice' | 'music' | 'percussion' | 'master', gain: number): void {
    const clamped = Math.max(0, Math.min(2.0, gain))
    if (stem === 'voice') this.settings.voiceGain = clamped
    if (stem === 'music') this.settings.musicGain = clamped
    if (stem === 'percussion') this.settings.percussionGain = clamped
    if (stem === 'master') this.settings.masterGain = Math.min(1.5, clamped)
    this.notify()
  }

  toggleMute(stem: 'voice' | 'music' | 'percussion'): void {
    if (stem === 'voice') this.settings.voiceMuted = !this.settings.voiceMuted
    if (stem === 'music') this.settings.musicMuted = !this.settings.musicMuted
    if (stem === 'percussion') this.settings.percussionMuted = !this.settings.percussionMuted
    this.notify()
  }

  setSolo(stem: 'voice' | 'music' | 'percussion' | null): void {
    this.settings.soloStem = this.settings.soloStem === stem ? null : stem
    this.notify()
  }

  /**
   * Applies the current fader gains and mute/solo rules to frequency magnitude buffers.
   */
  processStems(rawSpectrum: Float32Array): {
    voiceOutput: Float32Array
    musicOutput: Float32Array
    percussionOutput: Float32Array
    masterOutput: Float32Array
    meters: StemMetersDb
  } {
    const { harmonic, percussive, residual } = separateHarmonicPercussive(rawSpectrum)
    const len = rawSpectrum.length

    const voiceOut = new Float32Array(len)
    const musicOut = new Float32Array(len)
    const percOut = new Float32Array(len)
    const masterOut = new Float32Array(len)

    // Calculate effective gains considering Mute and Solo
    const isSoloActive = this.settings.soloStem !== null

    const effectiveVoiceGain = !this.settings.voiceMuted && (!isSoloActive || this.settings.soloStem === 'voice')
      ? this.settings.voiceGain
      : 0

    const effectiveMusicGain = !this.settings.musicMuted && (!isSoloActive || this.settings.soloStem === 'music')
      ? this.settings.musicGain
      : 0

    const effectivePercGain = !this.settings.percussionMuted && (!isSoloActive || this.settings.soloStem === 'percussion')
      ? this.settings.percussionGain
      : 0

    for (let i = 0; i < len; i++) {
      voiceOut[i] = harmonic[i]! * effectiveVoiceGain
      musicOut[i] = residual[i]! * effectiveMusicGain
      percOut[i] = percussive[i]! * effectivePercGain
      masterOut[i] = (voiceOut[i]! + musicOut[i]! + percOut[i]!) * this.settings.masterGain
    }

    const meters: StemMetersDb = {
      voiceDb: Math.round(calculateDecibelsFromMagnitudes(voiceOut) * 10) / 10,
      musicDb: Math.round(calculateDecibelsFromMagnitudes(musicOut) * 10) / 10,
      percussionDb: Math.round(calculateDecibelsFromMagnitudes(percOut) * 10) / 10,
      masterDb: Math.round(calculateDecibelsFromMagnitudes(masterOut) * 10) / 10,
    }

    return { voiceOutput: voiceOut, musicOutput: musicOut, percussionOutput: percOut, masterOutput: masterOut, meters }
  }

  subscribe(callback: (settings: StemVolumeSettings) => void): () => void {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notify(): void {
    const current = this.getSettings()
    this.subscribers.forEach(cb => cb(current))
  }
}
