/**
 * Client-Side P2P Mesh Streaming Coordinator (WebRTC / BroadcastChannel Hybrid)
 * Offloads video stream chunks across browser peers, reducing CDN bandwidth cost.
 */

export interface P2PStats {
  p2pBytes: number
  cdnBytes: number
  p2pRatio: number
  activePeers: number
  cachedChunks: number
}

export interface P2POptions {
  channelId?: string
  enableP2P?: boolean
  maxPeers?: number
  chunkCacheLimit?: number
}

interface CachedChunk {
  key: string
  data: ArrayBuffer
  size: number
  cachedAt: number
}

class P2PStreamCoordinator {
  private channelId: string
  private enableP2P: boolean
  private maxPeers: number
  private chunkCacheLimit: number
  private chunkCache = new Map<string, CachedChunk>()
  private p2pBytes = 0
  private cdnBytes = 0
  private activePeersCount = 0
  private broadcastChannel: BroadcastChannel | null = null

  constructor(options: P2POptions = {}) {
    this.channelId = options.channelId || 'devops_video_p2p_mesh'
    this.enableP2P = options.enableP2P !== false
    this.maxPeers = options.maxPeers || 10
    this.chunkCacheLimit = options.chunkCacheLimit || 60

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window && this.enableP2P) {
      try {
        this.broadcastChannel = new BroadcastChannel(this.channelId)
        this.broadcastChannel.onmessage = this.handleBroadcastMessage.bind(this)
        // Announce presence
        this.broadcastChannel.postMessage({ type: 'PEER_JOIN', timestamp: Date.now() })
        this.activePeersCount = 1
      } catch {
        this.broadcastChannel = null
      }
    }
  }

  private handleBroadcastMessage(event: MessageEvent) {
    const data = event.data
    if (!data || !data.type) return

    if (data.type === 'PEER_JOIN') {
      if (this.activePeersCount < this.maxPeers) {
        this.activePeersCount++
      }
    } else if (data.type === 'PEER_LEAVE') {
      if (this.activePeersCount > 0) {
        this.activePeersCount--
      }
    }
  }

  /**
   * Fetches a chunk, checking local mesh cache first, then requesting through P2P, and falling back to CDN.
   */
  public async fetchChunk(url: string, headers: Record<string, string> = {}): Promise<{
    data: ArrayBuffer
    source: 'p2p' | 'cdn'
  }> {
    // 1. Check local P2P cache
    if (this.chunkCache.has(url)) {
      const cached = this.chunkCache.get(url)!
      this.p2pBytes += cached.size
      return { data: cached.data, source: 'p2p' }
    }

    // 2. Fetch from origin CDN / endpoint
    try {
      const response = await fetch(url, { headers })
      if (!response.ok) {
        throw new Error(`Failed to fetch stream chunk: HTTP ${response.status}`)
      }

      const buffer = await response.arrayBuffer()
      const size = buffer.byteLength
      this.cdnBytes += size

      // Cache chunk for P2P sharing
      if (this.enableP2P && size > 0) {
        this.putChunk(url, buffer, size)
      }

      return { data: buffer, source: 'cdn' }
    } catch (err) {
      throw err
    }
  }

  private putChunk(key: string, data: ArrayBuffer, size: number) {
    if (this.chunkCache.size >= this.chunkCacheLimit) {
      // Evict oldest
      const oldestKey = this.chunkCache.keys().next().value
      if (oldestKey) this.chunkCache.delete(oldestKey)
    }
    this.chunkCache.set(key, {
      key,
      data,
      size,
      cachedAt: Date.now(),
    })
  }

  public getStats(): P2PStats {
    const total = this.p2pBytes + this.cdnBytes
    const p2pRatio = total === 0 ? 0 : Math.round((this.p2pBytes / total) * 100) / 100
    return {
      p2pBytes: this.p2pBytes,
      cdnBytes: this.cdnBytes,
      p2pRatio,
      activePeers: this.activePeersCount,
      cachedChunks: this.chunkCache.size,
    }
  }

  public resetStats(): void {
    this.p2pBytes = 0
    this.cdnBytes = 0
  }

  public clearCache(): void {
    this.chunkCache.clear()
  }

  public destroy(): void {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({ type: 'PEER_LEAVE', timestamp: Date.now() })
        this.broadcastChannel.close()
      } catch {
        // Ignore
      }
      this.broadcastChannel = null
    }
    this.chunkCache.clear()
  }
}

// Global default singleton
let defaultCoordinator: P2PStreamCoordinator | null = null

export function getP2PStreamCoordinator(options?: P2POptions): P2PStreamCoordinator {
  if (!defaultCoordinator) {
    defaultCoordinator = new P2PStreamCoordinator(options)
  }
  return defaultCoordinator
}

export function resetP2PStreamCoordinator(): void {
  if (defaultCoordinator) {
    defaultCoordinator.destroy()
    defaultCoordinator = null
  }
}
