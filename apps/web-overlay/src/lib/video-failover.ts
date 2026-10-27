import type { VideoConfig, VideoMirrorSource } from '@/types/navigation'

export interface FailoverEvent {
  videoId: string
  fromSourceId: string
  toSourceId: string
  reason: string
  timestamp: string
}

const FAILOVER_STORAGE_KEY = 'devops_video_failover_events_v1'

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage
  }
  return null
}

/**
 * Normalizes all available mirror sources for a video, including its primary configuration.
 */
export function resolveAvailableMirrors(videoConfig: VideoConfig): VideoMirrorSource[] {
  const sources: VideoMirrorSource[] = []

  // Primary source
  const primaryId = videoConfig.bvid || videoConfig.videoId || 'primary'
  sources.push({
    id: `primary-${videoConfig.type}-${primaryId}`,
    platform: videoConfig.type,
    sourceId: primaryId,
    label: videoConfig.type === 'bilibili' ? 'Bilibili 主线路' : 'YouTube 主线路',
    priority: 0,
    isDirectStream: false,
  })

  // Explicit additional mirrors
  if (Array.isArray(videoConfig.mirrors) && videoConfig.mirrors.length > 0) {
    for (const mirror of videoConfig.mirrors) {
      if (!mirror.id || !mirror.sourceId) continue
      // Avoid duplicate primary ID
      if (sources.some(s => s.id === mirror.id)) continue
      sources.push({
        id: mirror.id,
        platform: mirror.platform,
        sourceId: mirror.sourceId,
        label: mirror.label || `${mirror.platform.toUpperCase()} 备用源`,
        priority: typeof mirror.priority === 'number' ? mirror.priority : 10,
        isDirectStream: Boolean(mirror.isDirectStream),
      })
    }
  }

  // Sort by priority ascending (0 = highest priority)
  // priority 现在是可选字段（数据侧可以不填），缺失按最低优先级 10 处理
  return sources.sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10))
}

/**
 * Select the best candidate source excluding known failed source IDs.
 */
export function selectBestMirror(
  sources: VideoMirrorSource[],
  failedSourceIds: string[] = []
): VideoMirrorSource | null {
  const failedSet = new Set(failedSourceIds)
  const candidates = sources.filter(s => !failedSet.has(s.id))
  if (candidates.length === 0) {
    return sources[0] || null
  }
  return candidates[0]
}

/**
 * Lightweight probe to check if a mirror URL or endpoint is responsive.
 */
export async function probeSourceHealth(
  source: VideoMirrorSource,
  timeoutMs: number = 3000
): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
  const start = Date.now()
  try {
    // id 是线路自身标识（如 primary-bilibili-BV1xx），sourceId 才是稿件 ID；
    // 两者都可能缺一侧，这里按 sourceId -> id -> href 依次兜底，避免探测到 undefined。
    const sourceId = source.sourceId ?? source.id
    let probeUrl = ''
    if (source.platform === 'bilibili') {
      // Use media proxy or public bilibili favicon/head probe
      probeUrl = `https://www.bilibili.com/video/${sourceId}`
    } else if (source.platform === 'youtube') {
      probeUrl = `https://www.youtube.com/watch?v=${sourceId}`
    } else {
      probeUrl = source.href || sourceId
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    // Using mode: 'no-cors' in browser to test connectivity without CORS blocking
    const response = await fetch(probeUrl, {
      method: 'GET',
      mode: 'no-cors',
      signal: controller.signal,
    })
    clearTimeout(timer)

    return {
      healthy: true,
      latencyMs: Date.now() - start,
    }
  } catch (err: any) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: err?.message || 'Mirror probe timeout or network failure',
    }
  }
}

/**
 * Record a failover transition to persistent telemetry storage.
 */
export function recordMirrorFailover(
  videoId: string,
  fromSourceId: string,
  toSourceId: string,
  reason: string
): void {
  try {
    const storage = getStorage()
    if (!storage) return

    const raw = storage.getItem(FAILOVER_STORAGE_KEY)
    const logs: FailoverEvent[] = raw ? JSON.parse(raw) : []
    const newEvent: FailoverEvent = {
      videoId,
      fromSourceId,
      toSourceId,
      reason,
      timestamp: new Date().toISOString(),
    }
    logs.unshift(newEvent)
    // Keep last 100 failover events
    if (logs.length > 100) {
      logs.length = 100
    }
    storage.setItem(FAILOVER_STORAGE_KEY, JSON.stringify(logs))
  } catch {
    // Ignore storage quota/permission errors
  }
}

/**
 * Retrieve recent failover history, optionally filtered by videoId.
 */
export function getFailoverHistory(videoId?: string): FailoverEvent[] {
  try {
    const storage = getStorage()
    if (!storage) return []
    const raw = storage.getItem(FAILOVER_STORAGE_KEY)
    if (!raw) return []
    const logs: FailoverEvent[] = JSON.parse(raw)
    if (videoId) {
      return logs.filter(log => log.videoId === videoId)
    }
    return logs
  } catch {
    return []
  }
}

/**
 * Clear failover history.
 */
export function clearFailoverHistory(): void {
  try {
    const storage = getStorage()
    if (storage) {
      storage.removeItem(FAILOVER_STORAGE_KEY)
    }
  } catch {
    // Ignore
  }
}
