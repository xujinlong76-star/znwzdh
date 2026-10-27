export interface NeuralDenoiserConfig {
  enabled: boolean
  denoiseIntensity: number // 0.0 to 1.0 (default 0.75)
  noiseGateThresholdDb: number // -60 to -25 dBFS (default -45)
  voiceClarityGain: number // 1.0 to 2.0 (default 1.25)
  overSubtractionFactor: number // 1.0 to 3.0 (default 1.5)
}

export interface DenoiseProcessingStats {
  inputRmsDb: number
  outputRmsDb: number
  noiseSuppressedDb: number
  activeVoiceDetected: boolean
}

export const NEURAL_DENOISE_WGSL = `
@group(0) @binding(0) var<storage, read> inputMagnitudes: array<f32>;
@group(0) @binding(1) var<storage, read> noiseProfile: array<f32>;
@group(0) @binding(2) var<storage, read_write> outputGains: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  if (idx >= arrayLength(&inputMagnitudes)) {
    return;
  }

  let mag = inputMagnitudes[idx];
  let noise = noiseProfile[idx];
  let snr = (mag + 0.0001) / (noise + 0.0001);

  // Wiener-style gain filtering: G = max(0.05, 1.0 - (alpha / snr))
  let gain = clamp(1.0 - (1.5 / snr), 0.08, 1.0);
  outputGains[idx] = gain;
}
`

/**
 * Estimates stationary background noise profile from quiet segments.
 */
export function estimateNoiseFloor(spectrum: Float32Array): Float32Array {
  const noiseProfile = new Float32Array(spectrum.length)
  for (let i = 0; i < spectrum.length; i++) {
    // Smooth lower bound estimate
    noiseProfile[i] = Math.max(0.002, spectrum[i] * 0.35)
  }
  return noiseProfile
}

/**
 * Performs spectral gating and noise suppression on audio frequency magnitude buffers.
 */
export function applySpectralGating(
  magnitudes: Float32Array,
  noiseFloor: Float32Array,
  config: NeuralDenoiserConfig
): { cleanMagnitudes: Float32Array; stats: DenoiseProcessingStats } {
  const len = magnitudes.length
  const clean = new Float32Array(len)
  const alpha = Math.max(1.0, config.overSubtractionFactor || 1.5)
  const floorFactor = 0.05 // Prevent metallic musical noise artifacts

  let sumInput = 0
  let sumOutput = 0

  for (let i = 0; i < len; i++) {
    const raw = magnitudes[i]
    sumInput += raw * raw

    if (!config.enabled) {
      clean[i] = raw
      sumOutput += raw * raw
      continue
    }

    const noiseEstimate = noiseFloor[i] || 0.005
    // Spectral subtraction: S_clean = max(floor, S_raw - alpha * N)
    const subtracted = raw - (alpha * config.denoiseIntensity * noiseEstimate)
    const gated = Math.max(raw * floorFactor, subtracted)

    // Voice formant booster in 1kHz - 4kHz range (approx 20% to 60% of bins)
    const isVoiceBin = i >= Math.floor(len * 0.15) && i <= Math.floor(len * 0.6)
    const voiceMultiplier = isVoiceBin ? config.voiceClarityGain : 1.0

    clean[i] = gated * voiceMultiplier
    sumOutput += clean[i] * clean[i]
  }

  const inRms = Math.sqrt(sumInput / len)
  const outRms = Math.sqrt(sumOutput / len)
  const inDb = inRms > 0.00001 ? 20 * Math.log10(inRms) : -100
  const outDb = outRms > 0.00001 ? 20 * Math.log10(outRms) : -100

  return {
    cleanMagnitudes: clean,
    stats: {
      inputRmsDb: Math.round(inDb * 10) / 10,
      outputRmsDb: Math.round(outDb * 10) / 10,
      noiseSuppressedDb: Math.max(0, Math.round((inDb - outDb) * 10) / 10),
      activeVoiceDetected: inDb > config.noiseGateThresholdDb,
    },
  }
}

/**
 * Controller class managing WebGPU / WebAudio neural audio de-noising.
 */
export class NeuralDenoiserController {
  private config: NeuralDenoiserConfig
  private noiseFloor: Float32Array = new Float32Array(256).fill(0.01)

  constructor(initialConfig?: Partial<NeuralDenoiserConfig>) {
    this.config = {
      enabled: true,
      denoiseIntensity: 0.8,
      noiseGateThresholdDb: -42,
      voiceClarityGain: 1.25,
      overSubtractionFactor: 1.6,
      ...initialConfig,
    }
  }

  setConfig(newConfig: Partial<NeuralDenoiserConfig>): void {
    Object.assign(this.config, newConfig)
  }

  getConfig(): NeuralDenoiserConfig {
    return { ...this.config }
  }

  calibrateNoise(sampleBuffer: Float32Array): void {
    this.noiseFloor = estimateNoiseFloor(sampleBuffer)
  }

  processFrame(magnitudes: Float32Array): { clean: Float32Array; stats: DenoiseProcessingStats } {
    const { cleanMagnitudes, stats } = applySpectralGating(magnitudes, this.noiseFloor, this.config)
    return { clean: cleanMagnitudes, stats }
  }
}
