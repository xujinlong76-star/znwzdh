'use client'

import { useState, useEffect, useCallback } from 'react'
import { ArrowUp, Search, Wrench } from 'lucide-react'
import { preferredScrollBehavior } from '@/lib/motion'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import { cn } from '@/lib/utils'

interface FloatingQuickNavProps {
  onOpenTools?: () => void
  className?: string
}

export function FloatingQuickNav({ onOpenTools, className }: FloatingQuickNavProps) {
  const [visible, setVisible] = useState(false)
  const { isEditingLayout } = useHomeDIY()

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
        'fixed right-4 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+0.75rem)] sm:right-4 sm:bottom-14 z-40 flex flex-row items-center gap-1 p-0.5 rounded-full border border-border/80 bg-background/90 dark:bg-card/85 backdrop-blur-md shadow-md transition-all duration-200',
        visible && !isEditingLayout ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none',
        className,
      )}
    >
      <button
        type="button"
        onClick={scrollToTop}
        className="w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
        title="回到顶部 (Top)"
        aria-label="回到顶部"
      >
        <ArrowUp className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-border/60" />

      <button
        type="button"
        onClick={openSpotlight}
        className="w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
        title="呼出超级搜索与指令控制台 (⌘K / /)"
        aria-label="呼出超级搜索控制台"
      >
        <Search className="w-3.5 h-3.5" />
      </button>

      {onOpenTools && (
        <>
          <div className="w-px h-4 bg-border/60" />
          <button
            type="button"
            onClick={onOpenTools}
            className="w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 cursor-pointer"
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
