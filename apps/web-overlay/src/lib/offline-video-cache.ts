import type { NavigationSubItem } from '@/types/navigation'

export interface OfflineCacheStats {
  count: number
  lastSyncedAt: string | null
  storageType: 'indexeddb' | 'localstorage' | 'memory'
}

const DB_NAME = 'devops_nav_video_offline_v1'
const STORE_NAME = 'offline_videos'
const META_STORE = 'offline_meta'
const LS_FALLBACK_KEY = 'devops_video_offline_cache_v1'

const memoryStore = new Map<string, NavigationSubItem>()
const memoryLastSynced: string | null = null

function getIndexedDB(): IDBFactory | null {
  if (typeof window !== 'undefined' && window.indexedDB) {
    return window.indexedDB
  }
  return null
}

function getLocalStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage
  }
  return null
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = getIndexedDB()
    if (!idb) {
      return reject(new Error('IndexedDB not supported in current environment'))
    }

    const request = idb.open(DB_NAME, 1)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Fallback operations for environments without IndexedDB
function lsSave(item: NavigationSubItem): void {
  memoryStore.set(item.id, item)
  const ls = getLocalStorage()
  if (!ls) return
  try {
    const raw = ls.getItem(LS_FALLBACK_KEY)
    const list: NavigationSubItem[] = raw ? JSON.parse(raw) : []
    const idx = list.findIndex(v => v.id === item.id)
    if (idx >= 0) {
      list[idx] = item
    } else {
      list.push(item)
    }
    ls.setItem(LS_FALLBACK_KEY, JSON.stringify(list))
    ls.setItem(`${LS_FALLBACK_KEY}_time`, new Date().toISOString())
  } catch {
    // Quota exceeded or error
  }
}

function lsGet(id: string): NavigationSubItem | null {
  if (memoryStore.has(id)) return memoryStore.get(id)!
  const ls = getLocalStorage()
  if (!ls) return null
  try {
    const raw = ls.getItem(LS_FALLBACK_KEY)
    if (!raw) return null
    const list: NavigationSubItem[] = JSON.parse(raw)
    const found = list.find(v => v.id === id)
    return found || null
  } catch {
    return null
  }
}

function lsList(): NavigationSubItem[] {
  const ls = getLocalStorage()
  if (!ls) return Array.from(memoryStore.values())
  try {
    const raw = ls.getItem(LS_FALLBACK_KEY)
    if (!raw) return Array.from(memoryStore.values())
    const list: NavigationSubItem[] = JSON.parse(raw)
    return list
  } catch {
    return Array.from(memoryStore.values())
  }
}

function lsRemove(id: string): void {
  memoryStore.delete(id)
  const ls = getLocalStorage()
  if (!ls) return
  try {
    const raw = ls.getItem(LS_FALLBACK_KEY)
    if (!raw) return
    const list: NavigationSubItem[] = JSON.parse(raw)
    const filtered = list.filter(v => v.id !== id)
    ls.setItem(LS_FALLBACK_KEY, JSON.stringify(filtered))
  } catch {
    // Ignore
  }
}

function lsClear(): void {
  memoryStore.clear()
  const ls = getLocalStorage()
  if (!ls) return
  try {
    ls.removeItem(LS_FALLBACK_KEY)
    ls.removeItem(`${LS_FALLBACK_KEY}_time`)
  } catch {
    // Ignore
  }
}

/**
 * Saves a video's full metadata and cached configuration into offline storage.
 */
export async function saveOfflineVideo(item: NavigationSubItem): Promise<void> {
  const idb = getIndexedDB()
  if (!idb) {
    lsSave(item)
    return
  }

  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite')
      const videoStore = tx.objectStore(STORE_NAME)
      const metaStore = tx.objectStore(META_STORE)

      videoStore.put(item)
      metaStore.put({ key: 'lastSyncedAt', value: new Date().toISOString() })

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // IDB transaction failed, fallback to local storage
    lsSave(item)
  }
}

/**
 * Retrieve a specific cached video item.
 */
export async function getOfflineVideo(id: string): Promise<NavigationSubItem | null> {
  const idb = getIndexedDB()
  if (!idb) {
    return lsGet(id)
  }

  try {
    const db = await openDB()
    return await new Promise<NavigationSubItem | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return lsGet(id)
  }
}

/**
 * Checks if a specific video is stored in offline cache.
 */
export async function isOfflineVideo(id: string): Promise<boolean> {
  const item = await getOfflineVideo(id)
  return item !== null
}

/**
 * Lists all offline cached videos.
 */
export async function listOfflineVideos(): Promise<NavigationSubItem[]> {
  const idb = getIndexedDB()
  if (!idb) {
    return lsList()
  }

  try {
    const db = await openDB()
    return await new Promise<NavigationSubItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  } catch {
    return lsList()
  }
}

/**
 * Removes a video from offline storage.
 */
export async function removeOfflineVideo(id: string): Promise<void> {
  const idb = getIndexedDB()
  if (!idb) {
    lsRemove(id)
    return
  }

  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.delete(id)

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    lsRemove(id)
  }
}

/**
 * Batch cache multiple videos for offline viewing.
 */
export async function cacheVideoBatch(items: NavigationSubItem[]): Promise<number> {
  if (!items || items.length === 0) return 0

  const idb = getIndexedDB()
  if (!idb) {
    items.forEach(item => lsSave(item))
    return items.length
  }

  try {
    const db = await openDB()
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const meta = tx.objectStore(META_STORE)

      let count = 0
      for (const item of items) {
        store.put(item)
        count++
      }
      meta.put({ key: 'lastSyncedAt', value: new Date().toISOString() })

      tx.oncomplete = () => resolve(count)
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    items.forEach(item => lsSave(item))
    return items.length
  }
}

/**
 * Retrieves cache statistics including total cached count and last sync timestamp.
 */
export async function getOfflineCacheStats(): Promise<OfflineCacheStats> {
  const idb = getIndexedDB()
  if (!idb) {
    const list = lsList()
    const ls = getLocalStorage()
    const lastSyncedAt = ls ? ls.getItem(`${LS_FALLBACK_KEY}_time`) : memoryLastSynced
    return {
      count: list.length,
      lastSyncedAt,
      storageType: ls ? 'localstorage' : 'memory',
    }
  }

  try {
    const db = await openDB()
    return await new Promise<OfflineCacheStats>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, META_STORE], 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const meta = tx.objectStore(META_STORE)

      const countReq = store.count()
      const metaReq = meta.get('lastSyncedAt')

      tx.oncomplete = () => {
        resolve({
          count: countReq.result || 0,
          lastSyncedAt: metaReq.result ? metaReq.result.value : null,
          storageType: 'indexeddb',
        })
      }
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    const list = lsList()
    return {
      count: list.length,
      lastSyncedAt: null,
      storageType: 'memory',
    }
  }
}

/**
 * Clears all cached offline videos and metadata.
 */
export async function clearOfflineCache(): Promise<void> {
  const idb = getIndexedDB()
  if (!idb) {
    lsClear()
    return
  }

  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, META_STORE], 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.objectStore(META_STORE).clear()

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    lsClear()
  }
}
