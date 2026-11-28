/**
 * /hot 客户端轮询（方案 C，2026-11-28）定向测试。
 *
 * 测 lib/hot-polling.ts 的纯调度逻辑（定时器 / 可见性 / 监听全注入，
 * 假时钟 + 假可见性，不依赖 jsdom；仓库 vitest 是 node 环境）：
 *  - 可见时每 30 秒轮询一次，成功换榜 + 更新重算时间戳
 *  - 挂载时不立即取（首帧是 SSR 数据）；回前台立刻补一次
 *  - 切后台停轮询；停止后不再取、不再响应可见性变化
 *  - 失败（degrade 兜底 / 抛错）旧榜不动、不弹错，下次继续轮询
 *  - 在途请求不叠加
 * 另有两层源码守卫：hot-view.tsx 真的把浏览器 API 接进轮询、
 * page.tsx revalidate 仍为 60（服务端零改动）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  HOT_TRENDING_POLL_MS,
  startTrendingPoller,
  type TrendingPollerDeps,
} from '../src/lib/hot-polling'
import type { TrendingMeta } from '../src/lib/navhub-api'

const HERE = dirname(fileURLToPath(import.meta.url))
/**
 * 源码守卫读 overlay 源文件。本文件以 apps/web-overlay/test 运行
 * 时 HERE 的上一级就是 overlay；以 apps/web/test 镜像运行时，
 * 上一级是 apps/web，需再上一级进 web-overlay。两处都试，取先命中的。
 */
const readSrc = (rel: string) => {
  const candidates = [
    join(HERE, '..', rel),
    join(HERE, '..', '..', 'web-overlay', rel),
  ]
  for (const p of candidates) {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      // 不是该位置，试下一个
    }
  }
  throw new Error(`源码守卫找不到文件：${rel}`)
}

const site = (id: string) => ({ id }) as unknown as TrendingMeta['sites'][number]
const meta = (ids: string[], recomputedAt: number | null = 1700000000000): TrendingMeta => ({
  sites: ids.map(site),
  recomputedAt,
})

/** 假时钟 + 假可见性 + 假 fetch 的完整 harness。 */
function harness(opts: { visible?: boolean; intervalMs?: number } = {}) {
  let visible = opts.visible ?? true
  const listeners = new Set<() => void>()
  let timerFn: (() => void) | null = null
  let timerMs: number | null = null
  let timerId = 0
  const activeTimers = new Set<number>()
  const fetchCalls: Array<{ degraded: boolean }> = []
  let fetchImpl: (onDegraded: (e: unknown) => void) => Promise<TrendingMeta> = async () =>
    meta(['a', 'b'])
  const updates: TrendingMeta[] = []

  const deps: TrendingPollerDeps = {
    fetchTrending: (onDegraded) => {
      const call = { degraded: false }
      fetchCalls.push(call)
      return fetchImpl((e) => {
        call.degraded = true
        onDegraded(e)
      })
    },
    onUpdate: (m) => {
      updates.push(m)
    },
    isVisible: () => visible,
    addVisibilityListener: (fn) => {
      listeners.add(fn)
    },
    removeVisibilityListener: (fn) => {
      listeners.delete(fn)
    },
    setIntervalFn: (fn, ms) => {
      timerFn = fn
      timerMs = ms
      const id = ++timerId
      activeTimers.add(id)
      return id
    },
    clearIntervalFn: (id) => {
      activeTimers.delete(id as number)
      if (activeTimers.size === 0) timerFn = null
    },
    intervalMs: opts.intervalMs,
  }
  return {
    deps,
    fetchCalls,
    updates,
    listeners,
    activeTimers,
    get timerMs() {
      return timerMs
    },
    setFetchImpl: (impl: typeof fetchImpl) => {
      fetchImpl = impl
    },
    /** 手动触发 interval 回调（假时钟的一次 tick）。 */
    tick: () => {
      timerFn?.()
    },
    /** 切换可见性并触发已订阅的监听。 */
    setVisible: (next: boolean) => {
      visible = next
      for (const fn of [...listeners]) fn()
    },
    flush: () => vi.waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0)),
  }
}

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('HOT_TRENDING_POLL_MS', () => {
  it('轮询间隔为 30 秒（方案 C 定稿）', () => {
    expect(HOT_TRENDING_POLL_MS).toBe(30_000)
  })
})

describe('startTrendingPoller', () => {
  it('可见时挂载不立即取，30 秒 tick 取一次、成功换榜', async () => {
    const h = harness()
    const stop = startTrendingPoller(h.deps)
    expect(h.fetchCalls).toHaveLength(0)
    expect(h.timerMs).toBe(30_000)
    h.tick()
    await flushMicrotasks()
    expect(h.fetchCalls).toHaveLength(1)
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0].sites.map((s) => s.id)).toEqual(['a', 'b'])
    expect(h.updates[0].recomputedAt).toBe(1700000000000)
    stop()
  })

  it('切后台停轮询（清 interval），回前台立刻补一次并续轮询', async () => {
    const h = harness()
    const stop = startTrendingPoller(h.deps)
    h.setVisible(false)
    expect(h.activeTimers.size).toBe(0)
    h.tick()
    await flushMicrotasks()
    expect(h.fetchCalls).toHaveLength(0)
    h.setVisible(true)
    await flushMicrotasks()
    expect(h.fetchCalls).toHaveLength(1)
    expect(h.activeTimers.size).toBe(1)
    h.tick()
    await flushMicrotasks()
    expect(h.fetchCalls).toHaveLength(2)
    stop()
  })

  it('挂载时在后台不启动 interval；回前台才启动', async () => {
    const h = harness({ visible: false })
    const stop = startTrendingPoller(h.deps)
    expect(h.activeTimers.size).toBe(0)
    expect(h.fetchCalls).toHaveLength(0)
    h.setVisible(true)
    await flushMicrotasks()
    expect(h.fetchCalls).toHaveLength(1)
    expect(h.activeTimers.size).toBe(1)
    stop()
  })

  it('失败（degrade 兜底）旧榜不动、不抛错，下次 tick 继续轮询', async () => {
    const h = harness()
    h.setFetchImpl(async (onDegraded) => {
      onDegraded(new Error('hub down'))
      return meta([])
    })
    const stop = startTrendingPoller(h.deps)
    h.tick()
    await flushMicrotasks()
    expect(h.fetchCalls).toHaveLength(1)
    expect(h.fetchCalls[0].degraded).toBe(true)
    expect(h.updates).toHaveLength(0)
    h.tick()
    await flushMicrotasks()
    expect(h.fetchCalls).toHaveLength(2)
    stop()
  })

  it('fetch 抛错也静默，旧榜不动，下次继续轮询', async () => {
    const h = harness()
    h.setFetchImpl(async () => {
      throw new Error('network down')
    })
    const stop = startTrendingPoller(h.deps)
    h.tick()
    await flushMicrotasks()
    expect(h.fetchCalls).toHaveLength(1)
    expect(h.updates).toHaveLength(0)
    h.tick()
    await flushMicrotasks()
    expect(h.fetchCalls).toHaveLength(2)
    stop()
  })

  it('请求在途时下一 tick 不叠加；完成后恢复', async () => {
    const h = harness()
    let release!: (m: TrendingMeta) => void
    h.setFetchImpl(
      () =>
        new Promise<TrendingMeta>((resolve) => {
          release = resolve
        }),
    )
    const stop = startTrendingPoller(h.deps)
    h.tick()
    h.tick()
    expect(h.fetchCalls).toHaveLength(1)
    release(meta(['c']))
    await flushMicrotasks()
    expect(h.updates).toHaveLength(1)
    h.tick()
    expect(h.fetchCalls).toHaveLength(2)
    stop()
  })

  it('stop 后清 interval、摘监听，不再取数、不响应可见性变化', async () => {
    const h = harness()
    const stop = startTrendingPoller(h.deps)
    expect(h.listeners.size).toBe(1)
    stop()
    expect(h.activeTimers.size).toBe(0)
    expect(h.listeners.size).toBe(0)
    h.tick()
    await flushMicrotasks()
    expect(h.fetchCalls).toHaveLength(0)
    h.setVisible(false)
    h.setVisible(true)
    await flushMicrotasks()
    expect(h.fetchCalls).toHaveLength(0)
  })

  it('真取回 0 条（未失败）也正常换榜（空榜是事实，不是故障）', async () => {
    const h = harness()
    h.setFetchImpl(async () => meta([]))
    const stop = startTrendingPoller(h.deps)
    h.tick()
    await flushMicrotasks()
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0].sites).toEqual([])
    stop()
  })
})

describe('hot-view 接线守卫（源码）', () => {
  it('hot-view.tsx 接入 startTrendingPoller + fetchTrendingMeta(30) + visibilitychange，卸载清 interval', () => {
    const src = readSrc('src/app/hot/hot-view.tsx')
    expect(src).toContain('startTrendingPoller')
    expect(src).toContain('fetchTrendingMeta(30')
    expect(src).toContain("document.visibilityState === 'visible'")
    expect(src).toContain("document.addEventListener('visibilitychange'")
    expect(src).toContain("document.removeEventListener('visibilitychange'")
    // 只更新 trending 一路：轮询回调里只写 setTrending / setRecomputedAt
    expect(src).toContain('setTrending(t.sites)')
    expect(src).toContain('setRecomputedAt(t.recomputedAt)')
  })

  it('page.tsx revalidate 仍为 60（服务端零改动）', () => {
    const src = readSrc('src/app/hot/page.tsx')
    expect(src).toMatch(/export const revalidate = 60/)
  })
})
