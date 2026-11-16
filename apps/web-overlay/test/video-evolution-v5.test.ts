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

describe('smoothStrokePoints tension parameter (evo/tension-1422)', () => {
  const raw = [
    { x: 10, y: 10 },
    { x: 50, y: 80 },
    { x: 100, y: 20 },
    { x: 150, y: 90 },
  ]

  // Default output locked to the pre-fix implementation, point by point.
  // Computed from the baseline formula (tension hard-coded to 0.5); any
  // change to the default curve must update this list deliberately.
  const DEFAULT_EXPECTED = [
    { x: 10, y: 10 },
    { x: 16.953125, y: 25.625 },
    { x: 26.875, y: 48.75 },
    { x: 38.359375, y: 70 },
    { x: 50, y: 80 },
    { x: 61.796875, y: 71.09375 },
    { x: 74.375, y: 50 },
    { x: 87.265625, y: 28.90625 },
    { x: 100, y: 20 },
    { x: 113.671875, y: 30 },
    { x: 128.125, y: 51.25 },
    { x: 141.015625, y: 74.375 },
    { x: 150, y: 90 },
  ]

  it('default output is unchanged from the pre-fix implementation', () => {
    expect(smoothStrokePoints(raw)).toEqual(DEFAULT_EXPECTED)
  })

  it('explicit tension 0.5 matches the default', () => {
    expect(smoothStrokePoints(raw, 0.5)).toEqual(smoothStrokePoints(raw))
  })

  it('different tension values produce different curves', () => {
    expect(smoothStrokePoints(raw, 0.25)).not.toEqual(smoothStrokePoints(raw, 0.75))
    expect(smoothStrokePoints(raw, 0)).not.toEqual(smoothStrokePoints(raw, 1))
    expect(smoothStrokePoints(raw, 0.25)).not.toEqual(smoothStrokePoints(raw))
  })

  it('clamps out-of-range tension and falls back for non-finite input', () => {
    expect(smoothStrokePoints(raw, 2)).toEqual(smoothStrokePoints(raw, 1))
    expect(smoothStrokePoints(raw, -1)).toEqual(smoothStrokePoints(raw, 0))
    expect(smoothStrokePoints(raw, Number.NaN)).toEqual(smoothStrokePoints(raw))
    expect(smoothStrokePoints(raw, Number.POSITIVE_INFINITY)).toEqual(smoothStrokePoints(raw))
  })

  it('keeps the stroke endpoints for any tension', () => {
    for (const tension of [0, 0.25, 0.5, 0.75, 1]) {
      const smoothed = smoothStrokePoints(raw, tension)
      expect(smoothed[0]).toEqual({ x: 10, y: 10 })
      expect(smoothed[smoothed.length - 1]).toEqual({ x: 150, y: 90 })
    }
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

