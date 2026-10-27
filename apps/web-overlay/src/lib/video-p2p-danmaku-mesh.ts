import type { VideoDanmakuItem } from '@/types/navigation'

export interface GossipDanmakuMessage {
  id: string
  text: string
  timeSec: number
  originPeerId: string
  hopCount: number
  timestamp: number
  color?: string
}

export interface MeshTopologyStats {
  connectedPeersCount: number
  totalRelayedMessages: number
  deduplicatedCount: number
  dropCount: number
  averageLatencyMs: number
}

/**
 * Lightweight 64-bit Bloom filter for O(1) message deduplication across gossip hops.
 */
export class SimpleBloomFilter {
  private size: number
  private bits: Uint8Array

  constructor(size: number = 256) {
    this.size = size
    this.bits = new Uint8Array(Math.ceil(size / 8))
  }

  private hash(str: string, seed: number): number {
    let h = seed
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
    }
    return Math.abs(h) % this.size
  }

  add(item: string): void {
    const h1 = this.hash(item, 0x1234)
    const h2 = this.hash(item, 0x5678)
    this.setBit(h1)
    this.setBit(h2)
  }

  has(item: string): boolean {
    const h1 = this.hash(item, 0x1234)
    const h2 = this.hash(item, 0x5678)
    return this.getBit(h1) && this.getBit(h2)
  }

  private setBit(pos: number): void {
    const byteIdx = Math.floor(pos / 8)
    const bitIdx = pos % 8
    this.bits[byteIdx] |= 1 << bitIdx
  }

  private getBit(pos: number): boolean {
    const byteIdx = Math.floor(pos / 8)
    const bitIdx = pos % 8
    return (this.bits[byteIdx] & (1 << bitIdx)) !== 0
  }
}

/**
 * Token bucket rate limiter preventing flood storms during live streaming danmaku peaks.
 */
export class TokenBucketLimiter {
  private capacity: number
  private fillRatePerSec: number
  private tokens: number
  private lastFillTime: number = Date.now()

  constructor(capacity: number = 30, fillRatePerSec: number = 10) {
    this.capacity = capacity
    this.fillRatePerSec = fillRatePerSec
    this.tokens = capacity
  }

  tryConsume(tokens: number = 1): boolean {
    const now = Date.now()
    const elapsed = (now - this.lastFillTime) / 1000
    this.lastFillTime = now

    this.tokens = Math.min(this.capacity, this.tokens + (elapsed * this.fillRatePerSec))
    if (this.tokens >= tokens) {
      this.tokens -= tokens
      return true
    }
    return false
  }
}

/**
 * P2P Danmaku Mesh Coordinator managing virtual gossip dissemination.
 */
export class P2PDanmakuMeshCoordinator {
  private peerId: string
  private videoId: string
  private bloomFilter = new SimpleBloomFilter(512)
  private limiter = new TokenBucketLimiter(20, 5)
  private stats: MeshTopologyStats = {
    connectedPeersCount: 6,
    totalRelayedMessages: 0,
    deduplicatedCount: 0,
    dropCount: 0,
    averageLatencyMs: 24,
  }
  private listeners = new Set<(msg: GossipDanmakuMessage) => void>()

  constructor(videoId: string, peerId: string = `peer-${Math.random().toString(36).slice(2, 7)}`) {
    this.videoId = videoId
    this.peerId = peerId
  }

  getStats(): MeshTopologyStats {
    return { ...this.stats }
  }

  broadcastDanmaku(text: string, timeSec: number, color?: string): GossipDanmakuMessage | null {
    if (!this.limiter.tryConsume(1)) {
      this.stats.dropCount++
      return null
    }

    const msg: GossipDanmakuMessage = {
      id: `gossip-${this.peerId}-${Date.now()}`,
      text,
      timeSec,
      originPeerId: this.peerId,
      hopCount: 0,
      timestamp: Date.now(),
      color,
    }

    this.bloomFilter.add(msg.id)
    this.stats.totalRelayedMessages++
    this.listeners.forEach(cb => cb(msg))
    return msg
  }

  receiveIncomingGossip(msg: GossipDanmakuMessage): boolean {
    if (this.bloomFilter.has(msg.id)) {
      this.stats.deduplicatedCount++
      return false
    }

    this.bloomFilter.add(msg.id)
    this.stats.totalRelayedMessages++
    this.listeners.forEach(cb => cb(msg))
    return true
  }

  onDanmakuReceived(cb: (msg: GossipDanmakuMessage) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
}
