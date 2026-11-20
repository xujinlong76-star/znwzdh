/**
 * 事件循环阻塞看门狗（生产服务器挂死定位用）。
 *
 * 背景：2026-11-20 电脑 :3001/:3002 生产服务器三次挂死，特征是单线程 JS 空转
 * （一个线程 100% CPU、其余线程等待、内存稳定、无出站连接、HTTP 000）。
 * VideoHealthScheduler 已被 A/B 对照实验证伪为直接原因（sweep 跑完 6014/6014
 * 也不挂死），真凶是间歇性的、未命名的同步循环。事后复盘拿不到 JS 栈
 * （Windows 上 process._debugProcess 不可用，SIGUSR1 无实现），所以必须在
 * 进程内留一个哨兵：事件循环一旦被堵住超过阈值，立刻把“堵了多久 + 当时内存”
 * 写进服务器日志，下次挂死直接按时间戳去对请求日志，就能定位触发点。
 *
 * 原理：每 intervalMs 用 setInterval 记一次时间戳；下次 tick 时算漂移
 * lag = now - last - intervalMs。事件循环畅通时 lag ≈ 0；被同步循环堵住时
 * tick 被推迟，lag 就是被堵的时长。只检测、不中断、不杀进程、不碰业务。
 *
 * 配置走环境变量（与 VIDEO_HEALTH_SWEEP_* 同一口径）：
 * - `EVENT_LOOP_WATCHDOG_ENABLED`：`false` 关闭（默认开启）
 * - `EVENT_LOOP_WATCHDOG_INTERVAL_MS`：检测间隔，默认 1000（钳在 100..10000）
 * - `EVENT_LOOP_WATCHDOG_THRESHOLD_MS`：上报阈值，默认 5000（钳在 1000..60000）
 * - `EVENT_LOOP_WATCHDOG_MAX_REPORTS`：单进程最多上报次数，默认 10（防刷屏）
 */

export interface EventLoopWatchdogConfig {
  enabled: boolean
  intervalMs: number
  thresholdMs: number
  maxReports: number
}

export const DEFAULT_EVENT_LOOP_WATCHDOG: EventLoopWatchdogConfig = {
  enabled: true,
  intervalMs: 1000,
  thresholdMs: 5000,
  maxReports: 10,
}

function clampInt(raw: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.floor(raw))) : fallback
}

function parseMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/** 从环境变量读出生效配置（显式传 env 便于测试；默认读 process.env）。
 * 参数用 Record 而不用 NodeJS.ProcessEnv：测试里传字面量对象时，
 * 字面量没有 ProcessEnv 的索引签名，TS2345 报错；Record 则两者都接受。 */
export function readEventLoopWatchdogConfig(env: Record<string, string | undefined> = process.env): EventLoopWatchdogConfig {
  const enabledRaw = (env.EVENT_LOOP_WATCHDOG_ENABLED ?? '').trim().toLowerCase()
  return {
    enabled: enabledRaw === '' ? true : enabledRaw !== 'false' && enabledRaw !== '0' && enabledRaw !== 'no',
    intervalMs: clampInt(
      parseMs(env.EVENT_LOOP_WATCHDOG_INTERVAL_MS, DEFAULT_EVENT_LOOP_WATCHDOG.intervalMs),
      100,
      10000,
      DEFAULT_EVENT_LOOP_WATCHDOG.intervalMs,
    ),
    thresholdMs: clampInt(
      parseMs(env.EVENT_LOOP_WATCHDOG_THRESHOLD_MS, DEFAULT_EVENT_LOOP_WATCHDOG.thresholdMs),
      1000,
      60000,
      DEFAULT_EVENT_LOOP_WATCHDOG.thresholdMs,
    ),
    maxReports: clampInt(
      parseMs(env.EVENT_LOOP_WATCHDOG_MAX_REPORTS, DEFAULT_EVENT_LOOP_WATCHDOG.maxReports),
      1,
      1000,
      DEFAULT_EVENT_LOOP_WATCHDOG.maxReports,
    ),
  }
}

export interface EventLoopWatchdogStatus {
  started: boolean
  enabled: boolean
  intervalMs: number
  thresholdMs: number
  blocksDetected: number
  lastBlockMs: number | null
  lastBlockAt: number | null
}

let started = false
let config: EventLoopWatchdogConfig | null = null
let timer: ReturnType<typeof setInterval> | null = null
let blocksDetected = 0
let lastBlockMs: number | null = null
let lastBlockAt: number | null = null
let reportsSent = 0

export function getEventLoopWatchdogStatus(): EventLoopWatchdogStatus {
  const effective = config ?? readEventLoopWatchdogConfig()
  return {
    started,
    enabled: effective.enabled,
    intervalMs: effective.intervalMs,
    thresholdMs: effective.thresholdMs,
    blocksDetected,
    lastBlockMs,
    lastBlockAt,
  }
}

/**
 * 启动看门狗。幂等：重复调用直接返回已启动状态，不会多挂一个定时器。
 * 定时器 unref，不阻止进程退出。
 */
export function startEventLoopWatchdog(options?: {
  config?: EventLoopWatchdogConfig
  onBlock?: (lagMs: number, at: number) => void
}): { started: boolean; reason?: string } {
  if (started) return { started: true }
  const effective = options?.config ?? readEventLoopWatchdogConfig()
  config = effective
  if (!effective.enabled) {
    console.warn('[EventLoopWatchdog] 已禁用（EVENT_LOOP_WATCHDOG_ENABLED=false），阻塞不会上报')
    return { started: false, reason: 'disabled' }
  }

  const onBlock = options?.onBlock
  let last = Date.now()
  timer = setInterval(() => {
    const now = Date.now()
    const lag = now - last - effective.intervalMs
    last = now
    if (lag <= effective.thresholdMs) return
    blocksDetected++
    lastBlockMs = lag
    lastBlockAt = now
    if (reportsSent >= effective.maxReports) return
    reportsSent++
    const mem = process.memoryUsage()
    console.error(
      `[EventLoopWatchdog] 事件循环阻塞 ${lag}ms（阈值 ${effective.thresholdMs}ms，` +
        `约在 ${new Date(now - lag).toISOString()} 开始，` +
        `heapUsed ${(mem.heapUsed / 1048576).toFixed(1)}MB/rss ${(mem.rss / 1048576).toFixed(1)}MB，` +
        `本进程第 ${blocksDetected} 次）。若随后 HTTP 无响应，` +
        `请按该开始时间去对请求日志定位触发点。`,
    )
    onBlock?.(lag, now)
  }, effective.intervalMs)
  timer.unref?.()

  started = true
  console.warn(
    `[EventLoopWatchdog] 已启动：每 ${effective.intervalMs}ms 检测一次，` +
      `阻塞超 ${effective.thresholdMs}ms 即上报（单进程最多 ${effective.maxReports} 次）`,
  )
  return { started: true }
}

/** 停掉看门狗（测试与进程关闭时用；生产不调） */
export function stopEventLoopWatchdog(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  started = false
  config = null
}

/** 仅供测试复位状态 */
export function resetEventLoopWatchdogForTest(): void {
  stopEventLoopWatchdog()
  blocksDetected = 0
  lastBlockMs = null
  lastBlockAt = null
  reportsSent = 0
}
