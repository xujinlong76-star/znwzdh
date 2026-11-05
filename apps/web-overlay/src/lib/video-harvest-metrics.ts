/**
 * 视频采集与巡检的运行期指标（进程内）。
 *
 * 为什么需要：这两条链路原来只把结果写进各自的报告对象，跑完就没了 ——
 * 「今天采集跑了几次、失败几次、被风控挡了多少关键词、探活里有多少不可判定」
 * 这些**随时间变化的量**没有任何地方能回答。中枢有 `/metrics`（Prometheus），
 * 但 overlay 侧没有对应的出口，`/api/videos/harvest` 只回静态快照。
 *
 * 设计取舍：
 *   - **不引入依赖、不加新端点**：进程内累加 + 由既有管理端端点一并返回；
 *   - **只增不减、不做滑动窗口**：先回答「累计跑了多少」，窗口统计等有真实需求再说；
 *   - **多副本各记各的**：注释写清楚，不要让人误以为是全局计数（真正的汇总需要落库）。
 */

export interface VideoHarvestRuntimeMetrics {
  harvest: {
    /** 进入执行（不论成败）的次数 */
    runs: number
    /** 抛错次数（含版本冲突重试后仍失败） */
    failed: number
    /** 实际入库条目数 */
    added: number
    /** 实际替换条目数 */
    replaced: number
    /** 采集失败/跳过的关键词累计数（口径同报告里的 degradedKeywords） */
    degradedKeywords: number
  }
  sweep: {
    runs: number
    failed: number
    healthy: number
    dead: number
    unverified: number
    pruned: number
  }
  lastHarvestAt: number | null
  lastSweepAt: number | null
  lastError: string | null
}

const metrics: VideoHarvestRuntimeMetrics = {
  harvest: { runs: 0, failed: 0, added: 0, replaced: 0, degradedKeywords: 0 },
  sweep: { runs: 0, failed: 0, healthy: 0, dead: 0, unverified: 0, pruned: 0 },
  lastHarvestAt: null,
  lastSweepAt: null,
  lastError: null,
}

export function recordHarvestRun(result: {
  ok: boolean
  added?: number
  replaced?: number
  degradedKeywords?: number
  error?: string
}): void {
  metrics.harvest.runs++
  metrics.lastHarvestAt = Date.now()
  if (!result.ok) {
    metrics.harvest.failed++
    metrics.lastError = result.error ?? 'unknown'
    return
  }
  metrics.harvest.added += result.added ?? 0
  metrics.harvest.replaced += result.replaced ?? 0
  metrics.harvest.degradedKeywords += result.degradedKeywords ?? 0
}

export function recordSweepRun(result: {
  ok: boolean
  healthy?: number
  dead?: number
  unverified?: number
  pruned?: number
  error?: string
}): void {
  metrics.sweep.runs++
  metrics.lastSweepAt = Date.now()
  if (!result.ok) {
    metrics.sweep.failed++
    metrics.lastError = result.error ?? 'unknown'
    return
  }
  metrics.sweep.healthy += result.healthy ?? 0
  metrics.sweep.dead += result.dead ?? 0
  metrics.sweep.unverified += result.unverified ?? 0
  metrics.sweep.pruned += result.pruned ?? 0
}

/**
 * 把持久化快照并回进程内计数器（进程重启后 hydrate 用）。
 *
 * 合并取 **max** 而不是相加：计数器只增不减，重启后进程内从 0 开始，
 * max 恰好等于「接上历史累计」；若两个实例都从同一份落盘值 hydrate 再各自累加，
 * 相加会把同一段历史翻倍，max 不会。代价是实例 A 写盘后实例 B 仍在跑的窗口里
 * B 的增量可能被 A 的整包覆盖——多副本下指标本就是尽力而为的观测值，不是账本。
 */
export function mergeVideoMetrics(persisted: Partial<VideoHarvestRuntimeMetrics> | null | undefined): void {
  if (!persisted || typeof persisted !== 'object') return
  const take = (a: number | undefined, b: number | undefined): number =>
    Math.max(typeof a === 'number' && Number.isFinite(a) ? a : 0, typeof b === 'number' && Number.isFinite(b) ? b : 0)
  metrics.harvest.runs = take(metrics.harvest.runs, persisted.harvest?.runs)
  metrics.harvest.failed = take(metrics.harvest.failed, persisted.harvest?.failed)
  metrics.harvest.added = take(metrics.harvest.added, persisted.harvest?.added)
  metrics.harvest.replaced = take(metrics.harvest.replaced, persisted.harvest?.replaced)
  metrics.harvest.degradedKeywords = take(metrics.harvest.degradedKeywords, persisted.harvest?.degradedKeywords)
  metrics.sweep.runs = take(metrics.sweep.runs, persisted.sweep?.runs)
  metrics.sweep.failed = take(metrics.sweep.failed, persisted.sweep?.failed)
  metrics.sweep.healthy = take(metrics.sweep.healthy, persisted.sweep?.healthy)
  metrics.sweep.dead = take(metrics.sweep.dead, persisted.sweep?.dead)
  metrics.sweep.unverified = take(metrics.sweep.unverified, persisted.sweep?.unverified)
  metrics.sweep.pruned = take(metrics.sweep.pruned, persisted.sweep?.pruned)
  metrics.lastHarvestAt = Math.max(metrics.lastHarvestAt ?? 0, persisted.lastHarvestAt ?? 0) || null
  metrics.lastSweepAt = Math.max(metrics.lastSweepAt ?? 0, persisted.lastSweepAt ?? 0) || null
  if (!metrics.lastError && typeof persisted.lastError === 'string') {
    metrics.lastError = persisted.lastError
  }
}

/** 深拷贝快照，调用方改不动内部状态 */
export function videoMetricsSnapshot(): VideoHarvestRuntimeMetrics {
  return {
    harvest: { ...metrics.harvest },
    sweep: { ...metrics.sweep },
    lastHarvestAt: metrics.lastHarvestAt,
    lastSweepAt: metrics.lastSweepAt,
    lastError: metrics.lastError,
  }
}

/** 仅供测试重置 */
export function resetVideoMetricsForTest(): void {
  metrics.harvest = { runs: 0, failed: 0, added: 0, replaced: 0, degradedKeywords: 0 }
  metrics.sweep = { runs: 0, failed: 0, healthy: 0, dead: 0, unverified: 0, pruned: 0 }
  metrics.lastHarvestAt = null
  metrics.lastSweepAt = null
  metrics.lastError = null
}
