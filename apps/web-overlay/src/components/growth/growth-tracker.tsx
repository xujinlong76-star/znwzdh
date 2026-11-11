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
 */

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { AI_CHAT_USED_EVENT, recordDailyVisitOnce, recordGrowthEvent, recordIdleMinute } from '@/lib/growth'

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
    recordDailyVisitOnce()
  }, [])

  useEffect(() => {
    let visibleSeconds = 0
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      visibleSeconds += 1
      if (visibleSeconds >= 60) {
        visibleSeconds -= 60
        recordIdleMinute()
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const anchor = target?.closest?.('a[href^="http"]') as HTMLAnchorElement | null
      if (anchor && !anchor.href.startsWith(window.location.origin)) {
        recordGrowthEvent('site_open')
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  // 小猫猫挂件聊天桥（A12）：挂件只发事件，落账仍走统一规则
  useEffect(() => {
    const onWidgetChat = () => recordGrowthEvent('ai_chat')
    window.addEventListener(AI_CHAT_USED_EVENT, onWidgetChat)
    return () => window.removeEventListener(AI_CHAT_USED_EVENT, onWidgetChat)
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
      recordGrowthEvent('category_visit', { categoryId: slug })
      if (slug === 'duanju') recordGrowthEvent('drama_visit')
      return
    }
    if (pathname === '/search' && searchParams?.get('q')) {
      awardedRoutes.current.add(key)
      recordGrowthEvent('search')
    }
  }, [pathname, searchParams])

  return null
}
