/**
 * 事件循环阻塞看门狗（2026-11-20 服务器挂死定位用）。
 *
 * 覆盖：配置解析（默认值 / 环境变量覆盖 / 钳制）、禁用、幂等启动、
 * 以及最关键的一条——真实同步阻塞能被检测到（忙循环 250ms，阈值 100ms）。
 */
import { describe, expect, it, afterEach } from 'vitest'
import {
  readEventLoopWatchdogConfig,
  startEventLoopWatchdog,
  stopEventLoopWatchdog,
  getEventLoopWatchdogStatus,
  resetEventLoopWatchdogForTest,
  DEFAULT_EVENT_LOOP_WATCHDOG,
} from '@/lib/event-loop-watchdog'

afterEach(() => {
  resetEventLoopWatchdogForTest()
})

describe('事件循环看门狗配置', () => {
  it('默认配置：开启、间隔 1s、阈值 5s、上限 10 次', () => {
    const cfg = readEventLoopWatchdogConfig({})
    expect(cfg.enabled).toBe(true)
    expect(cfg.intervalMs).toBe(DEFAULT_EVENT_LOOP_WATCHDOG.intervalMs)
    expect(cfg.thresholdMs).toBe(DEFAULT_EVENT_LOOP_WATCHDOG.thresholdMs)
    expect(cfg.maxReports).toBe(DEFAULT_EVENT_LOOP_WATCHDOG.maxReports)
  })

  it('环境变量可覆盖全部四项，非法值回落默认', () => {
    const cfg = readEventLoopWatchdogConfig({
      EVENT_LOOP_WATCHDOG_ENABLED: 'false',
      EVENT_LOOP_WATCHDOG_INTERVAL_MS: '200',
      EVENT_LOOP_WATCHDOG_THRESHOLD_MS: '2000',
      EVENT_LOOP_WATCHDOG_MAX_REPORTS: '3',
    })
    expect(cfg.enabled).toBe(false)
    expect(cfg.intervalMs).toBe(200)
    expect(cfg.thresholdMs).toBe(2000)
    expect(cfg.maxReports).toBe(3)

    const bad = readEventLoopWatchdogConfig({
      EVENT_LOOP_WATCHDOG_INTERVAL_MS: 'not-a-number',
      EVENT_LOOP_WATCHDOG_THRESHOLD_MS: '',
    })
    expect(bad.intervalMs).toBe(DEFAULT_EVENT_LOOP_WATCHDOG.intervalMs)
    expect(bad.thresholdMs).toBe(DEFAULT_EVENT_LOOP_WATCHDOG.thresholdMs)
  })

  it('钳制：间隔 100..10000ms、阈值 1000..60000ms、上限 1..1000', () => {
    const cfg = readEventLoopWatchdogConfig({
      EVENT_LOOP_WATCHDOG_INTERVAL_MS: '1',
      EVENT_LOOP_WATCHDOG_THRESHOLD_MS: '999999',
      EVENT_LOOP_WATCHDOG_MAX_REPORTS: '0',
    })
    expect(cfg.intervalMs).toBe(100)
    expect(cfg.thresholdMs).toBe(60000)
    expect(cfg.maxReports).toBe(1)
  })
})

describe('事件循环看门狗启动', () => {
  it('禁用时不启动并返回 reason', () => {
    const r = startEventLoopWatchdog({ config: { ...DEFAULT_EVENT_LOOP_WATCHDOG, enabled: false } })
    expect(r.started).toBe(false)
    expect(r.reason).toBe('disabled')
    expect(getEventLoopWatchdogStatus().started).toBe(false)
  })

  it('重复启动幂等：只挂一个定时器', () => {
    const first = startEventLoopWatchdog({ config: { ...DEFAULT_EVENT_LOOP_WATCHDOG, intervalMs: 1000, thresholdMs: 5000 } })
    const second = startEventLoopWatchdog({ config: { ...DEFAULT_EVENT_LOOP_WATCHDOG, intervalMs: 1000, thresholdMs: 5000 } })
    expect(first.started).toBe(true)
    expect(second.started).toBe(true)
    expect(getEventLoopWatchdogStatus().started).toBe(true)
    stopEventLoopWatchdog()
    expect(getEventLoopWatchdogStatus().started).toBe(false)
  })

  it('真实同步阻塞能被检测到（忙循环 250ms，阈值 100ms）', async () => {
    const blocks: Array<{ lagMs: number; at: number }> = []
    startEventLoopWatchdog({
      config: { enabled: true, intervalMs: 50, thresholdMs: 100, maxReports: 10 },
      onBlock: (lagMs, at) => {
        blocks.push({ lagMs, at })
      },
    })
    // 先让一个 tick 正常跑过，建立 last 基准
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(blocks.length).toBe(0)
    // 同步堵住事件循环 250ms（模拟挂死时的单线程空转）
    const until = Date.now() + 250
    while (Date.now() < until) {
      // 忙循环：故意不让出事件循环
    }
    // 等看门狗下一个 tick 上报
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    expect(blocks[0].lagMs).toBeGreaterThanOrEqual(100)
    const status = getEventLoopWatchdogStatus()
    expect(status.blocksDetected).toBeGreaterThanOrEqual(1)
    expect(status.lastBlockMs).not.toBeNull()
    expect(status.lastBlockAt).not.toBeNull()
  }, 10000)
})
