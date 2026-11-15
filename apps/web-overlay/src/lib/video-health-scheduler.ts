/**
 * 视频健康巡检的进程内定时调度。
 *
 * 背景：巡检 cron 端点（`/api/cron/video-health-sweep`）一直存在，但没有任何东西
 * 定期调它——仓库里没有 vercel.json、没有系统 crontab 接入，部署形态是 Docker
 * 自托管（见根目录 `docker-compose.yml`），Vercel Cron 并不适用。于是“有巡检
 * 能力、从不巡检”。
 *
 * 本调度器在 Next.js 服务进程启动时（`src/instrumentation.ts` 的 `register()`，
 * 仅生产环境 + nodejs runtime）启动一个真实的定时器：
 * - 首轮在启动后 `initialDelayMs`（默认 60s）触发一次，随后每 `intervalMs`
 *   （默认 6h）触发一次；
 * - 每一轮都调 `runHealthSweepToCompletion`：按页扫完全库，预算到点即停，
 *   断点写进检查点，下一轮从断点续扫——调度本身保证“最终扫完全库”，
 *   而不是每轮都只扫前 N 条；
 * - 单飞：上一轮还没跑完时跳过本次 tick（不叠加、不排队），状态可查。
 *
 * 配置全部走环境变量（与 `NAVHUB_HEALTH_POOL` 等既有运维变量同一口径），
 * 生效值由管理端 `GET /api/videos/health-sweep` 原样返回，方便核对
 * “到底配成了什么”而不是凭印象。
 *
 * 环境变量：
 * - `VIDEO_HEALTH_SWEEP_ENABLED`：`false` 关闭（默认开启）
 * - `VIDEO_HEALTH_SWEEP_INTERVAL_MS`：巡检间隔，默认 6h（钳在 5 分钟..7 天）
 * - `VIDEO_HEALTH_SWEEP_INITIAL_DELAY_MS`：启动后首轮延迟，默认 60s（钳在 0..1h）
 * - `VIDEO_HEALTH_SWEEP_PAGE_SIZE`：每页条数，默认 100（钳在 10..500）
 * - `VIDEO_HEALTH_SWEEP_TICK_BUDGET_MS`：每轮 wall-clock 预算，默认 20 分钟
 *   （钳在 1 分钟..2 小时）；到点即停，断点续扫
 * - `VIDEO_HEALTH_SWEEP_TIMEOUT_MS`：单条探测超时，默认 3500（钳在 500..30000）
 * - `VIDEO_HEALTH_SWEEP_AUTO_PRUNE`：`true` 才自动删除确认失效的条目（默认 false）
 */
import { runHealthSweepToCompletion, type HealthSweepFullResult } from '@/lib/video-health-sweep-service'
import { getHealthSweepRunStatus } from '@/lib/video-health-sweep-service'

export interface VideoHealthScheduleConfig {
  enabled: boolean
  intervalMs: number
  initialDelayMs: number
  pageSize: number
  tickBudgetMs: number
  timeoutMs: number
  autoPrune: boolean
}

export const DEFAULT_VIDEO_HEALTH_SCHEDULE: VideoHealthScheduleConfig = {
  enabled: true,
  intervalMs: 6 * 60 * 60 * 1000,
  initialDelayMs: 60 * 1000,
  pageSize: 100,
  tickBudgetMs: 20 * 60 * 1000,
  timeoutMs: 3500,
  autoPrune: false,
}

function clampInt(raw: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.floor(raw))) : fallback
}

function parseMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/** 从环境变量读出生效配置（显式传 env 便于测试；默认读 process.env） */
export function readVideoHealthScheduleConfig(env: NodeJS.ProcessEnv = process.env): VideoHealthScheduleConfig {
  const enabledRaw = (env.VIDEO_HEALTH_SWEEP_ENABLED ?? '').trim().toLowerCase()
  return {
    enabled: enabledRaw === '' ? true : enabledRaw !== 'false' && enabledRaw !== '0' && enabledRaw !== 'no',
    intervalMs: clampInt(
      parseMs(env.VIDEO_HEALTH_SWEEP_INTERVAL_MS, DEFAULT_VIDEO_HEALTH_SCHEDULE.intervalMs),
      5 * 60 * 1000,
      7 * 24 * 60 * 60 * 1000,
      DEFAULT_VIDEO_HEALTH_SCHEDULE.intervalMs,
    ),
    initialDelayMs: clampInt(
      parseMs(env.VIDEO_HEALTH_SWEEP_INITIAL_DELAY_MS, DEFAULT_VIDEO_HEALTH_SCHEDULE.initialDelayMs),
      0,
      60 * 60 * 1000,
      DEFAULT_VIDEO_HEALTH_SCHEDULE.initialDelayMs,
    ),
    pageSize: clampInt(
      parseMs(env.VIDEO_HEALTH_SWEEP_PAGE_SIZE, DEFAULT_VIDEO_HEALTH_SCHEDULE.pageSize),
      10,
      500,
      DEFAULT_VIDEO_HEALTH_SCHEDULE.pageSize,
    ),
    tickBudgetMs: clampInt(
      parseMs(env.VIDEO_HEALTH_SWEEP_TICK_BUDGET_MS, DEFAULT_VIDEO_HEALTH_SCHEDULE.tickBudgetMs),
      60 * 1000,
      2 * 60 * 60 * 1000,
      DEFAULT_VIDEO_HEALTH_SCHEDULE.tickBudgetMs,
    ),
    timeoutMs: clampInt(
      parseMs(env.VIDEO_HEALTH_SWEEP_TIMEOUT_MS, DEFAULT_VIDEO_HEALTH_SCHEDULE.timeoutMs),
      500,
      30000,
      DEFAULT_VIDEO_HEALTH_SCHEDULE.timeoutMs,
    ),
    autoPrune: (env.VIDEO_HEALTH_SWEEP_AUTO_PRUNE ?? '').trim().toLowerCase() === 'true',
  }
}

export type HealthSweepRunner = (config: VideoHealthScheduleConfig) => Promise<HealthSweepFullResult>

async function defaultRunner(config: VideoHealthScheduleConfig): Promise<HealthSweepFullResult> {
  return runHealthSweepToCompletion({
    pageSize: config.pageSize,
    timeoutMs: config.timeoutMs,
    autoPrune: config.autoPrune,
    maxRunMs: config.tickBudgetMs,
    resumeFromCheckpoint: true,
    scope: 'scheduler',
  })
}

export interface VideoHealthSchedulerStatus {
  started: boolean
  enabled: boolean
  intervalMs: number
  nextRunAt: number | null
  lastRunAt: number | null
  lastOutcome: string | null
  running: boolean
}

let started = false
let config: VideoHealthScheduleConfig | null = null
let initialTimer: ReturnType<typeof setTimeout> | null = null
let intervalTimer: ReturnType<typeof setInterval> | null = null
let nextRunAt: number | null = null
let lastRunAt: number | null = null
let lastOutcome: string | null = null
/** 本调度器自己上一轮 runner 是否还在跑（注入式 runner 不经过服务层单飞锁时也生效） */
let tickInFlight = false

export function getVideoHealthSchedulerStatus(): VideoHealthSchedulerStatus {
  const effective = config ?? readVideoHealthScheduleConfig()
  return {
    started,
    enabled: effective.enabled,
    intervalMs: effective.intervalMs,
    nextRunAt,
    lastRunAt,
    lastOutcome,
    running: tickInFlight || getHealthSweepRunStatus().running,
  }
}

/**
 * 启动调度器。幂等：重复调用直接返回已启动状态，不会多挂一个定时器。
 *
 * `runner` 是测试缝：默认调真实的 `runHealthSweepToCompletion`；测试注入
 * 计数型替身，验证“定时器真的触发了执行”而不是只挂了个 timer。
 */
export function startVideoHealthScheduler(options?: {
  config?: VideoHealthScheduleConfig
  runner?: HealthSweepRunner
}): { started: boolean; reason?: string } {
  if (started) return { started: true }
  const effective = options?.config ?? readVideoHealthScheduleConfig()
  config = effective
  if (!effective.enabled) {
    console.warn('[VideoHealthScheduler] 已禁用（VIDEO_HEALTH_SWEEP_ENABLED=false），巡检不会自动运行')
    return { started: false, reason: 'disabled' }
  }

  const runner = options?.runner ?? defaultRunner

  const tick = () => {
    if (tickInFlight || getHealthSweepRunStatus().running) {
      console.warn('[VideoHealthScheduler] 上一轮巡检尚未结束，跳过本次 tick')
      return
    }
    nextRunAt = Date.now() + effective.intervalMs
    lastRunAt = Date.now()
    tickInFlight = true
    void runner(effective)
      .then((result) => {
        if (!result.success) {
          // 单飞锁被占（tick 前的检查与加锁之间被别的入口抢先）：跳过，不算失败
          lastOutcome = `跳过：已有巡检在跑（scope=${result.scope ?? 'unknown'}）`
          console.warn(`[VideoHealthScheduler] ${lastOutcome}`)
          return
        }
        lastOutcome = result.done
          ? `完成：${result.coverage.scanned}/${result.coverage.total} 条，${result.pages} 页`
          : `未完成（预算到点）：${result.coverage.scanned}/${result.coverage.total} 条，下轮续扫`
        console.warn(`[VideoHealthScheduler] ${lastOutcome}`)
      })
      .catch((error: unknown) => {
        lastOutcome = `失败：${error instanceof Error ? error.message : String(error)}`
        console.error('[VideoHealthScheduler] 巡检失败（下一轮照常触发）:', error)
      })
      .finally(() => {
        tickInFlight = false
      })
  }

  const firstAt = Date.now() + effective.initialDelayMs
  nextRunAt = firstAt
  initialTimer = setTimeout(() => {
    initialTimer = null
    tick()
    intervalTimer = setInterval(tick, effective.intervalMs)
    intervalTimer.unref?.()
  }, effective.initialDelayMs)
  initialTimer.unref?.()

  started = true
  console.warn(
    `[VideoHealthScheduler] 已启动：每 ${Math.round(effective.intervalMs / 60000)} 分钟巡检一次，` +
      `首轮在 ${Math.round(effective.initialDelayMs / 1000)}s 后，每页 ${effective.pageSize} 条，每轮预算 ${Math.round(effective.tickBudgetMs / 60000)} 分钟`,
  )
  return { started: true }
}

/** 停掉调度器（测试与进程关闭时用；生产不调） */
export function stopVideoHealthScheduler(): void {
  if (initialTimer) {
    clearTimeout(initialTimer)
    initialTimer = null
  }
  if (intervalTimer) {
    clearInterval(intervalTimer)
    intervalTimer = null
  }
  started = false
  config = null
  nextRunAt = null
}

/** 仅供测试复位状态 */
export function resetVideoHealthSchedulerForTest(): void {
  stopVideoHealthScheduler()
  lastRunAt = null
  lastOutcome = null
  tickInFlight = false
}
