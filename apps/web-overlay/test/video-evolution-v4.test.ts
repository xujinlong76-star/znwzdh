import { describe, it, expect } from 'vitest'
import {
  computeCasKernel,
  applySharpenFilter,
  createSoftwareSharpenFilter,
  CAS_WEBGPU_SHADER_CODE,
} from '@/lib/video-webgpu-sharpener'
import {
  parseVoiceCommandIntent,
  createVoiceCommander,
} from '@/lib/video-voice-commander'
import {
  VirtualFS,
  runWasmSandbox,
} from '@/lib/video-wasm-runtime'
import {
  calculateNextSM2Schedule,
  generateFlashcardsFromNotes,
  generateFlashcardsFromQuizzes,
  filterDueFlashcards,
} from '@/lib/video-spaced-repetition'
import {
  analyzeDanmakuSentiment,
  clusterConfusionHotspots,
} from '@/lib/video-danmaku-sentiment'
import {
  evaluateBadges,
  issueVerifiableCertificate,
  renderCertificateSvg,
} from '@/lib/video-credential-issuer'

describe('Proposal [1]: WebGPU/WebGL CAS Super-Resolution Shader', () => {
  it('computes 3x3 CAS convolution kernel with valid energy conservation', () => {
    const kernel = computeCasKernel(1.0)
    expect(kernel).toHaveLength(3)
    expect(kernel[0]).toHaveLength(3)
    expect(kernel[1][1]).toBeGreaterThan(1.0)

    let sum = 0
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        sum += kernel[r][c]
      }
    }
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001)
  })

  it('processes image data through software edge sharpening filter', () => {
    const width = 4
    const height = 4
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 120
      data[i + 1] = 120
      data[i + 2] = 120
      data[i + 3] = 255
    }

    const filtered = applySharpenFilter(data, width, height, {
      enabled: true,
      intensity: 0.8,
      algorithm: 'cas',
      preserveContrast: true,
    })

    expect(filtered).toHaveLength(data.length)
    expect(filtered[3]).toBe(255)
  })

  it('provides valid WebGPU WGSL compute shader source', () => {
    expect(CAS_WEBGPU_SHADER_CODE).toContain('@compute')
    expect(CAS_WEBGPU_SHADER_CODE).toContain('textureLoad')
    expect(CAS_WEBGPU_SHADER_CODE).toContain('textureStore')
  })
})

describe('Proposal [2]: Voice Commander & Semantic Audio Intent Dispatch', () => {
  it('parses relative and absolute seek intents accurately', () => {
    const fastForward = parseVoiceCommandIntent('快进 30 秒')
    expect(fastForward?.action).toBe('seek_relative')
    expect(fastForward?.value).toBe(30)

    const rewind = parseVoiceCommandIntent('后退 15 秒')
    expect(rewind?.action).toBe('seek_relative')
    expect(rewind?.value).toBe(-15)

    const jump = parseVoiceCommandIntent('跳转到 05:30')
    expect(jump?.action).toBe('seek_absolute')
    expect(jump?.value).toBe(330)
  })

  it('parses playback state, rate, danmaku, and tab switching commands', () => {
    expect(parseVoiceCommandIntent('暂停播放')?.action).toBe('pause')
    expect(parseVoiceCommandIntent('继续播放')?.action).toBe('play')
    expect(parseVoiceCommandIntent('1.5倍速')?.value).toBe(1.5)
    expect(parseVoiceCommandIntent('关闭弹幕')?.action).toBe('toggle_danmaku')
    expect(parseVoiceCommandIntent('打开知识脑图')?.targetTab).toBe('mindmap')
    expect(parseVoiceCommandIntent('切换到终端')?.targetTab).toBe('terminal')
    expect(parseVoiceCommandIntent('下一集')?.action).toBe('next_video')
  })

  it('manages listener state and simulated input dispatching', () => {
    let receivedCommand: string | null = null
    const commander = createVoiceCommander({
      onCommand: (intent) => {
        receivedCommand = intent.action
      },
    })

    commander.simulateVoiceInput('两倍速')
    expect(receivedCommand).toBe('speed')
    expect(commander.isListening()).toBe(false)
  })
})

describe('Proposal [3]: WebAssembly In-Browser Sandbox Runtime', () => {
  it('supports virtual filesystem CRUD operations', () => {
    const vfs = new VirtualFS()
    vfs.writeFile('/workspace/test.py', 'print("hello world")')
    expect(vfs.exists('/workspace/test.py')).toBe(true)
    expect(vfs.readFile('/workspace/test.py')).toBe('print("hello world")')
    expect(vfs.listFiles('/workspace')).toContain('/workspace/test.py')
  })

  it('runs Bash command emulator inside sandbox', async () => {
    const vfs = new VirtualFS()
    const result = await runWasmSandbox('bash', 'echo "Antigravity VFS"\npwd', vfs)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Antigravity VFS')
  })

  it('runs SQLite command engine and parses table queries', async () => {
    const vfs = new VirtualFS()
    const script = `
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob');
SELECT * FROM users;
`
    const result = await runWasmSandbox('sql', script, vfs)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Alice')
    expect(result.stdout).toContain('Bob')
  })

  it('runs Python script runner with variable state and print evaluation', async () => {
    const vfs = new VirtualFS()
    const code = `
msg = "Python WASM engine active"
print(msg)
`
    const result = await runWasmSandbox('python', code, vfs)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Python WASM engine active')
  })
})

describe('Proposal [4]: Spaced Repetition (SM-2) Flashcard Scheduler', () => {
  it('updates review schedule via SuperMemo SM-2 algorithm correctly', () => {
    const initialCard = {
      id: 'c1',
      question: 'What is CRDT?',
      answer: 'Conflict-free Replicated Data Type',
      sourceVideoId: 'v1',
      createdAt: Date.now(),
      nextReviewDate: Date.now(),
      // 实现按 `easinessFactor ?? easeFactor ?? 2.5` 取种子值，两者给同值不影响行为；
      // nextReviewTimestamp 是必填，缺了 tsc 直接红（TS2345）。
      easinessFactor: 2.5,
      nextReviewTimestamp: Date.now(),
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
    }

    // First correct answer (grade 4 - Good)
    const review1 = calculateNextSM2Schedule(initialCard, 4)
    expect(review1.repetitions).toBe(1)
    expect(review1.intervalDays).toBe(1)

    // Second correct answer
    const review2 = calculateNextSM2Schedule(review1, 5)
    expect(review2.repetitions).toBe(2)
    expect(review2.intervalDays).toBe(6)
    expect(review2.easeFactor).toBeGreaterThanOrEqual(2.5)

    // Fail review (grade 1 - Again)
    const reviewFail = calculateNextSM2Schedule(review2, 1)
    expect(reviewFail.repetitions).toBe(0)
    expect(reviewFail.intervalDays).toBe(1)
  })

  it('generates flashcards from user study notes and quizzes', () => {
    const notes = [
      {
        id: 'n1',
        videoId: 'v1',
        // videoTitle 在 VideoStudyNote 上是必填（抽卡时用它拼题面）
        videoTitle: 'WebRTC 数据通道',
        timeSec: 120,
        screenshotUrl: '',
        userNote: 'WebRTC data channel supports SCTP encapsulation.',
        codeSnippet: 'const dc = pc.createDataChannel("chat")',
        // VideoStudyNote.createdAt 是 ISO 字符串（抽卡时按 Date.parse 回读）
        createdAt: new Date().toISOString(),
      },
    ]

    const cards = generateFlashcardsFromNotes(notes)
    expect(cards).toHaveLength(1)
    expect(cards[0].question).toContain('⏱️ 02:00 知识卡')
    expect(cards[0].answer).toContain('SCTP encapsulation')

    const dueCards = filterDueFlashcards(cards)
    expect(dueCards).toHaveLength(1)
  })
})

describe('Proposal [5]: Danmaku Sentiment & Confusion Stumbling Block Radar', () => {
  it('analyzes danmaku sentiment polarity and tags', () => {
    const qDanmaku = analyzeDanmakuSentiment('这里为什么会报错啊？完全看不懂')
    expect(qDanmaku.category).toBe('blocked')
    expect(qDanmaku.score).toBeLessThan(0)

    const praiseDanmaku = analyzeDanmakuSentiment('讲得太透彻了，学到了！')
    expect(praiseDanmaku.category).toBe('applause')
    expect(praiseDanmaku.score).toBeGreaterThan(0)
  })

  it('clusters timeline confusion hotspots and proposes diagnostic recommendations', () => {
    const danmakus = [
      { id: 'd1', timeSec: 100, text: '报错 404 怎么办' },
      { id: 'd2', timeSec: 105, text: '这里卡住了，求指点' },
      { id: 'd3', timeSec: 110, text: '看不懂这段代码' },
      { id: 'd4', timeSec: 600, text: '前排打卡' },
    ]

    const hotspots = clusterConfusionHotspots(danmakus, 30)
    expect(hotspots.length).toBeGreaterThan(0)
    expect(hotspots[0].confusionCount).toBe(3)
    expect(hotspots[0].diagnosticAdvice).toBeDefined()
  })
})

describe('Proposal [6]: Verifiable Completion Certificate & Badge Issuer', () => {
  it('evaluates earned badges accurately according to learning telemetry', () => {
    const badges = evaluateBadges({
      watchedVideosCount: 5,
      totalNotesCount: 4,
      passedQuizCount: 2,
      runSandboxCount: 3,
      watchDurationSec: 4000,
    })

    const earned = badges.filter(b => b.earned)
    expect(earned.length).toBeGreaterThanOrEqual(3)
    expect(earned.some(b => b.id === 'badge-quiz-master')).toBe(true)
  })

  it('issues cryptographically tamper-evident certificates with SVG vector output', () => {
    const cert = issueVerifiableCertificate({
      studentName: 'Geek Developer',
      courseTitle: 'Fullstack Modern Web & Streaming System Architecture',
      quizScore: 95,
      notesCount: 12,
      watchDurationSec: 7200,
    })

    expect(cert.certificateId).toMatch(/^CERT-/)
    expect(cert.verificationHash).toHaveLength(64)

    const svg = renderCertificateSvg(cert)
    expect(svg).toContain('<svg')
    expect(svg).toContain('Geek Developer')
    expect(svg).toContain(cert.certificateId)
    expect(svg).toContain('antigravity')
  })
})
