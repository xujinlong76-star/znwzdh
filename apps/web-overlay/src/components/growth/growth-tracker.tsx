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
 *    本组件监听后落账（挂件本身不写成长档案）。
 * 本组件不渲染任何可见 UI。
 * （注：不再在根布局无条件拦截 beforeinstallprompt 并调用 preventDefault，
 *  避免在 /marketplace/*、/submit 等无安装引导页触发浏览器
 *  "Banner not shown: beforeinstallpromptevent.preventDefault() called" 告警；
 *  改为由实际渲染安装按钮的 InstallPrompt / HomepageGuideCard 按需接管。）
 */

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  AI_CHAT_USED_EVENT,
  FAVORITE_ADDED_EVENT,
  GROWTH_UPDATED_EVENT,
  claimPwaInstallAction,
  growthDayKey,
  loadGrowthProfile,
  markMemberSeenAction,
  openDailyChestLazy,
  recordDailyVisitOnce,
  recordGrowthEvent,
  recordIdleMinute,
  recordPageVisitAction,
} from '@/lib/growth-lazy'
import { probeClientSession } from '@/lib/client-session'
import { toast } from '@/components/ui/use-toast'
import { ToastAction } from '@/components/ui/toast'

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
    recordDailyVisitOnce()
    // 身份档：探测登录态同步进成长档案（×1.2 档）；探测失败不猜、不改
    let cancelled = false
    void probeClientSession().then((probe) => {
      if (cancelled) return
      if (probe.kind === 'ok') markMemberSeenAction(!!probe.session.user?.id)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // PWA 真实安装（appinstalled 事件）→ +60 一次性奖励 + ×1.5 身份档
  useEffect(() => {
    const onInstalled = () => claimPwaInstallAction()
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
        recordGrowthEvent('site_open', { siteKey: siteKeyOf(anchor.href) })
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

  // 小猫猫挂件喂猫桥（互动玩法第一批 Top 3：拖链接喂猫收藏）：挂件只 dispatch 事件，落账走统一规则
  useEffect(() => {
    const onWidgetFav = (e: Event) => {
      const siteId = (e as CustomEvent<{ siteId?: string }>).detail?.siteId
      recordGrowthEvent('favorite_add', { siteId })
    }
    window.addEventListener(FAVORITE_ADDED_EVENT, onWidgetFav)
    return () => window.removeEventListener(FAVORITE_ADDED_EVENT, onWidgetFav)
  }, [])

  // 跨页全清宝箱回流闭环：监听成长档案更新事件，当用户在首页/搜索页/简报页等
  // 站内任意非 /me/growth 页面刚完成今日第 3 件任务且宝箱可领时，弹出轻量 Toast，
  // 支持点击「一键开宝箱」原地结算奖励，无需专门跳回用户中心。
  const chestToastedDayRef = useRef<string | null>(null)
  const pathnameRef = useRef<string | null>(pathname)
  pathnameRef.current = pathname

  useEffect(() => {
    const isDailyAllClearReady = () => {
      try {
        const profile = loadGrowthProfile()
        const key = growthDayKey(new Date())
        const day = profile.days[key]
        if (!day || day.chestGranted) return { ready: false, key }
        const granted = new Set(day.dailyGranted || [])
        const ready = granted.has('shallow') && granted.has('core') && granted.has('settle')
        return { ready, key }
      } catch {
        return { ready: false, key: '' }
      }
    }

    // 初始已全清的会话不再重复弹（只捕捉本次会话内“刚完成第 3 件事”的瞬间）
    const init = isDailyAllClearReady()
    if (init.ready) chestToastedDayRef.current = init.key

    const onGrowthUpdated = () => {
      const { ready, key } = isDailyAllClearReady()
      if (!ready || !key || chestToastedDayRef.current === key) return
      // 已在 /me/growth 页内则直接看到发光宝箱按钮，不额外弹窗打扰
      if (pathnameRef.current === '/me/growth') {
        chestToastedDayRef.current = key
        return
      }
      chestToastedDayRef.current = key
      toast({
        title: '🎁 今日三件事已全清',
        description: '每日全清宝箱已就绪，可直接原地开启领取经验或冻结卡。',
        action: (
          <ToastAction
            altText="一键开宝箱"
            onClick={() => {
              void openDailyChestLazy().then((res) => {
                if (!res || !res.ok) {
                  window.location.href = '/me/growth?openChest=1'
                  return
                }
                const rewardText = res.gotCard
                  ? `固定 +${res.fixedXp} XP，额外获得 1 张冻结卡！`
                  : res.tier === 'card'
                    ? `固定 +${res.fixedXp} XP（冻结卡已满，折算 +${res.bonusXp} XP）`
                    : `固定 +${res.fixedXp} XP + 随机 +${res.bonusXp} XP`
                toast({
                  title: '✨ 宝箱已开启',
                  description: rewardText,
                })
              })
            }}
          >
            一键开宝箱
          </ToastAction>
        ),
      })
    }

    window.addEventListener(GROWTH_UPDATED_EVENT, onGrowthUpdated)
    return () => window.removeEventListener(GROWTH_UPDATED_EVENT, onGrowthUpdated)
  }, [])

  // 注：beforeinstallprompt 不再在此处全局 preventDefault，避免在未展示安装引导的子页触发浏览器告警。
  // 需要安装入口时由 InstallPrompt（首页满足条件时）与 HomepageGuideCard（实际挂载时）按需监听。

  useEffect(() => {
    if (!pathname) return
    const key = `${pathname}?${searchParams?.toString() ?? ''}`
    if (awardedRoutes.current.has(key)) return
    const categoryMatch = pathname.match(/^\/category\/([^/]+)/)
    if (categoryMatch) {
      awardedRoutes.current.add(key)
      const slug = decodeURIComponent(categoryMatch[1]!)
      recordGrowthEvent('category_visit', { categoryId: slug })
      if (slug === 'duanju' || slug === 'short-drama') recordGrowthEvent('drama_visit')
      return
    }
    if (pathname === '/search' && searchParams?.get('q')) {
      awardedRoutes.current.add(key)
      recordGrowthEvent('search', { term: searchParams.get('q') ?? undefined })
      return
    }
    if (pathname === '/brief') {
      awardedRoutes.current.add(key)
      recordGrowthEvent('brief_read')
      return
    }
    if (pathname === '/hot') {
      awardedRoutes.current.add(key)
      recordPageVisitAction('hot')
    }
  }, [pathname, searchParams])

  return null
}
