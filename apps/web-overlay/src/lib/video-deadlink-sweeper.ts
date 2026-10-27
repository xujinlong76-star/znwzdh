import type { NavigationData, NavigationSubItem, VideoReplacementRecord } from '@/types/navigation'
import { videoLog } from './video-log'
import { recordSweepRun } from '@/lib/video-harvest-metrics'

export const PRUNE_AFTER_CONSECUTIVE_FAILURES = 2

export interface ProbeResult {
  videoId: string
  title: string
  platform: 'bilibili' | 'youtube' | 'custom'
  healthy: boolean
  /**
   * 探活三态。
   *
   * 为什么必须有中间态：`healthy: false` 把「视频被删了」和「这次没连上」混为一谈，
   * 而下游 `autoPrune` 会据此**永久删除**条目 —— 一次网络抖动就丢内容。
   * 口径与本仓其它探活一致：只有平台明确回答「不存在」才算 dead；
   * 超时、403/429、5xx 一律 unverified（不可判定），不进删除分母。
   *
   * 该字段可选以兼容外部注入的 prober（测试里只给 healthy 布尔），
   * `sweepVideoHealth` 会按 `state ?? (healthy ? 'healthy' : 'dead')` 归一化。
   */
  state?: 'healthy' | 'dead' | 'unverified'
  statusCode?: number
  reason?: string
  latencyMs: number
}

export interface SweepReport {
  timestamp: string
  totalScanned: number
  healthyCount: number
  brokenCount: number
  unverifiedCount?: number
  prunedCount?: number
  brokenItems: Array<{ id: string; title: string; reason: string }>
  replacementRecords: VideoReplacementRecord[]
  updatedData?: NavigationData
}

const SWEEP_STORAGE_KEY = 'devops_video_sweep_report_v1'

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) return (globalThis as any).localStorage
  return null
}

/**
 * Checks single video embed/metadata status.
 */
export async function probeVideoAvailability(
  item: NavigationSubItem,
  timeoutMs: number = 4000
): Promise<ProbeResult> {
  const start = Date.now()
  const config = item.videoConfig

  if (!config) {
    return {
      videoId: item.id,
      title: item.title,
      platform: 'custom',
      healthy: true,
      latencyMs: Date.now() - start,
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    if (config.type === 'bilibili') {
      const bvid = config.bvid || config.videoId
      if (!bvid) throw new Error('Missing Bilibili BV ID')

      // Official Bilibili public view metadata API
      const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
      const resp = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.bilibili.com',
        },
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (resp.ok) {
        const json = await resp.json()
        // code 0 = normal; -404 = doesn't exist; 62002 = invisible/deleted; 62004 = under review
        if (json.code === 0) {
          return {
            videoId: item.id,
            title: item.title,
            platform: 'bilibili',
            healthy: true,
            state: 'healthy',
            statusCode: 200,
            latencyMs: Date.now() - start,
          }
        }

        // 只有平台明确回答「这条视频没了」才算 dead
        const deadCodes = new Set([-404, 62002, 62004])
        const isDead = deadCodes.has(json.code)
        return {
          videoId: item.id,
          title: item.title,
          platform: 'bilibili',
          healthy: false,
          state: isDead ? 'dead' : 'unverified',
          statusCode: json.code,
          reason: json.message || `Bilibili API error code ${json.code}`,
          latencyMs: Date.now() - start,
        }
      }

      // 404/410 = 资源不存在；403/412(风控)/429(限流)/5xx = 不可判定
      const deadHttp = resp.status === 404 || resp.status === 410
      return {
        videoId: item.id,
        title: item.title,
        platform: 'bilibili',
        healthy: false,
        state: deadHttp ? 'dead' : 'unverified',
        statusCode: resp.status,
        reason: `HTTP status ${resp.status}`,
        latencyMs: Date.now() - start,
      }
    } else if (config.type === 'youtube') {
      const videoId = config.videoId || config.bvid
      if (!videoId) throw new Error('Missing YouTube videoId')

      // YouTube oEmbed standard API
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`
      const resp = await fetch(oembedUrl, {
        method: 'GET',
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (resp.ok) {
        return {
          videoId: item.id,
          title: item.title,
          platform: 'youtube',
          healthy: true,
          state: 'healthy',
          statusCode: 200,
          latencyMs: Date.now() - start,
        }
      }

      const ytDead = resp.status === 404 || resp.status === 410
      return {
        videoId: item.id,
        title: item.title,
        platform: 'youtube',
        healthy: false,
        state: ytDead ? 'dead' : 'unverified',
        statusCode: resp.status,
        reason: ytDead ? 'YouTube video deleted or private' : `HTTP error ${resp.status}`,
        latencyMs: Date.now() - start,
      }
    } else {
      clearTimeout(timer)
      return {
        videoId: item.id,
        title: item.title,
        platform: 'custom',
        healthy: true,
        state: 'healthy',
        latencyMs: Date.now() - start,
      }
    }
  } catch (err: any) {
    clearTimeout(timer)
    // 超时 / 连接失败 / 证书错误：无法判定，不是「已失效」
    return {
      videoId: item.id,
      title: item.title,
      platform: config.type || 'custom',
      healthy: false,
      state: 'unverified',
      reason: err?.name === 'AbortError'
        ? '探测超时，未能在时限内确认状态'
        : '网络错误，未能确认状态',
      latencyMs: Date.now() - start,
    }
  }
}

/**
 * Sweeps video catalog for dead assets, marks health status, and optionally auto-prunes invalid items.
 *
 * 返回值是 `{ report, updatedData }`（历史声明的 `Promise<SweepReport>` 与实现不符，
 * 靠 `ignoreBuildErrors` 一直没暴露）。
 */
export async function sweepVideoHealth(
  navigationData: NavigationData,
  options?: {
    maxItemsToCheck?: number
    timeoutMs?: number
    prober?: (item: NavigationSubItem) => Promise<ProbeResult>
    autoPrune?: boolean
    /** 同时在飞的探测数（默认 6）。串行 30 条 × 3.5s 最坏 105s，必然撞函数超时。 */
    concurrency?: number
  }
): Promise<{ report: SweepReport; updatedData: NavigationData }> {
  const maxItems = options?.maxItemsToCheck || 50
  const timeoutMs = options?.timeoutMs || 4000
  // 默认不删：删除是不可逆操作，必须显式开启（并有回滚记录）
  const autoPrune = options?.autoPrune ?? false
  const concurrency = Math.max(1, Math.min(options?.concurrency ?? 6, 10))
  const prober = options?.prober || ((item) => probeVideoAvailability(item, timeoutMs))

  const allItems: NavigationSubItem[] = []
  for (const cat of navigationData.navigationItems) {
    if (cat.items) allItems.push(...cat.items)
    if (cat.subCategories) {
      for (const sub of cat.subCategories) {
        if (sub.items) allItems.push(...sub.items)
      }
    }
  }

  const videoItems = allItems.filter(i => Boolean(i.videoConfig)).slice(0, maxItems)

  let healthyCount = 0
  let brokenCount = 0
  let unverifiedCount = 0
  const brokenItems: Array<{ id: string; title: string; reason: string }> = []
  const replacementRecords: VideoReplacementRecord[] = []
  const brokenIds = new Set<string>()

  /**
   * 有界并发探测。
   *
   * 原实现是 `for (const item of videoItems) { await prober(item) }`：30 条 × 3.5s
   * 超时 = 最坏 105 秒，直接超过多数 Serverless 函数上限，导致「巡检跑一半被掐断、
   * 状态只落了一部分」。并发 6 后同样的量级压到 ~20s 以内。
   *
   * 计数器与 Set 的读写在 `await` 之后都是同步块，JS 单线程下不需要额外加锁。
   */
  const queue = [...videoItems]
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (;;) {
      const item = queue.shift()
      if (!item) return

      const result = await prober(item)
      // 兼容只给 healthy 布尔的外部 prober
      const state: 'healthy' | 'dead' | 'unverified' = result.state ?? (result.healthy ? 'healthy' : 'dead')

      if (state === 'healthy') {
        healthyCount++
        if (item.videoConfig) {
          item.videoConfig.healthStatus = 'healthy'
          item.videoConfig.lastVerifiedAt = Date.now()
          // 恢复健康即清零：中间偶发一次失败不该累积到「下次直接删」
          item.videoConfig.failStreak = 0
        }
        continue
      }

      if (state === 'unverified') {
        unverifiedCount++
        // 只标记「没能确认」，绝不进删除候选
        if (item.videoConfig) {
          item.videoConfig.healthStatus = 'unverified'
          item.videoConfig.lastVerifiedAt = Date.now()
        }
        continue
      }

      brokenCount++
      const streak = (item.videoConfig?.failStreak ?? 0) + 1
      // 首次失败只标记不删；连续失败达到阈值才进删除候选
      if (streak >= PRUNE_AFTER_CONSECUTIVE_FAILURES) brokenIds.add(item.id)
      brokenItems.push({
        id: item.id,
        title: item.title,
        reason: result.reason || '平台确认该视频已不存在',
      })
      if (item.videoConfig) {
        item.videoConfig.healthStatus = 'broken'
        item.videoConfig.lastVerifiedAt = Date.now()
        item.videoConfig.failStreak = (item.videoConfig.failStreak ?? 0) + 1
      }
    }
  })
  await Promise.all(workers)

  let prunedCount = 0
  let updatedCategories = navigationData.navigationItems

  // 结构化落一条：这一轮探测了多少、多少健康/失败、准备删几条
  videoLog('probe', {
    count: videoItems.length,
    healthy: healthyCount,
    broken: brokenCount,
    unverified: unverifiedCount,
    pruneCandidates: brokenIds.size,
    threshold: PRUNE_AFTER_CONSECUTIVE_FAILURES,
  })

  if (autoPrune && brokenIds.size > 0) {
    updatedCategories = navigationData.navigationItems.map(cat => {
      const filteredItems = (cat.items || []).filter(item => {
        if (brokenIds.has(item.id)) {
          prunedCount++
          return false
        }
        return true
      })

      const filteredSub = (cat.subCategories || []).map(sub => ({
        ...sub,
        items: (sub.items || []).filter(item => {
          if (brokenIds.has(item.id)) {
            prunedCount++
            return false
          }
          return true
        })
      }))

      return {
        ...cat,
        items: filteredItems,
        subCategories: filteredSub
      }
    })
  }

  const updatedNavData: NavigationData = {
    ...navigationData,
    navigationItems: updatedCategories
  }

  const report: SweepReport = {
    timestamp: new Date().toISOString(),
    totalScanned: videoItems.length,
    healthyCount,
    brokenCount,
    unverifiedCount,
    prunedCount,
    brokenItems,
    replacementRecords,
    updatedData: updatedNavData,
  }

  try {
    const storage = getStorage()
    if (storage) {
      storage.setItem(SWEEP_STORAGE_KEY, JSON.stringify(report))
    }
  } catch {
    // Ignore storage quota
  }

  recordSweepRun({
    ok: true,
    healthy: healthyCount,
    dead: brokenCount,
    unverified: unverifiedCount,
    pruned: prunedCount,
  })

  return { report, updatedData: updatedNavData }
}

/**
 * Retrieves the latest video health sweep report.
 */
export function getLatestSweepReport(): SweepReport | null {
  try {
    const storage = getStorage()
    if (!storage) return null
    const raw = storage.getItem(SWEEP_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
