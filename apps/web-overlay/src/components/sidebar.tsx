'use client'

import { useState, useEffect, useCallback, memo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import dynamic from 'next/dynamic'
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
import { XiaomaomaoToggle } from '@/components/xiaomaomao-toggle'
/**
 * CRDT 同步状态小药丸（Bundle 瘦身续刀：CRDT 引擎按需加载）。
 *
 * 小药丸整棵子树（pill 本体 + useCrdtRoaming hook + lib/crdt-sync +
 * lib/crdt-presence，约 19.5KB 代码）只在挂载后经 effect 启动同步引擎，
 * 首屏只需要一个“连接中”态的按钮。`next/dynamic({ ssr: false })` 让
 * 整棵子树离开 `/` 初始 chunk；占位按钮与小药丸 'syncing' 态像素一致
 * （同款式 + 12px 纯 CSS 转圈，不引新图标），chunk 到达后无缝替换、零 CLS。
 * 占位按钮在 chunk 到达前点击无响应（窗口本机 <100ms、慢速网约 300–600ms），
 * 与手柄第三刀 a 接受的“进入编辑态才加载”同一取舍。
 *
 * 与 0622 方案书 §4.1 的差别（已实测纠正）：方案书只让引擎（sync +
 * presence）走 effect 内 await import、小药丸留静态——那样只能省
 * 5.7–7.3KB（hook 经 pill 静态 import 仍在初始 chunk 里），盖不住
 * 7KB 缺口；本刀把整棵子树（含 hook 与 pill 本体）一次 dynamic，
 * 预期省 10.7–13.6KB。引擎唯一的另一静态 import 方是算法实验室的
 * mesh-panel（algorithm-lab.tsx:104），它本身已在 dynamic 边界之后、
 * 只活在 /algorithms 路由，不影响本刀。
 */
const CrdtSyncStatusPill = dynamic(
  () =>
    import('@/components/crdt/crdt-sync-status-pill').then(
      (m) => m.CrdtSyncStatusPill,
    ),
  { ssr: false, loading: () => <CrdtSyncStatusPillPlaceholder /> },
)

/** 小药丸 chunk 到达前的静态占位：与 'syncing' 态同款式、同尺寸、无新依赖。 */
function CrdtSyncStatusPillPlaceholder() {
  return (
    <button
      type="button"
      aria-label="多端协同中… - 查看多端协同状态"
      className="inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-full border border-success/30 bg-success/10 dark:bg-success/15 px-2.5 py-1 text-xs text-success-foreground font-medium transition-all hover:bg-success/20 shadow-2xs"
    >
      <span
        aria-hidden
        className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-600/30 border-t-emerald-600 dark:border-t-emerald-400"
      />
      <span className="text-[11px] shrink-0 whitespace-nowrap font-semibold text-success-foreground inline">
        多端协同中…
      </span>
    </button>
  )
}
import { useIdentityReady } from '@/hooks/useIdentityReady'
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications'
import { unreadBadgeText } from '@/lib/notification-badge'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
import { useFeatureMask } from '@/lib/modular/feature-mask-store'

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  navigationData: NavigationData
  siteInfo: SiteConfig
  onClose?: () => void
  /** 品牌标题是否渲染为 h1。默认 true；移动抽屉传 false，保证同一页面
      DOM 内恰好一个 h1（复核 2026-11-20 首屏瘦身第 1 项）。 */
  brandAsHeading?: boolean
}

// P0-2：包 memo——navigationData 已 memo 化、onClose 已 useCallback 化。
export const Sidebar = memo(function Sidebar({ className, navigationData, siteInfo, onClose, brandAsHeading = true }: SidebarProps) {
  const identityState = useIdentityReady()
  const unread = useUnreadNotifications(identityState)
  const unreadText = unreadBadgeText(unread)
  const { collapsedCategoryIds, hiddenCategoryIds, expandCategory } = useHomeDIY()
  const { isModuleHidden, isCategoryHidden, isSubcategoryHidden, bypassMaskTemporarily } = useFeatureMask()

  const scrollToSection = (id: string, parentCategoryId?: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('lazy-mount-target', { detail: { sectionId: id } }))
      ;(window as unknown as { __navhub_programmatic_scroll?: boolean }).__navhub_programmatic_scroll = true
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          ;(window as unknown as { __navhub_programmatic_scroll?: boolean }).__navhub_programmatic_scroll = false
        }
      }, 700)
    }
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
          alt=""
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
    (e: React.PointerEvent<HTMLButtonElement>) => {
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

  // P1-18：侧边栏宽度手柄键盘可用。方向键 ±16px（180–420px 钳制，与拖拽
  // 边界一致）、Home/End 到两端、Enter 复位默认 256px（与双击同义）。
  // 键盘改动与拖拽一样写 localStorage，下次打开保持同一宽度。
  const handleSidebarResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const current = sidebarWidth ?? 256
      const step = 16
      let next: number | null = null
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(180, current - step)
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(420, current + step)
      else if (e.key === 'Home') next = 180
      else if (e.key === 'End') next = 420
      else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        setSidebarWidth(null)
        try {
          window.localStorage?.removeItem('navhub_sidebar_width_px')
        } catch {
          // 忽略删除失败
        }
        return
      } else return
      e.preventDefault()
      e.stopPropagation()
      setSidebarWidth(next)
      try {
        window.localStorage?.setItem('navhub_sidebar_width_px', String(next))
      } catch {
        // 忽略写入失败
      }
    },
    [sidebarWidth]
  )

  return (
    <div
      style={!onClose && sidebarWidth ? { width: `${sidebarWidth}px` } : undefined}
      className={cn(
        "relative group/sidebar w-full md:w-64 h-full bg-background border-r border-border/40 flex flex-col",
        className
      )}
    >
      {/* 桌面端侧边栏右边缘左右拖拉调整宽度手柄（P1-18：可聚焦按钮 + role=slider，键盘可用） */}
      {!onClose && (
        <button
          type="button"
          role="slider"
          aria-label="调整侧边导航栏宽度"
          aria-valuenow={sidebarWidth ?? 256}
          aria-valuemin={180}
          aria-valuemax={420}
          aria-orientation="horizontal"
          aria-valuetext={`${sidebarWidth ?? 256} 像素`}
          data-sidebar-resizer=""
          onPointerDown={handleSidebarResizeStart}
          onDoubleClick={handleSidebarResetWidth}
          onKeyDown={handleSidebarResizeKeyDown}
          style={{ touchAction: 'none' }}
          title="左右拖拉调整侧边导航栏宽度（双击或回车恢复默认 256px；方向键 ±16px）"
          className={cn(
            "hidden md:flex absolute inset-y-0 -right-1.5 w-3 z-30 cursor-col-resize items-center justify-center select-none transition-opacity focus-visible:opacity-100",
            isResizingSidebar ? "opacity-100" : "opacity-0 group-hover/sidebar:opacity-100 hover:opacity-100"
          )}
        >
          <div
            className={cn(
              "w-1 h-12 rounded-full transition-all duration-[--duration-fast]",
              isResizingSidebar
                ? "bg-primary h-24 shadow-md shadow-primary/50"
                : "bg-border/80 hover:bg-primary hover:h-16"
            )}
          />
        </button>
      )}
      <div className="flex min-h-[3.5rem] items-center justify-between px-3.5 pt-[max(env(safe-area-inset-top,0px),0px)] border-b border-border/40 gap-2">
        <Link href="/" className="flex items-center gap-2 font-bold text-sm tracking-tight hover:opacity-90 transition-opacity min-w-0">
          {siteInfo.appearance.logo ? (
            <Image
              src={siteInfo.appearance.logo}
              alt={siteInfo.basic.title}
              width={26}
              height={26}
              className="h-6.5 w-6.5 rounded-md object-contain shrink-0"
            />
          ) : (
            <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-2xs shrink-0">
              <Compass className="h-4 w-4 text-primary" />
            </div>
          )}
          <div className="flex flex-col min-w-0">
            {/* 首屏瘦身：侧边栏品牌为页面唯一 h1（主内容区大号 H1 已移除；
                不走 sr-only 隐藏术）。侧边栏在桌面与移动抽屉各渲染一次，
                移动抽屉传 brandAsHeading={false} 渲染为 span，保证 DOM 内
                恰好一个 h1（复核 2026-11-20 首屏瘦身第 1 项）。 */}
            {brandAsHeading ? (
              <h1 className="leading-tight font-bold text-foreground text-sm tracking-tight truncate">{siteInfo.basic.title}</h1>
            ) : (
              <span className="leading-tight font-bold text-foreground text-sm tracking-tight truncate">{siteInfo.basic.title}</span>
            )}
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
              if (!bypassMaskTemporarily && (hiddenCategoryIds.includes(category.id) || isCategoryHidden(category.id))) {
                return false;
              }
              const directCount = category.items?.length || 0;
              const subCount = category.subCategories?.reduce((acc, sub) => acc + (sub.items?.length || 0), 0) || 0;
              if (category.title === '未分类' && directCount + subCount === 0) return false;
              return true;
            })
            .map((category) => {
              const visibleSubCategories = (category.subCategories || []).filter(
                (sub) =>
                  (!sub.items || sub.items.length > 0) &&
                  (bypassMaskTemporarily || !isSubcategoryHidden(sub.id))
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
                  <span className="truncate min-w-0">{category.title}</span>
                </Button>

                {visibleSubCategories.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-7 px-0 hover:bg-muted/50 cursor-pointer text-muted-foreground"
                    onClick={() => toggleCategory(category.id)}
                    aria-label={expandedCategories[category.id] ? `折叠分类：${category.title}` : `展开分类：${category.title}`}
                    aria-expanded={Boolean(expandedCategories[category.id])}
                    aria-controls={`subcategory-${category.id}`}
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
                  id={`subcategory-${category.id}`}
                  className={cn(
                    "grid transition-all duration-[--duration-base] ease-in-out",
                    expandedCategories[category.id] ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  )}
                >
                  <div className="mt-1 ml-3 pl-2.5 border-l border-border/50 space-y-0.5 overflow-hidden">
                    {visibleSubCategories.map((subCategory) => (
                      <Button
                        key={subCategory.id}
                        variant="ghost"
                        className="w-full justify-start h-7.5 px-2 text-xs rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer"
                        onClick={() => {
                          scrollToSection(subCategory.id, category.id)
                        }}
                      >
                        <span className="truncate min-w-0">{subCategory.title}</span>
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
        {!isModuleHidden('mod:crdt-pill') ? (
          <div data-feature-id="mod:crdt-pill">
            <CrdtSyncStatusPill />
          </div>
        ) : (
          <span />
        )}
        {/* 首屏瘦身：小猫猫挂件默认收起，本开关是常驻开启入口（与通知铃并列） */}
        <div className="flex items-center gap-1">
          <XiaomaomaoToggle />
          <Link
            href="/me/notifications"
            aria-label={unread > 0 ? `通知，${unread} 条未读` : '通知'}
            className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Bell className="h-4 w-4" aria-hidden />
            {unreadText && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 min-w-[15px] rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-[15px] text-primary-foreground tabular-nums"
              >
                {unreadText}
              </span>
            )}
          </Link>
        </div>
      </div>
    </div>
  )
})

