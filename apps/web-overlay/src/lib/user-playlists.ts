import type { NavigationSubItem } from '@/types/navigation'

export interface UserPlaylist {
  id: string
  title: string
  description?: string
  isSystem?: boolean
  items: NavigationSubItem[]
  createdAt: string
  updatedAt: string
}

export const WATCH_LATER_ID = 'watch-later'
export const FAVORITES_PLAYLIST_ID = 'video-favorites'
const STORAGE_KEY = 'devops_user_video_playlists_v1'
export const PLAYLIST_UPDATE_EVENT = 'devops:playlists:updated'

let _cachedPlaylists: UserPlaylist[] | null = null;

export function invalidatePlaylistsCache(): void {
  _cachedPlaylists = null;
}

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage
  }
  return null
}

function notifySubscribers(): void {
  if (typeof window !== 'undefined' && window.dispatchEvent) {
    window.dispatchEvent(new CustomEvent(PLAYLIST_UPDATE_EVENT))
  }
}

function initializeDefaultPlaylists(): UserPlaylist[] {
  const now = new Date().toISOString()
  return [
    {
      id: WATCH_LATER_ID,
      title: '稍后再看',
      description: '存放待学习的技术视频队列',
      isSystem: true,
      items: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: FAVORITES_PLAYLIST_ID,
      title: '我的收藏',
      description: '个人星标与高质量技术精选',
      isSystem: true,
      items: [],
      createdAt: now,
      updatedAt: now,
    },
  ]
}

/**
 * Retrieves all user playlists, ensuring default system lists exist.
 */
export function getUserPlaylists(): UserPlaylist[] {
  if (_cachedPlaylists) return _cachedPlaylists
  const storage = getStorage()
  if (!storage) return initializeDefaultPlaylists()

  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) {
      const defaults = initializeDefaultPlaylists()
      storage.setItem(STORAGE_KEY, JSON.stringify(defaults))
      return defaults
    }
    const lists: UserPlaylist[] = JSON.parse(raw)
    // Ensure system lists exist
    if (!lists.some(l => l.id === WATCH_LATER_ID)) {
      lists.unshift({
        id: WATCH_LATER_ID,
        title: '稍后再看',
        description: '存放待学习的技术视频队列',
        isSystem: true,
        items: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    }
    _cachedPlaylists = lists
    return lists
  } catch {
    return initializeDefaultPlaylists()
  }
}

function savePlaylists(lists: UserPlaylist[]): void {
  _cachedPlaylists = lists
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(lists))
    notifySubscribers()
  } catch {
    // Ignore quota issues
  }
}

/**
 * Gets a playlist by ID.
 */
export function getPlaylistById(id: string): UserPlaylist | null {
  const lists = getUserPlaylists()
  return lists.find(l => l.id === id) || null
}

/**
 * Creates a new custom user playlist.
 */
export function createPlaylist(title: string, description?: string): UserPlaylist {
  const lists = getUserPlaylists()
  const now = new Date().toISOString()
  const newPlaylist: UserPlaylist = {
    id: `playlist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: title.trim() || '新建播单',
    description: description?.trim(),
    isSystem: false,
    items: [],
    createdAt: now,
    updatedAt: now,
  }
  lists.push(newPlaylist)
  savePlaylists(lists)
  return newPlaylist
}

/**
 * Deletes a custom playlist (system playlists cannot be deleted).
 */
export function deletePlaylist(id: string): boolean {
  if (id === WATCH_LATER_ID || id === FAVORITES_PLAYLIST_ID) {
    return false
  }
  const lists = getUserPlaylists()
  const filtered = lists.filter(l => l.id !== id)
  if (filtered.length !== lists.length) {
    savePlaylists(filtered)
    return true
  }
  return false
}

/**
 * Renames or updates description of a custom playlist.
 */
export function updatePlaylistMeta(id: string, title: string, description?: string): boolean {
  const lists = getUserPlaylists()
  const target = lists.find(l => l.id === id)
  if (!target) return false

  target.title = title.trim() || target.title
  if (description !== undefined) {
    target.description = description.trim()
  }
  target.updatedAt = new Date().toISOString()
  savePlaylists(lists)
  return true
}

/**
 * Adds a video item to a playlist.
 */
export function addToPlaylist(playlistId: string, item: NavigationSubItem): void {
  const lists = getUserPlaylists()
  const playlist = lists.find(l => l.id === playlistId)
  if (!playlist) return

  // Avoid duplicates in the same list
  if (!playlist.items.some(existing => existing.id === item.id)) {
    playlist.items.push(item)
    playlist.updatedAt = new Date().toISOString()
    savePlaylists(lists)
  }
}

/**
 * Removes a video item from a playlist.
 */
export function removeFromPlaylist(playlistId: string, itemId: string): void {
  const lists = getUserPlaylists()
  const playlist = lists.find(l => l.id === playlistId)
  if (!playlist) return

  const initialLen = playlist.items.length
  playlist.items = playlist.items.filter(item => item.id !== itemId)
  if (playlist.items.length !== initialLen) {
    playlist.updatedAt = new Date().toISOString()
    savePlaylists(lists)
  }
}

/**
 * Checks if an item is already inside a specific playlist.
 */
export function isItemInPlaylist(playlistId: string, itemId: string): boolean {
  const playlist = getPlaylistById(playlistId)
  if (!playlist) return false
  return playlist.items.some(i => i.id === itemId)
}

/**
 * Toggles an item in the Watch Later queue.
 * Returns true if added, false if removed.
 */
export function toggleWatchLater(item: NavigationSubItem): boolean {
  if (isItemInPlaylist(WATCH_LATER_ID, item.id)) {
    removeFromPlaylist(WATCH_LATER_ID, item.id)
    return false
  } else {
    addToPlaylist(WATCH_LATER_ID, item)
    return true
  }
}

/**
 * Checks if an item is in Watch Later.
 */
export function isInWatchLater(itemId: string): boolean {
  return isItemInPlaylist(WATCH_LATER_ID, itemId)
}

/**
 * Gets all items in Watch Later.
 */
export function getWatchLaterList(): NavigationSubItem[] {
  const p = getPlaylistById(WATCH_LATER_ID)
  return p ? p.items : []
}

/**
 * Reorders items in a playlist.
 */
export function reorderPlaylist(playlistId: string, orderedItemIds: string[]): void {
  const lists = getUserPlaylists()
  const playlist = lists.find(l => l.id === playlistId)
  if (!playlist) return

  const itemMap = new Map(playlist.items.map(i => [i.id, i]))
  const newItems: NavigationSubItem[] = []
  for (const id of orderedItemIds) {
    const item = itemMap.get(id)
    if (item) {
      newItems.push(item)
      itemMap.delete(id)
    }
  }
  // Append remaining items if any
  for (const remaining of itemMap.values()) {
    newItems.push(remaining)
  }
  playlist.items = newItems
  playlist.updatedAt = new Date().toISOString()
  savePlaylists(lists)
}

/**
 * Resolves next item in the playlist for continuous sequential auto-play.
 */
export function getNextPlaylistItem(playlistId: string, currentItemId: string): NavigationSubItem | null {
  const playlist = getPlaylistById(playlistId)
  if (!playlist || playlist.items.length === 0) return null

  const currentIndex = playlist.items.findIndex(i => i.id === currentItemId)
  if (currentIndex === -1 || currentIndex >= playlist.items.length - 1) {
    return null
  }
  return playlist.items[currentIndex + 1]
}
