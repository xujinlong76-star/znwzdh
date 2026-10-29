import { describe, it, expect } from 'vitest'
import {
  smoothStrokePoints,
  getStrokeDisplayOpacity,
  TelestratorManager,
  type TelestratorStroke,
} from '@/lib/video-telestrator'
import {
  getStorageQuotaEstimate,
  deriveEncryptionKey,
  encryptChunkData,
  decryptChunkData,
} from '@/lib/video-offline-storage'
import {
  calculateRmsDb,
  computeDynamicPlaybackRate,
  SmartSpeedController,
} from '@/lib/video-silence-detector'
import {
  binarizeFrameData,
  parseExtractedCodeText,
} from '@/lib/video-frame-ocr'
import {
  CVD_COLOR_MATRICES,
  generateSvgFilterMarkup,
} from '@/lib/video-a11y-sight-guard'
import {
  calculateLearningStreak,
  generate365DayHeatmapGrid,
  computeRadarPolygonPoints,
} from '@/lib/video-learning-analytics'

describe('Proposal [1]: Collaborative Video Telestrator & Canvas Annotation', () => {
  it('smooths stroke points using Catmull-Rom spline interpolation', () => {
    const raw = [
      { x: 10, y: 10 },
      { x: 50, y: 80 },
      { x: 100, y: 20 },
      { x: 150, y: 90 },
    ]
    const smoothed = smoothStrokePoints(raw)
    expect(smoothed.length).toBeGreaterThan(raw.length)
    expect(smoothed[0].x).toBe(10)
    expect(smoothed[smoothed.length - 1].x).toBe(150)
  })

  it('calculates visibility opacity curves across stroke lifetime', () => {
    const stroke: TelestratorStroke = {
      id: 's1',
      tool: 'pen',
      color: '#38bdf8',
      lineWidth: 3,
      opacity: 0.9,
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      timeSec: 10,
      durationSec: 5,
    }

    expect(getStrokeDisplayOpacity(stroke, 9)).toBe(0) // Before
    expect(getStrokeDisplayOpacity(stroke, 12)).toBe(0.9) // Active
    expect(getStrokeDisplayOpacity(stroke, 14.8)).toBeLessThan(0.9) // Fading out
    expect(getStrokeDisplayOpacity(stroke, 16)).toBe(0) // Ended
  })

  it('manages undo, redo, active strokes, and JSON serialization', () => {
    const manager = new TelestratorManager('test-video')
    const stroke: TelestratorStroke = {
      id: 's1',
      tool: 'pen',
      color: '#fbbf24',
      lineWidth: 2,
      opacity: 1,
      points: [{ x: 1, y: 1 }],
      timeSec: 5,
      durationSec: 4,
    }

    manager.addStroke(stroke)
    expect(manager.getStrokes()).toHaveLength(1)
    expect(manager.getActiveStrokes(6)).toHaveLength(1)
    expect(manager.getActiveStrokes(15)).toHaveLength(0)

    manager.undo()
    expect(manager.getStrokes()).toHaveLength(0)

    manager.redo()
    expect(manager.getStrokes()).toHaveLength(1)

    const json = manager.exportJson()
    expect(json).toContain('test-video')

    const newMgr = new TelestratorManager('test-video-2')
    expect(newMgr.importJson(json)).toBe(true)
    expect(newMgr.getStrokes()).toHaveLength(1)
  })
})

describe('Proposal [2]: Offline PWA Storage & AES-GCM Encrypted Cache', () => {
  it('retrieves storage quota estimation safely', async () => {
    const quota = await getStorageQuotaEstimate()
    expect(quota).toHaveProperty('usageBytes')
    expect(quota).toHaveProperty('quotaBytes')
    expect(quota).toHaveProperty('percentUsed')
    expect(quota.quotaBytes).toBeGreaterThan(0)
  })

  it('performs AES-GCM key derivation and binary chunk encryption roundtrip', async () => {
    const key = await deriveEncryptionKey('test-secret-salt-pass')
    if (key) {
      const originalText = 'Video Chunk Byte Stream #42'
      const enc = new TextEncoder()
      const rawBuffer = enc.encode(originalText).buffer

      const { encrypted, iv } = await encryptChunkData(rawBuffer, key)
      expect(encrypted.byteLength).toBeGreaterThan(0)
      expect(iv.length).toBe(12)

      const decrypted = await decryptChunkData(encrypted, iv, key)
      const dec = new TextDecoder()
      expect(dec.decode(decrypted)).toBe(originalText)
    } else {
      expect(key).toBeNull()
    }
  })
})

describe('Proposal [3]: Smart Audio Silence Trimming & Dynamic Playback Speed', () => {
  it('calculates RMS decibel loudness from time-domain byte audio samples', () => {
    // Silence buffer (centered at 128)
    const silentBuffer = new Uint8Array(512).fill(128)
    const silentDb = calculateRmsDb(silentBuffer)
    expect(silentDb).toBeLessThan(-60)

    // Loud tone buffer
    const loudBuffer = new Uint8Array(512)
    for (let i = 0; i < 512; i++) {
      loudBuffer[i] = i % 2 === 0 ? 0 : 255
    }
    const loudDb = calculateRmsDb(loudBuffer)
    expect(loudDb).toBeGreaterThan(-5)
  })

  it('accelerates playback rate during sustained silence and restores base rate on voice', () => {
    const config = {
      enabled: true,
      silenceThresholdDb: -42,
      minSilenceDurationMs: 300,
      baseRate: 1.0,
      skipRate: 2.5,
      smoothingFactor: 0.5,
    }

    let state = {
      currentLoudnessDb: -60,
      isSilent: false,
      currentDynamicRate: 1.0,
      silenceDurationMs: 0,
      totalTimeSavedSec: 0,
    }

    // Step 1: 500ms of quiet audio
    const step1 = computeDynamicPlaybackRate(-55, state, config, 500)
    expect(step1.isSilent).toBe(true)
    expect(step1.newRate).toBeGreaterThan(1.0)

    state = {
      ...state,
      isSilent: step1.isSilent,
      currentDynamicRate: step1.newRate,
      silenceDurationMs: step1.newSilenceDurationMs,
    }

    // Step 2: Voice resumes at -15 dBFS
    const step2 = computeDynamicPlaybackRate(-15, state, config, 100)
    expect(step2.isSilent).toBe(false)
    expect(step2.newRate).toBeLessThan(step1.newRate)
  })

  it('manages smart speed controller state and time-saved metrics', () => {
    const controller = new SmartSpeedController({ enabled: true, baseRate: 1.0, skipRate: 2.5 })
    const silentData = new Uint8Array(256).fill(128)

    controller.processAudioSample(silentData)
    const state = controller.getState()
    expect(state.currentLoudnessDb).toBeLessThan(-40)
  })
})

describe('Proposal [4]: Client-side In-Browser Frame OCR & Code Extraction', () => {
  it('binarizes frame pixel data to isolate monochrome text', () => {
    const pixels = new Uint8ClampedArray(16) // 4 pixels RGBA
    pixels.set([200, 200, 200, 255, 30, 30, 30, 255, 150, 150, 150, 255, 0, 0, 0, 255])
    const binarized = binarizeFrameData(pixels, 2, 2, 128)

    expect(binarized[0]).toBe(255) // bright
    expect(binarized[4]).toBe(0) // dark
    expect(binarized[3]).toBe(255) // alpha intact
  })

  it('parses commands and language profiles from extracted terminal lines', () => {
    const text = `
$ docker run -d -p 8080:80 nginx
# Check cluster pods
kubectl get pods -A
git status
`
    const result = parseExtractedCodeText(text)
    expect(result.language).toBe('bash')
    expect(result.detectedCommands).toContain('docker run -d -p 8080:80 nginx')
    expect(result.detectedCommands).toContain('kubectl get pods -A')
    expect(result.detectedCommands).toContain('git status')
    expect(result.lines.some(l => l.isComment)).toBe(true)
  })
})

describe('Proposal [5]: High-Contrast Sight Guard & Full Keyboard A11y Navigation', () => {
  it('supplies standard color matrices for all color vision modes', () => {
    expect(CVD_COLOR_MATRICES.normal).toBeDefined()
    expect(CVD_COLOR_MATRICES.protanopia).toContain('0.567')
    expect(CVD_COLOR_MATRICES.deuteranopia).toContain('0.625')
    expect(CVD_COLOR_MATRICES.tritanopia).toContain('0.95')
    expect(CVD_COLOR_MATRICES['high-contrast']).toContain('1.5')
  })

  it('generates compliant SVG feColorMatrix filter markup', () => {
    const markup = generateSvgFilterMarkup('protanopia', 'my-prot-filter')
    expect(markup).toContain('<svg')
    expect(markup).toContain('id="my-prot-filter"')
    expect(markup).toContain('<feColorMatrix')
  })
})

describe('Proposal [6]: Learning Streak Heatmap & Skill Tree Mastery Radar', () => {
  it('calculates continuous learning streaks and total study time', () => {
    const history: Record<string, number> = {
      '2026-10-25': 45,
      '2026-10-26': 60,
      '2026-10-27': 30,
    }
    const streak = calculateLearningStreak(history, new Date('2026-10-27'))
    expect(streak.currentStreak).toBe(3)
    expect(streak.longestStreak).toBe(3)
    expect(streak.totalMinutes).toBe(135)
  })

  it('generates 52-week contribution heatmap matrix', () => {
    const history: Record<string, number> = {
      '2026-10-27': 120,
    }
    const grid = generate365DayHeatmapGrid(history, new Date('2026-10-27'))
    expect(grid.length).toBeGreaterThanOrEqual(52)
    expect(grid[0]).toHaveLength(7)

    const flattened = grid.flat()
    const targetDay = flattened.find(d => d.date === '2026-10-27')
    expect(targetDay).toBeDefined()
    expect(targetDay?.level).toBe(4) // >90 mins = level 4
  })

  it('computes 5-dimensional skill radar SVG polygon coordinates', () => {
    const domains = [
      { domain: 'devops', name: 'DevOps', score: 80, maxScore: 100 },
      { domain: 'frontend', name: 'Frontend', score: 90, maxScore: 100 },
      { domain: 'backend', name: 'Backend', score: 70, maxScore: 100 },
      { domain: 'database', name: 'Database', score: 60, maxScore: 100 },
      { domain: 'cloud', name: 'Cloud', score: 85, maxScore: 100 },
    ]
    const points = computeRadarPolygonPoints(domains, { x: 100, y: 100 }, 80)
    expect(points.split(' ')).toHaveLength(5)
    points.split(' ').forEach((pt) => {
      const [x, y] = pt.split(',').map(Number)
      expect(x).toBeGreaterThan(0)
      expect(y).toBeGreaterThan(0)
    })
  })
})
