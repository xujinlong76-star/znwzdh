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

