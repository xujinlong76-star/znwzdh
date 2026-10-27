/**
 * Hybrid WebRTC P2P-CDN Video Swarm Chunk Loader
 * Bitfield-based peer chunk dissemination with rarest-first piece scheduling and HTTP fallback.
 */

export interface VideoChunkMeta {
  chunkIndex: number
  byteStart: number
  byteEnd: number
  hash: string
  source: 'p2p' | 'cdn'
  downloadDurationMs: number
}

export interface SwarmPeerInfo {
  peerId: string
  bitfield: boolean[]
  downloadedBytes: number
  uploadedBytes: number
  latencyMs: number
  choked: boolean
}

export interface SwarmTelemetry {
  totalChunks: number
  downloadedChunksCount: number
  p2pBytes: number
  cdnBytes: number
  p2pOffloadRatio: number // 0.0 - 1.0 (e.g. 0.72 = 72% P2P)
  activePeersCount: number
  averageSwarmLatencyMs: number
}

/**
 * Creates an initial boolean array representing downloaded chunk availability.
 */
export function createBitfield(chunkCount: number, fillWith: boolean = false): boolean[] {
  return new Array(chunkCount).fill(fillWith)
}

/**
 * Calculates rarest-first chunk candidate from peers' bitfields.
 * Returns the index of the rarest chunk that the local peer does not yet possess.
 */
export function selectRarestChunk(
  localBitfield: boolean[],
  peerBitfields: boolean[][]
): number | null {
  const totalChunks = localBitfield.length
  const chunkAvailability: number[] = new Array(totalChunks).fill(0)

  // Count peer availability for each chunk
  for (const pBits of peerBitfields) {
    for (let i = 0; i < totalChunks; i++) {
      if (pBits[i]) {
        chunkAvailability[i]!++
      }
    }
  }

  let minCount = Infinity
  let rarestIndex: number | null = null

  for (let i = 0; i < totalChunks; i++) {
    // Only consider chunks local peer does NOT have
    if (!localBitfield[i] && (chunkAvailability[i] ?? 0) > 0) {
      const avail = chunkAvailability[i]!
      if (avail < minCount) {
        minCount = avail
        rarestIndex = i
      }
    }
  }

  return rarestIndex
}

/**
 * Controller class coordinating P2P swarm chunk exchanges with CDN fallback.
 */
export class P2PVideoSwarmManager {
  private totalChunks: number
  private localBitfield: boolean[]
  private peers: Map<string, SwarmPeerInfo> = new Map()
  private chunkStore: Map<number, VideoChunkMeta> = new Map()
  private p2pBytesTotal: number = 0
  private cdnBytesTotal: number = 0

  constructor(totalChunks: number = 20) {
    this.totalChunks = Math.max(1, totalChunks)
    this.localBitfield = createBitfield(this.totalChunks, false)
  }

  registerPeer(peerId: string, bitfield?: boolean[]): void {
    this.peers.set(peerId, {
      peerId,
      bitfield: bitfield || createBitfield(this.totalChunks, true),
      downloadedBytes: 0,
      uploadedBytes: 0,
      latencyMs: Math.floor(15 + Math.random() * 25),
      choked: false,
    })
  }

  unregisterPeer(peerId: string): void {
    this.peers.delete(peerId)
  }

  getLocalBitfield(): boolean[] {
    return [...this.localBitfield]
  }

  getTelemetry(): SwarmTelemetry {
    const totalBytes = this.p2pBytesTotal + this.cdnBytesTotal
    const p2pOffloadRatio = totalBytes > 0 ? this.p2pBytesTotal / totalBytes : 0

    let totalLatency = 0
    this.peers.forEach(p => {
      totalLatency += p.latencyMs
    })
    const avgLatency = this.peers.size > 0 ? Math.round(totalLatency / this.peers.size) : 0

    return {
      totalChunks: this.totalChunks,
      downloadedChunksCount: this.chunkStore.size,
      p2pBytes: this.p2pBytesTotal,
      cdnBytes: this.cdnBytesTotal,
      p2pOffloadRatio: Math.round(p2pOffloadRatio * 1000) / 1000,
      activePeersCount: this.peers.size,
      averageSwarmLatencyMs: avgLatency,
    }
  }

  /**
   * Request a specific chunk. If a peer has it, receive via P2P; otherwise fetch via CDN fallback.
   */
  async acquireChunk(
    chunkIndex: number,
    chunkSizeBytes: number = 256 * 1024,
    preferP2P: boolean = true
  ): Promise<VideoChunkMeta> {
    if (this.chunkStore.has(chunkIndex)) {
      return this.chunkStore.get(chunkIndex)!
    }

    const peerArray = Array.from(this.peers.values())
    const peersHavingChunk = peerArray.filter(p => p.bitfield[chunkIndex] && !p.choked)

    if (preferP2P && peersHavingChunk.length > 0) {
      // Pick best low-latency peer
      peersHavingChunk.sort((a, b) => a.latencyMs - b.latencyMs)
      const selectedPeer = peersHavingChunk[0]!

      const meta: VideoChunkMeta = {
        chunkIndex,
        byteStart: chunkIndex * chunkSizeBytes,
        byteEnd: (chunkIndex + 1) * chunkSizeBytes - 1,
        hash: `chunk-sha256-${chunkIndex}`,
        source: 'p2p',
        downloadDurationMs: selectedPeer.latencyMs,
      }

      selectedPeer.downloadedBytes += chunkSizeBytes
      this.p2pBytesTotal += chunkSizeBytes
      this.localBitfield[chunkIndex] = true
      this.chunkStore.set(chunkIndex, meta)
      return meta
    }

    // CDN Fallback
    const meta: VideoChunkMeta = {
      chunkIndex,
      byteStart: chunkIndex * chunkSizeBytes,
      byteEnd: (chunkIndex + 1) * chunkSizeBytes - 1,
      hash: `chunk-sha256-${chunkIndex}`,
      source: 'cdn',
      downloadDurationMs: 45,
    }

    this.cdnBytesTotal += chunkSizeBytes
    this.localBitfield[chunkIndex] = true
    this.chunkStore.set(chunkIndex, meta)
    return meta
  }
}
