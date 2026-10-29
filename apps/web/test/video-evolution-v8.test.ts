import { describe, it, expect } from 'vitest'
import {
  computeDifferenceHash,
  hammingDistance,
  detectSlideTransitions,
} from '@/lib/video-slide-detector'
import {
  separateHarmonicPercussive,
  calculateDecibelsFromMagnitudes,
  AudioStemMixerController,
} from '@/lib/video-audio-stem-separator'
import {
  createBitfield,
  selectRarestChunk,
  P2PVideoSwarmManager,
} from '@/lib/video-p2p-chunk-swarm'
import {
  calculatePointDistance,
  classifyHandGesture,
  AirGestureTracker,
} from '@/lib/video-air-gesture-tracker'
import {
  createExpect,
  runLiveCodeTest,
} from '@/lib/video-live-test-runner'
import {
  calculateBKTUpdate,
  BayesianKnowledgeTracer,
} from '@/lib/video-knowledge-tracer'
import {
  CURATED_TRENDING_TOPICS,
  harvestTrendingVideos,
} from '@/lib/video-trending-harvester'
import type { NavigationData } from '@/types/navigation'

describe('Proposal [1]: Presentation Slide Deck & Chapter Boundary Detector', () => {
  it('computes 64-bit difference hash and evaluates hamming distance', () => {
    // 8 rows x 9 cols
    const matrixA = Array.from({ length: 8 }, () => [10, 20, 30, 40, 50, 60, 70, 80, 90])
    const matrixB = Array.from({ length: 8 }, () => [90, 80, 70, 60, 50, 40, 30, 20, 10])

    const hashA = computeDifferenceHash(matrixA, 9, 8)
    const hashB = computeDifferenceHash(matrixB, 9, 8)

    expect(typeof hashA).toBe('bigint')
    expect(typeof hashB).toBe('bigint')

    const dist = hammingDistance(hashA, hashB)
    expect(dist).toBeGreaterThan(30) // Strong visual contrast
  })

  it('detects slide page transitions across frame samples', () => {
    const mat1 = Array.from({ length: 8 }, () => [10, 20, 30, 40, 50, 60, 70, 80, 90])
    const mat2 = Array.from({ length: 8 }, () => [90, 80, 70, 60, 50, 40, 30, 20, 10])

    const samples = [
      { timeSec: 0, grayscaleMatrix: mat1, title: '课程体系概览' },
      { timeSec: 3, grayscaleMatrix: mat1 },
      { timeSec: 10, grayscaleMatrix: mat2, title: '核心原理深度剖析' },
      { timeSec: 15, grayscaleMatrix: mat2 },
    ]

    const slides = detectSlideTransitions(samples, {
      hammingDistanceThreshold: 10,
      minSlideDurationSec: 4,
    })

    expect(slides.length).toBe(2)
    expect(slides[0]!.pageNumber).toBe(1)
    expect(slides[0]!.title).toContain('课程体系概览')
    expect(slides[1]!.pageNumber).toBe(2)
    expect(slides[1]!.title).toContain('核心原理')
  })
})

describe('Proposal [2]: Audio Stem Separator & Multi-track Equalizer', () => {
  it('deconstructs frequency spectrum into harmonic and percussive components', () => {
    const spectrum = new Float32Array(512)
    spectrum.fill(0.1)
    // Emphasize speech fundamental frequencies
    spectrum[20] = 0.8

    const { harmonic, percussive, residual } = separateHarmonicPercussive(spectrum)
    expect(harmonic.length).toBe(512)
    expect(percussive.length).toBe(512)
    expect(residual.length).toBe(512)

    expect(harmonic[20]).toBeGreaterThan(percussive[20]!)
  })

  it('routes independent fader gains, mute, and solo controls', () => {
    const mixer = new AudioStemMixerController({
      voiceGain: 1.0,
      musicGain: 0.5,
      percussionGain: 0.2,
    })

    const raw = new Float32Array(256).fill(0.5)
    let processed = mixer.processStems(raw)
    expect(processed.meters.voiceDb).toBeGreaterThan(processed.meters.musicDb)

    // Test Voice Mute
    mixer.toggleMute('voice')
    processed = mixer.processStems(raw)
    expect(processed.voiceOutput[10]).toBe(0)

    // Test Solo Music
    mixer.setSolo('music')
    processed = mixer.processStems(raw)
    expect(processed.musicOutput[10]).toBeGreaterThan(0)
    expect(processed.percussionOutput[10]).toBe(0)
  })
})

describe('Proposal [3]: Hybrid WebRTC P2P-CDN Video Swarm Loader', () => {
  it('manages bitfields and selects rarest chunk across peer availability', () => {
    const localBits = [true, false, false, true]
    const peerBits = [
      [true, true, false, true],
      [true, false, true, true],
      [true, true, true, true],
    ]

    // Local needs index 1 and 2.
    // Index 1 is possessed by 2 peers (peer0, peer2).
    // Index 2 is possessed by 2 peers (peer1, peer2).
    const rarest = selectRarestChunk(localBits, peerBits)
    expect(rarest).not.toBeNull()
    expect([1, 2]).toContain(rarest)
  })

  it('acquires chunks through P2P with seamless CDN fallback', async () => {
    const swarm = new P2PVideoSwarmManager(10)
    swarm.registerPeer('peer-node-alpha', [true, true, false, false, false, false, false, false, false, false])

    // Chunk 0 exists in peer -> should download via P2P
    const chunk0 = await swarm.acquireChunk(0, 1024, true)
    expect(chunk0.source).toBe('p2p')
    expect(chunk0.chunkIndex).toBe(0)

    // Chunk 5 does NOT exist in peer -> should fallback to CDN
    const chunk5 = await swarm.acquireChunk(5, 1024, true)
    expect(chunk5.source).toBe('cdn')
    expect(chunk5.chunkIndex).toBe(5)

    const telemetry = swarm.getTelemetry()
    expect(telemetry.downloadedChunksCount).toBe(2)
    expect(telemetry.p2pBytes).toBe(1024)
    expect(telemetry.cdnBytes).toBe(1024)
    expect(telemetry.p2pOffloadRatio).toBe(0.5)
  })
})

describe('Proposal [4]: Spatial Air-Gesture Video Commander', () => {
  it('calculates point Euclidean distance and classifies pinch gesture', () => {
    const p1 = { x: 0.5, y: 0.5 }
    const p2 = { x: 0.53, y: 0.54 }
    expect(calculatePointDistance(p1, p2)).toBeCloseTo(0.05, 2)

    // Construct mock hand skeleton with pinch (thumb tip close to index tip)
    const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }))
    landmarks[4] = { x: 0.5, y: 0.5 } // Thumb tip
    landmarks[8] = { x: 0.51, y: 0.51 } // Index tip

    const result = classifyHandGesture(landmarks)
    expect(result.gesture).toBe('pinch')
    expect(result.action).toBe('toggle_play')
  })

  it('classifies swipe gestures through centroid delta', () => {
    const landmarks = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.5 }))
    landmarks[4] = { x: 0.1, y: 0.5 } // Thumb far from index to avoid pinch
    landmarks[8] = { x: 0.3, y: 0.5 }
    const previousCentroid = { x: 0.5, y: 0.5 } // Moved left by 0.2

    const result = classifyHandGesture(landmarks, previousCentroid)
    expect(result.gesture).toBe('swipe_left')
    expect(result.action).toBe('seek_back')
  })
})

describe('Proposal [5]: Timeline-Driven Live Unit Test Runner', () => {
  it('verifies matcher assertions', () => {
    const expectFn = createExpect
    expectFn(10).toBe(10)
    expectFn({ a: 1 }).toEqual({ a: 1 })
    expectFn(20).toBeGreaterThan(15)
    expectFn('TypeScript').toContain('Script')
    expectFn([1, 2, 3]).toContain(2)
    expectFn(() => { throw new Error('Boom') }).toThrow()
  })

  it('executes user code against test cases with isolated logging', async () => {
    const userCode = `
      function add(a, b) { return a + b; }
      exports.add = add;
      console.log("Add function ready");
    `

    const testCases = [
      {
        id: 'tc-1',
        title: '测试加法',
        testFn: ({ expect }: any) => {
          const fn = new Function(`const exports = {}; ${userCode}; return exports.add;`)()
          expect(fn(2, 3)).toBe(5)
        },
      },
    ]

    const res = await runLiveCodeTest('Math Test Suite', userCode, testCases)
    expect(res.passedCount).toBe(1)
    expect(res.failedCount).toBe(0)
    expect(res.consoleLogs).toContain('Add function ready')
  })
})

describe('Proposal [6]: Bayesian Knowledge Tracing & Diagnostic Remedy Engine', () => {
  it('updates mastery probability upon correct and incorrect attempts', () => {
    const prior = 0.5
    const updatedCorrect = calculateBKTUpdate(prior, true, 0.1, 0.2, 0.1)
    const updatedWrong = calculateBKTUpdate(prior, false, 0.1, 0.2, 0.1)

    expect(updatedCorrect).toBeGreaterThan(prior)
    expect(updatedWrong).toBeLessThan(prior)
  })

  it('diagnoses weak concepts and produces remedial suggestions with jump timestamps', () => {
    const tracer = new BayesianKnowledgeTracer([
      {
        conceptId: 'event-loop',
        conceptName: 'Event Loop',
        priorMastery: 0.3,
        transitionProb: 0.1,
        guessProb: 0.2,
        slipProb: 0.1,
        prerequisiteIds: [],
        recommendedTimestampSec: 120,
      },
    ])

    // Learner fails question
    tracer.recordAttempt('event-loop', false)
    const report = tracer.getDiagnosticReport()

    expect(report.weakCount).toBe(1)
    expect(report.remedialSuggestions.length).toBe(1)
    expect(report.remedialSuggestions[0]!.conceptId).toBe('event-loop')
    expect(report.remedialSuggestions[0]!.jumpToTimeSec).toBe(120)
  })
})

describe('Trending Video Automated Harvester & Content Enrichment', () => {
  it('contains high-caliber curated trending topics', () => {
    expect(CURATED_TRENDING_TOPICS.length).toBeGreaterThanOrEqual(4)

    // 原断言硬绑「必须有一条 keyword 含 DeepSeek」——候选池换选题就红，
    // 但它想守的其实是「候选质量」。改成对**每一条**都成立的结构性契约：
    //   - 必须有章节大纲（否则 UI 的章节树是空的）
    //   - bvid 必须符合 B 站真实格式（BV + 10 位）
    //   - 时长必须为正
    //   - 至少要覆盖 4 个不同领域，否则「热点」退化成单一垂类
    for (const topic of CURATED_TRENDING_TOPICS) {
      expect(topic.chapters.length, `${topic.keyword} 缺章节大纲`).toBeGreaterThanOrEqual(2)
      expect(topic.bvidFallback, `${topic.keyword} 的 BV 号格式不合法`).toMatch(/^BV[0-9A-Za-z]{10}$/)
      expect(topic.durationSec, `${topic.keyword} 时长异常`).toBeGreaterThan(0)
    }

    const domains = new Set(CURATED_TRENDING_TOPICS.map(t => t.domain))
    expect(domains.size).toBeGreaterThanOrEqual(4)
  })

  it('enriches NavigationData without duplicating existing entries', () => {
    const mockData: NavigationData = {
      navigationItems: [
        {
          id: 'cat_ai_engineering',
          title: 'AI 与大模型工程',
          items: [],
          subCategories: [],
        },
      ],
    }

    const { updatedData, result } = harvestTrendingVideos(mockData, { minHotIndex: 85 })
    expect(result.harvestedCount).toBeGreaterThan(0)
    expect(result.categoriesEnriched.length).toBeGreaterThan(0)

    // Harvest a second time: duplicate IDs should be skipped
    const secondPass = harvestTrendingVideos(updatedData, { minHotIndex: 85 })
    expect(secondPass.result.harvestedCount).toBe(0)
  })
})
