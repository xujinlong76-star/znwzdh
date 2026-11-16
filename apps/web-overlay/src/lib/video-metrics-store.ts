/**
 * 采集/巡检运行期指标的落盘存取（服务端专用）。
 *
 * `video-harvest-metrics.ts` 本体是**零依赖纯内存**计数器（重启清零、多副本各记各的）。
 * 这里补上持久化：重启后 hydrate 接上历史累计；计数变化后防抖写回中枢 KV。
 * 拆成独立文件的原因：`./github` 会经 auth 链拉进 next-auth，vitest 下解析失败——
 * 纯计数器不能背这个依赖（同 `video-write-guard.ts` 的取舍）。
 *
 * 写是防抖 + last-writer-wins：多副本同时写互相覆盖，观测值允许近似；
 * 读用 `readStorageFresh` 绕过缓存，合并语义见 `mergeVideoMetrics`（max）。
 */
import { commitFile, readStorageFresh } from '@/lib/github'
import { videoMetricsSnapshot, type VideoHarvestRuntimeMetrics } from '@/lib/video-harvest-metrics'

const METRICS_PATH = 'data/video-harvest-metrics.json'
const SWEEP_REPORT_PATH = 'data/video-health-sweep-latest.json'
const HEALTH_SWEEP_CHECKPOINT_PATH = 'data/video-health-sweep-checkpoint.json'

/**
 * 健康巡检断点检查点（一轮全库巡检扫到哪了）。
 *
 * 为什么必须落盘而不是只放内存：巡检是按页循环的长活，进程重启 / 函数被掐断
 * 后内存里的游标就没了，下一轮只能从头再扫——6007 条的库永远扫不完。
 * 检查点每页写一次：`done: false` + `cursor` = 下一轮从断点续扫；
 * `done: true` = 本轮已扫完全库；空库时 `total: 0, done: true`，是合法的空巡检。
 *
 * 与报告摘要一样走中枢 KV：本模块是唯一被允许出现 `commitFile` 的巡检侧模块
 * （巡检路由被源码守卫禁止直接写文件，见 video-api-guards.test.ts）。
 */
export interface HealthSweepCheckpoint {
  version: 1
  /** 本轮巡检编号（与游标里的 runId 一致） */
  runId: string
  /** 下一页的游标；扫完时为 null */
  cursor: string | null
  /** 本轮累计已扫条数 */
  scanned: number
  /** 本轮开始时全库可探测条目总数（空库为 0） */
  total: number
  startedAt: number
  updatedAt: number
  /** 本轮是否已扫完全库 */
  done: boolean
  /** 本轮累计 healthy / dead / unverified / pruned（仅供管理端展示） */
  lastHealthy?: number
  lastDead?: number
  lastUnverified?: number
  lastPruned?: number
}

export async function persistHealthSweepCheckpoint(checkpoint: HealthSweepCheckpoint): Promise<void> {
  try {
    await commitFile(
      HEALTH_SWEEP_CHECKPOINT_PATH,
      JSON.stringify({ ...checkpoint, version: 1 }, null, 2),
      'chore(video): health sweep checkpoint',
    )
  } catch {
    // 检查点写失败不中断巡检：最坏是下次从头再扫，不丢内容
  }
}

export async function readHealthSweepCheckpoint(): Promise<HealthSweepCheckpoint | null> {
  try {
    const raw = await readStorageFresh<HealthSweepCheckpoint>(HEALTH_SWEEP_CHECKPOINT_PATH)
    if (!raw || typeof raw !== 'object' || raw.version !== 1) return null
    if (typeof raw.runId !== 'string' || raw.runId.length === 0) return null
    if (typeof raw.scanned !== 'number' || typeof raw.total !== 'number') return null
    if (raw.cursor !== null && typeof raw.cursor !== 'string') return null
    if (typeof raw.done !== 'boolean') return null
    return raw
  } catch {
    return null
  }
}

/**
 * 服务端巡检报告的持久化。
 *
 * `video-deadlink-sweeper` 的报告只写 localStorage —— 它的主调用方是 cron 路由
 * （服务端），那里 localStorage 是 no-op，报告随 HTTP 响应消失，事后排查无据可查。
 * 这里把报告（截断后的摘要）写进中枢 KV，管理与排障随时可读。
 *
 * 放在本模块而不是巡检路由的原因：巡检路由被源码守卫禁止出现 `commitFile`
 * （历史事故：把站点导航整包覆盖成视频数据），IO 必须收敛在专门的存储模块里。
 */
export async function persistSweepReport(report: {
  timestamp: string
  totalScanned: number
  healthyCount: number
  brokenCount: number
  unverifiedCount?: number
  prunedCount?: number
  brokenItems: Array<{ id: string; title: string; reason: string }>
}): Promise<void> {
  // 摘要落盘：brokenItems 截到 50 条，避免报告本体随死链数量无限膨胀
  const summary = {
    version: 1,
    savedAt: Date.now(),
    ...report,
    brokenItems: (report.brokenItems || []).slice(0, 50),
    brokenItemsTruncated: Math.max(0, (report.brokenItems || []).length - 50),
  }
  try {
    await commitFile(
      SWEEP_REPORT_PATH,
      JSON.stringify(summary, null, 2),
      'chore(video): health sweep report snapshot',
    )
  } catch {
    // 报告落盘失败不影响巡检本身：本轮结果仍在 HTTP 响应里
  }
}

let hydrated = false
let persistTimer: ReturnType<typeof setTimeout> | null = null
let persisting = false

/** 进程重启后把落盘的累计值接回来（只在首次调用生效） */
export async function hydrateVideoMetrics(): Promise<void> {
  if (hydrated) return
  hydrated = true
  try {
    const persisted = await readStorageFresh<VideoHarvestRuntimeMetrics>(METRICS_PATH)
    if (persisted) {
      const { mergeVideoMetrics } = await import('@/lib/video-harvest-metrics')
      mergeVideoMetrics(persisted)
    }
  } catch {
    // 落盘不可用（首次运行 / 中枢不可达）：静默保持纯内存态
  }
}

/** 防抖写快照：高频计数变化不能每次都打中枢 */
export function scheduleVideoMetricsPersist(): void {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persistVideoMetricsNow()
  }, 800)
}

export async function persistVideoMetricsNow(): Promise<void> {
  if (persisting) return
  persisting = true
  try {
    // last-writer-wins，不带 ifVersion：观测数据不需要 CAS，写失败也不影响主流程
    await commitFile(
      METRICS_PATH,
      JSON.stringify(videoMetricsSnapshot(), null, 2),
      'chore(video): harvest runtime metrics snapshot',
    )
  } catch {
    // 只服务于「重启后还能看到历史」，写失败可容忍
  } finally {
    persisting = false
  }
}

/** 仅供测试重置 hydrate 状态 */
export function resetVideoMetricsStoreForTest(): void {
  hydrated = false
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
}
