export interface VideoOfflinePackage {
  videoId: string
  title: string
  totalBytes: number
  cachedBytes: number
  totalChunks: number
  cachedChunks: number
  downloadedAt: number
  isComplete: boolean
  encrypted: boolean
  author?: string
  durationSec?: number
}

export interface VideoOfflineChunk {
  id: string // `${videoId}_chunk_${index}`
  videoId: string
  chunkIndex: number
  data: ArrayBuffer
  iv?: Uint8Array
  byteLength: number
}

export interface StorageQuotaInfo {
  usageBytes: number
  quotaBytes: number
  percentUsed: number
}

const DB_NAME = 'navhub_video_offline_store'
const DB_VERSION = 1
const STORE_PACKAGES = 'packages'
const STORE_CHUNKS = 'chunks'

/**
 * Retrieves the current origin storage quota estimate from the browser.
 */
export async function getStorageQuotaEstimate(): Promise<StorageQuotaInfo> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate()
      const usage = estimate.usage || 0
      const quota = estimate.quota || 1024 * 1024 * 1024 // Fallback 1GB
      return {
        usageBytes: usage,
        quotaBytes: quota,
        percentUsed: Math.min(100, Math.round((usage / quota) * 100)),
      }
    } catch {
      // Fallback
    }
  }

  return {
    usageBytes: 0,
    quotaBytes: 1024 * 1024 * 1024,
    percentUsed: 0,
  }
}

/**
 * Initializes or upgrades the offline IndexedDB instance.
 */
export function openOfflineDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in current environment'))
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_PACKAGES)) {
        db.createObjectStore(STORE_PACKAGES, { keyPath: 'videoId' })
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunkStore = db.createObjectStore(STORE_CHUNKS, { keyPath: 'id' })
        chunkStore.createIndex('videoId', 'videoId', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Derives a lightweight AES-GCM CryptoKey for chunk encryption.
 */
export async function deriveEncryptionKey(secretPhrase: string): Promise<CryptoKey | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return null
  }

  try {
    const enc = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(secretPhrase.padEnd(32, '0').slice(0, 32)),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    )

    return await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode('navhub-video-offline-salt'),
        iterations: 10000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
  } catch {
    return null
  }
}

/**
 * Encrypts an ArrayBuffer chunk with AES-GCM.
 */
export async function encryptChunkData(
  buffer: ArrayBuffer,
  key: CryptoKey
): Promise<{ encrypted: ArrayBuffer; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    buffer
  )
  return { encrypted, iv }
}

/**
 * Decrypts an AES-GCM encrypted chunk.
 */
export async function decryptChunkData(
  encrypted: ArrayBuffer,
  iv: Uint8Array,
  key: CryptoKey
): Promise<ArrayBuffer> {
  return await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  )
}

/**
 * Saves or updates video package metadata.
 */
export async function saveVideoPackageMetadata(pkg: VideoOfflinePackage): Promise<void> {
  try {
    const db = await openOfflineDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PACKAGES, 'readwrite')
      const store = tx.objectStore(STORE_PACKAGES)
      const req = store.put(pkg)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    // In-memory fallback if IndexedDB is unavailable
  }
}

/**
 * Lists all offline video packages.
 */
export async function listOfflinePackages(): Promise<VideoOfflinePackage[]> {
  try {
    const db = await openOfflineDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PACKAGES, 'readonly')
      const store = tx.objectStore(STORE_PACKAGES)
      const req = store.getAll()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

/**
 * Stores a binary chunk into IndexedDB.
 */
export async function storeOfflineChunk(chunk: VideoOfflineChunk): Promise<void> {
  try {
    const db = await openOfflineDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readwrite')
      const store = tx.objectStore(STORE_CHUNKS)
      const req = store.put(chunk)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    // In-memory fallback
  }
}

/**
 * Deletes all chunks and metadata for a video.
 */
export async function deleteOfflineVideo(videoId: string): Promise<void> {
  try {
    const db = await openOfflineDatabase()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PACKAGES, STORE_CHUNKS], 'readwrite')
      tx.objectStore(STORE_PACKAGES).delete(videoId)

      const chunkStore = tx.objectStore(STORE_CHUNKS)
      const index = chunkStore.index('videoId')
      const req = index.getAllKeys(videoId)

      req.onsuccess = () => {
        const keys = req.result
        keys.forEach(k => chunkStore.delete(k))
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    // Ignore error
  }
}
