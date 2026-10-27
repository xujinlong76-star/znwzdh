/**
 * Client-Side WebAudio Signal Processing Engine
 * Provides Vocal Enhancement, Loudness Normalization (AGC), and Noise Reduction.
 */

export interface AudioEnhancerSettings {
  volumeBoost: number // 1.0 - 2.5
  voiceClarity: boolean
  loudnessNormalization: boolean
  noiseSuppression: boolean
  lowCut?: boolean
}

export type AudioEnhancerOptions = AudioEnhancerSettings

export interface AudioEnhancerController {
  setVolumeBoost: (multiplier: number) => void
  toggleVoiceClarity: (enabled: boolean) => void
  toggleLoudnessNormalization: (enabled: boolean) => void
  toggleNoiseSuppression: (enabled: boolean) => void
  setOptions: (options: Partial<AudioEnhancerSettings>) => void
  getOptions: () => AudioEnhancerSettings
  getSettings: () => AudioEnhancerSettings
  destroy: () => void
}

/**
 * Attaches a WebAudio DSP pipeline to an HTML5 media element (audio/video).
 */
export function attachAudioEnhancer(
  mediaElement: HTMLMediaElement,
  initialSettings?: Partial<AudioEnhancerSettings>
): AudioEnhancerController {
  const settings: AudioEnhancerSettings = {
    volumeBoost: 1.0,
    voiceClarity: false,
    loudnessNormalization: false,
    noiseSuppression: false,
    lowCut: false,
    ...initialSettings,
  }

  const applyOptions = (opts: Partial<AudioEnhancerSettings>) => {
    if (typeof opts.volumeBoost === 'number') {
      const clamped = Math.max(0.5, Math.min(2.5, opts.volumeBoost))
      settings.volumeBoost = clamped
    }
    if (typeof opts.voiceClarity === 'boolean') {
      settings.voiceClarity = opts.voiceClarity
    }
    if (typeof opts.loudnessNormalization === 'boolean') {
      settings.loudnessNormalization = opts.loudnessNormalization
    }
    if (typeof opts.noiseSuppression === 'boolean') {
      settings.noiseSuppression = opts.noiseSuppression
    }
    if (typeof opts.lowCut === 'boolean') {
      settings.lowCut = opts.lowCut
      settings.noiseSuppression = opts.lowCut
    }
  }

  // Gracefully handle SSR / unsupported environments
  if (
    typeof window === 'undefined' ||
    !(window.AudioContext || (window as any).webkitAudioContext)
  ) {
    return {
      setVolumeBoost: (v) => { applyOptions({ volumeBoost: v }) },
      toggleVoiceClarity: (v) => { applyOptions({ voiceClarity: v }) },
      toggleLoudnessNormalization: (v) => { applyOptions({ loudnessNormalization: v }) },
      toggleNoiseSuppression: (v) => { applyOptions({ noiseSuppression: v }) },
      setOptions: applyOptions,
      getOptions: () => ({ ...settings }),
      getSettings: () => ({ ...settings }),
      destroy: () => {},
    }
  }

  try {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new AudioCtxClass()

    const source = ctx.createMediaElementSource(mediaElement)

    // 1. Gain Node (Volume Boost)
    const gainNode = ctx.createGain()
    gainNode.gain.value = settings.volumeBoost

    // 2. Dynamics Compressor Node (Loudness Normalization / AGC)
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.setValueAtTime(-24, ctx.currentTime)
    compressor.knee.setValueAtTime(30, ctx.currentTime)
    compressor.ratio.setValueAtTime(12, ctx.currentTime)
    compressor.attack.setValueAtTime(0.003, ctx.currentTime)
    compressor.release.setValueAtTime(0.25, ctx.currentTime)

    // 3. Bandpass / Peaking EQ (Human Vocal Clarity 2kHz)
    const voiceFilter = ctx.createBiquadFilter()
    voiceFilter.type = 'peaking'
    voiceFilter.frequency.setValueAtTime(2500, ctx.currentTime)
    voiceFilter.Q.setValueAtTime(1.5, ctx.currentTime)
    voiceFilter.gain.setValueAtTime(settings.voiceClarity ? 6 : 0, ctx.currentTime)

    // 4. Low-cut Filter (Noise Suppression < 120Hz)
    const lowCutFilter = ctx.createBiquadFilter()
    lowCutFilter.type = 'highpass'
    lowCutFilter.frequency.setValueAtTime(settings.noiseSuppression ? 120 : 20, ctx.currentTime)

    // Connect audio processing graph:
    // source -> lowCut -> voiceFilter -> compressor -> gain -> destination
    source.connect(lowCutFilter)
    lowCutFilter.connect(voiceFilter)
    voiceFilter.connect(compressor)
    compressor.connect(gainNode)
    gainNode.connect(ctx.destination)

    return {
      setVolumeBoost: (multiplier: number) => {
        applyOptions({ volumeBoost: multiplier })
        gainNode.gain.setValueAtTime(settings.volumeBoost, ctx.currentTime)
      },
      toggleVoiceClarity: (enabled: boolean) => {
        applyOptions({ voiceClarity: enabled })
        voiceFilter.gain.setValueAtTime(enabled ? 6 : 0, ctx.currentTime)
      },
      toggleLoudnessNormalization: (enabled: boolean) => {
        applyOptions({ loudnessNormalization: enabled })
        if (enabled) {
          compressor.threshold.setValueAtTime(-28, ctx.currentTime)
          compressor.ratio.setValueAtTime(16, ctx.currentTime)
        } else {
          compressor.threshold.setValueAtTime(-10, ctx.currentTime)
          compressor.ratio.setValueAtTime(2, ctx.currentTime)
        }
      },
      toggleNoiseSuppression: (enabled: boolean) => {
        applyOptions({ noiseSuppression: enabled })
        lowCutFilter.frequency.setValueAtTime(enabled ? 120 : 20, ctx.currentTime)
      },
      setOptions: (opts: Partial<AudioEnhancerSettings>) => {
        applyOptions(opts)
        gainNode.gain.setValueAtTime(settings.volumeBoost, ctx.currentTime)
        voiceFilter.gain.setValueAtTime(settings.voiceClarity ? 6 : 0, ctx.currentTime)
        lowCutFilter.frequency.setValueAtTime(settings.noiseSuppression ? 120 : 20, ctx.currentTime)
      },
      getOptions: () => ({ ...settings }),
      getSettings: () => ({ ...settings }),
      destroy: () => {
        try {
          source.disconnect()
          lowCutFilter.disconnect()
          voiceFilter.disconnect()
          compressor.disconnect()
          gainNode.disconnect()
          ctx.close()
        } catch {
          // Ignore cleanup errors
        }
      },
    }
  } catch {
    // MediaElement might already be connected to an AudioContext
    return {
      setVolumeBoost: (v) => { applyOptions({ volumeBoost: v }) },
      toggleVoiceClarity: (v) => { applyOptions({ voiceClarity: v }) },
      toggleLoudnessNormalization: (v) => { applyOptions({ loudnessNormalization: v }) },
      toggleNoiseSuppression: (v) => { applyOptions({ noiseSuppression: v }) },
      setOptions: applyOptions,
      getOptions: () => ({ ...settings }),
      getSettings: () => ({ ...settings }),
      destroy: () => {},
    }
  }
}
