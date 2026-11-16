/**
 * 视频健康巡检的共享服务层：单页执行 + 全库循环 + 单飞互斥 + 断点检查点。
 *
 * 为什么要从 cron 路由里抽出来：原来整套“读库 → 探测 → 收集补丁 → 回写”
 * 全写在 `app/api/cron/video-health-sweep/route.ts` 里，于是三个入口
 * （外部 cron、管理端手动触发、进程内定时调度）各写一份就会漂移——此前采集
 * 链路就是这么漂移的（cron 一度是唯一不取锁的采集入口）。现在三个入口
 * 都调这里，行为只有一份。
 *
 * 写路径收敛点（源码守卫见 video-api-guards.test.ts）：
 * - 只回写三个健康字段 + 删除确认失效的条目，其余字段以最新读到的为准；
 * - 走 `mutateVideoLibrary`（带 ifVersion，冲突重放），绝不整包覆盖；
 * - 本模块不直接出现 `commitFile`：报告与检查点的落盘在 `video-metrics-store`。
 */
import { sweepVideoHealth, type ProbeResult, type SweepReport } from '@/lib/video-deadlink-sweeper'
import { type HealthSweepCoverage} from '@/lib/video-health-cursor'
import {
  hydrateVideoMetrics,
  persistHealthSweepCheckpoint,
  persistSweepReport,
  readHealthSweepCheckpoint,
  scheduleVideoMetricsPersist,
  type HealthSweepCheckpoint,
} from '@/lib/video-metrics-store'
import { mutateVideoLibrary, readVideoLibrary, type MutateOutcome } from '@/lib/video-library-store'
import { recordSweepRun } from '@/lib/video-harvest-metrics'
import type { NavigationData, NavigationSubItem, VideoConfig } from '@/types/navigation'

/** 单条条目需要回写的健康字段（其余字段一律以最新读到的数据为准） */
type HealthPatch = Partial<Pick<VideoConfig, 'healthStatus' | 'lastVerifiedAt' | 'failStreak'>>

function walkItems(
  data: NavigationData,
  visit: (item: NavigationSubItem) => void,
): void {
  for (const cat of data.navigationItems ?? []) {
    for (const item of cat.items ?? []) visit(item)
    for (const sub of cat.subCategories ?? []) {
      for (const item of sub.items ?? []) visit(item)
    }
  }
}

function collectIds(data: NavigationData): Set<string> {
  const ids = new Set<string>()
  walkItems(data, (item) => ids.add(item.id))
  return ids
}

/**
 * 收集本轮**真正探测过**的条目的健康字段。
 *
 * 判据是 `lastVerifiedAt >= since`：`sweepVideoHealth` 对每个探测过的条目
 * （healthy / dead / unverified 三种状态）都会写这个时间戳，未探测到的条目
 * 保持原值。用时间戳而不是「状态是否变化」，是因为健康的条目状态可能本来就是
 * healthy —— 只看状态差异会漏掉它们的验证时间。
 */
function collectPatches(data: NavigationData, since: number): Map<string, HealthPatch> {
  const patches = new Map<string, HealthPatch>()
  walkItems(data, (item) => {
    const config = item.videoConfig
    if (!config) return
    if (typeof config.lastVerifiedAt !== 'number' || config.lastVerifiedAt < since) return
    patches.set(item.id, {
      healthStatus: config.healthStatus,
      lastVerifiedAt: config.lastVerifiedAt,
      failStreak: config.failStreak,
    })
  })
  return patches
}

/**
 * 把健康补丁与删除集合应用到**最新**数据上。
 *
 * 为什么不能直接写 `updatedData`：那是一份基于「探测开始时读到的快照」算出来的
 * 整包文档。巡检要跑几十秒，期间采集可能已经写入新条目；整包覆盖会把它们抹掉。
 * 这里只改三个健康字段 + 删除确认失效的条目，其余字段以最新读到的为准。
 */
function applyPatches(
  latest: NavigationData,
  patches: Map<string, HealthPatch>,
  prunedIds: Set<string>,
): { next: NavigationData; applied: number; removed: number } {
  let applied = 0
  let removed = 0

  const mapItems = (items?: NavigationSubItem[]): NavigationSubItem[] | undefined => {
    if (!items) return items
    const out: NavigationSubItem[] = []
    for (const item of items) {
      if (prunedIds.has(item.id)) {
        removed++
        continue
      }
      const patch = patches.get(item.id)
      if (!patch || !item.videoConfig) {
        out.push(item)
        continue
      }
      applied++
      out.push({
        ...item,
        videoConfig: {
          ...item.videoConfig,
          ...(patch.healthStatus !== undefined ? { healthStatus: patch.healthStatus } : {}),
          ...(patch.lastVerifiedAt !== undefined ? { lastVerifiedAt: patch.lastVerifiedAt } : {}),
          ...(patch.failStreak !== undefined ? { failStreak: patch.failStreak } : {}),
        },
      })
    }
    return out
  }

  const navigationItems = (latest.navigationItems ?? []).map((cat) => {
    const items = mapItems(cat.items)
    const subCategories = cat.subCategories?.map((sub) => {
      const subItems = mapItems(sub.items)
      return subItems === sub.items ? sub : { ...sub, items: subItems }
    })
    return { ...cat, ...(items ? { items } : {}), ...(subCategories ? { subCategories } : {}) }
  })

  return { next: { ...latest, navigationItems }, applied, removed }
}

// ---------------------------------------------------------------------------
// 单飞互斥：巡检是写库长活，两个入口同时跑两轮会互相重放、重复探测同一批
// 条目。锁只在进程内生效（多副本下中枢 CAS 仍由 mutateVideoLibrary 兜底），
// 抢不到的入口返回 409 而不是静默排队——排队会让一次手动点击卡住几分钟，
// 调用方看到 409 才能立刻知道“已经有一轮在跑”。
// ---------------------------------------------------------------------------

interface RunningSweep {
  scope: string
  startedAt: number
}

let runningSweep: RunningSweep | null = null

export function getHealthSweepRunStatus(): { running: boolean; scope: string | null; startedAt: number | null } {
  return {
    running: runningSweep !== null,
    scope: runningSweep?.scope ?? null,
    startedAt: runningSweep?.startedAt ?? null,
  }
}

function tryBeginHealthSweepRun(scope: string): boolean {
  if (runningSweep) return false
  runningSweep = { scope, startedAt: Date.now() }
  return true
}

function endHealthSweepRun(): void {
  runningSweep = null
}

/** 仅供测试复位单飞锁 */
export function resetHealthSweepRunForTest(): void {
  runningSweep = null
}

// ---------------------------------------------------------------------------
// 依赖缝（默认走真实实现；测试注入内存替身，不碰中枢存储）
// ---------------------------------------------------------------------------

export interface HealthSweepDeps {
  readLibrary: () => Promise<NavigationData>
  mutateLibrary: <T>(
    mutate: (data: NavigationData) => { next: NavigationData; result: T; skip?: boolean },
    message: string,
  ) => Promise<MutateOutcome<T>>
  persistReport: (report: SweepReport) => Promise<void> | void
  persistCheckpoint: (checkpoint: HealthSweepCheckpoint) => Promise<void> | void
  readCheckpoint: () => Promise<HealthSweepCheckpoint | null>
  hydrateMetrics: () => Promise<void> | void
  scheduleMetricsPersist: () => void
}

const defaultDeps: HealthSweepDeps = {
  readLibrary: () => readVideoLibrary(),
  mutateLibrary: (mutate, message) => mutateVideoLibrary(mutate, message),
  persistReport: (report) => persistSweepReport(report),
  persistCheckpoint: (checkpoint) => persistHealthSweepCheckpoint(checkpoint),
  readCheckpoint: () => readHealthSweepCheckpoint(),
  hydrateMetrics: () => hydrateVideoMetrics(),
  scheduleMetricsPersist: () => scheduleVideoMetricsPersist(),
}

export interface HealthSweepPageOptions {
  /** 断点续扫游标；不传且 `resumeFromCheckpoint` 时自动读检查点续扫 */
  cursor?: string | null
  /** 每页探测条数（默认 100，钳在 1..500） */
  pageSize?: number
  timeoutMs?: number
  autoPrune?: boolean
  dryRun?: boolean
  /** 只探测到全 healthy 时也写回时间戳（默认只在有 dead/unverified/删除时写） */
  force?: boolean
  /** 无检查点可续时是否读检查点（默认 true；显式传 cursor 时不读） */
  resumeFromCheckpoint?: boolean
  /** 测试缝：注入 prober，不发真实网络请求 */
  prober?: (item: NavigationSubItem) => Promise<ProbeResult>
  /** 入口标记，写进运行状态与日志（'cron' | 'admin' | 'scheduler'） */
  scope?: string
}

export interface HealthSweepPageOutcome {
  success: true
  report: SweepReport
  coverage: HealthSweepCoverage
  nextCursor: string | null
  done: boolean
  persisted: boolean
  applied: number
  removed: number
  dryRun: boolean
}

export type HealthSweepPageResult =
  | HealthSweepPageOutcome
  | { success: false; busy: true; scope: string | null; startedAt: number | null }

/**
 * 扫一页（游标页大小内）。空库时直接返回 0 条的完成页：不报错、不造假。
 *
 * 续扫优先级：显式 `cursor` > 检查点（`resumeFromCheckpoint` 时）> 新开一轮。
 */
export async function runHealthSweepPage(
  options: HealthSweepPageOptions = {},
  deps: HealthSweepDeps = defaultDeps,
): Promise<HealthSweepPageResult> {
  const scope = options.scope ?? 'manual'
  if (!tryBeginHealthSweepRun(scope)) {
    const status = getHealthSweepRunStatus()
    return { success: false, busy: true, scope: status.scope, startedAt: status.startedAt }
  }

  try {
    return await runHealthSweepPageInner(options, deps)
  } catch (error) {
    recordSweepRun({ ok: false, error: error instanceof Error ? error.message : 'health sweep failed' })
    throw error
  } finally {
    endHealthSweepRun()
  }
}

async function runHealthSweepPageInner(
  options: HealthSweepPageOptions,
  deps: HealthSweepDeps,
): Promise<HealthSweepPageOutcome> {
  const dryRun = options.dryRun ?? false
  const pageSize = clampInt(options.pageSize ?? 100, 1, 500, 100)
  const timeoutMs = clampInt(options.timeoutMs ?? 3500, 500, 30000, 3500)
  const autoPrune = options.autoPrune ?? false
  const force = options.force ?? false

  let cursor = options.cursor ?? null
  if (!cursor && (options.resumeFromCheckpoint ?? true)) {
    const checkpoint = await deps.readCheckpoint().catch(() => {
      /* 断点文件缺失/损坏：从头扫，checkpoint 只是续跑优化不是必需 */
      return null
    })
    if (checkpoint && !checkpoint.done && checkpoint.cursor) cursor = checkpoint.cursor
  }

  await deps.hydrateMetrics()

  const snapshot = await deps.readLibrary()
  if (!Array.isArray(snapshot.navigationItems)) {
    throw new Error('Failed to read video library: navigationItems is not an array')
  }

  // 探测起点：用于区分「本轮验证过」与「历史验证过」
  const sweepStartedAt = Date.now()
  const { report, updatedData, nextCursor, coverage } = await sweepVideoHealth(snapshot, {
    cursor,
    pageSize,
    timeoutMs,
    autoPrune,
    prober: options.prober,
  })

  // 探测结果 → 健康补丁；autoPrune 时再算出被删掉的 id 集合
  const patches = collectPatches(snapshot, sweepStartedAt)
  const prunedIds = new Set<string>()
  if (autoPrune && (report.prunedCount ?? 0) > 0) {
    const before = collectIds(snapshot)
    const after = collectIds(updatedData)
    for (const id of before) if (!after.has(id)) prunedIds.add(id)
  }

  /**
   * 落盘条件：有状态变化才写。
   *
   * 只探测到「全是 healthy」时不写库 —— 那只会把 6MB 文档整包重写一遍，
   * 换来的仅是一批 lastVerifiedAt 时间戳。需要这些时间戳的场景（排查死链）
   * 应显式带 `force` 触发。
   */
  const shouldPersist = force || report.brokenCount > 0 || (report.unverifiedCount ?? 0) > 0 || prunedIds.size > 0

  let persisted = false
  let applied = 0
  let removed = 0
  if (!dryRun && shouldPersist && (patches.size > 0 || prunedIds.size > 0)) {
    // 走统一写入入口：带 ifVersion，冲突时重读重放（只重放字段合并，不重跑探测）
    const outcome = await deps.mutateLibrary(
      (latest) => {
        const result = applyPatches(latest, patches, prunedIds)
        return {
          next: result.next,
          result: { applied: result.applied, removed: result.removed },
          // 补丁与最新数据完全对不上（条目已被并发删除）时不写
          skip: result.applied === 0 && result.removed === 0,
        }
      },
      `chore(video): health sweep — ${report.healthyCount} healthy / ${report.brokenCount} dead / ${report.unverifiedCount ?? 0} unverified`,
    )
    // skip 也返回 ok:true（补丁与最新数据完全对不上时），所以 persisted 要看实际改动数
    persisted = outcome.ok && (outcome.result.applied > 0 || outcome.result.removed > 0)
    applied = outcome.ok ? outcome.result.applied : 0
    removed = outcome.ok ? outcome.result.removed : 0
  }

  // 断点检查点每页写一次：下一轮（或下一个 tick）从 nextCursor 续扫；
  // 空库时 coverage.done 已为 true，检查点直接记完成。
  const now = Date.now()
  await deps.persistCheckpoint({
    version: 1,
    runId: coverage.runId,
    cursor: nextCursor,
    scanned: coverage.scanned,
    total: coverage.total,
    startedAt: sweepStartedAt,
    updatedAt: now,
    done: coverage.done,
    lastHealthy: report.healthyCount,
    lastDead: report.brokenCount,
    lastUnverified: report.unverifiedCount ?? 0,
    lastPruned: report.prunedCount ?? 0,
  })

  // 报告落中枢 KV（截断摘要）：服务端 localStorage 是 no-op，不落盘的报告
  // 随 HTTP 响应消失，事后排查「上次巡检是什么时候、杀了谁」无据可查。
  void deps.persistReport(report)
  deps.scheduleMetricsPersist()

  return {
    success: true,
    report,
    coverage,
    nextCursor,
    done: coverage.done,
    persisted,
    applied,
    removed,
    dryRun,
  }
}

export interface HealthSweepFullOptions extends HealthSweepPageOptions {
  /**
   * 本轮循环的 wall-clock 预算（默认 120_000ms）。到点即停，检查点已记下
   * 断点，下一个 tick / 下一次手动触发从断点续扫，而不是从头重扫。
   */
  maxRunMs?: number
  /** 每扫完一页的回调（管理端可据此推流进度；默认无） */
  onPage?: (page: HealthSweepPageOutcome) => void
}

export interface HealthSweepFullOutcome {
  success: true
  report: SweepReport
  coverage: HealthSweepCoverage
  nextCursor: string | null
  done: boolean
  /** 本轮循环实际跑了几页 */
  pages: number
  persisted: boolean
  applied: number
  removed: number
  dryRun: boolean
}

export type HealthSweepFullResult =
  | HealthSweepFullOutcome
  | { success: false; busy: true; scope: string | null; startedAt: number | null }

/**
 * 循环扫页直到全库完成或预算到点。
 *
 * 空库：第一页即完成（total 0、done true），不报错、不循环、不造假数据。
 * 预算到点：停在当前断点，检查点已落盘，返回 `done: false` + `nextCursor`，
 * 调用方下次从断点续扫。
 */
export async function runHealthSweepToCompletion(
  options: HealthSweepFullOptions = {},
  deps: HealthSweepDeps = defaultDeps,
): Promise<HealthSweepFullResult> {
  const scope = options.scope ?? 'manual'
  if (!tryBeginHealthSweepRun(scope)) {
    const status = getHealthSweepRunStatus()
    return { success: false, busy: true, scope: status.scope, startedAt: status.startedAt }
  }

  try {
    const maxRunMs = clampInt(options.maxRunMs ?? 120_000, 10_000, 600_000, 120_000)
    const deadline = Date.now() + maxRunMs
    let cursor: string | null = options.cursor ?? null
    let pages = 0
    let applied = 0
    let removed = 0
    let persisted = false
    let lastOutcome: HealthSweepPageOutcome | null = null
    // 空库时第一页的报告就是全量报告；非空库时把各页计数累加
    let healthy = 0
    let broken = 0
    let unverified = 0
    let pruned = 0
    const brokenItems: SweepReport['brokenItems'] = []

    for (;;) {
      const page = await runHealthSweepPageInner(
        { ...options, cursor, resumeFromCheckpoint: pages === 0 },
        deps,
      )
      pages++
      applied += page.applied
      removed += page.removed
      persisted = persisted || page.persisted
      healthy += page.report.healthyCount
      broken += page.report.brokenCount
      unverified += page.report.unverifiedCount ?? 0
      pruned += page.report.prunedCount ?? 0
      brokenItems.push(...page.report.brokenItems)
      lastOutcome = page
      options.onPage?.(page)
      cursor = page.nextCursor
      if (page.done) break
      if (Date.now() >= deadline) break
    }

    const coverage = lastOutcome?.coverage ?? {
      runId: 'hs_empty',
      total: 0,
      scanned: 0,
      remaining: 0,
      done: true,
    }
    const report: SweepReport = {
      timestamp: new Date().toISOString(),
      totalScanned: coverage.scanned,
      healthyCount: healthy,
      brokenCount: broken,
      unverifiedCount: unverified,
      prunedCount: pruned,
      brokenItems,
      replacementRecords: [],
      coverage,
      nextCursor: cursor,
    }

    // 全量报告也落盘一份（单页报告已在每一页落过，这里是汇总版）
    if (!options.dryRun) {
      void deps.persistReport(report)
      deps.scheduleMetricsPersist()
    }

    return {
      success: true,
      report,
      coverage,
      nextCursor: cursor,
      done: coverage.done,
      pages,
      persisted,
      applied,
      removed,
      dryRun: options.dryRun ?? false,
    }
  } catch (error) {
    recordSweepRun({ ok: false, error: error instanceof Error ? error.message : 'health sweep failed' })
    throw error
  } finally {
    endHealthSweepRun()
  }
}

function clampInt(raw: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.floor(raw))) : fallback
}
