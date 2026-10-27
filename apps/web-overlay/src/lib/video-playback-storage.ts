/**
 * 视频播放历史与续播断点持久化存储管理器 (LocalStorage 契约)
 */

export interface PlaybackHistoryItem {
  videoId: string
  title: string
  author: string
  cover?: string
  platform: 'bilibili' | 'youtube' | 'other'
  timestampSec: number
  durationSec: number
  lastWatchedAt: number
  progressPercent: number
}

const STORAGE_KEY = 'navhub:video:playback-history:v1'
const MAX_HISTORY_ITEMS = 30

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  if (typeof globalThis !== 'undefined' && (globalThis as unknown as { localStorage?: Storage }).localStorage) {
    return (globalThis as unknown as { localStorage: Storage }).localStorage
  }
  return null
}

export function getPlaybackHistory(): PlaybackHistoryItem[] {
  const storage = getStorage()
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function savePlaybackPosition(item: {
  videoId: string
  title: string
  author?: string
  cover?: string
  platform: 'bilibili' | 'youtube' | 'other'
  timestampSec: number
  durationSec: number
}): void {
  const storage = getStorage()
  if (!storage) return
  try {
    const history = getPlaybackHistory()
    const now = Date.now()
    const duration = Math.max(1, item.durationSec)
    const current = Math.max(0, Math.min(item.timestampSec, duration))
    const progressPercent = Math.min(100, Math.round((current / duration) * 100))

    const entry: PlaybackHistoryItem = {
      videoId: item.videoId,
      title: item.title,
      author: item.author || '未知讲师',
      cover: item.cover,
      platform: item.platform,
      timestampSec: Math.floor(current),
      durationSec: Math.floor(duration),
      lastWatchedAt: now,
      progressPercent
    }

    // 去重并排到最前
    const filtered = history.filter(h => h.videoId !== item.videoId)
    filtered.unshift(entry)

    if (filtered.length > MAX_HISTORY_ITEMS) {
      filtered.length = MAX_HISTORY_ITEMS
    }

    storage.setItem(STORAGE_KEY, JSON.stringify(filtered))
  } catch {
    // 忽略 localStorage 满或隐私模式错误
  }
}

export function getResumePosition(videoId: string): number {
  const storage = getStorage()
  if (!storage || !videoId) return 0
  const history = getPlaybackHistory()
  const found = history.find(h => h.videoId === videoId)
  if (!found) return 0
  // 如果已看超过 95%，则从头开始
  if (found.progressPercent >= 95) return 0
  return found.timestampSec
}

export function removePlaybackItem(videoId: string): void {
  const storage = getStorage()
  if (!storage) return
  try {
    const history = getPlaybackHistory()
    const next = history.filter(h => h.videoId !== videoId)
    storage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // localStorage 可能因隐私模式/配额已满而失败；播放记录是尽力而为的附加信息
  }
}

export function clearPlaybackHistory(): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(STORAGE_KEY)
  } catch {
    // 同上：清理失败不影响播放，下次写入会覆盖
  }
}
