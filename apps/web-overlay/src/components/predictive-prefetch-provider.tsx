'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  calculateMotionVector,
  determinePrefetchStrategy,
  isHeadingTowardsRect,
  extractSafeOrigin,
  shouldPreconnectOrigin,
  type Point,
} from '@/lib/prefetch'
import {
  HOVER_PREFETCH_DELAY_MS,
  IDLE_PREFETCH_FALLBACK_MS,
  SCENE_SWITCHED_EVENT,
  buildRecentCandidates,
  buildSceneLandingCandidate,
  getSharedRoutePrefetchSession,
  isRoutePrefetchNetworkAllowed,
  pickIdlePrefetchCandidate,
  toInternalRouteHref,
  tryClaimRoutePrefetch,
  type PrefetchConnectionLike,
} from '@/lib/route-prefetch'
import { readOfflineVisits } from '@/lib/offline-recent'

const MAX_PRECONNECTS = 8
const THROTTLE_MS = 60
// 注入 link 节点总数上限（dns-prefetch + preconnect 各一，共 2×origins），防 DOM 无限膨胀
const MAX_INJECTED_LINKS = MAX_PRECONNECTS * 2

/** navigator.connection 是非标准扩展，取不到时按「网络良好」处理。 */
function getConnection(): PrefetchConnectionLike | undefined {
  if (typeof navigator === 'undefined') return undefined
  const nav = navigator as Navigator & { connection?: PrefetchConnectionLike }
  return nav.connection
}

type IdleTask = { cancel: () => void }

/**
 * 空闲调度：requestIdleCallback 优先（iOS Safari 没有时用 setTimeout 兜底）。
 * 超时 5s 兜底，避免浏览器一直不给空闲时间时永远不跑。
 */
function scheduleIdle(fn: () => void): IdleTask {
  if (typeof window === 'undefined') return { cancel: () => {} }
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (handle: number) => void
  }
  if (typeof w.requestIdleCallback === 'function') {
    const handle = w.requestIdleCallback(fn, { timeout: 5000 })
    return { cancel: () => w.cancelIdleCallback?.(handle) }
  }
  const timer = window.setTimeout(fn, IDLE_PREFETCH_FALLBACK_MS)
  return { cancel: () => window.clearTimeout(timer) }
}

export function PredictivePrefetchProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const lastPointRef = useRef<Point | null>(null)
  const lastTimeRef = useRef<number>(0)
  const connectedOriginsRef = useRef<Set<string>>(new Set())
  const injectedLinksRef = useRef<HTMLLinkElement[]>([])
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoverHrefRef = useRef<string | null>(null)
  // 当前路径的 ref 镜像：主 effect 只订阅一次，回调里读 ref 拿最新路径。
  const pathnameRef = useRef(pathname)

  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    /**
     * A0：真正调用 determinePrefetchStrategy 的唯一出口。
     * saveData / slow-2g / 2g → 全停；3g → 只注入 dns-prefetch；
     * 其余 → dns-prefetch + preconnect 各一。
     * 触屏（touchstart）与键盘（focusin）走的也是这同一个判定（见下）。
     */
    const preconnectOrigin = (origin: string) => {
      if (!shouldPreconnectOrigin(origin, connectedOriginsRef.current, MAX_PRECONNECTS)) {
        return
      }
      const strategy = determinePrefetchStrategy(getConnection())
      if (strategy === 'none') return
      // 去重上限：已注入节点过多则拒绝新增（防长会话 DOM 膨胀）
      if (injectedLinksRef.current.length >= MAX_INJECTED_LINKS) return

      connectedOriginsRef.current.add(origin)

      // 动态注入 dns-prefetch
      const dnsLink = document.createElement('link')
      dnsLink.rel = 'dns-prefetch'
      dnsLink.href = origin
      dnsLink.dataset.predictivePrefetch = '1'
      document.head.appendChild(dnsLink)
      injectedLinksRef.current.push(dnsLink)

      // 3g 时只到 DNS，不做 TCP/TLS 预连接
      if (strategy === 'dns-prefetch') return

      const preconnLink = document.createElement('link')
      preconnLink.rel = 'preconnect'
      preconnLink.href = origin
      preconnLink.crossOrigin = 'anonymous'
      preconnLink.dataset.predictivePrefetch = '1'
      document.head.appendChild(preconnLink)
      injectedLinksRef.current.push(preconnLink)
    }

    /**
     * A1：站内路由预取的唯一出口（与 A0 的外站预连接分轨）。
     * 网络门控 + 白名单 + 会话 ≤5 条 + 每路由 1 次都在 tryClaim 里；
     * 认领成功才发一次 router.prefetch（App Router 默认预取不动，A1 是补充）。
     */
    const tryRoutePrefetch = (href: string) => {
      if (typeof navigator !== 'undefined') {
        if (!isRoutePrefetchNetworkAllowed(getConnection(), navigator.onLine)) return
      }
      const session = getSharedRoutePrefetchSession()
      if (!tryClaimRoutePrefetch(session, href, pathnameRef.current)) return
      router.prefetch(href)
    }

    const clearHoverTimer = () => {
      if (hoverTimerRef.current !== null) {
        clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = null
      }
      hoverHrefRef.current = null
    }

    /** 悬停 / 轨迹指向站内卡片 ≥150ms 才预取：扫过不停留的不烧流量。 */
    const armHoverPrefetch = (href: string) => {
      if (hoverHrefRef.current === href && hoverTimerRef.current !== null) return
      clearHoverTimer()
      hoverHrefRef.current = href
      hoverTimerRef.current = setTimeout(() => {
        hoverTimerRef.current = null
        hoverHrefRef.current = null
        tryRoutePrefetch(href)
      }, HOVER_PREFETCH_DELAY_MS)
    }

    /** 锚点上的站内 href（相对路径或同源绝对 URL），外站返回 null。 */
    const internalHrefOf = (anchor: HTMLAnchorElement | null): string | null => {
      if (!anchor) return null
      return toInternalRouteHref(anchor.getAttribute('href') ?? '', window.location.origin)
    }

    /**
     * 按下 / 触摸 / 聚焦到链接时（触发器①，立即）：
     * 站内链接 → 立即 router.prefetch；外站链接 → A0 预连接判定。
     * 只取其一，不叠加。
     */
    const handlePressTarget = (target: EventTarget | null) => {
      const anchor = (target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor) return
      const internal = internalHrefOf(anchor)
      if (internal) {
        tryRoutePrefetch(internal)
        return
      }
      if (connectedOriginsRef.current.size >= MAX_PRECONNECTS) return
      const origin = extractSafeOrigin(anchor.href)
      if (origin) {
        preconnectOrigin(origin)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now()
      if (now - lastTimeRef.current < THROTTLE_MS) return
      lastTimeRef.current = now

      const currentPoint: Point = { x: e.clientX, y: e.clientY, t: now }

      if (lastPointRef.current) {
        const vector = calculateMotionVector(lastPointRef.current, currentPoint)

        // 仅当速度达到阈值且非停滞时扫描周围 <a> 标签
        if (vector.speed >= 0.15) {
          // A0 外站预连接：达到上限时跳过本段扫描，0 开销 0 强制重排
          if (connectedOriginsRef.current.size < MAX_PRECONNECTS) {
            // 认领 data-prefetch-target（Batch 3 第 8 项 P2）：navigation-card
            // 的三处外站卡片链接带该标记——旧推测预取组件删后留下的死标记，
            // 现由本扫描正式认领为优先预连接目标。标记链接先扫、其余 http
            // 链接后补位（去重），仍只取前 12 个、单次运动周期只预连接 1 个。
            // 标记在外站链接上，故只进 A0 预连接扫描，不进 A1 站内预取。
            const markedLinks = document.querySelectorAll<HTMLAnchorElement>(
              'a[data-prefetch-target="true"]',
            )
            const httpLinks = document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')
            const orderedLinks: HTMLAnchorElement[] = []
            const seenLinks = new Set<HTMLAnchorElement>()
            for (const a of Array.from(markedLinks)) {
              if (!seenLinks.has(a)) {
                seenLinks.add(a)
                orderedLinks.push(a)
              }
            }
            for (const a of Array.from(httpLinks)) {
              if (!seenLinks.has(a)) {
                seenLinks.add(a)
                orderedLinks.push(a)
              }
            }
            // 限制只检测视口附近前 12 个链接，杜绝几百个 DOM 元素的 getBoundingClientRect 触发重排
            const maxCheck = Math.min(orderedLinks.length, 12)
            for (let i = 0; i < maxCheck; i++) {
              const a = orderedLinks[i]
              if (!a) continue

              const rect = a.getBoundingClientRect()
              // 快速空间初筛：若视口不可见则跳过
              if (rect.bottom < 0 || rect.top > window.innerHeight) continue

              if (
                isHeadingTowardsRect(
                  { x: currentPoint.x, y: currentPoint.y },
                  vector,
                  { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
                  220,
                  0.15
                )
              ) {
                const origin = extractSafeOrigin(a.href)
                if (origin) {
                  preconnectOrigin(origin)
                  break; // 单次运动周期预测单目标
                }
              }
            }
          }

          // A1 触发器②：轨迹指向站内卡片 → 150ms 悬停计时（不与 A0 叠加）。
          const internalLinks = document.querySelectorAll<HTMLAnchorElement>(
            'a[href^="/"]:not([href^="//"])',
          )
          const maxInternalCheck = Math.min(internalLinks.length, 12)
          for (let i = 0; i < maxInternalCheck; i++) {
            const a = internalLinks[i]
            if (!a) continue
            const rect = a.getBoundingClientRect()
            if (rect.bottom < 0 || rect.top > window.innerHeight) continue
            if (
              isHeadingTowardsRect(
                { x: currentPoint.x, y: currentPoint.y },
                vector,
                { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
                220,
                0.15,
              )
            ) {
              const internal = internalHrefOf(a)
              if (internal) {
                armHoverPrefetch(internal)
                break; // 单次运动周期预测单目标
              }
            }
          }
        }
      }

      lastPointRef.current = currentPoint
    }

    const onPointerDown = (e: PointerEvent) => {
      handlePressTarget(e.target)
    }

    // A0 触屏补位：touchstart 走与 pointerdown 同一次判定（站内立即预取 / 外站预连接）。
    const onTouchStart = (e: TouchEvent) => {
      handlePressTarget(e.target)
    }

    // A0 键盘补位 + A1 触发器①：focusin（冒泡版 focus）到链接时立即判定一次。
    const onFocusIn = (e: FocusEvent) => {
      handlePressTarget(e.target)
    }

    // A1 触发器②：悬停站内链接 ≥150ms 预取；移出则取消计时。
    const onMouseOver = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor) {
        clearHoverTimer()
        return
      }
      const internal = internalHrefOf(anchor)
      if (!internal) {
        clearHoverTimer()
        return
      }
      armHoverPrefetch(internal)
    }

    const onMouseOut = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href]')
      if (!anchor) return
      const related = e.relatedTarget as Node | null
      if (related && anchor.contains(related)) return
      const internal = internalHrefOf(anchor)
      if (internal && hoverHrefRef.current === internal) clearHoverTimer()
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('focusin', onFocusIn, { passive: true })
    window.addEventListener('mouseover', onMouseOver, { passive: true })
    window.addEventListener('mouseout', onMouseOut, { passive: true })

    // P1 遗留收尾（Batch 3 第 8 项 P2）：场景切换成功后空闲预取目标场景
    // 首页 1 条。buildSceneLandingCandidate 只产 1 条 low 候选，绝不预取
    // 场景内全部站点；网络门控与会话 ≤5 条由下面的 pick/tryClaim 复核。
    // 工具栏下拉与 ⌘K 共用 performSceneSwitch，两处切换都发同一事件。
    let sceneSwitchDisposed = false
    const onSceneSwitched = (e: Event) => {
      const sceneId = (e as CustomEvent<{ sceneId?: unknown }>).detail?.sceneId
      if (typeof sceneId !== 'string' || sceneId.trim() === '') return
      scheduleIdle(() => {
        if (sceneSwitchDisposed) return
        if (
          typeof navigator !== 'undefined' &&
          !isRoutePrefetchNetworkAllowed(getConnection(), navigator.onLine)
        ) {
          return
        }
        const candidate = buildSceneLandingCandidate(sceneId)
        if (!candidate) return
        const picked = pickIdlePrefetchCandidate([candidate], getSharedRoutePrefetchSession(), {
          networkAllowed: true,
          currentHref: pathnameRef.current,
        })
        if (picked) router.prefetch(picked.href)
      })
    }
    window.addEventListener(SCENE_SWITCHED_EVENT, onSceneSwitched)

    const injectedLinks = injectedLinksRef.current
    const connectedOrigins = connectedOriginsRef.current

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('mouseover', onMouseOver)
      window.removeEventListener('mouseout', onMouseOut)
      window.removeEventListener(SCENE_SWITCHED_EVENT, onSceneSwitched)
      sceneSwitchDisposed = true
      clearHoverTimer()
      // 卸载清理：移除本 provider 注入的 link，释放 Set/point 引用（防 SPA 切页泄漏）
      for (const el of injectedLinks) {
        el.remove()
      }
      injectedLinks.length = 0
      connectedOrigins.clear()
      lastPointRef.current = null
    }
  }, [router])

  /**
   * A1 触发器③：空闲时预取 1 条最高优先候选。
   * 只在回到首页 / `/offline` 时跑（最近访问 top 3 的语义就是「回来找东西」），
   * 且只取 1 条；视频下一集、场景落地页由各自的持有方（播放器页 /
   * buildSceneLandingCandidate 的调用方）供候选，这里不越俎代庖。
   */
  useEffect(() => {
    if (pathname !== '/' && pathname !== '/offline') return
    if (typeof window === 'undefined') return
    let cancelled = false
    const task = scheduleIdle(() => {
      if (cancelled) return
      void readOfflineVisits()
        .then((visits) => {
          if (cancelled) return
          if (!isRoutePrefetchNetworkAllowed(getConnection(), navigator.onLine)) return
          const candidates = buildRecentCandidates(visits, pathname, undefined, window.location.origin)
          if (candidates.length === 0) return
          const picked = pickIdlePrefetchCandidate(
            candidates,
            getSharedRoutePrefetchSession(),
            { networkAllowed: true, currentHref: pathname },
          )
          if (picked) router.prefetch(picked.href)
        })
        .catch(() => {
          // 空闲预取失败不打扰用户：下次回到首页再试。
        })
    })
    return () => {
      cancelled = true
      task.cancel()
    }
  }, [pathname, router])

  return <>{children}</>
}
