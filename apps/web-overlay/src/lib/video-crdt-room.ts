export interface CoWatchUser {
  id: string
  name: string
  isHost: boolean
  joinedAt: number
}

export interface SharedNoteItem {
  id: string
  author: string
  text: string
  timeSec: number
  timestamp: number
}

export interface CoWatchState {
  roomId: string
  videoId: string
  playheadSec: number
  currentSec: number
  isPlaying: boolean
  lastUpdated: number
  version: number
  users: CoWatchUser[]
  sharedNotes: SharedNoteItem[]
  notes: SharedNoteItem[]
}

export interface CoWatchSession {
  roomId: string
  clientId: string
  currentUser: CoWatchUser
  getPeerCount: () => number
  syncPlayhead: (sec: number, isPlaying: boolean) => void
  broadcastPlayback: (sec: number, isPlaying: boolean) => void
  broadcastNote: (text: string, timeSec: number) => void
  appendSharedNote: (text: string, timeSec: number) => void
  onStateChange: (callback: (state: CoWatchState) => void) => () => void
  leaveRoom: () => void
  leave: () => void
  getState: () => CoWatchState
}

export interface JoinCoWatchRoomParams {
  roomId: string
  videoId: string
  userName?: string
  onStateUpdate?: (state: CoWatchState) => void
  onNoteUpdate?: (notes: SharedNoteItem[]) => void
}

/**
 * Creates or joins a decentralized real-time co-watching and CRDT note room.
 */
export function joinCoWatchRoom(
  paramsOrRoomId: JoinCoWatchRoomParams | string,
  videoIdArg?: string,
  userNameArg: string = '匿名开发者'
): CoWatchSession {
  let roomId: string
  let videoId: string
  let userName = userNameArg
  let initialOnStateUpdate: ((state: CoWatchState) => void) | undefined
  let initialOnNoteUpdate: ((notes: SharedNoteItem[]) => void) | undefined

  if (typeof paramsOrRoomId === 'object' && paramsOrRoomId !== null) {
    roomId = paramsOrRoomId.roomId
    videoId = paramsOrRoomId.videoId
    userName = paramsOrRoomId.userName || '匿名开发者'
    initialOnStateUpdate = paramsOrRoomId.onStateUpdate
    initialOnNoteUpdate = paramsOrRoomId.onNoteUpdate
  } else {
    roomId = paramsOrRoomId
    videoId = videoIdArg || 'default'
  }

  const userId = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const channelName = `devops_cowatch_room_${roomId}`

  const currentUser: CoWatchUser = {
    id: userId,
    name: userName,
    isHost: false,
    joinedAt: Date.now(),
  }

  const state: CoWatchState = {
    roomId,
    videoId,
    playheadSec: 0,
    currentSec: 0,
    isPlaying: true,
    lastUpdated: Date.now(),
    version: 1,
    users: [currentUser],
    sharedNotes: [],
    notes: [],
  }

  const listeners = new Set<(s: CoWatchState) => void>()
  if (initialOnStateUpdate) {
    listeners.add(initialOnStateUpdate)
  }
  let channel: BroadcastChannel | null = null

  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    try {
      channel = new BroadcastChannel(channelName)
      channel.onmessage = (event) => {
        const msg = event.data
        if (!msg || !msg.type) return

        if (msg.type === 'USER_JOIN') {
          if (!state.users.some(u => u.id === msg.user.id)) {
            state.users.push(msg.user)
            notify()
          }
          // Reply state to new user
          channel?.postMessage({ type: 'STATE_SNAPSHOT', state })
        } else if (msg.type === 'USER_LEAVE') {
          state.users = state.users.filter(u => u.id !== msg.userId)
          notify()
        } else if (msg.type === 'SYNC_PLAYHEAD') {
          // Clock drift and LWW comparison
          if (msg.timestamp > state.lastUpdated) {
            state.playheadSec = msg.playheadSec
            state.isPlaying = msg.isPlaying
            state.lastUpdated = msg.timestamp
            notify()
          }
        } else if (msg.type === 'ADD_SHARED_NOTE') {
          if (!state.sharedNotes.some(n => n.id === msg.note.id)) {
            state.sharedNotes.push(msg.note)
            notify()
          }
        } else if (msg.type === 'STATE_SNAPSHOT') {
          if (msg.state.lastUpdated > state.lastUpdated) {
            state.playheadSec = msg.state.playheadSec
            state.isPlaying = msg.state.isPlaying
            state.lastUpdated = msg.state.lastUpdated
          }
          for (const u of msg.state.users || []) {
            if (!state.users.some(existing => existing.id === u.id)) {
              state.users.push(u)
            }
          }
          for (const note of msg.state.sharedNotes || []) {
            if (!state.sharedNotes.some(n => n.id === note.id)) {
              state.sharedNotes.push(note)
            }
          }
          notify()
        }
      }

      // Announce arrival
      channel.postMessage({ type: 'USER_JOIN', user: currentUser })
    } catch {
      channel = null
    }
  }

  function notify() {
    const copy = { ...state, users: [...state.users], sharedNotes: [...state.sharedNotes] }
    listeners.forEach(cb => {
      try {
        cb(copy)
      } catch {
        // Ignore listener error
      }
    })
  }

  const syncPlayhead = (sec: number, isPlaying: boolean) => {
    state.playheadSec = sec
    state.currentSec = sec
    state.isPlaying = isPlaying
    state.lastUpdated = Date.now()
    state.version++
    channel?.postMessage({
      type: 'SYNC_PLAYHEAD',
      playheadSec: sec,
      isPlaying,
      timestamp: state.lastUpdated,
      version: state.version,
    })
    notify()
  }

  const broadcastNote = (text: string, timeSec: number) => {
    const note: SharedNoteItem = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      author: currentUser.name,
      text,
      timeSec,
      timestamp: Date.now(),
    }
    state.sharedNotes.push(note)
    state.notes = state.sharedNotes
    state.version++
    channel?.postMessage({ type: 'ADD_SHARED_NOTE', note })
    initialOnNoteUpdate?.(state.sharedNotes)
    notify()
  }

  const leave = () => {
    channel?.postMessage({ type: 'USER_LEAVE', userId })
    channel?.close()
    channel = null
    listeners.clear()
  }

  return {
    roomId,
    clientId: userId,
    currentUser,
    getPeerCount: () => state.users.length,
    syncPlayhead,
    broadcastPlayback: syncPlayhead,
    broadcastNote,
    appendSharedNote: broadcastNote,
    onStateChange: (callback) => {
      listeners.add(callback)
      callback({ ...state })
      return () => {
        listeners.delete(callback)
      }
    },
    leaveRoom: leave,
    leave,
    getState: () => ({ ...state }),
  }
}
