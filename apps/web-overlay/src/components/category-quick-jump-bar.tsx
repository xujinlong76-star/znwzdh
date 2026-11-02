'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Star, MonitorPlay, Sparkles, FoldVertical, ChevronsUpDown, Layers } from 'lucide-react'
import { resolveNavIcon } from '@/lib/nav-icons'
import { cn } from '@/lib/utils'
import { preferredScrollBehavior } from '@/lib/motion'

export interface CategoryJumpItem {
  id: string
  title: string
  count?: number
  icon?: string
}

interface CategoryQuickJumpBarProps {
  categories: CategoryJumpItem[]
  hasQuickAccess?: boolean
  className?: string
  /** 全部分类折叠状态 */
  isAllCollapsed?: boolean
  /** 一键折叠/展开全部顶级类目 */
  onToggleAllCollapsed?: () => void
}

export function CategoryQuickJumpBar({
  categories,
  hasQuickAccess = true,
  className,
  isAllCollapsed,
  onToggleAllCollapsed,
}: CategoryQuickJumpBarProps) {
  const [activeId, setActiveId] = useState<string>('')
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // 检查横向滚动边界
  const checkScrollBounds = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4)
  }, [])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    checkScrollBounds()
    el.addEventListener('scroll', checkScrollBounds, { passive: true })
    window.addEventListener('resize', checkScrollBounds)
    return () => {
      el.removeEventListener('scroll', checkScrollBounds)
      window.removeEventListener('resize', checkScrollBounds)
    }
  }, [checkScrollBounds, categories])

  // 监听可视区域内的分类区块 (Scroll Spy)
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return

    const categoryElements = categories
      .map(c => document.getElementById(c.id))
      .filter((el): el is HTMLElement => el !== null)

    if (categoryElements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        // 找到当前相交比例最高的或者离顶部最近的元素
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)

        if (visible.length > 0) {
          const currentId = visible[0].target.id
          setActiveId(currentId)

          // 保持激活的 Pill 在横向可视区内
          const pill = document.getElementById(`pill-${currentId}`)
          if (pill && scrollContainerRef.current) {
            const container = scrollContainerRef.current
            const pillLeft = pill.offsetLeft
            const pillRight = pillLeft + pill.offsetWidth
            if (pillLeft < container.scrollLeft + 40) {
              container.scrollTo({ left: Math.max(0, pillLeft - 40), behavior: 'smooth' })
            } else if (pillRight > container.scrollLeft + container.clientWidth - 40) {
              container.scrollTo({ left: pillRight - container.clientWidth + 40, behavior: 'smooth' })
            }
          }
        }
      },
      {
        rootMargin: '-80px 0px -60% 0px',
        threshold: [0.1, 0.5, 0.8]
      }
    )

    categoryElements.forEach(el => observer.observe(el))

    return () => {
      categoryElements.forEach(el => observer.unobserve(el))
      observer.disconnect()
    }
  }, [categories])

  const scrollToId = (id: string) => {
    // 广播聚焦与自愈展开事件，确保若目标分类处于折叠状态能自动展开
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('navhub-request-category-focus', { detail: { categoryId: id } }))
      try {
        window.history.replaceState(null, '', `#${id}`)
      } catch (_e) {
        // 静默捕获：部分受限 iframe 或无痕沙箱环境下禁止操作 history state
      }
    }

    // 双重 RAF 确保 DOM 自愈展开重绘完成后，按真实高度精确平滑滚动
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const element = document.getElementById(id)
        if (element) {
          const topOffset = 110 // 吸顶栏高度缓冲
          const elementPosition = element.getBoundingClientRect().top
          const offsetPosition = elementPosition + window.pageYOffset - topOffset

          window.scrollTo({
            top: offsetPosition,
            behavior: preferredScrollBehavior()
          })
          setActiveId(id)
        }
      })
    })
  }

  const scrollHorizontally = (direction: 'left' | 'right') => {
    const el = scrollContainerRef.current
    if (!el) return
    const offset = direction === 'left' ? -240 : 240
    el.scrollBy({ left: offset, behavior: 'smooth' })
  }

  if (categories.length === 0) return null

  return (
    <nav
      aria-label="分类快捷直达"
      className={cn(
        "sticky top-14 z-20 bg-background/90 dark:bg-background/85 backdrop-blur-md border-b border-border/40 py-1.5 px-3 sm:px-6 shadow-2xs transition-all",
        className
      )}
    >
      <div className="relative flex items-center max-w-7xl mx-auto">
        {/* 左滑按钮 */}
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => scrollHorizontally('left')}
            className="absolute left-0 z-10 hidden sm:flex items-center justify-center h-7 w-7 rounded-full bg-background/95 border border-border shadow-xs text-muted-foreground hover:text-foreground transition-all touch-manipulation select-none active:scale-90 cursor-pointer"
            aria-label="向左滚动分类"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}

        {/* 左侧遮罩 */}
        {canScrollLeft && (
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent pointer-events-none z-5" />
        )}

        {/* 横向滚动列表 */}
        <div
          ref={scrollContainerRef}
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth py-0.5 px-1 w-full"
        >
          {onToggleAllCollapsed && (
            <button
              type="button"
              onClick={onToggleAllCollapsed}
              className={cn(
                "shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-150 mr-1 touch-manipulation select-none active:scale-95 cursor-pointer",
                isAllCollapsed
                  ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
                  : "bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/70"
              )}
              title={isAllCollapsed ? "展开全部类目" : "折叠全部类目"}
              aria-label={isAllCollapsed ? "展开全部类目" : "折叠全部类目"}
            >
              <ChevronsUpDown className="h-3 w-3" />
              <span>{isAllCollapsed ? "展开全部" : "折叠全部"}</span>
            </button>
          )}

          {hasQuickAccess && (
            <button
              type="button"
              id="pill-quick-access"
              onClick={() => scrollToId('quick-access-tray')}
              className={cn(
                "shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-150 touch-manipulation select-none active:scale-95 cursor-pointer",
                activeId === 'quick-access-tray'
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-400 font-semibold"
                  : "bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/70"
              )}
            >
              <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
              <span>常用</span>
            </button>
          )}

          {categories.map((cat) => {
            const isActive = activeId === cat.id
            const CatIcon = cat.icon ? resolveNavIcon(cat.icon) : null
            return (
              <button
                key={cat.id}
                id={`pill-${cat.id}`}
                type="button"
                onClick={() => scrollToId(cat.id)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all duration-150 border touch-manipulation select-none active:scale-95 cursor-pointer",
                  isActive
                    ? "bg-primary text-primary-foreground border-primary font-medium shadow-2xs scale-102"
                    : "bg-muted/40 border-border/40 text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/70"
                )}
              >
                {CatIcon && (
                  <CatIcon className={cn("h-3 w-3 shrink-0", isActive ? "text-primary-foreground" : "text-primary/70")} />
                )}
                <span>{cat.title}</span>
                {cat.count !== undefined && cat.count > 0 && (
                  <span
                    className={cn(
                      "text-[10px] px-1 py-0.2 rounded-full font-mono",
                      isActive
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-background/80 text-muted-foreground"
                    )}
                  >
                    {cat.count}
                  </span>
                )}
              </button>
            )
          })}

          {/* 直达技术视频 */}
          <Link
            href="/videos"
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 transition-all duration-150 ml-1 touch-manipulation select-none active:scale-95"
          >
            <MonitorPlay className="h-3 w-3" />
            <span>精选视频</span>
            <span className="text-[10px] px-1 rounded-full bg-rose-500/20">6k+</span>
          </Link>
        </div>

        {/* 右滑按钮 */}
        {canScrollRight && (
          <button
            type="button"
            onClick={() => scrollHorizontally('right')}
            className="absolute right-0 z-10 hidden sm:flex items-center justify-center h-7 w-7 rounded-full bg-background/95 border border-border shadow-xs text-muted-foreground hover:text-foreground transition-all touch-manipulation select-none active:scale-90 cursor-pointer"
            aria-label="向右滚动分类"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        {/* 右侧遮罩 */}
        {canScrollRight && (
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none z-5" />
        )}
      </div>
    </nav>
  )
}
