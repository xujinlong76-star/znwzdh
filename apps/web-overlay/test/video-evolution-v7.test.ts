import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  applySpectralGating,
  estimateNoiseFloor,
  NeuralDenoiserController,
} from '@/lib/video-neural-denoiser'
import {
  InteractiveCodeDebugger,
} from '@/lib/video-breakpoint-debugger'
import {
  SimpleBloomFilter,
  TokenBucketLimiter,
  P2PDanmakuMeshCoordinator,
} from '@/lib/video-p2p-danmaku-mesh'
import {
  generateSparseEmbedding,
  cosineSimilarity,
  VideoLocalRagStore,
} from '@/lib/video-local-rag-search'
import {
  validateClipInterval,
  extractClipSubtitles,
  renderVideoClipPackage,
} from '@/lib/video-clip-exporter'
import {
  PomodoroSessionManager,
  generatePinkNoiseBuffer,
  ERGONOMIC_BREAK_TIPS,
} from '@/lib/video-pomodoro-engine'

describe('Proposal [1]: WebGPU Neural Denoiser & Audio Formant Enhancer', () => {
  it('performs spectral gating and floor suppression on noisy frequency bins', () => {
    const binCount = 8
    const noisySpectrum = new Float32Array([1.0, 0.8, 0.05, 0.02, 0.9, 0.03, 0.4, 0.01])
    const noiseProfile = new Float32Array([0.1, 0.1, 0.08, 0.08, 0.1, 0.08, 0.1, 0.08])

    const result = applySpectralGating(noisySpectrum, noiseProfile, {
      enabled: true,
      denoiseIntensity: 0.8,
      noiseGateThresholdDb: -45,
      voiceClarityGain: 1.25,
      overSubtractionFactor: 1.5,
    })

    expect(result.cleanMagnitudes.length).toBe(binCount)
    expect(result.stats).toBeDefined()
    expect(result.stats.noiseSuppressedDb).toBeGreaterThanOrEqual(0)
    // High-energy signal bin (index 0) remains strong
    expect(result.cleanMagnitudes[0]).toBeGreaterThan(0.7)
  })

  it('estimates noise floor correctly from audio spectrum', () => {
    const spectrum = new Float32Array([0.2, 0.15, 0.08, 0.04])
    const noiseProfile = estimateNoiseFloor(spectrum)

    expect(noiseProfile.length).toBe(spectrum.length)
    expect(noiseProfile[0]).toBeCloseTo(0.2 * 0.35, 3)
    expect(noiseProfile[3]).toBeGreaterThanOrEqual(0.002)
  })

  it('initializes controller and handles updates gracefully', () => {
    const controller = new NeuralDenoiserController({
      enabled: true,
      denoiseIntensity: 0.8,
    })
    expect(controller.getConfig().denoiseIntensity).toBe(0.8)

    controller.setConfig({ denoiseIntensity: 0.95 })
    expect(controller.getConfig().denoiseIntensity).toBe(0.95)

    const inputMagnitudes = new Float32Array(256).fill(0.05)
    controller.calibrateNoise(inputMagnitudes)

    const processed = controller.processFrame(inputMagnitudes)
    expect(processed.clean.length).toBe(256)
    expect(processed.stats).toBeDefined()
  })
})

describe('Proposal [2]: Interactive Code Breakpoint Debugger & Stepper Engine', () => {
  const sampleCode = `let a = 10
let b = 20
console.log("sum")`

  it('parses code, manages breakpoints and steps forward line-by-line', () => {
    const dbg = new InteractiveCodeDebugger(sampleCode)

    // Add breakpoint on line 2
    const added = dbg.toggleBreakpoint(2)
    expect(added).toBe(true)
    expect(dbg.getBreakpoints().some(b => b.lineNumber === 2)).toBe(true)

    // Initial state
    const initState = dbg.getCurrentState()
    expect(initState.currentLine).toBe(1)

    // Step over line 1
    const step1 = dbg.stepOver()
    expect(step1.variables['a']).toBeDefined()
    expect(step1.variables['a'].value).toBe(10)

    // Step over line 2
    const step2 = dbg.stepOver()
    expect(step2.variables['b']).toBeDefined()
    expect(step2.variables['b'].value).toBe(20)

    // Step over line 3 (console.log)
    const step3 = dbg.stepOver()
    expect(step3.output).toContain('sum')
  })

  it('supports stepping backward and resuming to next breakpoint', () => {
    const dbg = new InteractiveCodeDebugger(sampleCode)
    dbg.toggleBreakpoint(2)

    // Run to next breakpoint
    const hit = dbg.continueToNextBreakpoint()
    expect(hit.hitBreakpoint).toBe(true)
    expect(hit.state.currentLine).toBe(2)

    // Step back
    const backState = dbg.stepBack()
    expect(backState.currentLine).toBe(1)
  })
})

describe('Proposal [3]: Distributed P2P Danmaku Mesh & Flood Prevention', () => {
  it('manages bloom filter hashing and deduplication', () => {
    const bloom = new SimpleBloomFilter(256)
    const msgId = 'msg-unique-42'

    expect(bloom.has(msgId)).toBe(false)
    bloom.add(msgId)
    expect(bloom.has(msgId)).toBe(true)
  })

  it('throttles excessive broadcasts using token bucket limiter', () => {
    const limiter = new TokenBucketLimiter(3, 1) // capacity 3, 1 token/sec
    expect(limiter.tryConsume(1)).toBe(true)
    expect(limiter.tryConsume(1)).toBe(true)
    expect(limiter.tryConsume(1)).toBe(true)
    // Capacity exhausted
    expect(limiter.tryConsume(1)).toBe(false)
  })

  it('coordinates mesh gossip broadcast and rejects duplicate messages', () => {
    const coordinator = new P2PDanmakuMeshCoordinator('video-mesh-101')
    const received: string[] = []
    const unsub = coordinator.onDanmakuReceived((msg) => {
      received.push(msg.id)
    })

    const msg = coordinator.broadcastDanmaku('Awesome video tutorial!', 12, '#38bdf8')
    expect(msg).toBeDefined()
    expect(coordinator.getStats().totalRelayedMessages).toBe(1)

    // Duplicate message injection should be ignored by bloom filter
    const accepted = coordinator.receiveIncomingGossip(msg!)
    expect(accepted).toBe(false)
    expect(coordinator.getStats().deduplicatedCount).toBe(1)
    expect(received.length).toBe(1)

    unsub()
  })
})

describe('Proposal [4]: Client-side Local RAG Search & Vector Index', () => {
  it('computes sparse embeddings and cosine similarity', () => {
    const vecA = generateSparseEmbedding('WebGPU 性能优化与着色器架构', 32)
    const vecB = generateSparseEmbedding('WebGPU 着色器架构与计算着色器', 32)
    const vecC = generateSparseEmbedding('烹饪番茄炒蛋秘籍配方', 32)

    expect(vecA.length).toBe(32)
    const simAB = cosineSimilarity(vecA, vecB)
    const simAC = cosineSimilarity(vecA, vecC)

    expect(simAB).toBeGreaterThan(0.3)
    expect(simAC).toBeLessThan(simAB)
  })

  it('indexes transcripts and performs top-K semantic similarity lookup', () => {
    const rag = new VideoLocalRagStore()
    rag.indexTranscripts([
      { id: 'd1', text: '初始化 WebGPU 渲染管线、顶点缓冲和着色器', startSec: 30, endSec: 60 },
      { id: 'd2', text: '使用 useEffect 和 useMemo 优化 React 组件重渲染', startSec: 90, endSec: 120 },
      { id: 'd3', text: '部署 Kubernetes Ingress 与服务网格微服务架构', startSec: 150, endSec: 180 },
    ])

    const results = rag.search('WebGPU 着色器渲染管线', 2)
    expect(results.length).toBe(2)
    expect(results[0].chunk.id).toBe('d1')
    expect(results[0].similarity).toBeGreaterThan(0.2)
  })
})

describe('Proposal [5]: Micro-Learning Video Clip Exporter & Subtitle Slicer', () => {
  beforeEach(() => {
    if (typeof globalThis.URL.createObjectURL !== 'function') {
      globalThis.URL.createObjectURL = vi.fn(() => 'blob:https://mock-domain/mock-clip-uuid')
    }
    if (typeof globalThis.URL.revokeObjectURL !== 'function') {
      globalThis.URL.revokeObjectURL = vi.fn()
    }
  })

  it('validates clip interval limits and boundaries', () => {
    expect(validateClipInterval(10, 20, 100).valid).toBe(true)
    // start >= end
    expect(validateClipInterval(30, 20, 100).valid).toBe(false)
    // interval < 3 sec
    expect(validateClipInterval(10, 11, 100).valid).toBe(false)
    // start < 0
    expect(validateClipInterval(-5, 10, 100).valid).toBe(false)
    // duration > maxDurationSec
    expect(validateClipInterval(10, 350, 300).valid).toBe(false)
  })

  it('slices overlapping subtitles according to clip time boundaries', () => {
    const transcripts = [
      { id: 't1', startSec: 5, endSec: 12, text: '前期准备' },
      { id: 't2', startSec: 15, endSec: 25, text: '核心关键技巧' },
      { id: 't3', startSec: 28, endSec: 40, text: '后期收尾' },
    ]

    const sliced = extractClipSubtitles(transcripts, 10, 30)
    expect(sliced.length).toBe(3)
    expect(sliced.map(s => s.id)).toEqual(['t1', 't2', 't3'])
  })

  it('renders package payload with filename and blob metadata', async () => {
    const pkg = await renderVideoClipPackage(
      'React 性能深度优化',
      [{ id: 'sub-1', startSec: 12, endSec: 20, text: '避免大对象深度比对' }],
      {
        startSec: 10,
        endSec: 25,
        format: 'webm',
        quality: '1080p',
        includeSubtitles: true,
        includeWatermark: true,
      }
    )

    expect(pkg.durationSec).toBe(15)
    expect(pkg.filename).toContain('.webm')
    expect(pkg.filename).toContain('10s-25s')
    expect(pkg.associatedSubtitles.length).toBe(1)
    expect(pkg.blobUrl).toBeDefined()
  })
})

describe('Proposal [6]: Deep Immersion Pomodoro Engine & Pink Noise Soundscape', () => {
  it('manages work and break state transitions through clock ticks', () => {
    const mgr = new PomodoroSessionManager({
      workDurationSec: 5,
      shortBreakDurationSec: 2,
      longBreakDurationSec: 4,
      longBreakInterval: 2,
    })

    expect(mgr.getState().phase).toBe('work')
    expect(mgr.getState().remainingSec).toBe(5)

    mgr.start()
    for (let i = 0; i < 5; i++) {
      mgr.tickSecond()
    }

    // Work phase finishes -> transitions to short_break
    expect(mgr.getState().phase).toBe('short_break')
    expect(mgr.getState().remainingSec).toBe(2)
    expect(mgr.getState().completedCycles).toBe(1)
  })

  it('generates pink noise sound buffer with 1/f spectral attenuation', () => {
    const channelData = new Float32Array(4410)
    const mockAudioCtx = {
      sampleRate: 44100,
      createBuffer: vi.fn((channels, size, rate) => ({
        length: size,
        sampleRate: rate,
        numberOfChannels: channels,
        getChannelData: vi.fn(() => channelData),
      })),
    } as unknown as AudioContext

    const buffer = generatePinkNoiseBuffer(mockAudioCtx, 0.1)
    expect(buffer).toBeDefined()
    expect(mockAudioCtx.createBuffer).toHaveBeenCalledWith(1, 4410, 44100)
    let nonZero = false
    for (let i = 0; i < channelData.length; i++) {
      if (Math.abs(channelData[i]) > 0.00001) {
        nonZero = true
        break
      }
    }
    expect(nonZero).toBe(true)
  })

  it('provides ergonomic eye-strain and stretching tips', () => {
    expect(ERGONOMIC_BREAK_TIPS.length).toBeGreaterThanOrEqual(3)
    const tip20 = ERGONOMIC_BREAK_TIPS.find(t => t.title.includes('20-20-20'))
    expect(tip20).toBeDefined()
    expect(tip20?.instruction).toContain('远方')
  })
})
