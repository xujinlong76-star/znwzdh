'use client'

/**
 * 成长档案的全局感知层（挂在根 layout，一次挂载全站生效）：
 *  - 每日首次到访：记活跃日 + 连续访问天数（recordDailyVisitOnce 内部判重）；
 *  - 挂机经验：页面可见时累计秒数，满 60 秒记 1 分钟经验，切后台即停
 *    （visibilityState 控制），每日上限在 growth.ts 里封顶；
 *  - 路由感知：进分类页记 category_visit（短剧分类额外记 drama_visit），
 *    进搜索结果页记 search；同一路由键一会话只记一次，避免重复渲染刷计数；
 *  - 点开外站链接记 site_open（经验规则里有每日递减，刷不动）；
 *  - 小猫猫挂件聊天记 ai_chat：挂件只 dispatch navhub:ai-chat-used 事件，
 *    本组件监听后落账（挂件本身不写成长档案）；
 *  - 捕获 PWA 的 beforeinstallprompt，供「设为首页」引导组件使用。
 * 本组件不渲染任何可见 UI。
 *
 * 包体积：lib/growth.ts（约 32KB）只在 effect 里用，静态 import 会经根
 * layout 进全部路由首屏（/sites 曾因此超预算）。这里只留动态 import
 * 入口（单例 promise，chunk 只拉一次），首屏 chunk 不再含 growth.ts；
 * 记录类 effect 晚一个 chunk 启动（后台附带行为，内部有去重/幂等，
 * 首 200ms 内的事件可能漏记一次；chunk 拉取失败如离线首访时本次记账
 * 静默跳过，不报错、不阻断页面）。
 */

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { probeClientSession } from '@/lib/client-session'

type GrowthModule = typeof import('@/lib/growth')

let growthPromise: Promise<GrowthModule> | null = null
/** 成长模块按需加载：import 结果由模块缓存 + 单例 promise 保证只加载一次。 */
const loadGrowth = () => (growthPromise ??= import('@/lib/growth'))

/** 记账类调用统一走这里：chunk 拉取失败时静默跳过，不抛未处理 rejection。 */
function recordGrowth(fn: (g: GrowthModule) => void): void {
  loadGrowth().then(fn).catch(() => { /* chunk 拉取失败时静默跳过本次记账，不抛未处理 rejection */ })
}

/** 站点 key 规范化（同站同日硬化与百站寻宝的去重口径）：去 query/hash 与尾斜杠 */
function siteKeyOf(href: string): string {
  try {
    const u = new URL(href)
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return href.split(/[?#]/)[0]!.replace(/\/+$/, '')
  }
}

declare global {
  interface Window {
    __navhubInstallPrompt?: Event & { prompt: () => Promise<void> }
  }
}

export function GrowthTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const awardedRoutes = useRef<Set<string>>(new Set())

  useEffect(() => {
    // 身份档：探测登录态同步进成长档案（×1.2 档）；探测失败不猜、不改
    let cancelled = false
    loadGrowth()
      .then((g) => {
        if (cancelled) return
        g.recordDailyVisitOnce()
        void probeClientSession().then((probe) => {
          if (cancelled) return
          if (probe.kind === 'ok') g.markMemberSeenAction(!!probe.session.user?.id)
        })
      })
      .catch(() => { /* chunk 拉取失败时跳过本次到访记账，不报错 */ })
    return () => {
      cancelled = true
    }
  }, [])

  // PWA 真实安装（appinstalled 事件）→ +60 一次性奖励 + ×1.5 身份档
  useEffect(() => {
    const onInstalled = () => recordGrowth((g) => g.claimPwaInstallAction())
    window.addEventListener('appinstalled', onInstalled)
    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])

  useEffect(() => {
    let visibleSeconds = 0
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      visibleSeconds += 1
      if (visibleSeconds >= 60) {
        visibleSeconds -= 60
        recordGrowth((g) => g.recordIdleMinute())
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const anchor = target?.closest?.('a[href^="http"]') as HTMLAnchorElement | null
      if (anchor && !anchor.href.startsWith(window.location.origin)) {
        const siteKey = siteKeyOf(anchor.href)
        recordGrowth((g) => g.recordGrowthEvent('site_open', { siteKey }))
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  // 小猫猫挂件聊天桥（A12）：挂件只发事件，落账仍走统一规则
  // 事件名本身活在 growth.ts 里：监听须等 chunk 加载后注册，cleanup 用
  // 存下的事件名 + handler 解绑。
  useEffect(() => {
    let cancelled = false
    let eventName: string | undefined
    let onWidgetChat: (() => void) | undefined
    loadGrowth()
      .then((g) => {
        if (cancelled) return
        eventName = g.AI_CHAT_USED_EVENT
        onWidgetChat = () => recordGrowth((gg) => gg.recordGrowthEvent('ai_chat'))
        window.addEventListener(eventName, onWidgetChat)
      })
      .catch(() => { /* chunk 拉取失败时不注册聊天监听，本次会话的 ai_chat 记账跳过 */ })
    return () => {
      cancelled = true
      if (onWidgetChat && eventName) window.removeEventListener(eventName, onWidgetChat)
    }
  }, [])

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      window.__navhubInstallPrompt = e as Window['__navhubInstallPrompt']
      window.dispatchEvent(new CustomEvent('navhub:install-available'))
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  useEffect(() => {
    if (!pathname) return
    const key = `${pathname}?${searchParams?.toString() ?? ''}`
    if (awardedRoutes.current.has(key)) return
    const categoryMatch = pathname.match(/^\/category\/([^/]+)/)
    if (categoryMatch) {
      awardedRoutes.current.add(key)
      const slug = decodeURIComponent(categoryMatch[1]!)
      recordGrowth((g) => {
        g.recordGrowthEvent('category_visit', { categoryId: slug })
        if (slug === 'duanju' || slug === 'short-drama') g.recordGrowthEvent('drama_visit')
      })
      return
    }
    if (pathname === '/search' && searchParams?.get('q')) {
      awardedRoutes.current.add(key)
      const term = searchParams.get('q') ?? undefined
      recordGrowth((g) => g.recordGrowthEvent('search', { term }))
      return
    }
    if (pathname === '/brief') {
      awardedRoutes.current.add(key)
      recordGrowth((g) => g.recordGrowthEvent('brief_read'))
      return
    }
    if (pathname === '/hot') {
      awardedRoutes.current.add(key)
      recordGrowth((g) => g.recordPageVisitAction('hot'))
    }
  }, [pathname, searchParams])

  return null
}
