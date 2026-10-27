/**
 * WebRTC / CRDT Collaborative Study Room & Synchronized Whiteboard Canvas Engine
 * Proposal [6]: Real-Time Synchronized Study Room & Collaborative Canvas via WebRTC/CRDT
 * Synchronizes playback state with sub-second clock drift compensation,
 * manages peer presence, and coordinates multi-user vector canvas strokes via CRDT.
 */

export interface StudyPeer {
  id: string
  name: string
  avatar: string
  isHost: boolean
  pingMs: number
  cursor?: { x: number; y: number }
  lastActiveAt: number
}

export interface SharedPlaybackState {
  currentTimeSec: number
  isPlaying: boolean
  playbackRate: number
  updatedAt: number
  sequence: number
  updatedBy: string
}

export interface WhiteboardStroke {
  id: string
  authorId: string
  color: string
  width: number
  points: Array<{ x: number; y: number }>
  createdAt: number
}

export interface StudyRoomMessage {
  type: 'playback_sync' | 'peer_join' | 'peer_leave' | 'stroke_add' | 'canvas_clear' | 'chat_message'
  roomId: string
  senderId: string
  timestamp: number
  payload: any
}

/**
 * CRDT Study Room State Manager.
 */
export class StudyRoomCRDTState {
  private roomId: string
  private localPeerId: string
  private peers: Map<string, StudyPeer> = new Map()
  private playbackState: SharedPlaybackState
  private strokes: Map<string, WhiteboardStroke> = new Map()
  private messages: Array<{ sender: string; text: string; time: number }> = []

  constructor(roomId: string, localPeerId: string, initialHost: boolean = false) {
    this.roomId = roomId
    this.localPeerId = localPeerId
    this.playbackState = {
      currentTimeSec: 0,
      isPlaying: false,
      playbackRate: 1.0,
      updatedAt: Date.now(),
      sequence: 0,
      updatedBy: localPeerId,
    }

    // Register local peer
    this.peers.set(localPeerId, {
      id: localPeerId,
      name: `伴学研友-${localPeerId.slice(-4)}`,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
      isHost: initialHost,
      pingMs: 12,
      lastActiveAt: Date.now(),
    })
  }

  getRoomId(): string {
    return this.roomId
  }

  getLocalPeerId(): string {
    return this.localPeerId
  }

  getPeers(): StudyPeer[] {
    return Array.from(this.peers.values())
  }

  getPlaybackState(): SharedPlaybackState {
    return { ...this.playbackState }
  }

  /**
   * Calculates the drift-compensated current video playback position.
   */
  getCompensatedPlaybackTime(): number {
    if (!this.playbackState.isPlaying) {
      return this.playbackState.currentTimeSec
    }
    const elapsedSec = (Date.now() - this.playbackState.updatedAt) / 1000
    return Math.max(0, this.playbackState.currentTimeSec + elapsedSec * this.playbackState.playbackRate)
  }

  getStrokes(): WhiteboardStroke[] {
    return Array.from(this.strokes.values()).sort((a, b) => a.createdAt - b.createdAt)
  }

  getMessages(): Array<{ sender: string; text: string; time: number }> {
    return [...this.messages]
  }

  /**
   * Updates playback state locally and increments sequence number.
   */
  updatePlayback(partial: Partial<Pick<SharedPlaybackState, 'currentTimeSec' | 'isPlaying' | 'playbackRate'>>): SharedPlaybackState {
    this.playbackState = {
      ...this.playbackState,
      ...partial,
      updatedAt: Date.now(),
      sequence: this.playbackState.sequence + 1,
      updatedBy: this.localPeerId,
    }
    return this.playbackState
  }

  /**
   * Receives remote playback update and applies Last-Write-Wins (LWW) conflict resolution.
   */
  applyRemotePlayback(remote: SharedPlaybackState): boolean {
    if (remote.sequence > this.playbackState.sequence || remote.updatedAt > this.playbackState.updatedAt) {
      this.playbackState = { ...remote }
      return true
    }
    return false
  }

  /**
   * Adds a collaborative stroke.
   */
  addStroke(stroke: WhiteboardStroke): void {
    this.strokes.set(stroke.id, stroke)
    if (this.strokes.size > 200) {
      const oldestKey = this.strokes.keys().next().value
      if (oldestKey) this.strokes.delete(oldestKey)
    }
  }

  clearCanvas(): void {
    this.strokes.clear()
  }

  /**
   * Adds a chat message.
   */
  addChatMessage(sender: string, text: string): void {
    this.messages.push({ sender, text, time: Date.now() })
    if (this.messages.length > 50) this.messages.shift()
  }

  /**
   * Updates peer presence.
   */
  setPeerPresence(peer: StudyPeer): void {
    this.peers.set(peer.id, { ...peer, lastActiveAt: Date.now() })
  }

  removePeer(peerId: string): boolean {
    return this.peers.delete(peerId)
  }

  /**
   * Serializes current room snapshot for WebRTC / WebSocket mesh synchronization.
   */
  serializeSnapshot(): string {
    return JSON.stringify({
      roomId: this.roomId,
      playback: this.playbackState,
      peers: Array.from(this.peers.values()),
      strokes: Array.from(this.strokes.values()),
    })
  }

  /**
   * Merges a remote snapshot.
   */
  mergeRemoteSnapshot(jsonStr: string): void {
    try {
      const parsed = JSON.parse(jsonStr)
      if (parsed.playback) {
        this.applyRemotePlayback(parsed.playback)
      }
      if (Array.isArray(parsed.peers)) {
        parsed.peers.forEach((p: StudyPeer) => this.setPeerPresence(p))
      }
      if (Array.isArray(parsed.strokes)) {
        parsed.strokes.forEach((s: WhiteboardStroke) => this.addStroke(s))
      }
    } catch (e) {
      console.error('Failed to merge remote study room snapshot:', e)
    }
  }
}
