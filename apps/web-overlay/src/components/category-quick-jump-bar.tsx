'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Star, MonitorPlay, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { preferredScrollBehavior } from '@/lib/motion'
import { HorizontalScrollFade } from '@/components/horizontal-scroll-fade'

export interface CategoryJumpItem {
  id: string
  title: string
  count?: number
  icon?: string
}

/**
 * U-416：精选视频徽章的真实总数格式化（2265 → "2,265"）。
 * 不做数量级缩写——约数写法就是旧徽章失真的根源，精确数才诚实。
 */
export function formatVideoCount(count: number): string {
  return count.toLocaleString('en-US')
}

export type VideoTotalFetcher = (
  url: string,
) => Promise<{ headers: { get(name: string): string | null } }>

/**
 * U-416：视频库实时总数取数（`GET /api/videos?limit=1`，只要总数、
 * 条目本身不拉——与管理端数据页同款轻量口径；总数走 `X-Total-Items`
 * 响应头，与服务端 countItems 同口径）。
 * 取不到 / 非正数 / 解析失败都回 null——调用方不渲染徽章，绝不回落
 * 任何手写数字（旧徽章手写约数与实际 2265 条差了近三倍）。
 */
export async function loadVideoTotalCount(fetcher: VideoTotalFetcher): Promise<number | null> {
  try {
    const res = await fetcher('/api/videos?limit=1')
    const total = Number(res.headers.get('X-Total-Items'))
    return Number.isFinite(total) && total > 0 ? Math.floor(total) : null
  } catch {
    return null
  }
}

interface CategoryQuickJumpBarProps {
  categories: CategoryJumpItem[]
  hasQuickAccess?: boolean
  className?: string
  /** 全部分类折叠状态 */
  isAllCollapsed?: boolean
  /** 一键折叠/展开全部顶级类目 */
  onToggleAllCollapsed?: () => void
  /**
   * U-416：视频库总数（由调用方服务端算好传入时优先用它）。
   * 不传时组件在移动端自行取一次实时总数；取不到就不显示徽章。
   */
  videoCount?: number
}

export function CategoryQuickJumpBar({
  categories,
  hasQuickAccess = true,
  className,
  isAllCollapsed,
  onToggleAllCollapsed,
  videoCount,
}: CategoryQuickJumpBarProps) {
  const [activeId, setActiveId] = useState<string>('')
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // U-416：移动端才取实时总数（本栏桌面端隐藏，桌面不发请求）。
  const [liveVideoCount, setLiveVideoCount] = useState<number | null>(null)
  useEffect(() => {
    if (typeof videoCount === 'number') return
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    if (!window.matchMedia('(max-width: 767px)').matches) return
    let cancelled = false
    void loadVideoTotalCount((url) => fetch(url)).then((total) => {
      if (!cancelled) setLiveVideoCount(total)
    })
    return () => {
      cancelled = true
    }
  }, [videoCount])
  const effectiveVideoCount = typeof videoCount === 'number' ? videoCount : liveVideoCount

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
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lazy-mount-target', { detail: { sectionId: id } }))
      ;(window as unknown as { __navhub_programmatic_scroll?: boolean }).__navhub_programmatic_scroll = true
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          ;(window as unknown as { __navhub_programmatic_scroll?: boolean }).__navhub_programmatic_scroll = false
        }
      }, 700)
    }
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
        {/* 横向滚动列表：边界检测、渐隐遮罩、滚轮横滚与箭头统一由
            HorizontalScrollFade 负责；ScrollSpy 仍用 scrollContainerRef
            把激活 Pill 滚回可视区（ref 经组件透传到滚动容器）。 */}
        <HorizontalScrollFade
          ref={scrollContainerRef}
          className="min-w-0 flex-1"
          scrollClassName="flex items-center gap-1.5 scroll-smooth py-0.5 px-1 w-full"
          prevAriaLabel="向左滚动分类"
          nextAriaLabel="向右滚动分类"
        >
          {onToggleAllCollapsed && (
            <button
              type="button"
              onClick={onToggleAllCollapsed}
              className={cn(
                "shrink-0 inline-flex min-h-11 items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-150 mr-1",
                isAllCollapsed
                  ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
                  : "bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/70"
              )}
              title={isAllCollapsed ? "展开全部类目" : "折叠全部类目"}
              aria-label={isAllCollapsed ? "展开全部类目" : "折叠全部类目"}
            >
              <ChevronsUpDown className="h-3 w-3" />
              {/* 首屏瘦身（2026-11-25）：文字标签只在 ≥sm 出现；<sm 仅图标（有 title/aria-label），
                  省出的宽度留给分类芯片——「折叠全部」是低频操作，不该占移动端一整颗胶囊。 */}
              <span className="hidden sm:inline">{isAllCollapsed ? "展开全部" : "折叠全部"}</span>
            </button>
          )}

          {hasQuickAccess && (
            <button
              type="button"
              id="pill-quick-access"
              onClick={() => scrollToId('quick-access-tray')}
              className={cn(
                "shrink-0 inline-flex min-h-11 items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-150",
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
            if (cat.count !== undefined && cat.count === 0) return null
            const isActive = activeId === cat.id
            return (
              <button
                key={cat.id}
                id={`pill-${cat.id}`}
                type="button"
                onClick={() => scrollToId(cat.id)}
                // 桌面端（lg+，左侧栏在场）隐藏分类芯片：与侧栏逐项重复是四层导航冗余的第三层；
                // 移动端没有侧栏，芯片仍是唯一的分类直达入口，保持原样。
                className={cn(
                  "shrink-0 inline-flex min-h-11 items-center gap-1 px-2.5 py-1 rounded-full text-xs transition-all duration-150 border lg:hidden",
                  isActive
                    ? "bg-primary text-primary-foreground border-primary font-medium shadow-2xs scale-102"
                    : "bg-muted/40 border-border/40 text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/70"
                )}
              >
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
            className="shrink-0 inline-flex min-h-11 items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 transition-all duration-150 ml-1"
          >
            <MonitorPlay className="h-3 w-3" />
            <span>精选视频</span>
            {typeof effectiveVideoCount === 'number' && effectiveVideoCount > 0 && (
              <span className="text-[10px] px-1 rounded-full bg-rose-500/20">{formatVideoCount(effectiveVideoCount)}</span>
            )}
          </Link>
        </HorizontalScrollFade>
      </div>
    </nav>
  )
}
