'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { preferredScrollBehavior } from '@/lib/motion'
import { Button } from '@/registry/new-york/ui/button'
import { ScrollArea } from '@/registry/new-york/ui/scroll-area'
import type { NavigationData } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { ChevronDown, ChevronRight, Compass, Bell, X } from 'lucide-react'
import { NavIcon } from '@/components/nav-icon'
import { NAV_ICON_FALLBACK, isIconUrl, resolveNavIcon } from '@/lib/nav-icons'
import { WorkspaceSwitcher } from '@/components/workspace/workspace-switcher'
import { CrdtSyncStatusPill } from '@/components/crdt/crdt-sync-status-pill'
import { useIdentityReady } from '@/hooks/useIdentityReady'
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications'
import { unreadBadgeText } from '@/lib/notification-badge'
import { useHomeDIY } from '@/lib/modular/use-home-diy'

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  navigationData: NavigationData
  siteInfo: SiteConfig
  onClose?: () => void
}

export function Sidebar({ className, navigationData, siteInfo, onClose }: SidebarProps) {
  const identityState = useIdentityReady()
  const unread = useUnreadNotifications(identityState)
  const unreadText = unreadBadgeText(unread)
  const { collapsedCategoryIds, expandCategory } = useHomeDIY()

  const scrollToSection = (id: string, parentCategoryId?: string) => {
    if (parentCategoryId && collapsedCategoryIds.includes(parentCategoryId)) {
      expandCategory(parentCategoryId)
    } else if (collapsedCategoryIds.includes(id)) {
      expandCategory(id)
    }

    // 若刚展开了折叠分类，DOM 节点在下一帧呈现，通过 requestAnimationFrame 执行平滑滚动
    requestAnimationFrame(() => {
      const element = document.getElementById(id)
      if (element) {
        element.scrollIntoView({ behavior: preferredScrollBehavior() })
        onClose?.()
      } else {
        setTimeout(() => {
          const retry = document.getElementById(id)
          if (retry) {
            retry.scrollIntoView({ behavior: preferredScrollBehavior() })
            onClose?.()
          }
        }, 60)
      }
    })
  }

  const handleCategoryClick = (categoryId: string) => {
    scrollToSection(categoryId)

    // 如果有子分类，切换展开/收起状态
    const category = navigationData.navigationItems.find(cat => cat.id === categoryId)
    if (category?.subCategories && category.subCategories.length > 0) {
      toggleCategory(categoryId)
    }
  }

  const renderIcon = (iconName?: string) => {
    if (!iconName) return <NAV_ICON_FALLBACK className="h-4 w-4" />;

    if (isIconUrl(iconName)) {
      return (
        <Image
          src={iconName}
          alt="icon"
          width={16}
          height={16}
          className="h-4 w-4"
        />
      );
    }

    // 已知名字走静态映射（可被 tree-shaking，零额外体积、无闪烁）；
    // 表外名字交给 NavIcon 按需拉取，行为与旧的整包查找一致。
    const StaticIcon = resolveNavIcon(iconName);
    if (StaticIcon) return <StaticIcon className="h-4 w-4" />;
    return <NavIcon name={iconName} className="h-4 w-4" />;
  }

  // 使用对象存储每个分类的展开状态
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(() => {
    return navigationData.navigationItems.reduce((acc, category) => {
      acc[category.id] = false
      return acc
    }, {} as Record<string, boolean>)
  })

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [categoryId]: !prev[categoryId]
    }))
  }

  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)

  useEffect(() => {
    try {
      const saved = window.localStorage?.getItem('navhub_sidebar_width_px')
      if (saved) {
        const parsed = parseInt(saved, 10)
        if (Number.isFinite(parsed) && parsed >= 180 && parsed <= 420) {
          setSidebarWidth(parsed)
        }
      }
    } catch {
      // 忽略本地存储读取失败
    }
  }, [])

  const handleSidebarResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startW = sidebarWidth ?? 256
      setIsResizingSidebar(true)
      const prevCursor = document.body.style.cursor
      const prevSelect = document.body.style.userSelect
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      let latestW = startW
      let rafId: number | null = null

      const onMove = (ev: PointerEvent) => {
        if (rafId !== null) return
        rafId = requestAnimationFrame(() => {
          rafId = null
          const nextW = Math.max(180, Math.min(420, Math.round(startW + (ev.clientX - startX))))
          latestW = nextW
          setSidebarWidth(nextW)
        })
      }
      const onUp = () => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
          rafId = null
        }
        document.body.style.cursor = prevCursor
        document.body.style.userSelect = prevSelect
        setIsResizingSidebar(false)
        try {
          window.localStorage?.setItem('navhub_sidebar_width_px', String(latestW))
        } catch {
          // 忽略写入失败
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove, { passive: true })
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [sidebarWidth]
  )

  const handleSidebarResetWidth = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSidebarWidth(null)
    try {
      window.localStorage?.removeItem('navhub_sidebar_width_px')
    } catch {
      // 忽略删除失败
    }
  }, [])

  return (
    <div
      style={!onClose && sidebarWidth ? { width: `${sidebarWidth}px` } : undefined}
      className={cn(
        "relative group/sidebar w-full md:w-64 h-full bg-background border-r border-border/40 flex flex-col",
        className
      )}
    >
      {/* 桌面端侧边栏右边缘左右拖拉调整宽度手柄 */}
      {!onClose && (
        <div
          aria-hidden="true"
          data-sidebar-resizer=""
          onPointerDown={handleSidebarResizeStart}
          onDoubleClick={handleSidebarResetWidth}
          style={{ touchAction: 'none' }}
          title="左右拖拉调整侧边导航栏宽度（双击恢复默认 256px）"
          className={cn(
            "hidden md:flex absolute inset-y-0 -right-1.5 w-3 z-30 cursor-col-resize items-center justify-center select-none transition-opacity",
            isResizingSidebar ? "opacity-100" : "opacity-0 group-hover/sidebar:opacity-100 hover:opacity-100"
          )}
        >
          <div
            className={cn(
              "w-1 h-12 rounded-full transition-all duration-150",
              isResizingSidebar
                ? "bg-primary h-24 shadow-md shadow-primary/50"
                : "bg-border/80 hover:bg-primary hover:h-16"
            )}
          />
        </div>
      )}
      <div className="flex min-h-[3.5rem] items-center justify-between px-3.5 pt-[max(env(safe-area-inset-top,0px),0px)] border-b border-border/40 gap-2">
        <Link href="/" className="flex items-center gap-2 font-bold text-sm tracking-tight hover:opacity-90 transition-opacity min-w-0 shrink-0">
          {siteInfo.appearance.logo ? (
            <Image
              src={siteInfo.appearance.logo}
              alt={siteInfo.basic.title}
              width={26}
              height={26}
              className="h-6.5 w-6.5 rounded-md object-contain shrink-0"
            />
          ) : (
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-2xs shrink-0">
              <Compass className="h-4 w-4 text-primary" />
            </div>
          )}
          <div className="flex flex-col min-w-0 shrink-0">
            <span className="leading-tight font-bold text-foreground text-[14px] tracking-tight whitespace-nowrap">{siteInfo.basic.title}</span>
            <span className="text-[11px] text-muted-foreground font-mono font-normal">AI-Native Hub</span>
          </div>
        </Link>

        <span className="shrink-0 hidden min-[1536px]:inline-flex text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
          v5.0
        </span>

        {/* 移动模式下的关闭按钮 */}
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto md:hidden h-8 w-8 rounded-lg"
            onClick={onClose}
            aria-label="关闭侧边栏"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="px-3 py-2 border-b border-border/40">
        <WorkspaceSwitcher />
      </div>

      <ScrollArea className="flex-1 px-3 py-3">
        <div className="space-y-1">
          {navigationData.navigationItems
            .filter((category) => {
              const directCount = category.items?.length || 0;
              const subCount = category.subCategories?.reduce((acc, sub) => acc + (sub.items?.length || 0), 0) || 0;
              if (category.title === '未分类' && directCount + subCount === 0) return false;
              return true;
            })
            .map((category) => {
              const visibleSubCategories = (category.subCategories || []).filter(
                (sub) => !sub.items || sub.items.length > 0
              );
              return (
            <div key={category.id} className="py-1">
              <div className="flex items-center group">
                <Button
                  variant="ghost"
                  className="flex-1 justify-start gap-2.5 h-8.5 px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                  onClick={() => handleCategoryClick(category.id)}
                >
                  <span className="text-muted-foreground group-hover:text-primary transition-colors">
                    {renderIcon(category.icon)}
                  </span>
                  <span className="truncate">{category.title}</span>
                </Button>

                {visibleSubCategories.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-7 px-0 hover:bg-muted/50 cursor-pointer text-muted-foreground"
                    onClick={() => toggleCategory(category.id)}
                    aria-label={expandedCategories[category.id] ? `折叠分类：${category.title}` : `展开分类：${category.title}`}
                    aria-expanded={Boolean(expandedCategories[category.id])}
                  >
                    {expandedCategories[category.id] ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>

              {visibleSubCategories.length > 0 && (
                <div
                  className={cn(
                    "grid transition-all duration-200 ease-in-out",
                    expandedCategories[category.id] ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  )}
                >
                  <div className="mt-1 ml-3 pl-2.5 border-l border-border/50 space-y-0.5 overflow-hidden">
                    {visibleSubCategories.map((subCategory) => (
                      <Button
                        key={subCategory.id}
                        variant="ghost"
                        className="w-full justify-start h-7.5 px-2 text-xs rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer"
                        onClick={() => {
                          scrollToSection(subCategory.id, category.id)
                        }}
                      >
                        <span className="truncate">{subCategory.title}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )})}
        </div>
      </ScrollArea>

      <div className="p-2.5 pb-[max(env(safe-area-inset-bottom,0px),0.625rem)] border-t border-border/40 flex items-center justify-between">
        <CrdtSyncStatusPill />
        <Link
          href="/me/notifications"
          aria-label={unread > 0 ? `通知，${unread} 条未读` : '通知'}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unreadText && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 min-w-[15px] rounded-full bg-primary px-1 text-center text-[9px] font-semibold leading-[15px] text-primary-foreground tabular-nums"
            >
              {unreadText}
            </span>
          )}
        </Link>
      </div>
    </div>
  )
}

