'use client'

import { useEffect } from 'react'
import {
  computeInpFromInteractions,
  parseRumSampleRate,
  rateWebVital,
  shouldSampleRum,
  type VitalName,
} from '@/lib/web-vitals-metrics'

/**
 * Web Vitals 采集（零依赖，P0-1 升级版）。
 *
 * 升级要点：
 * 1. 支持采样率 `NEXT_PUBLIC_RUM_SAMPLE`（默认 0.1 = 10% 会话采样），控制中枢写入量；
 * 2. INP 改为按 `interactionId` 聚合并按 Chrome 口径取 p98，修复旧版「取最长单个事件」的系统性高估；
 * 3. 首次用户输入（pointerdown/keydown）后立即锁定 LCP，避免后续懒挂载元素污染指标；
 * 4. 隐私安全归因：附加 `cardMode`、`focused`、`effectiveType`、LCP 节点摘要与 LoAF 最长脚本路径（不含 query 与身份）。
 *
 * 开关：NEXT_PUBLIC_RUM=1 时启用（默认关闭，避免个人部署把数据发到中枢）。
 * 落点：POST /api/hub/api/vitals → 中枢 events 表（kind=vitals）。
 */

const ENDPOINT = '/api/hub/api/vitals'
const ENABLED = process.env.NEXT_PUBLIC_RUM === '1'
const SAMPLE_RATE = parseRumSampleRate(process.env.NEXT_PUBLIC_RUM_SAMPLE, 0.1)

function describeElement(el: Element | null | undefined): string | undefined {
  if (!el) return undefined
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id.slice(0, 32)}` : ''
  const testId = el.getAttribute('data-testid')
  if (testId) return `${tag}[data-testid="${testId.slice(0, 40)}"]`
  if (id) return `${tag}${id}`
  return tag
}

function readEffectiveType(): string | undefined {
  try {
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection
    return typeof conn?.effectiveType === 'string' ? conn.effectiveType : undefined
  } catch {
    return undefined
  }
}

export function WebVitalsReporter() {
  useEffect(() => {
    if (!ENABLED) return
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return
    if (!shouldSampleRum(SAMPLE_RATE)) return

    const sent = new Set<VitalName>()
    const pending = new Map<VitalName, number>()
    const interactionDurations = new Map<number, number>()
    let lcpFinalized = false
    let lcpElement: string | undefined
    let longestLoafScript: string | undefined
    let longestLoafDuration = 0

    const readContext = () => {
      const mainEl = document.getElementById('main-content')
      const cardMode = mainEl?.getAttribute('data-card-mode') || undefined
      const focused = Boolean(document.querySelector('[data-testid="focused-category-bar"]'))
      return {
        cardMode,
        focused,
        effectiveType: readEffectiveType(),
      }
    }

    const flush = () => {
      if (interactionDurations.size > 0) {
        pending.set('INP', computeInpFromInteractions(interactionDurations.values()))
      }
      const ctx = readContext()
      for (const [name, value] of pending) {
        if (sent.has(name) || !Number.isFinite(value) || value < 0) continue
        sent.add(name)
        const payload: Record<string, unknown> = {
          name,
          value: Math.round(value * 100) / 100,
          rating: rateWebVital(name, value),
          path: window.location.pathname,
          ...ctx,
        }
        if (name === 'LCP' && lcpElement) payload.element = lcpElement
        if (name === 'INP' && longestLoafScript) payload.loafScript = longestLoafScript
        const body = JSON.stringify(payload)
        try {
          const blob = new Blob([body], { type: 'application/json' })
          if (navigator.sendBeacon?.(ENDPOINT, blob)) continue
        } catch {
          // sendBeacon 失败（隐私模式 / 不支持）时退回 fetch keepalive
        }
        void fetch(ENDPOINT, {
          method: 'POST',
          body,
          headers: { 'content-type': 'application/json' },
          keepalive: true,
        }).catch(() => {
          /* 上报失败不影响页面：这是纯遥测，丢一条无所谓 */
        })
      }
    }

    const observe = (type: string, cb: (entries: PerformanceEntryList) => void, extra?: Record<string, unknown>) => {
      try {
        const po = new PerformanceObserver((list) => cb(list.getEntries()))
        po.observe({ type, buffered: true, ...extra } as PerformanceObserverInit)
        return po
      } catch {
        return null
      }
    }

    const observers: Array<PerformanceObserver | null> = []

    // 首次用户输入后锁定 LCP（防止后续懒挂载节点污染 LCP）
    const lockLcp = () => {
      lcpFinalized = true
    }
    window.addEventListener('pointerdown', lockLcp, { once: true, capture: true })
    window.addEventListener('keydown', lockLcp, { once: true, capture: true })

    // LCP：只取用户输入前的最后一次候选
    observers.push(
      observe('largest-contentful-paint', (entries) => {
        if (lcpFinalized) return
        const last = entries[entries.length - 1] as (PerformanceEntry & { element?: Element | null }) | undefined
        if (last) {
          pending.set('LCP', last.startTime)
          lcpElement = describeElement(last.element)
        }
      }),
    )

    // CLS：累加「非用户输入触发」的布局偏移
    let cls = 0
    observers.push(
      observe('layout-shift', (entries) => {
        for (const e of entries as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
          if (!e.hadRecentInput) cls += e.value
        }
        pending.set('CLS', cls)
      }),
    )

    // INP：按 interactionId 归并，每交互取最大耗时，flush 时按 p98 汇总
    observers.push(
      observe(
        'event',
        (entries) => {
          for (const e of entries as Array<PerformanceEntry & { duration: number; interactionId?: number }>) {
            const id = e.interactionId ?? 0
            if (id <= 0) continue
            const prev = interactionDurations.get(id) ?? 0
            if (e.duration > prev) interactionDurations.set(id, e.duration)
          }
          if (interactionDurations.size > 0) {
            pending.set('INP', computeInpFromInteractions(interactionDurations.values()))
          }
        },
        { durationThreshold: 40 },
      ),
    )

    // LoAF（Long Animation Frames）：记录最长阻塞脚本路径（不含 query）用于 INP 归因
    observers.push(
      observe('long-animation-frame', (entries) => {
        for (const frame of entries as Array<PerformanceEntry & { duration: number; scripts?: Array<{ sourceURL?: string; duration?: number }> }>) {
          if (frame.duration <= longestLoafDuration || !Array.isArray(frame.scripts)) continue
          longestLoafDuration = frame.duration
          let topScript: { sourceURL?: string; duration?: number } | null = null
          for (const s of frame.scripts) {
            if (!topScript || (s.duration ?? 0) > (topScript.duration ?? 0)) topScript = s
          }
          if (topScript?.sourceURL) {
            try {
              const u = new URL(topScript.sourceURL, window.location.origin)
              longestLoafScript = u.pathname.slice(0, 120)
            } catch {
              // ignore invalid URL
            }
          }
        }
      }),
    )

    // FCP / TTFB
    observers.push(
      observe('paint', (entries) => {
        for (const e of entries) {
          if (e.name === 'first-contentful-paint') pending.set('FCP', e.startTime)
        }
      }),
    )
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      if (nav) pending.set('TTFB', nav.responseStart)
    } catch {
      // ignore
    }

    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)

    return () => {
      flush()
      window.removeEventListener('pointerdown', lockLcp, true)
      window.removeEventListener('keydown', lockLcp, true)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      for (const po of observers) po?.disconnect()
    }
  }, [])

  return null
}
