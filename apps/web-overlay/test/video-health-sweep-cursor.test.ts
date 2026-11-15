import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 服务层默认依赖经 video-metrics-store / video-library-store 拉进 `@/lib/github`，
// 而 github.ts 静态 import 缺失的 `@/navsphere/content/site.json`（且经 auth 链
// 拉进 next-auth），vitest 下无法加载——与 video-evolution-suite 等文件同款处理：
// 只 mock 掉存储后端。本文件用例全部注入内存 deps，mock 从不被真实调用。
vi.mock('@/lib/github', () => ({
  getFileContent: vi.fn(),
  commitFile: vi.fn(),
  readStorageFresh: vi.fn().mockResolvedValue(null),
  getStorageVersion: vi.fn().mockResolvedValue(null),
}))

// mock-hygiene：本文件对 `@/lib/github` 做了跨模块 mock，每个用例后重置模块
// 注册表，否则同进程的其它测试文件会拿到被 mock 过的版本（isolate:false 的前置要求）。
afterEach(() => {
  vi.resetModules()
})
import { sweepVideoHealth, type ProbeResult } from '../src/lib/video-deadlink-sweeper'
import {
  decodeHealthCursor,
  encodeHealthCursor,
  pageVideoItems,
  resolveHealthCursorStart,
  flattenVideoItems,
} from '../src/lib/video-health-cursor'
import {
  runHealthSweepPage,
  runHealthSweepToCompletion,
  resetHealthSweepRunForTest,
  type HealthSweepDeps,
  type HealthSweepFullOutcome,
} from '../src/lib/video-health-sweep-service'
import {
  getVideoHealthSchedulerStatus,
  readVideoHealthScheduleConfig,
  resetVideoHealthSchedulerForTest,
  startVideoHealthScheduler,
  type VideoHealthScheduleConfig,
} from '../src/lib/video-health-scheduler'
import type { NavigationData, NavigationSubItem } from '../src/types/navigation'

/**
 * 回归：健康检查必须扫完全库（游标分页 + 断点续扫），且要有真实生效的调度。
 *
 * 旧实现是 `slice(0, maxItems)`（路由默认 30、上限 500）：6007 条的库永远只扫
 * 前几十条；也没有任何调度——cron 端点存在，但没有任何东西定期调它。
 */

function videoItem(id: string): NavigationSubItem {
  return {
    id,
    title: `视频 ${id}`,
    href: `https://www.bilibili.com/video/${id}`,
    enabled: true,
    videoConfig: { type: 'bilibili', bvid: id, healthStatus: 'healthy' },
  } as NavigationSubItem
}

function navData(items: NavigationSubItem[]): NavigationData {
  return {
    navigationItems: [{ id: 'cat1', title: '分类一', enabled: true, items, subCategories: [] }],
  } as NavigationData
}

/** 记录被探测 id 的健康 prober（不发真实网络请求） */
function recordingProber(seen: string[], state: 'healthy' | 'unverified' = 'healthy') {
  return async (item: NavigationSubItem): Promise<ProbeResult> => {
    seen.push(item.id)
    return {
      videoId: item.id,
      title: item.title,
      platform: 'bilibili',
      healthy: state === 'healthy',
      state,
      latencyMs: 1,
    }
  }
}

describe('video-health-cursor — 游标编解码与分页', () => {
  it('编解码往返，状态原样回来', () => {
    const encoded = encodeHealthCursor({ v: 1, runId: 'hs_abc', lastId: 'v42', scanned: 43 })
    expect(decodeHealthCursor(encoded)).toEqual({ v: 1, runId: 'hs_abc', lastId: 'v42', scanned: 43 })
  })

  it('非法游标返回 null（不抛错，调用方按新开一轮处理）', () => {
    expect(decodeHealthCursor(null)).toBeNull()
    expect(decodeHealthCursor('')).toBeNull()
    expect(decodeHealthCursor('not-base64!!!')).toBeNull()
    expect(decodeHealthCursor(Buffer.from(JSON.stringify({ v: 2, runId: 'x', lastId: null, scanned: 0 }), 'utf8').toString('base64url'))).toBeNull()
    expect(decodeHealthCursor(Buffer.from(JSON.stringify({ v: 1, runId: '', lastId: null, scanned: 0 }), 'utf8').toString('base64url'))).toBeNull()
  })

  it('250 条按 100 分页：3 页，无重复无遗漏，done 只在最后一页', () => {
    const items = Array.from({ length: 250 }, (_, i) => videoItem(`v${i}`))
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    for (;;) {
      const { page, nextCursor, coverage } = pageVideoItems(items, decodeHealthCursor(cursor), 100)
      pages++
      seen.push(...page.map((i) => i.id))
      expect(coverage.total).toBe(250)
      if (nextCursor === null) {
        expect(coverage.done).toBe(true)
        expect(coverage.scanned).toBe(250)
        expect(page.length).toBe(50)
        break
      }
      expect(coverage.done).toBe(false)
      expect(page.length).toBe(100)
      cursor = nextCursor
      if (pages > 5) throw new Error('分页死循环')
    }
    expect(pages).toBe(3)
    expect(new Set(seen).size).toBe(250)
    expect(seen).toEqual(items.map((i) => i.id))
  })

  it('游标条目本身被删：续扫不跳过下一条、不重复', () => {
    const items = Array.from({ length: 10 }, (_, i) => videoItem(`v${i}`))
    const first = pageVideoItems(items, null, 4)
    expect(first.page.map((i) => i.id)).toEqual(['v0', 'v1', 'v2', 'v3'])
    // 删掉游标指向的 v3（采集轮换在两页之间删了它）
    const remaining = items.filter((i) => i.id !== 'v3')
    const second = pageVideoItems(remaining, decodeHealthCursor(first.nextCursor), 4)
    expect(second.page.map((i) => i.id)).toEqual(['v4', 'v5', 'v6', 'v7'])
  })

  it('库被清空后游标过期：从头开始，而不是报“已完成”', () => {
    const items = Array.from({ length: 5 }, (_, i) => videoItem(`n${i}`))
    const stale = encodeHealthCursor({ v: 1, runId: 'hs_old', lastId: 'gone', scanned: 5000 })
    expect(resolveHealthCursorStart(items, decodeHealthCursor(stale))).toBe(0)
  })
})

describe('sweepVideoHealth — 游标分页全库覆盖', () => {
  it('250 条分 3 页扫完：每条恰好探测一次，coverage 累计到 250', async () => {
    const data = navData(Array.from({ length: 250 }, (_, i) => videoItem(`v${i}`)))
    const seen: string[] = []
    const prober = recordingProber(seen)
    let cursor: string | null = null
    let pages = 0
    let lastCoverage: { total: number; scanned: number; done: boolean } | null = null
    for (;;) {
      const { report, nextCursor, coverage } = await sweepVideoHealth(data, { cursor, pageSize: 100, prober })
      pages++
      lastCoverage = coverage
      expect(report.coverage).toEqual(coverage)
      if (nextCursor === null) {
        expect(coverage.done).toBe(true)
        expect(report.totalScanned).toBe(50)
        break
      }
      expect(report.totalScanned).toBe(100)
      cursor = nextCursor
      if (pages > 5) throw new Error('巡检分页死循环')
    }
    expect(pages).toBe(3)
    expect(new Set(seen).size).toBe(250)
    expect(lastCoverage).toEqual(expect.objectContaining({ total: 250, scanned: 250, done: true }))
  })

  it('不传 pageSize 时一次扫完全库（小库与旧行为一致）', async () => {
    const data = navData([videoItem('a'), videoItem('b')])
    const seen: string[] = []
    const { report, nextCursor, coverage } = await sweepVideoHealth(data, { prober: recordingProber(seen) })
    expect(report.totalScanned).toBe(2)
    expect(nextCursor).toBeNull()
    expect(coverage.done).toBe(true)
    expect(seen).toEqual(['a', 'b'])
  })

  it('空库：0 条待查，不报错、不造假，done 为 true', async () => {
    const seen: string[] = []
    const empty = await sweepVideoHealth(navData([]), { prober: recordingProber(seen) })
    expect(empty.report.totalScanned).toBe(0)
    expect(empty.report.healthyCount).toBe(0)
    expect(empty.report.brokenCount).toBe(0)
    expect(empty.coverage).toEqual(expect.objectContaining({ total: 0, scanned: 0, remaining: 0, done: true }))
    expect(empty.nextCursor).toBeNull()
    expect(seen).toEqual([])

    // 有分类、但条目都没有 videoConfig：同样 0 条可探测，不报错
    const noVideo = navData([{ id: 'x', title: '无视频', href: 'https://example.com', enabled: true } as NavigationSubItem])
    const res = await sweepVideoHealth(noVideo, { prober: recordingProber(seen) })
    expect(res.coverage.total).toBe(0)
    expect(res.coverage.done).toBe(true)
    expect(flattenVideoItems(noVideo)).toEqual([])
  })
})

/** 内存版依赖缝：读/写都在内存里，不碰中枢存储 */
function memoryDeps(initial: NavigationData): { deps: HealthSweepDeps; store: { lib: NavigationData; checkpoints: unknown[]; reports: unknown[]; mutateCalls: number } } {
  const store = { lib: initial, checkpoints: [] as unknown[], reports: [] as unknown[], mutateCalls: 0 }
  const deps: HealthSweepDeps = {
    readLibrary: async () => structuredClone(store.lib),
    mutateLibrary: async (mutate, _message) => {
      store.mutateCalls++
      const plan = mutate(structuredClone(store.lib))
      if (!plan.skip) store.lib = plan.next
      return { ok: true, result: plan.result, attempts: 1 }
    },
    persistReport: (report) => {
      store.reports.push(report)
    },
    persistCheckpoint: (checkpoint) => {
      store.checkpoints.push(structuredClone(checkpoint))
    },
    readCheckpoint: async () => {
      const last = store.checkpoints[store.checkpoints.length - 1] as never
      return (last ?? null) as never
    },
    hydrateMetrics: () => undefined,
    scheduleMetricsPersist: () => undefined,
  }
  return { deps, store }
}

describe('runHealthSweepPage / runHealthSweepToCompletion — 服务层', () => {
  beforeEach(() => {
    resetHealthSweepRunForTest()
  })
  afterEach(() => {
    resetHealthSweepRunForTest()
  })

  it('单页：force 时回写健康字段，检查点记下断点', async () => {
    const { deps, store } = memoryDeps(navData(Array.from({ length: 25 }, (_, i) => videoItem(`v${i}`))))
    const seen: string[] = []
    const page = await runHealthSweepPage(
      { pageSize: 10, force: true, prober: recordingProber(seen) },
      deps,
    )
    expect(page.success).toBe(true)
    if (!page.success) return
    expect(page.report.totalScanned).toBe(10)
    expect(page.coverage).toEqual(expect.objectContaining({ total: 25, scanned: 10, done: false }))
    expect(page.nextCursor).not.toBeNull()
    expect(page.persisted).toBe(true)
    expect(page.applied).toBe(10)
    expect(store.mutateCalls).toBe(1)
    // 回写真的落到了库里：第一页条目有了验证时间戳
    const first = store.lib.navigationItems[0].items?.[0]
    expect(typeof first?.videoConfig?.lastVerifiedAt).toBe('number')
    expect(first?.videoConfig?.healthStatus).toBe('healthy')
    // 检查点记下断点
    const checkpoint = store.checkpoints[store.checkpoints.length - 1] as { cursor: string | null; scanned: number; total: number; done: boolean }
    expect(checkpoint.scanned).toBe(10)
    expect(checkpoint.total).toBe(25)
    expect(checkpoint.done).toBe(false)
    expect(checkpoint.cursor).toBe(page.nextCursor)
  })

  it('全 healthy 且不 force：不写库（只写时间戳不值得重写整份文档）', async () => {
    const { deps, store } = memoryDeps(navData([videoItem('a'), videoItem('b')]))
    const page = await runHealthSweepPage({ pageSize: 10, prober: recordingProber([]) }, deps)
    expect(page.success).toBe(true)
    if (!page.success) return
    expect(page.persisted).toBe(false)
    expect(store.mutateCalls).toBe(0)
  })

  it('全量循环：25 条 3 页扫完，计数汇总，检查点记完成', async () => {
    const { deps, store } = memoryDeps(navData(Array.from({ length: 25 }, (_, i) => videoItem(`v${i}`))))
    const seen: string[] = []
    const full = await runHealthSweepToCompletion(
      { pageSize: 10, prober: recordingProber(seen) },
      deps,
    )
    expect(full.success).toBe(true)
    if (!full.success) return
    expect(full.pages).toBe(3)
    expect(full.done).toBe(true)
    expect(full.nextCursor).toBeNull()
    expect(full.report.totalScanned).toBe(25)
    expect(full.report.healthyCount).toBe(25)
    expect(new Set(seen).size).toBe(25)
    const checkpoint = store.checkpoints[store.checkpoints.length - 1] as { scanned: number; total: number; done: boolean; cursor: string | null }
    expect(checkpoint).toEqual(expect.objectContaining({ scanned: 25, total: 25, done: true, cursor: null }))
  })

  it('空库全量循环：一页即完成，全 0，不循环', async () => {
    const { deps } = memoryDeps(navData([]))
    const full = await runHealthSweepToCompletion({ pageSize: 10, prober: recordingProber([]) }, deps)
    expect(full.success).toBe(true)
    if (!full.success) return
    expect(full.pages).toBe(1)
    expect(full.done).toBe(true)
    expect(full.report.totalScanned).toBe(0)
    expect(full.coverage.total).toBe(0)
  })

  it('预算到点即停在断点，下次调用从检查点续扫并最终完成', async () => {
    vi.useFakeTimers()
    try {
      const { deps, store } = memoryDeps(navData(Array.from({ length: 25 }, (_, i) => videoItem(`v${i}`))))
      const seen: string[] = []
      // 每次探测把假时钟拨快 6s：第一页（10 条）跑完就超过 10s 预算
      const slowProber = async (item: NavigationSubItem): Promise<ProbeResult> => {
        vi.advanceTimersByTime(6000)
        seen.push(item.id)
        return { videoId: item.id, title: item.title, platform: 'bilibili', healthy: true, state: 'healthy', latencyMs: 1 }
      }
      const first = await runHealthSweepToCompletion({ pageSize: 10, maxRunMs: 10_000, prober: slowProber }, deps)
      expect(first.success).toBe(true)
      if (!first.success) return
      expect(first.pages).toBe(1)
      expect(first.done).toBe(false)
      expect(first.nextCursor).not.toBeNull()
      expect(first.coverage.scanned).toBe(10)
      // 检查点留下了断点
      const checkpoint = store.checkpoints[store.checkpoints.length - 1] as { cursor: string | null; done: boolean }
      expect(checkpoint.done).toBe(false)
      expect(checkpoint.cursor).toBe(first.nextCursor)

      // 第二次调用不带 cursor：自动读检查点续扫，最终完成
      const seen2: string[] = []
      const second = await runHealthSweepToCompletion(
        { pageSize: 10, maxRunMs: 120_000, prober: recordingProber(seen2) },
        deps,
      )
      expect(second.success).toBe(true)
      if (!second.success) return
      expect(second.done).toBe(true)
      expect(second.coverage.scanned).toBe(25)
      expect(new Set([...seen, ...seen2]).size).toBe(25)
    } finally {
      vi.useRealTimers()
    }
  })

  it('单飞：两轮并发时第二轮返回 busy，不静默排队', async () => {
    const { deps } = memoryDeps(navData([videoItem('a'), videoItem('b')]))
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const blockingProber = async (item: NavigationSubItem): Promise<ProbeResult> => {
      await gate
      return { videoId: item.id, title: item.title, platform: 'bilibili', healthy: true, state: 'healthy', latencyMs: 1 }
    }
    const first = runHealthSweepPage({ pageSize: 10, prober: blockingProber }, deps)
    const second = await runHealthSweepPage({ pageSize: 10, prober: recordingProber([]) }, deps)
    expect(second.success).toBe(false)
    if (!second.success) expect(second.busy).toBe(true)
    release()
    const firstResult = await first
    expect(firstResult.success).toBe(true)
  })
})

describe('video-health-scheduler — 调度真实生效', () => {
  const testConfig: VideoHealthScheduleConfig = {
    enabled: true,
    intervalMs: 60 * 60 * 1000,
    initialDelayMs: 60 * 1000,
    pageSize: 100,
    tickBudgetMs: 20 * 60 * 1000,
    timeoutMs: 3500,
    autoPrune: false,
  }

  function fakeFullOutcome(): HealthSweepFullOutcome {
    return {
      success: true,
      report: {
        timestamp: new Date().toISOString(),
        totalScanned: 10,
        healthyCount: 10,
        brokenCount: 0,
        brokenItems: [],
        replacementRecords: [],
      },
      coverage: { runId: 'hs_test', total: 10, scanned: 10, remaining: 0, done: true },
      nextCursor: null,
      done: true,
      pages: 1,
      persisted: false,
      applied: 0,
      removed: 0,
      dryRun: false,
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    resetVideoHealthSchedulerForTest()
  })

  afterEach(() => {
    resetVideoHealthSchedulerForTest()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('首轮延迟后触发一次，之后每间隔触发一次', async () => {
    const runner = vi.fn(async () => fakeFullOutcome())
    startVideoHealthScheduler({ config: testConfig, runner })
    expect(runner).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(runner).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(runner).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(runner).toHaveBeenCalledTimes(3)
  })

  it('上一轮没跑完时跳过 tick，不叠加', async () => {
    let release!: () => void
    const gate = new Promise<HealthSweepFullOutcome>((resolve) => {
      release = () => resolve(fakeFullOutcome())
    })
    const runner = vi.fn(() => gate)
    startVideoHealthScheduler({ config: testConfig, runner })

    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(runner).toHaveBeenCalledTimes(1)

    //  runner 还没回来，又过了一个间隔：跳过，不多调
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(runner).toHaveBeenCalledTimes(1)

    release()
    await vi.advanceTimersByTimeAsync(0)
    // 再过一个间隔：正常触发
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('stop 后不再触发；重复 start 不会多挂定时器', async () => {
    const runner = vi.fn(async () => fakeFullOutcome())
    startVideoHealthScheduler({ config: testConfig, runner })
    expect(startVideoHealthScheduler({ config: testConfig, runner }).started).toBe(true)
    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(runner).toHaveBeenCalledTimes(1)

    resetVideoHealthSchedulerForTest()
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    expect(runner).toHaveBeenCalledTimes(1)
    expect(getVideoHealthSchedulerStatus().started).toBe(false)
  })

  it('enabled=false 时不启动、不触发', async () => {
    const runner = vi.fn(async () => fakeFullOutcome())
    const result = startVideoHealthScheduler({ config: { ...testConfig, enabled: false }, runner })
    expect(result.started).toBe(false)
    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    expect(runner).not.toHaveBeenCalled()
  })

  it('配置解析：非法值回默认值，越界值钳制', () => {
    const config = readVideoHealthScheduleConfig({
      VIDEO_HEALTH_SWEEP_INTERVAL_MS: '1000',
      VIDEO_HEALTH_SWEEP_PAGE_SIZE: '99999',
      VIDEO_HEALTH_SWEEP_ENABLED: 'false',
      VIDEO_HEALTH_SWEEP_TIMEOUT_MS: 'not-a-number',
    } as unknown as NodeJS.ProcessEnv)
    expect(config.enabled).toBe(false)
    expect(config.intervalMs).toBe(5 * 60 * 1000)
    expect(config.pageSize).toBe(500)
    expect(config.timeoutMs).toBe(3500)

    const defaults = readVideoHealthScheduleConfig({} as NodeJS.ProcessEnv)
    expect(defaults.enabled).toBe(true)
    expect(defaults.intervalMs).toBe(6 * 60 * 60 * 1000)
    expect(defaults.pageSize).toBe(100)
  })
})
