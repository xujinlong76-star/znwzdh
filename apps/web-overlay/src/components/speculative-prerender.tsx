'use client'

/**
 * 客户端自适应推测性预渲染与预取守护组件 (Speculative Prerender Sentinel)
 *
 * 核心机制：
 * 1. 动态特性探测：检测浏览器是否原生支持 W3C Speculation Rules API
 * 2. 意图嗅探：监听卡尔曼轨迹推断与卡片精准悬浮事件，编译动态预渲染与预取规则
 * 3. 智能回退：对低版本浏览器降级使用 <link rel="prefetch/prerender">
 * 4. 资源熔断：限制并发预渲染不超过 2 个、预取不超过 5 个，阻断高危敏感路径
 */

import { useEffect } from 'react'

export interface SpeculationCandidate {
  url: string
  confidence: number
  predictedArrivalMs: number
}

const DEFAULT_UNSAFE_PATTERNS = [
  /\/logout/i,
  /\/signout/i,
  /\/delete/i,
  /\/destroy/i,
  /\/api\/tokens/i,
  /\/admin/i,
]

function isSafeForSpeculation(url: string): boolean {
  if (!url || typeof url !== 'string') return false
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    for (const pattern of DEFAULT_UNSAFE_PATTERNS) {
      if (pattern.test(parsed.pathname)) return false
    }
    return true
  } catch {
    return false
  }
}

function compileRules(candidates: SpeculationCandidate[]) {
  const safe = candidates.filter((c) => isSafeForSpeculation(c.url))
  if (safe.length === 0) return null

  safe.sort((a, b) => b.confidence - a.confidence || a.predictedArrivalMs - b.predictedArrivalMs)

  const prerenderUrls: string[] = []
  const prefetchUrls: string[] = []

  for (const c of safe) {
    if (c.confidence >= 0.82 && prerenderUrls.length < 2) {
      prerenderUrls.push(c.url)
    } else if (c.confidence >= 0.45 && prefetchUrls.length < 5) {
      if (!prerenderUrls.includes(c.url)) {
        prefetchUrls.push(c.url)
      }
    }
  }

  if (prerenderUrls.length === 0 && prefetchUrls.length === 0) return null

  return {
    ...(prerenderUrls.length > 0
      ? { prerender: [{ source: 'list' as const, urls: prerenderUrls, eagerness: 'immediate' as const }] }
      : {}),
    ...(prefetchUrls.length > 0
      ? { prefetch: [{ source: 'list' as const, urls: prefetchUrls, eagerness: 'moderate' as const }] }
      : {}),
  }
}

const SCRIPT_ID = 'navhub-speculation-rules'

export function SpeculativePrerenderManager() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const supportsSpeculationRules =
      typeof HTMLScriptElement !== 'undefined' &&
      typeof (HTMLScriptElement as any).supports === 'function' &&
      (HTMLScriptElement as any).supports('speculationrules')

    const activeUrls = new Set<string>()

    const updateSpeculationRules = (candidates: SpeculationCandidate[]) => {
      const payload = compileRules(candidates)
      if (!payload) return

      if (supportsSpeculationRules) {
        let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
        if (!script) {
          script = document.createElement('script')
          script.id = SCRIPT_ID
          script.type = 'speculationrules'
          document.head.appendChild(script)
        }
        script.textContent = JSON.stringify(payload, null, 2)
      } else {
        // Fallback for Safari / legacy browsers
        const prerenders = payload.prerender?.[0]?.urls || []
        const prefetches = payload.prefetch?.[0]?.urls || []

        for (const url of [...prerenders, ...prefetches]) {
          if (!activeUrls.has(url) && isSafeForSpeculation(url)) {
            activeUrls.add(url)
            const link = document.createElement('link')
            link.rel = prerenders.includes(url) ? 'prerender' : 'prefetch'
            link.href = url
            // 打标记：卸载时只摘掉本组件注入的链接。
            // 不能按 link[rel=prefetch] 全删 —— Next App Router 自己也用 prefetch 链接。
            link.dataset.navhubSpeculation = '1'
            document.head.appendChild(link)
          }
        }
      }
    }

    // 1. 监听自定义推测事件（可由 Kalman 轨迹过滤器触发）
    const handleSpeculationEvent = (e: Event) => {
      const customEvent = e as CustomEvent<SpeculationCandidate[]>
      if (Array.isArray(customEvent.detail)) {
        updateSpeculationRules(customEvent.detail)
      }
    }

    // 2. 悬停微意图嗅探：卡片 touchstart / mouseenter 即刻赋予 0.85 置信度推测
    const handlePointerOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('a[href]') as HTMLAnchorElement | null
      if (!target || !target.href) return
      const href = target.href
      if (isSafeForSpeculation(href)) {
        updateSpeculationRules([
          {
            url: href,
            confidence: 0.88,
            predictedArrivalMs: 120,
          },
        ])
      }
    }

    window.addEventListener('navhub_speculation_candidate', handleSpeculationEvent)
    document.addEventListener('mouseover', handlePointerOver, { passive: true })

    return () => {
      window.removeEventListener('navhub_speculation_candidate', handleSpeculationEvent)
      document.removeEventListener('mouseover', handlePointerOver)
      const script = document.getElementById(SCRIPT_ID)
      if (script) script.remove()
      // 兜底注入的 <link> 也要摘掉：此前只删了 script，
      // 低版本浏览器下这些链接会留在 document.head 里跨路由累积。
      document
        .querySelectorAll('link[data-navhub-speculation="1"]')
        .forEach((el) => el.remove())
    }
  }, [])

  return null
}
