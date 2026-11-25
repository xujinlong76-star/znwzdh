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
import { ChevronDown, ChevronRight, Compass, SlidersHorizontal, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { NavIcon } from '@/components/nav-icon'
import { NAV_ICON_FALLBACK, isIconUrl, resolveNavIcon } from '@/lib/nav-icons'
import { WorkspaceSwitcher } from '@/components/workspace/workspace-switcher'
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
/**
 * 侧栏品牌短名（2026-11-21）。
 *
 * 210px 侧栏里放不下「山羊胡网址导航大全」这类长全称（实测 truncate 成
 * 「山羊胡网址导航...」）。这里把可识别的长尾后缀（网址导航大全 / 导航大全 /
 * 网址导航 / 大全）去掉，得到「山羊胡导航」这样的干练主标；全称仍通过
 * Link 的 title / aria-label 完整保留，悬停与读屏都能拿到。
 *
 * 只在「确实过长」时才裁剪（> 6 个字符），短品牌名原样返回，避免把
 * 用户自定义的短站名也削掉。
 */
function shortBrandName(full: string): string {
  const name = (full || '').trim()
  if (name.length <= 6) return name
  // 只削「网址」「大全」这类冗余修饰，**保留「导航」**——
  // 上一版正则 /(网址)?导航(大全)?$/ 会把「导航」一起吃掉，
  // 结果「山羊胡网址导航大全」变成光秃秃的「山羊胡」（实测宽度只剩 41px）。
  const trimmed = name.replace(/网址/g, '').replace(/大全/g, '').trim()
  if (!trimmed) return name
  // 仍超过 6 字时按字面截断，保证在 210px 侧栏内不出现省略号
  return trimmed.length > 6 ? trimmed.slice(0, 6) : trimmed
}

export const Sidebar = memo(function Sidebar({ className, navigationData, siteInfo, onClose, brandAsHeading = true }: SidebarProps) {
  /* 侧栏不再渲染通知铃铛：订阅源只保留顶栏一处（见页脚注释）。 */
  /* 2026-11-21：侧栏铃铛已移除，未读订阅与角标文案随之删掉——
     同一个订阅源现在只服务顶栏铃铛一处，避免两处红点不同步。 */
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
    setActiveCategoryId(categoryId)
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

  // 使用对象存储每个分类的展开状态（默认收起）
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(() => {
    return navigationData.navigationItems.reduce((acc, category) => {
      acc[category.id] = false
      return acc
    }, {} as Record<string, boolean>)
  })

  // 当前在视口内激活的一级分类 ID（用于左侧导航高亮与指示条）
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(() => {
    return navigationData.navigationItems[0]?.id ?? null
  })

  // 监听主区分类滚动位置与侧边栏主动点击，实时同步当前激活分类
  useEffect(() => {
    const onTarget = (e: Event) => {
      const targetId = (e as CustomEvent<{ sectionId?: string }>).detail?.sectionId
      if (!targetId) return
      const matchedCat = navigationData.navigationItems.find(
        (cat) => cat.id === targetId || cat.subCategories?.some((s) => s.id === targetId),
      )
      if (matchedCat) setActiveCategoryId(matchedCat.id)
    }
    window.addEventListener('lazy-mount-target', onTarget)

    let rafId: number | null = null
    const onScroll = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if ((window as unknown as { __navhub_programmatic_scroll?: boolean }).__navhub_programmatic_scroll) {
          return
        }
        let bestId: string | null = null
        let bestOffset = Number.POSITIVE_INFINITY
        for (const cat of navigationData.navigationItems) {
          const el = document.getElementById(cat.id)
          if (!el) continue
          const rect = el.getBoundingClientRect()
          if (rect.bottom > 110 && rect.top < window.innerHeight * 0.65) {
            const dist = Math.abs(rect.top - 110)
            if (dist < bestOffset) {
              bestOffset = dist
              bestId = cat.id
            }
          }
        }
        if (bestId) setActiveCategoryId(bestId)
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('lazy-mount-target', onTarget)
      window.removeEventListener('scroll', onScroll)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [navigationData.navigationItems])

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [categoryId]: !prev[categoryId]
    }))
  }

  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  // P1-1 残留（2026-11-21）：侧栏最大宽随视口钳制。工具栏最小需 ~704px
  //（搜索 min 260 + 右侧工具组 ~430 + gap）+ 头部 padding 48px，主区至少留
  // 780px；420px 侧栏在 1024px 档只剩 604px，工具栏溢出约 148px
  //（header-layout-guard 锁 md:flex-nowrap，不能靠换行修）。故最大宽 =
  // min(420, 视口宽 − 780)，下限仍为最小宽 180（窄视口下桌面侧栏本就贴边）。
  const [viewportMaxWidth, setViewportMaxWidth] = useState(420)

  useEffect(() => {
    const applyViewportMax = () => {
      const max =
        typeof window === 'undefined'
          ? 420
          : Math.max(180, Math.min(420, window.innerWidth - 780))
      setViewportMaxWidth(max)
      setSidebarWidth((prev) => {
        if (prev === null || prev <= max) return prev
        try {
          window.localStorage?.setItem('navhub_sidebar_width_px', String(max))
        } catch {
          // 忽略写入失败
        }
        return max
      })
    }
    applyViewportMax()
    window.addEventListener('resize', applyViewportMax)
    return () => window.removeEventListener('resize', applyViewportMax)
  }, [])

  useEffect(() => {
    try {
      const saved = window.localStorage?.getItem('navhub_sidebar_width_px')
      if (saved) {
        const parsed = parseInt(saved, 10)
        // 存量宽度同样受视口钳制（1024px 档存 420 会读回 244）。
        const max =
          typeof window === 'undefined'
            ? 420
            : Math.max(180, Math.min(420, window.innerWidth - 780))
        if (Number.isFinite(parsed) && parsed >= 180 && parsed <= max) {
          setSidebarWidth(parsed)
        } else if (Number.isFinite(parsed) && parsed > max) {
          setSidebarWidth(max)
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
          // P1-1 残留：拖拽上界为视口钳制后的最大宽（窄视口下 < 420）。
          const nextW = Math.max(180, Math.min(viewportMaxWidth, Math.round(startW + (ev.clientX - startX))))
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
    [sidebarWidth, viewportMaxWidth]
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

  // P1-18：侧边栏宽度手柄键盘可用。方向键 ±16px（180–视口钳制最大宽，与拖拽
  // 边界一致）、Home/End 到两端、Enter 复位默认 256px（与双击同义）。
  // 键盘改动与拖拽一样写 localStorage，下次打开保持同一宽度。
  const handleSidebarResizeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const current = sidebarWidth ?? 256
      const step = 16
      let next: number | null = null
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(180, current - step)
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(viewportMaxWidth, current + step)
      else if (e.key === 'Home') next = 180
      else if (e.key === 'End') next = viewportMaxWidth
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
    [sidebarWidth, viewportMaxWidth]
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
          aria-valuemax={viewportMaxWidth}
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
        {/* 2026-11-21 修品牌名截断（「山羊胡网址导航...」）：
            210px 侧栏里 图标 24px + gap 6px + 28px 边距 = 58px，剩约 150px。
            「山羊胡网址导航大全」9 个汉字按 14px 需 ~126px，但字重 700 + 字间距
            实际溢出，于是 truncate 成省略号。
            解法（采用需求给的第二方案）：主标收成短名「山羊胡导航」，副标
            保留 AI-Native Hub；全称挂 title + aria-label，悬停即可看到。 */}
        <Link
          href="/"
          title={siteInfo.basic.title}
          aria-label={siteInfo.basic.title}
          className="flex min-w-0 items-center gap-1.5 font-bold text-sm tracking-tight transition-opacity hover:opacity-90"
        >
          {siteInfo.appearance.logo ? (
            <Image
              src={siteInfo.appearance.logo}
              alt={siteInfo.basic.title}
              width={24}
              height={24}
              className="h-6 w-6 rounded-md object-contain shrink-0"
            />
          ) : (
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary shadow-2xs">
              <Compass className="h-3.5 w-3.5 text-primary" />
            </div>
          )}
          <div className="flex min-w-0 flex-col">
            {/* 侧边栏品牌为页面唯一 h1（主内容区大号 H1 已移除；不走 sr-only）。
                移动抽屉传 brandAsHeading={false} 渲染为 span，保证 DOM 内恰好一个 h1。 */}
            {brandAsHeading ? (
              <h1 className="truncate text-sm font-bold leading-tight tracking-tight text-foreground">
                {shortBrandName(siteInfo.basic.title)}
              </h1>
            ) : (
              <span className="truncate text-sm font-bold leading-tight tracking-tight text-foreground">
                {shortBrandName(siteInfo.basic.title)}
              </span>
            )}
            <span className="truncate font-mono text-[10px] font-normal text-muted-foreground">AI-Native Hub</span>
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

      <div className="relative flex-1 min-h-0 flex flex-col">
        <ScrollArea className="flex-1 px-2.5 py-2 [&_[data-radix-scroll-area-viewport]>div]:!block">
          <div className="space-y-0.5 pb-6">
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
              const directCount = category.items?.length || 0;
              const subTotalCount = visibleSubCategories.reduce((acc, sub) => acc + (sub.items?.length || 0), 0);
              const totalSiteCount = directCount + subTotalCount;
              const isActive = activeCategoryId === category.id;
              const isExpanded = Boolean(expandedCategories[category.id]);

              return (
            <div key={category.id} className="py-0">
              <div
                className={cn(
                  "group relative flex min-w-0 items-center rounded-xl transition-all duration-150",
                  isActive
                    ? "bg-primary/[0.08] text-foreground shadow-2xs ring-1 ring-inset ring-primary/20 dark:bg-primary/[0.14]"
                    : "hover:bg-muted/65"
                )}
              >
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-primary"
                  />
                )}
                <Button
                  variant="ghost"
                  className={cn(
                    "min-w-0 flex-1 justify-start gap-2 h-8 px-2 rounded-xl text-[12.5px] transition-colors cursor-pointer hover:bg-transparent",
                    isActive
                      ? "font-semibold text-foreground"
                      : "font-medium text-foreground/80 group-hover:text-foreground"
                  )}
                  onClick={() => handleCategoryClick(category.id)}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-all",
                      isActive
                        ? "border-primary/30 bg-primary/15 text-primary shadow-2xs"
                        : "border-border/50 bg-muted/45 text-muted-foreground group-hover:border-primary/25 group-hover:bg-primary/10 group-hover:text-primary"
                    )}
                  >
                    {renderIcon(category.icon)}
                  </span>
                  <span className="truncate min-w-0 flex-1 text-left">{category.title}</span>
                  {totalSiteCount > 0 && (
                    <span
                      className={cn(
                        "ml-1 shrink-0 rounded-full px-1.5 py-0.2 font-mono text-[10px] tabular-nums transition-colors",
                        isActive
                          ? "bg-primary/15 font-semibold text-primary"
                          : "bg-muted/70 text-muted-foreground group-hover:bg-muted group-hover:text-foreground/80"
                      )}
                    >
                      {totalSiteCount}
                    </span>
                  )}
                </Button>

                {visibleSubCategories.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 w-6 shrink-0 px-0 mr-0.5 rounded-lg hover:bg-muted/70 cursor-pointer transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                    )}
                    onClick={() => toggleCategory(category.id)}
                    aria-label={isExpanded ? `折叠分类：${category.title}` : `展开分类：${category.title}`}
                    aria-expanded={isExpanded}
                    aria-controls={`subcategory-${category.id}`}
                  >
                    {isExpanded ? (
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
                    isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  )}
                >
                  <div className="mt-0.5 mb-1 ml-4 pl-2.5 border-l border-border/60 space-y-0.5 overflow-hidden">
                    {visibleSubCategories.map((subCategory) => {
                      const subCount = subCategory.items?.length || 0;
                      return (
                        <Button
                          key={subCategory.id}
                          variant="ghost"
                          className="w-full justify-between h-7 px-2 text-xs rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-pointer"
                          onClick={() => {
                            setActiveCategoryId(category.id)
                            scrollToSection(subCategory.id, category.id)
                          }}
                        >
                          <span className="truncate min-w-0 text-left">{subCategory.title}</span>
                          {subCount > 0 && (
                            <span className="ml-1.5 shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                              {subCount}
                            </span>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )})}
          </div>
        </ScrollArea>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-background to-transparent"
        />
      </div>

      <div className="p-2.5 pb-[max(env(safe-area-inset-bottom,0px),0.625rem)] border-t border-border/40 flex items-center justify-between">
        {!isModuleHidden('mod:crdt-pill') ? (
          <div data-feature-id="mod:crdt-pill">
            <CrdtSyncStatusPill />
          </div>
        ) : (
          <span />
        )}
        {/* 2026-11-21 清理重复入口：**移除侧栏这枚铃铛**。
            全站通知入口统一收口到右上角顶栏铃铛（它自带未读红点）。
            两处铃铛曾是同一订阅源的两个消费者，视觉重复且角标可能不同步；
            现在只保留顶栏一处。这里只留下小猫猫开关。 */}
        {/* 2026-11-24 入口收口：移除侧栏重复的第二个「探索与专题 🧭」指南针下拉
            （顶栏探索矩阵已升级为 2 列网格全站枢纽，不再双处重复），保留纯净的偏好设置直达。 */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/preferences"
                aria-label="个性化偏好设置"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              个性化偏好设置
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
})

