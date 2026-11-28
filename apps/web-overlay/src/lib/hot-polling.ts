/**
 * /hot 客户端轮询（方案 C，2026-11-28）。
 *
 * 痛点：/hot 已打开页面永不更新——服务端重算每小时一次、页面滞后
 * 32–78 秒（本轮实测），用户打开榜单后看到的一直是旧榜。
 * 方案 C 是唯一能给已打开页面封顶约 30 秒且服务端零代价的方案：
 * 复用 fetchTrendingMeta(30)，30 秒间隔、页面可见时才轮询，
 * 只更新 trending 一路；服务端两层 60 秒缓存与 page.tsx
 * revalidate=60 一律不动。
 *
 * 行为：
 * - 挂载时若页面可见即启动 interval，首 tick 在 30 秒后（首帧是 SSR
 *   数据，不立即重取）；切到后台停轮询、回前台立刻补一次再续轮询。
 * - 成功才换榜（榜 + 重算时间戳）；失败静默——旧榜不动、不弹错，
 *   下次继续轮询。degrade() 把失败吞成空兜底，靠 onDegraded 标记
 *   区分「真取回 0 条」与「失败兜底」，与 hot-view 重试 effect 同口径。
 * - 请求在途时跳过下一 tick，不叠加；卸载时清 interval、摘监听。
 *
 * 本模块是纯调度逻辑：定时器 / 可见性 / 监听全部由调用方注入，
 * 因此可在 node 环境单测（仓库 vitest 无 jsdom），hot-view.tsx
 * 只负责把真实浏览器 API 接进来。
 */
import type { DegradedHandler } from './degrade'
import type { TrendingMeta } from './navhub-api'

/** /hot trending 轮询间隔：30 秒。 */
export const HOT_TRENDING_POLL_MS = 30_000

export interface TrendingPollerDeps {
  /** 取 trending 一路；失败时调 onDegraded（degrade 兜底语义） */
  fetchTrending: (onDegraded: DegradedHandler) => Promise<TrendingMeta>
  /** 成功取回时调用（调用方据此换榜 + 更新重算时间戳） */
  onUpdate: (meta: TrendingMeta) => void
  /** 当前页面是否可见（浏览器侧：document.visibilityState === 'visible'） */
  isVisible: () => boolean
  /** 订阅可见性变化（浏览器侧：document.addEventListener('visibilitychange', …)） */
  addVisibilityListener: (listener: () => void) => void
  removeVisibilityListener: (listener: () => void) => void
  /** 可注入的定时器（默认全局 setInterval/clearInterval；测试注入假时钟） */
  setIntervalFn?: (fn: () => void, ms: number) => unknown
  clearIntervalFn?: (id: unknown) => void
  /** 覆盖轮询间隔（默认 HOT_TRENDING_POLL_MS；测试可缩短） */
  intervalMs?: number
}

/**
 * 启动 /hot trending 轮询，返回停止函数（卸载时调用：清 interval、
 * 摘 visibilitychange 监听、在途请求的结果不再写回）。
 */
export function startTrendingPoller(deps: TrendingPollerDeps): () => void {
  const intervalMs = deps.intervalMs ?? HOT_TRENDING_POLL_MS
  const setIntervalFn = deps.setIntervalFn ?? setInterval
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval
  let timer: unknown = null
  let inFlight = false
  let stopped = false

  const poll = (): void => {
    if (stopped || inFlight || !deps.isVisible()) return
    inFlight = true
    let failed = false
    void deps
      .fetchTrending(() => {
        failed = true
      })
      .then(
        (meta) => {
          inFlight = false
          if (!stopped && !failed) deps.onUpdate(meta)
        },
        () => {
          // degrade() 正常不抛；万一抛了也静默，旧榜不动，下次继续轮询。
          inFlight = false
        },
      )
  }

  const stopTimer = (): void => {
    if (timer !== null) {
      clearIntervalFn(timer)
      timer = null
    }
  }
  const startTimer = (): void => {
    stopTimer()
    timer = setIntervalFn(poll, intervalMs)
  }

  const onVisibilityChange = (): void => {
    if (stopped) return
    if (deps.isVisible()) {
      // 回到前台立刻补一次（后台期间榜可能已重算），再续 30 秒轮询。
      poll()
      startTimer()
    } else {
      stopTimer()
    }
  }

  deps.addVisibilityListener(onVisibilityChange)
  if (deps.isVisible()) startTimer()

  return () => {
    stopped = true
    stopTimer()
    deps.removeVisibilityListener(onVisibilityChange)
  }
}
