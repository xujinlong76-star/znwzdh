'use client'

import { useEffect, useRef } from 'react'
import {
  calculateMotionVector,
  isHeadingTowardsRect,
  extractSafeOrigin,
  shouldPreconnectOrigin,
  type Point,
} from '@/lib/prefetch'

const MAX_PRECONNECTS = 8
const THROTTLE_MS = 60
// 注入 link 节点总数上限（dns-prefetch + preconnect 各一，共 2×origins），防 DOM 无限膨胀
const MAX_INJECTED_LINKS = MAX_PRECONNECTS * 2

export function PredictivePrefetchProvider({ children }: { children: React.ReactNode }) {
  const lastPointRef = useRef<Point | null>(null)
  const lastTimeRef = useRef<number>(0)
  const connectedOriginsRef = useRef<Set<string>>(new Set())
  const injectedLinksRef = useRef<HTMLLinkElement[]>([])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const preconnectOrigin = (origin: string) => {
      if (!shouldPreconnectOrigin(origin, connectedOriginsRef.current, MAX_PRECONNECTS)) {
        return
      }
      // 去重上限：已注入节点过多则拒绝新增（防长会话 DOM 膨胀）
      if (injectedLinksRef.current.length >= MAX_INJECTED_LINKS) return

      connectedOriginsRef.current.add(origin)

      // 动态注入 dns-prefetch 与 preconnect
      const dnsLink = document.createElement('link')
      dnsLink.rel = 'dns-prefetch'
      dnsLink.href = origin
      dnsLink.dataset.predictivePrefetch = '1'
      document.head.appendChild(dnsLink)
      injectedLinksRef.current.push(dnsLink)

      const preconnLink = document.createElement('link')
      preconnLink.rel = 'preconnect'
      preconnLink.href = origin
      preconnLink.crossOrigin = 'anonymous'
      preconnLink.dataset.predictivePrefetch = '1'
      document.head.appendChild(preconnLink)
      injectedLinksRef.current.push(preconnLink)
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
          const links = document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')
          for (let i = 0; i < links.length; i++) {
            const a = links[i]
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
      }

      lastPointRef.current = currentPoint
    }

    const onPointerDown = (e: PointerEvent) => {
      // 物理按下瞬间 (Mousedown) 提前于 Click 触发即刻预连接
      const target = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="http"]')
      if (target && target.href) {
        const origin = extractSafeOrigin(target.href)
        if (origin) {
          preconnectOrigin(origin)
        }
      }
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })

    const injectedLinks = injectedLinksRef.current
    const connectedOrigins = connectedOriginsRef.current

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      // 卸载清理：移除本 provider 注入的 link，释放 Set/point 引用（防 SPA 切页泄漏）
      for (const el of injectedLinks) {
        el.remove()
      }
      injectedLinks.length = 0
      connectedOrigins.clear()
      lastPointRef.current = null
    }
  }, [])

  return <>{children}</>
}
