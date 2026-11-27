'use client'

import { useEffect } from 'react'

/**
 * Web Vitals 采集（零依赖）。
 *
 * 为什么手写而不用 web-vitals 包：本仓的依赖安装层曾经很脆弱（见
 * docs/UPGRADE-EXECUTION-REPORT-2026-10-17.md §5.1），为 100 行采集逻辑
 * 引入一个新依赖不划算；PerformanceObserver 的四个条目类型足够覆盖
 * LCP / CLS / INP / TTFB。
 *
 * 开关：NEXT_PUBLIC_RUM=1 时启用（默认关闭，避免个人部署把数据发到中枢）。
 * 落点：POST /api/hub/api/vitals → 中枢 events 表（kind=vitals）。
 * 隐私：只上报指标名、数值、评级与 pathname；**不带 query、不带身份**。
 */

const ENDPOINT = '/api/hub/api/vitals'
const ENABLED = process.env.NEXT_PUBLIC_RUM === '1'

type VitalName = 'LCP' | 'INP' | 'CLS' | 'TTFB' | 'FCP'

/** Core Web Vitals 阈值（Google 2024 口径） */
function rate(name: VitalName, value: number): 'good' | 'needs-improvement' | 'poor' {
  const t: Record<VitalName, [number, number]> = {
    LCP: [2500, 4000],
    INP: [200, 500],
    CLS: [0.1, 0.25],
    TTFB: [800, 1800],
    FCP: [1800, 3000],
  }
  const [good, poor] = t[name]
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor'
}

export function WebVitalsReporter() {
  useEffect(() => {
    if (!ENABLED) return
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return

    const sent = new Set<VitalName>()
    const pending = new Map<VitalName, number>()

    const flush = () => {
      for (const [name, value] of pending) {
        if (sent.has(name) || !Number.isFinite(value) || value < 0) continue
        sent.add(name)
        const body = JSON.stringify({
          name,
          value: Math.round(value * 100) / 100,
          rating: rate(name, value),
          path: window.location.pathname,
        })
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

    const observe = (type: string, cb: (entries: PerformanceEntryList) => void) => {
      try {
        const po = new PerformanceObserver((list) => cb(list.getEntries()))
        po.observe({ type, buffered: true } as PerformanceObserverInit)
        return po
      } catch {
        // 浏览器不支持该条目类型：静默跳过，不影响页面
        return null
      }
    }

    const observers: Array<PerformanceObserver | null> = []

    // LCP：只取最后一次候选（页面隐藏前）
    let lcp = 0
    observers.push(
      observe('largest-contentful-paint', (entries) => {
        const last = entries[entries.length - 1] as PerformanceEntry | undefined
        if (last) lcp = last.startTime
        pending.set('LCP', lcp)
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

    // INP 近似：取所有事件里最长的 duration（event timing 需要 durationThreshold）
    let inp = 0
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries() as Array<PerformanceEntry & { duration: number }>) {
          if (e.duration > inp) inp = e.duration
        }
        pending.set('INP', inp)
      })
      po.observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit)
      observers.push(po)
    } catch {
      // Safari 早期版本不支持 event timing
    }

    // FCP / TTFB：paint 与 navigation 条目只发一次
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
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      for (const po of observers) po?.disconnect()
    }
  }, [])

  return null
}
