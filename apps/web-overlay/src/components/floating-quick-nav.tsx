'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { ArrowUp, Search, Wrench } from 'lucide-react'
import { preferredScrollBehavior } from '@/lib/motion'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import { cn } from '@/lib/utils'

interface FloatingQuickNavProps {
  onOpenTools?: () => void
  className?: string
  /** 全局版：挂在 providers，与首页实例互补；首页（'/'）与 /videos* 下不渲染 */
  global?: boolean
  /** 滚动显现阈值（px）：首页实例 300，全局版 100（深链内页首屏本无搜索入口） */
  threshold?: number
}

export function FloatingQuickNav({ onOpenTools, className, global = false, threshold = 300 }: FloatingQuickNavProps) {
  const [visible, setVisible] = useState(false)
  const [isScrollingDown, setIsScrollingDown] = useState(false)
  const lastScrollYRef = useRef(0)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { isEditingLayout } = useHomeDIY()
  const pathname = usePathname() ?? '/'

  const checkScroll = useCallback(() => {
    if (typeof window === 'undefined') return
    const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0
    setVisible(scrollY > threshold)

    const prevY = lastScrollYRef.current
    if (scrollY > prevY + 12 && scrollY > 200) {
      // 向下快速浏览卡片时自动淡出避让，防止遮挡卡片与标签
      setIsScrollingDown(true)
    } else if (scrollY < prevY - 6) {
      // 向上滚动时立即可见
      setIsScrollingDown(false)
    }
    lastScrollYRef.current = scrollY

    // 滚动停止 250ms 后平滑浮现
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      setIsScrollingDown(false)
    }, 250)
  }, [threshold])

  useEffect(() => {
    checkScroll()
    window.addEventListener('scroll', checkScroll, { passive: true })
    document.addEventListener('scroll', checkScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', checkScroll)
      document.removeEventListener('scroll', checkScroll)
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    }
  }, [checkScroll])

  // 全局版只补首页之外的缺口：首页已有带微工具键的实例（navigation-content 挂载），
  // /videos 路由自带 fixed bottom-0 播放器面板（MobileNav 同款避让），都不重复挂。
  if (global && (pathname === '/' || pathname.startsWith('/videos'))) return null

  const scrollToTop = () => {
    if (typeof window === 'undefined') return
    window.scrollTo({
      top: 0,
      behavior: preferredScrollBehavior(),
    })
  }

  const openSpotlight = () => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('open-spotlight'))
  }

  return (
    <aside
      id="navhub-floating-quick-nav"
      aria-label="快速操作与回到顶部"
      className={cn(
        'fixed right-4 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+3rem)] sm:right-4 sm:bottom-12 z-40 flex flex-row items-center gap-1 p-0.5 rounded-full border border-border/70 bg-background/80 dark:bg-card/75 backdrop-blur-md shadow-xs transition-all duration-200',
        visible && !isEditingLayout && !isScrollingDown ? 'opacity-90 hover:opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none',
        className,
      )}
    >
      <button
        type="button"
        onClick={scrollToTop}
        className="h-11 w-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
        title="回到顶部 (Top)"
        aria-label="回到顶部"
      >
        <ArrowUp className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-border/60" />

      <button
        type="button"
        onClick={openSpotlight}
        className="h-11 w-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
        title="呼出超级搜索与指令控制台 (⌘K / /)"
        aria-label="呼出超级搜索控制台"
        aria-keyshortcuts="/"
      >
        <Search className="w-3.5 h-3.5" />
      </button>

      {onOpenTools && (
        <>
          <div className="w-px h-4 bg-border/60" />
          <button
            type="button"
            onClick={onOpenTools}
            className="h-11 w-11 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
            title="打开开发者极速微工具箱 (T)"
            aria-label="开发者极速微工具箱"
          >
            <Wrench className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </aside>
  )
}
