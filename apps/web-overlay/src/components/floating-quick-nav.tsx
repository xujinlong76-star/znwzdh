'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowUp, Search, Wrench } from 'lucide-react'
import { preferredScrollBehavior } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface FloatingQuickNavProps {
  onOpenTools?: () => void
  className?: string
}

export function FloatingQuickNav({ onOpenTools, className }: FloatingQuickNavProps) {
  const [visible, setVisible] = useState(false)

  const checkScroll = useCallback(() => {
    if (typeof window === 'undefined') return
    const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0
    setVisible(scrollY > 300)
  }, [])

  useEffect(() => {
    checkScroll()
    window.addEventListener('scroll', checkScroll, { passive: true })
    document.addEventListener('scroll', checkScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', checkScroll)
      document.removeEventListener('scroll', checkScroll)
    }
  }, [checkScroll])

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
        'fixed right-3 sm:right-6 bottom-6 z-40 flex flex-col items-center gap-1.5 p-1.5 rounded-2xl border border-border/80 bg-background/90 dark:bg-card/85 backdrop-blur-md shadow-xl ring-1 ring-inset ring-white/10 transition-all duration-200',
        visible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none',
        className,
      )}
    >
      <button
        type="button"
        onClick={scrollToTop}
        className="w-8.5 h-8.5 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-150 touch-manipulation select-none active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
        title="回到顶部 (Top)"
        aria-label="回到顶部"
      >
        <ArrowUp className="w-4 h-4" />
      </button>

      <div className="w-5 h-px bg-border/60" />

      <button
        type="button"
        onClick={openSpotlight}
        className="w-8.5 h-8.5 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10 transition-all duration-150 touch-manipulation select-none active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 cursor-pointer"
        title="呼出超级搜索与指令控制台 (⌘K / /)"
        aria-label="呼出超级搜索控制台"
      >
        <Search className="w-4 h-4" />
      </button>

      {onOpenTools && (
        <button
          type="button"
          onClick={onOpenTools}
          className="w-8.5 h-8.5 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-all duration-150 touch-manipulation select-none active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 cursor-pointer"
          title="打开开发者极速微工具箱 (T)"
          aria-label="开发者极速微工具箱"
        >
          <Wrench className="w-4 h-4" />
        </button>
      )}
    </aside>
  )
}
