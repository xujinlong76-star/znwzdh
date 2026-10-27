import type { NavigationSubItem } from '@/types/navigation'

export interface VideoCacheItem {
  videoId: string
  title: string
  cachedAt: number
  sizeBytes: number
  isCompleted: boolean
  sourceUrl: string
}

export interface PrefetchCandidate {
  videoId: string
  title: string
  priority: 'high' | 'normal' | 'low'
  reason: string
  targetUrl: string
}

const CACHE_MANIFEST_KEY = 'devops_video_cache_manifest_v1'

/**
 * 离线清单的容量上限。
 *
 * 清单与**真实缓存条目**必须一起淘汰：原实现只 `slice(0, 50)` 截断清单，
 * 被挤掉的视频其 CacheStorage 响应仍留在磁盘上（清单里已看不见、却继续占配额），
 * 用户清缓存时也无从选择——这是「越用越占空间」的根因。
 */
export const MAX_CACHED_VIDEOS = 50

/** 纯函数：给定清单与上限，返回应被淘汰的条目（便于单测，不依赖 CacheStorage） */
export function selectEvicted(manifest: VideoCacheItem[], limit = MAX_CACHED_VIDEOS): VideoCacheItem[] {
  return manifest.length > limit ? manifest.slice(limit) : []
}

/**
 * Checks if CacheStorage & StorageManager APIs are accessible in current runtime.
 */
export function isStorageAvailable(): boolean {
  return typeof window !== 'undefined' && 'caches' in window && 'localStorage' in window
}

/**
 * Retrieves the local manifest of all cached video assets.
 */
export function getCachedVideosManifest(): VideoCacheItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(CACHE_MANIFEST_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * Records or updates cached chunk metadata into the offline manifest.
 */
export function recordCachedVideoItem(item: VideoCacheItem): void {
  if (typeof window === 'undefined') return
  try {
    const manifest = getCachedVideosManifest()
    const existingIdx = manifest.findIndex(m => m.videoId === item.videoId)
    if (existingIdx >= 0) {
      manifest[existingIdx] = { ...manifest[existingIdx], ...item, cachedAt: Date.now() }
    } else {
      manifest.unshift(item)
    }
    const evicted = selectEvicted(manifest)
    localStorage.setItem(CACHE_MANIFEST_KEY, JSON.stringify(manifest.slice(0, MAX_CACHED_VIDEOS)))
    // 清单与缓存条目联动淘汰：不 await，避免写清单被网络删除拖慢
    if (evicted.length > 0) void evictCachedResponses(evicted.map(e => e.videoId))
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * 删除若干视频在 CacheStorage 里的响应（与 clearVideoCache 同一套键匹配规则）。
 * 失败静默：淘汰是尽力而为，不能因为一个条目删不掉就让「记录清单」失败。
 */
async function evictCachedResponses(videoIds: string[]): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window) || videoIds.length === 0) return
  try {
    const keys = await caches.keys()
    for (const k of keys) {
      if (!k.includes('video-stream') && !k.includes('devops-videos')) continue
      if (videoIds.some(id => k.includes(id))) await caches.delete(k)
    }
  } catch {
    // 尽力而为：配额/权限异常不应冒泡到调用方
  }
}

/**
 * Clears cached assets for a specific video or all videos.
 */
export async function clearVideoCache(videoId?: string): Promise<boolean> {
  if (typeof window === 'undefined') return false
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      for (const k of keys) {
        if (k.includes('video-stream') || k.includes('devops-videos')) {
          if (!videoId || k.includes(videoId)) {
            await caches.delete(k)
          }
        }
      }
    }

    if (videoId) {
      const manifest = getCachedVideosManifest().filter(m => m.videoId !== videoId)
      localStorage.setItem(CACHE_MANIFEST_KEY, JSON.stringify(manifest))
    } else {
      localStorage.removeItem(CACHE_MANIFEST_KEY)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Calculates candidate videos to speculatively prefetch based on current video completion progress.
 */
export function calculatePrefetchQueue(params: {
  currentVideoId: string
  allVideos: NavigationSubItem[]
  watchProgressPercent: number // 0 - 100
}): PrefetchCandidate[] {
  const { currentVideoId, allVideos, watchProgressPercent } = params
  const candidates: PrefetchCandidate[] = []

  const currentIdx = allVideos.findIndex(v => v.id === currentVideoId)
  if (currentIdx < 0) return []

  // 1. Next episode in playlist has high priority if user is near end (> 75%)
  if (currentIdx < allVideos.length - 1) {
    const nextVideo = allVideos[currentIdx + 1]
    const priority = watchProgressPercent > 75 ? 'high' : 'normal'
    candidates.push({
      videoId: nextVideo.id,
      title: nextVideo.title,
      priority,
      reason: `连播预热：队列下一集 (${priority === 'high' ? '观看接近尾声' : '常规预拉取'})`,
      targetUrl: nextVideo.href || `/videos/player?id=${nextVideo.id}`,
    })
  }

  // 2. Subsequent episode has normal priority
  if (currentIdx < allVideos.length - 2) {
    const afterNext = allVideos[currentIdx + 2]
    candidates.push({
      videoId: afterNext.id,
      title: afterNext.title,
      priority: 'low',
      reason: '连播预热：后续剧集',
      targetUrl: afterNext.href || `/videos/player?id=${afterNext.id}`,
    })
  }

  return candidates
}
