/**
 * 视频采集的**单一服务层入口**。
 *
 * 为什么必须收口：此前有三个采集入口（同步 POST / 异步 task POST / cron），各自
 * 对「租约锁、指标、IndexNow、自主采集周期」做了不一致的包装——cron 甚至完全不取锁、
 * 不记指标，与手动任务并行时只能靠整包写冲突重放兜底（重放 = 重跑全部上游搜索）。
 * 本文件把公共骨架收敛为一处，路由层只剩参数解析与鉴权。
 *
 * 锁的层次：
 *   1. 进程内租约（videoTaskQueue）：挡住同实例并发，零开销；
 *   2. 跨实例租约（video-harvest-lock，中枢 KV + ifVersion CAS）：挡住多副本并发，
 *      适配器不支持 CAS 或中枢不可达时自动降级为仅进程内锁（degraded 如实返回）。
 */
import { runVideoHarvestAndRotation, type HarvestRunOptions, type VideoHarvestReport } from '@/lib/video-harvester'
import { videoTaskQueue, HarvestBusyError } from '@/lib/video-task-queue'
import { acquireHarvestLease, releaseHarvestLease } from '@/lib/video-harvest-lock'
import { scheduleVideoMetricsPersist } from '@/lib/video-metrics-store'
import { mutateVideoLibrary } from '@/lib/video-library-store'
import {
  getAutonomousHarvesterController,
  type AutonomousHarvestCycleReport,
} from '@/lib/video-autonomous-ai-harvester'
import { submitUrlsToIndexNow } from '@/lib/video-seo'
import type { VideoPlatformType } from '@/types/navigation'

export { HarvestBusyError }

/** 全量采集（12 分类 × 25s 预算）最坏 ~300s，TTL 必须盖过它 */
const HARVEST_LEASE_TTL_MS = 10 * 60 * 1000
/** 自主采集周期（静态池 + 多平台检索）也在分钟级 */
const AUTONOMOUS_LEASE_TTL_MS = 10 * 60 * 1000

interface LeaseHandle {
  owner: string
  degraded: boolean
}

function newLeaseOwner(scope: string): string {
  return `${scope}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 获取双层租约；任一层拒绝都抛 `HarvestBusyError('lock_busy')`。
 * 返回的 handle 必须传回 releaseHarvestLeases。
 */
async function acquireHarvestLeases(scope: string, ttlMs: number): Promise<LeaseHandle> {
  const owner = newLeaseOwner(scope)
  const local = videoTaskQueue.acquireLock(owner, ttlMs)
  if (!local.success) {
    throw new HarvestBusyError('lock_busy', local.error ?? '已有采集任务正在执行，请稍后重试')
  }
  const remote = await acquireHarvestLease(owner, ttlMs)
  if (!remote.success) {
    videoTaskQueue.releaseLock(owner)
    throw new HarvestBusyError('lock_busy', remote.error ?? '另一实例正在执行采集，请稍后重试')
  }
  return { owner, degraded: Boolean(remote.degraded) }
}

/** 成对释放双层租约（进程内必须释放，跨实例尽力而为：TTL 兜底） */
async function releaseHarvestLeases(handle: LeaseHandle): Promise<void> {
  videoTaskQueue.releaseLock(handle.owner)
  await releaseHarvestLease(handle.owner)
}

/**
 * 策略型采集与保鲜轮换（Bilibili / Dailymotion / PeerTube / TED / YouTube）。
 *
 * 同步路由、异步任务与 cron 统一走这里，保证「互斥 + 指标 + 租约」行为一致。
 */
export async function runPolicyHarvest(
  options: HarvestRunOptions & { scope?: 'harvest_sync' | 'cron' | 'harvest_task' },
): Promise<VideoHarvestReport> {
  const { scope = 'harvest_sync', ...harvestOptions } = options
  const lease = await acquireHarvestLeases(scope, HARVEST_LEASE_TTL_MS)
  try {
    const report = await runVideoHarvestAndRotation(harvestOptions)
    scheduleVideoMetricsPersist()
    return report
  } finally {
    await releaseHarvestLeases(lease)
  }
}

export interface AutonomousCycleOutcome {
  ok: boolean
  conflict?: boolean
  attempts?: number
  report?: AutonomousHarvestCycleReport
}

/**
 * 自主采集周期（静态选题池 → 多平台检索 → 可选 IndexNow）。
 *
 * 此前 cron 与管理端各持一份逐字近似的 `mutateVideoLibrary + controller.runCycle`
 * 实现，且两条路径都**不取租约**：并发触发时各跑一轮完整周期，只靠 ifVersion
 * 冲突重放兜底，而重放 = 重跑整轮周期。现在统一在这里加双层租约。
 */
export async function runAutonomousCycle(options: {
  dryRun?: boolean
  forceCategory?: string
  includeMultiPlatform?: boolean
  autoSubmitIndexNow?: boolean
  maxAdditionsPerCycle?: number
  scope?: 'ai_autonomous' | 'cron'
}): Promise<AutonomousCycleOutcome> {
  const {
    dryRun = false,
    forceCategory,
    includeMultiPlatform = true,
    autoSubmitIndexNow = true,
    maxAdditionsPerCycle = 15,
    scope = 'ai_autonomous',
  } = options

  const lease = await acquireHarvestLeases(scope, AUTONOMOUS_LEASE_TTL_MS)
  try {
    // 单例：每次 new 会让 controller.logs（管理端的「AI 思考过程」）每轮从零开始
    const controller = getAutonomousHarvesterController()
    const outcome = await mutateVideoLibrary<{ report: AutonomousHarvestCycleReport }>(
      async (data) => {
        const { updatedData, report } = await controller.runCycle(data, {
          dryRun,
          forceCategory,
          includeMultiPlatform,
          autoSubmitIndexNow,
          maxAdditionsPerCycle,
        })
        return {
          next: updatedData,
          result: { report },
          skip: dryRun || report.newCourses.length === 0,
        }
      },
      `[${scope === 'cron' ? 'Cron AI Harvest' : 'AI Harvest'}] Automated autonomous harvest cycle`,
    )
    if (outcome.ok) scheduleVideoMetricsPersist()
    return outcome.ok
      ? { ok: true, attempts: outcome.attempts, report: outcome.result.report }
      : { ok: false, conflict: true, attempts: outcome.attempts }
  } finally {
    await releaseHarvestLeases(lease)
  }
}

export interface HarvestIndexNowResult {
  submitted: number
  error?: string
}

/**
 * 采集后的 IndexNow 集中提交（cron 与 seo-index 共用 submitUrlsToIndexNow，
 * 这里只负责把两类报告的落地页 URL 拼齐——此前 cron 与 seo-index 各写一份拼装逻辑）。
 */
export async function submitHarvestIndexNow(options: {
  siteOrigin: string
  policyReport?: VideoHarvestReport | null
  autonomousReport?: AutonomousHarvestCycleReport | null
}): Promise<HarvestIndexNowResult> {
  const { siteOrigin, policyReport, autonomousReport } = options
  const urlsToPing: string[] = [`${siteOrigin}/videos/sitemap.xml`]

  if (policyReport && policyReport.additions.length > 0) {
    for (const add of policyReport.additions) {
      urlsToPing.push(`${siteOrigin}/videos/v/${encodeURIComponent(add.item.id)}`)
    }
  }
  if (autonomousReport && autonomousReport.newCourses.length > 0) {
    for (const nc of autonomousReport.newCourses) {
      if (nc.landingUrl) urlsToPing.push(nc.landingUrl)
    }
  }

  if (urlsToPing.length <= 1) return { submitted: 0 }
  try {
    const pingResult = await submitUrlsToIndexNow(urlsToPing, { siteOrigin })
    return { submitted: pingResult.submitted, error: pingResult.error }
  } catch (err) {
    // IndexNow 是锦上添花，失败不阻断采集，但必须留痕（此前 seo-index 是纯空 catch）
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[video-harvest-service] IndexNow 提交失败:', message)
    return { submitted: 0, error: message }
  }
}

/** 供路由层钳制参数（避免任意大数字打穿预算） */
export function clampPositiveInt(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(Math.floor(n), max)
}

/** 平台清单校验：只放行注册过的平台名 */
export function sanitizePlatforms(value: unknown): VideoPlatformType[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  return value.filter((p): p is VideoPlatformType => typeof p === 'string' && p.length > 0)
}
