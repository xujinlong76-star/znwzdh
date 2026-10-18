'use client'

import { useState, useMemo, useEffect } from 'react'
import dynamic from 'next/dynamic'
import type { NavigationData, NavigationSubItem } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { NavigationCard } from '@/components/navigation-card'
import { Sidebar } from '@/components/sidebar'
import { SearchPalette } from '@/components/search-palette'
import { ModeToggle } from '@/components/mode-toggle'
import { DensityToggle } from '@/components/density-toggle'
import { ViewModeToggle } from '@/components/view-mode-toggle'
import { useHomeDIY } from '@/lib/modular/use-home-diy'

import { CategoryInSituControls } from '@/components/category-in-situ-controls'
import { Footer } from '@/components/footer'
import { OnboardingCard } from '@/components/onboarding-card'
import { useOverlayBehavior } from '@/components/ui/overlay'

// 性能优化：动态懒加载大型组件，大幅缩减首屏 JS 体积与主线程阻塞时间
const ModularCanvas = dynamic(
  () => import('@/components/modular/modular-canvas').then((m) => m.ModularCanvas),
  { ssr: false }
)
const HomeHeroDeck = dynamic(
  () => import('@/components/home-hero-deck').then((m) => m.HomeHeroDeck),
  { ssr: false }
)
const KeyboardShortcutsDialog = dynamic(
  () => import('@/components/keyboard-shortcuts-dialog').then((m) => m.KeyboardShortcutsDialog),
  { ssr: false }
)
const SitePeekDialog = dynamic(
  () => import('@/components/site-peek-dialog').then((m) => m.SitePeekDialog),
  { ssr: false }
)
const QuickToolsDrawer = dynamic(
  () => import('@/components/quick-tools-drawer').then((m) => m.QuickToolsDrawer),
  { ssr: false }
)
// 浮动托盘与批量操作坞：都是「交互后才出现」的 UI。
// 之前静态导入会把 1,365 行的工具栏与批量引擎一起塞进首页初始包；
// 改为客户端懒加载后，首屏只留一个同高占位（不产生 CLS）。
const HomeDIYToolbar = dynamic(
  () => import('@/components/home-diy-toolbar').then((m) => m.HomeDIYToolbar),
  { ssr: false }
)
const BatchOperationDock = dynamic(
  () => import('@/components/batch-operation-dock').then((m) => m.BatchOperationDock),
  { ssr: false }
)
import { Button } from '@/registry/new-york/ui/button'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/registry/new-york/ui/dialog'
import { Input } from '@/registry/new-york/ui/input'
import {
  Github,
  HelpCircle,
  MonitorPlay,
  Send,
  Flame,
  Tags,
  Wrench,
  Menu,
  Network,
  Upload,
  Cpu,
  LayoutGrid,
  Compass,
  Store,
  Pin,
  Sparkles,
  Plus,
  ChevronDown,
  CheckSquare,
  ListChecks,
} from 'lucide-react'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { summarizeSelection } from '@/lib/selection'
import { WorkspaceFilter, type WorkspaceId } from '@/components/workspace-filter'
import {
  sortCategoryItemsWithPinned,
  computeAdaptiveSiteRanking,
  suggestCategoryForSite,
  isSafeWallpaperUrl,
  isSafeSiteHref,
} from '@/lib/modular/diy-presets'
import { filterNavigationByWorkspace } from '@/lib/modular/workspace-matching'
import {
  combineAndSortCategories,
  customCategoriesToNavigation,
} from '@/lib/modular/category-combine'
import { useSiteSelection } from '@/lib/modular/use-site-selection'
import { createCustomSiteId, normalizeCustomSiteHref } from '@/lib/modular/custom-site-input'
import { useToast } from '@/components/ui/use-toast'
import { pinSiteToWorkbench } from '@/lib/modular/workbench-bridge'

interface NavigationContentProps {
  navigationData: NavigationData
  siteData: SiteConfig
}

export function NavigationContent({ navigationData, siteData }: NavigationContentProps) {
  const { toast } = useToast()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  // 抽屉的公共行为：Esc 关、点遮罩关、锁背景滚动、焦点圈养与还原、role=dialog
  const { containerProps, scrimProps } = useOverlayBehavior({
    open: isSidebarOpen,
    onClose: () => setIsSidebarOpen(false),
  })
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>('all')
  const [isToolsOpen, setIsToolsOpen] = useState(false)
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)
  const [peekItem, setPeekItem] = useState<NavigationSubItem | null>(null)

  // 添加自定义网址到专属分类状态
  const [addSiteTargetCatId, setAddSiteTargetCatId] = useState<string | null>(null)
  const [customSiteTitle, setCustomSiteTitle] = useState('')
  const [customSiteHref, setCustomSiteHref] = useState('')
  const [customSiteDesc, setCustomSiteDesc] = useState('')

  const {
    mounted,
    viewMode,
    cardDisplayMode,
    canvasBackground,
    isEditingLayout,
    categoryOrder,
    pinnedCategoryIds,
    hiddenCategoryIds,
    collapsedCategoryIds,
    pinnedSiteIdsByCategory,
    customCategories,
    isAdaptiveRankingEnabled,
    togglePinSiteInCategory,
    addSiteToCustomCategory,
    reorderCategory,
    toggleCollapseCategory,
    siteCategoryOverrides,
    reclassifySite,
    customWallpaperUrl,
    glassmorphismBlur,
  } = useHomeDIY()

  // 拖拽编排分类状态
  const [dropCategoryTarget, setDropCategoryTarget] = useState<{ categoryId: string; position: 'before' | 'after' } | null>(null)
  // 拖拽卡片收录状态 (悬停的目标自定义分类 ID)
  const [dragOverCustomCatId, setDragOverCustomCatId] = useState<string | null>(null)

  // 1. 场景工作台动态过滤（纯函数见 lib/modular/workspace-matching.ts，判定有单测）
  const filteredNavigationItems = useMemo(
    () => filterNavigationByWorkspace(navigationData.navigationItems, activeWorkspace),
    [navigationData.navigationItems, activeWorkspace],
  )

  // 2. 自定义专属分类 → 导航形状 + 合并/重映射/隐藏/排序
  //    （纯函数见 lib/modular/category-combine.ts）
  const customAsCategories = useMemo(
    () => customCategoriesToNavigation(customCategories),
    [customCategories],
  )

  const { allCategoryIds, categoryTitleMap, sortedCategories } = useMemo(
    () =>
      combineAndSortCategories({
        custom: customAsCategories,
        navigation: filteredNavigationItems as never,
        siteCategoryOverrides,
        hiddenCategoryIds,
        pinnedCategoryIds,
        categoryOrder,
      }),
    [customAsCategories, filteredNavigationItems, hiddenCategoryIds, pinnedCategoryIds, categoryOrder, siteCategoryOverrides],
  )

  /* ------------------------- 多选批量操作 -------------------------
   *
   * 组件 `batch-operation-dock.tsx` 与 `lib/batch-operations.ts`（批量导出 /
   * 复制成 Markdown / 置顶 / 移动 / 删除）早就写好了，但**从未被挂载**：
   * 没有任何选中状态，也没有任何入口，用户「一次处理多个站点」的需求没有出口。
   * 这里补上入口：工具栏的「多选」开关 + 卡片选中态 + 底部操作坞。
   *
   * 选中态本身（可见站点收集 / 剪枝 / 切换 / 全选）已抽到
   * `lib/modular/use-site-selection.ts`，组件只消费返回值。
   */
  const {
    selectionMode,
    selectedIds,
    selectedSites,
    visibleSites,
    clearSelection,
    toggleSelectMode,
    toggleSelectOne,
    selectAllVisible,
  } = useSiteSelection(sortedCategories as never, collapsedCategoryIds)

  // 4. 画布背景类名
  const canvasBgClass = useMemo(() => {
    switch (canvasBackground) {
      case 'dots':
        return 'canvas-bg-dots'
      case 'grid':
        return 'canvas-bg-grid'
      case 'aurora':
        return 'canvas-bg-aurora'
      case 'clean':
        return 'canvas-bg-clean'
      case 'mesh':
      default:
        return 'subtle-mesh canvas-bg-mesh'
    }
  }, [canvasBackground])

  // 5. 根据多态卡片选择自适应网格列数
  const gridColumnsClass = useMemo(() => {
    if (cardDisplayMode === 'compact') {
      return 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 min-[1920px]:grid-cols-7'
    }
    if (cardDisplayMode === 'rich') {
      return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 min-[1920px]:grid-cols-5'
    }
    return 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 min-[1920px]:grid-cols-6'
  }, [cardDisplayMode])

  // 提交添加自定义站点
  const handleAddCustomSiteSubmit = () => {
    if (!addSiteTargetCatId || !customSiteTitle.trim() || !customSiteHref.trim()) return

    // 伪协议拦截 + 协议补全 + 白名单校验统一在纯函数里（有单测，见 custom-site-input.test.ts）
    const normalized = normalizeCustomSiteHref(customSiteHref)
    if (!normalized.ok) {
      if (normalized.reason === 'unsafe-protocol') {
        toast({ title: '⚠️ 网址不安全', description: '仅允许 http/https 或站内相对路径。' })
      } else {
        toast({ title: '⚠️ 网址不合法', description: '请输入合法的 http(s) 网址。' })
      }
      return
    }

    addSiteToCustomCategory(addSiteTargetCatId, {
      id: createCustomSiteId(),
      title: customSiteTitle.trim(),
      href: normalized.href,
      description: customSiteDesc.trim() || undefined,
    })

    toast({
      title: '✨ 自定义站点已添加',
      description: `站点「${customSiteTitle.trim()}」已成功收录至该分类。`,
    })

    setAddSiteTargetCatId(null)
    setCustomSiteTitle('')
    setCustomSiteHref('')
    setCustomSiteDesc('')
  }

  // 6. 自定义站点录入时的智能模糊分类归属推荐算法
  const categorySuggestion = useMemo(() => {
    if (!customSiteTitle.trim() && !customSiteHref.trim()) return null
    return suggestCategoryForSite(
      { title: customSiteTitle, href: customSiteHref, description: customSiteDesc },
      sortedCategories
    )
  }, [customSiteTitle, customSiteHref, customSiteDesc, sortedCategories])

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <div className="hidden md:block">
        <Sidebar
          navigationData={{ navigationItems: sortedCategories as any }}
          siteInfo={siteData}
          className="sticky top-0 h-screen"
        />
      </div>

      <div className={cn(
        "fixed inset-0 z-50 md:hidden",
        isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
      )}>
        <div
          {...scrimProps}
          className="absolute inset-0 bg-background/80 backdrop-blur-sm transition-opacity"
        />
        <div
          {...containerProps}
          aria-label="站点导航"
          className={cn(
            "fixed inset-y-0 left-0 w-3/4 max-w-xs bg-background shadow-lg transform transition-transform duration-200 ease-in-out outline-none",
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <Sidebar
            navigationData={{ navigationItems: sortedCategories as any }}
            siteInfo={siteData}
            onClose={() => setIsSidebarOpen(false)}
          />
        </div>
      </div>

      <main
        id="main-content"
        className={cn("flex-1 min-h-screen flex flex-col min-w-0 transition-colors duration-300", canvasBgClass)}
        // 水合安全：壁纸来自 localStorage（仅客户端），首帧与 SSR 保持一致（undefined），
        // 挂载后再上壁纸，避免 style 分叉触发 hydration mismatch；URL 白名单防 CSS url() 注入
        style={mounted && customWallpaperUrl && isSafeWallpaperUrl(customWallpaperUrl) ? {
          backgroundImage: `url(${customWallpaperUrl})`,
          backgroundSize: 'cover',
          backgroundAttachment: 'fixed',
          backgroundPosition: 'center',
          backdropFilter: `blur(${glassmorphismBlur || 0}px)`
        } : undefined}
      >
        {/* SEO 与无障碍可访问性首要标题（通过 sr-only 视觉隐藏，供屏幕阅读器与搜索引擎建立层级大纲） */}
        <h1 className="sr-only">
          {siteData.basic.title} - {siteData.basic.description || 'AI 原生智能网址导航与研发效率中枢'}
        </h1>

        <div className="sticky top-0 bg-background/85 dark:bg-background/80 backdrop-blur-md z-30 px-4 sm:px-6 border-b border-border/40 shadow-2xs">
          <div className="flex h-14 items-center justify-between gap-3">
            <div className="flex-1 max-w-xl">
              {/* NavHub 混合检索引擎 */}
              <SearchPalette siteConfig={siteData} />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* 开发者极速微工具箱按钮 */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8.5 w-8.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                onClick={() => setIsToolsOpen(true)}
                title="打开内置微工具箱 (快捷键: T)"
                aria-label="微工具箱"
              >
                <Wrench className="h-4 w-4" />
              </Button>

              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-8.5 w-8.5 rounded-lg text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
              >
                <Link href="/hot" aria-label="热度榜" title="热度趋势与新品榜">
                  <Flame className="h-4 w-4" />
                </Link>
              </Button>

              {/* 探索功能矩阵下拉菜单 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8.5 w-8.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    title="探索矩阵"
                    aria-label="探索矩阵"
                  >
                    <Compass className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 p-1.5 shadow-xl bg-popover/95 backdrop-blur-md border border-border/80">
                  <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
                    认知与前沿矩阵
                  </DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/graph" className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Network className="h-4 w-4 text-pink-500 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">技术生态图谱</span>
                        <span className="text-xs text-muted-foreground">架构选型与平替网络</span>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/algorithms" className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Cpu className="h-4 w-4 text-cyan-500 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">前沿算法实验室</span>
                        <span className="text-xs text-muted-foreground">LinUCB / 双曲 / E2EE</span>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/custom" className="flex items-center gap-2.5 px-2 py-2 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <LayoutGrid className="h-4 w-4 text-emerald-500 shrink-0" />
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">模块化工作台</span>
                        <span className="text-xs text-muted-foreground">自由拖拽与小组件排版</span>
                      </div>
                    </Link>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator className="my-1" />

                  <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
                    全景与发现
                  </DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/tags" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Tags className="h-4 w-4 text-indigo-500 shrink-0" />
                      <span className="font-medium text-foreground">全景标签云</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/videos" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <MonitorPlay className="h-4 w-4 text-blue-500 shrink-0" />
                      <span className="font-medium text-foreground">视频教程导航</span>
                    </Link>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator className="my-1" />

                  <DropdownMenuLabel className="text-xs text-muted-foreground font-semibold px-2 py-1">
                    社区与工具
                  </DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href="/import" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Upload className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span className="font-medium text-foreground">导入浏览器书签</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/marketplace" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Store className="h-4 w-4 text-rose-500 shrink-0" />
                      <span className="font-medium text-foreground">插件市场（社区共享）</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/submit" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Send className="h-4 w-4 text-amber-500 shrink-0" />
                      <span className="font-medium text-foreground">收录与提交网站</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/preferences" className="flex items-center gap-2.5 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent">
                      <Sparkles className="h-4 w-4 text-violet-500 shrink-0" />
                      <span className="font-medium text-foreground">我的偏好（个性化画像）</span>
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 快捷键指南按钮 */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8.5 w-8.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors hidden sm:inline-flex"
                onClick={() => setIsShortcutsOpen(true)}
                title="快捷键全景指南 (快捷键: ?)"
                aria-label="快捷键指南"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>

              {/* 多选：批量导出 / 复制 / 置顶的唯一入口（此前只有孤立的操作坞，没有任何入口） */}
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "relative h-8.5 w-8.5 rounded-lg transition-colors",
                  selectionMode
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
                onClick={toggleSelectMode}
                aria-pressed={selectionMode}
                title={selectionMode ? '退出多选模式' : '多选模式：批量导出 / 复制 / 置顶'}
                aria-label="多选模式"
              >
                <CheckSquare className="h-4 w-4" />
                {selectionMode && selectedIds.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] leading-4 font-mono">
                    {selectedIds.length}
                  </span>
                )}
              </Button>

              {selectionMode && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8.5 rounded-lg gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  onClick={selectAllVisible}
                  title={summarizeSelection(selectedIds, visibleSites.length) + '（点击全选当前可见站点）'}
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{summarizeSelection(selectedIds, visibleSites.length)}</span>
                </Button>
              )}

              <ViewModeToggle />
              <DensityToggle />
              <ModeToggle />
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-8.5 w-8.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"
              >
                <Link
                  href="https://github.com/tianyaxiang/NavSphere"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="访问 GitHub 仓库"
                  title="GitHub 仓库"
                  className="hidden sm:inline-flex"
                >
                  <Github className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8.5 w-8.5 rounded-lg md:hidden text-muted-foreground hover:text-foreground"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                aria-label="打开菜单"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 场景化工作台切换条 */}
          <WorkspaceFilter active={activeWorkspace} onChange={setActiveWorkspace} />
        </div>

        <div className="px-4 sm:px-6 md:px-8 py-6 sm:py-8 flex-1">
          {/* 首访引导：非阻断式卡片，只在首页且非工作台视图出现 */}
          {viewMode !== 'workbench' && <OnboardingCard />}
          {viewMode === 'workbench' ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-1">
                <div>
                  <h2 className="text-base sm:text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                    <span className="w-1.5 h-4.5 rounded-full bg-emerald-500" />
                    <span>模块化工作台主页</span>
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    当前处于工作台模式。模块支持自由拖拽换位、双轴尺寸调整，并在本地实时持久化。
                  </p>
                </div>
              </div>
              <ModularCanvas />
            </div>
          ) : (
            <>
              {/* 极客混合模式：首屏极速组件展板 */}
              {viewMode === 'hybrid' && <HomeHeroDeck />}

              <div className="space-y-8 sm:space-y-10">
                {sortedCategories.map((category, index) => {
                  const isPinned = pinnedCategoryIds.includes(category.id)
                  const isCustom = Boolean((category as any).isCustom)
                  const isCollapsed = collapsedCategoryIds.includes(category.id)
                  const directCount = (category.items as any[])?.length || 0
                  const subCats = (category.subCategories as any[]) || []
                  const subCount = subCats.reduce((acc: number, sub: any) => acc + ((sub.items as any[])?.length || 0), 0)
                  const totalCount = directCount + subCount

                  // 分类内置顶与自适应热度衰减推荐排序
                  const categoryPinnedItemIds = pinnedSiteIdsByCategory[category.id] || []
                  const sortedDirectItems = isAdaptiveRankingEnabled
                    ? computeAdaptiveSiteRanking((category.items as any[]) || [], {
                        pinnedItemIds: categoryPinnedItemIds,
                      })
                    : sortCategoryItemsWithPinned(
                        (category.items as any[]) || [],
                        categoryPinnedItemIds
                      )

                  return (
                    <section
                      key={category.id}
                      id={category.id}
                      onDragOver={(e) => {
                        // 1. 如果拖拽的是卡片，且当前是自定义专属分类
                        if (e.dataTransfer.types.includes('text/navhub-card-payload')) {
                          if (isCustom) {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'copy'
                            if (dragOverCustomCatId !== category.id) {
                              setDragOverCustomCatId(category.id)
                            }
                          }
                          return
                        }

                        // 2. 如果处于排版编排模式且拖拽的是分类
                        if (isEditingLayout && e.dataTransfer.types.includes('text/navhub-category-id')) {
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          const rect = e.currentTarget.getBoundingClientRect()
                          const midY = rect.top + rect.height / 2
                          const pos = e.clientY < midY ? 'before' : 'after'
                          setDropCategoryTarget({ categoryId: category.id, position: pos })
                        }
                      }}
                      onDragLeave={() => {
                        if (dropCategoryTarget?.categoryId === category.id) {
                          setDropCategoryTarget(null)
                        }
                        if (dragOverCustomCatId === category.id) {
                          setDragOverCustomCatId(null)
                        }
                      }}
                      onDrop={(e) => {
                        // 1. 处理卡片拖拽跨分类移动与自建分类收录
                        if (e.dataTransfer.types.includes('text/navhub-card-payload')) {
                          e.preventDefault()
                          setDragOverCustomCatId(null)
                          try {
                            const raw = e.dataTransfer.getData('text/navhub-card-payload')
                            if (raw) {
                              const card = JSON.parse(raw)
                              if (isCustom && card.title && card.href) {
                                if (!isSafeSiteHref(card.href)) {
                                  toast({
                                    title: '⚠️ 拖拽收录已拦截',
                                    description: '该卡片地址不安全，仅允许 http/https 或站内路径。',
                                  })
                                  return
                                }
                                const exists = (category.items as any[])?.some(
                                  (item: any) => item.href === card.href || item.title === card.title
                                )
                                if (exists) {
                                  toast({
                                    title: 'ℹ️ 站点已存在',
                                    description: `站点「${card.title}」已收录在「${category.title}」中。`,
                                  })
                                  return
                                }
                                addSiteToCustomCategory(category.id, {
                                  id: createCustomSiteId(),
                                  title: card.title,
                                  href: card.href,
                                  description: card.description || undefined,
                                  icon: card.icon || undefined,
                                })
                                toast({
                                  title: '📥 拖拽收录成功',
                                  description: `已成功将站点「${card.title}」收录进专属分类「${category.title}」！`,
                                })
                                return
                              } else if (isEditingLayout && card.id && card.sourceCategoryId !== category.id) {
                                reclassifySite(card.id, category.id)
                                toast({
                                  title: '🔄 跨分类迁移成功',
                                  description: `已将站点「${card.title}」重排归类至「${category.title}」！`,
                                })
                                return
                              }
                            }
                          } catch (err) {
                            console.error('拖拽卡片解析失败', err)
                          }
                          return
                        }
                        if (false && isCustom) {
                          e.preventDefault()
                          setDragOverCustomCatId(null)
                          try {
                            const raw = e.dataTransfer.getData('text/navhub-card-payload')
                            if (raw) {
                              const card = JSON.parse(raw)
                              if (card.title && card.href) {
                                const exists = (category.items as any[])?.some(
                                  (item: any) => item.href === card.href || item.title === card.title
                                )
                                if (exists) {
                                  toast({
                                    title: 'ℹ️ 站点已存在',
                                    description: `站点「${card.title}」已收录在「${category.title}」中。`,
                                  })
                                  return
                                }
                                addSiteToCustomCategory(category.id, {
                                  id: createCustomSiteId(),
                                  title: card.title,
                                  href: card.href,
                                  description: card.description || undefined,
                                  icon: card.icon || undefined,
                                })
                                toast({
                                  title: '📥 拖拽收录成功',
                                  description: `已成功将站点「${card.title}」收录进专属分类「${category.title}」！`,
                                })
                              }
                            }
                          } catch (err) {
                            console.error('拖拽卡片解析失败', err)
                          }
                          return
                        }

                        // 2. 处理分类位置重排
                        if (isEditingLayout && e.dataTransfer.types.includes('text/navhub-category-id')) {
                          e.preventDefault()
                          const sourceCatId = e.dataTransfer.getData('text/navhub-category-id')
                          const targetPos = dropCategoryTarget?.position || 'before'
                          setDropCategoryTarget(null)
                          if (sourceCatId && sourceCatId !== category.id) {
                            reorderCategory(sourceCatId, category.id, targetPos, allCategoryIds)
                            toast({
                              title: '✨ 分类编排已更新',
                              description: `已将分类重排至「${category.title}」${targetPos === 'after' ? '之后' : '之前'}。`,
                            })
                          }
                        }
                      }}
                      className={cn(
                        "relative scroll-m-16 transition-all duration-200",
                        isPinned && "p-3 sm:p-4 rounded-2xl bg-primary/3 border border-primary/20 depth-surface",
                        isEditingLayout && "p-3 sm:p-4 rounded-2xl border-2 border-dashed border-primary/30 bg-muted/20",
                        dragOverCustomCatId === category.id && "ring-2 ring-emerald-500 bg-emerald-500/10 rounded-2xl border-emerald-500/60"
                      )}
                    >
                      {/* 分类拖拽放置指示标线 */}
                      {dropCategoryTarget?.categoryId === category.id && dropCategoryTarget.position === 'before' && (
                        <div className="absolute -top-1.5 inset-x-2 h-1 bg-primary rounded-full shadow-md shadow-primary/60 animate-pulse z-30" />
                      )}
                      {dropCategoryTarget?.categoryId === category.id && dropCategoryTarget.position === 'after' && (
                        <div className="absolute -bottom-1.5 inset-x-2 h-1 bg-primary rounded-full shadow-md shadow-primary/60 animate-pulse z-30" />
                      )}

                      {/* 卡片拖拽进专属分类的引导高亮条 */}
                      {dragOverCustomCatId === category.id && (
                        <div className="mb-3 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500/15 border-2 border-dashed border-emerald-500 text-emerald-600 dark:text-emerald-400 font-semibold text-xs animate-in zoom-in-95 duration-150">
                          <Sparkles className="w-4 h-4 animate-bounce" />
                          <span>松开鼠标，直接收录卡片至「{category.title}」专属分类</span>
                        </div>
                      )}

                      <div className="space-y-4">
                        {/* 一级分类标题头 */}
                        <div className="flex items-center justify-between pb-3 border-b border-border/50">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* 手风琴折叠展开按钮 */}
                            <button
                              type="button"
                              onClick={() => toggleCollapseCategory(category.id)}
                              className="p-1 -ml-1 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-muted/80 transition-all flex items-center justify-center cursor-pointer"
                              title={isCollapsed ? `展开「${category.title}」` : `收起「${category.title}」`}
                              aria-expanded={!isCollapsed}
                            >
                              <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", isCollapsed && "-rotate-90")} />
                            </button>

                            <span className={cn(
                              "w-1.5 h-5 rounded-full",
                              isCustom ? "bg-emerald-500" : isPinned ? "bg-amber-500" : "bg-primary"
                            )} />
                            <h2
                              className="text-lg sm:text-xl font-bold tracking-tight text-foreground flex items-center gap-2 cursor-pointer select-none"
                              onClick={() => toggleCollapseCategory(category.id)}
                              title={isCollapsed ? "点击展开" : "点击折叠"}
                            >
                              <span>{category.title}</span>
                              {isPinned && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium">
                                  <Pin className="w-2.5 h-2.5 fill-amber-500" />
                                  <span>已置顶</span>
                                </span>
                              )}
                              {isCustom && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  <span>专属私人</span>
                                </span>
                              )}
                              {isAdaptiveRankingEnabled && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 font-medium">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  <span>自适应热度</span>
                                </span>
                              )}
                            </h2>
                            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground border border-border/40 font-medium">
                              {totalCount} 站点
                            </span>
                            {isCollapsed && (
                              <button
                                type="button"
                                onClick={() => toggleCollapseCategory(category.id)}
                                className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 font-medium hover:bg-sky-500/20 transition-all cursor-pointer"
                                title="点击展开该分类"
                              >
                                <span>已收起 (点击展开)</span>
                              </button>
                            )}
                          </div>

                          {/* 就地可视化排版控制器（置顶 / 上移 / 下移 / 隐藏） */}
                          {isEditingLayout && (
                            <CategoryInSituControls
                              categoryId={category.id}
                              title={category.title}
                              isPinned={isPinned}
                              isCustom={isCustom}
                              canMoveUp={index > 0}
                              canMoveDown={index < sortedCategories.length - 1}
                              allCategoryIds={allCategoryIds}
                            />
                          )}
                        </div>

                        {/* 未折叠时渲染分类下挂载的站点和二级分类 */}
                        {!isCollapsed && (
                          <>
                            {/* 一级分类下直接挂载的站点 */}
                            {(sortedDirectItems.length > 0 || isCustom) && (
                              <div
                                className={cn(gridColumnsClass, "transition-all duration-200")}
                                style={{ gap: 'var(--density-grid-gap, 1rem)' }}
                              >
                                {sortedDirectItems.map((item: any) => (
                                  <NavigationCard
                                    key={item.id}
                                    item={item}
                                    siteConfig={siteData}
                                    onPeek={setPeekItem}
                                    cardDisplayMode={cardDisplayMode}
                                    isPinnedInCategory={categoryPinnedItemIds.includes(item.id)}
                                    onTogglePinInCategory={(siteId) => togglePinSiteInCategory(category.id, siteId)}
                                    isDraggable={isEditingLayout}
                                    sourceCategoryId={category.id}
                                    selectable={selectionMode}
                                    selected={selectedIds.includes(item.id)}
                                    onToggleSelect={toggleSelectOne}
                                  />
                                ))}

                                {/* 专属私人分类末尾的“添加自定义网址”槽位 */}
                                {isCustom && (
                                  <button
                                    type="button"
                                    onClick={() => setAddSiteTargetCatId(category.id)}
                                    className={cn(
                                      "group flex items-center justify-center gap-2 p-3 rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-semibold transition-all hover:scale-[1.02] cursor-pointer",
                                      cardDisplayMode === 'compact' ? "h-9" : "min-h-[72px]"
                                    )}
                                    title="添加自定义网站到该专属分类"
                                  >
                                    <Plus className="w-4 h-4 transition-transform group-hover:rotate-90" />
                                    <span>添加自定义网址</span>
                                  </button>
                                )}
                              </div>
                            )}

                            {/* 二级分类及其站点 */}
                            {category.subCategories && category.subCategories.length > 0 &&
                              category.subCategories.map((subCategory: any) => {
                                const subPinnedItemIds = pinnedSiteIdsByCategory[subCategory.id] || []
                                const sortedSubItems = isAdaptiveRankingEnabled
                                  ? computeAdaptiveSiteRanking((subCategory.items as any[]) || [], {
                                      pinnedItemIds: subPinnedItemIds,
                                    })
                                  : sortCategoryItemsWithPinned(
                                      (subCategory.items as any[]) || [],
                                      subPinnedItemIds
                                    )

                                return (
                                  <div key={subCategory.id} id={subCategory.id} className="space-y-3 pt-2">
                                    <div className="flex items-center gap-2 pb-0.5 pt-1">
                                      <span className="w-1 h-3.5 rounded-full bg-muted-foreground/40" />
                                      <h3 className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                                        {subCategory.title}
                                      </h3>
                                      <span className="text-xs text-muted-foreground/60 font-mono">
                                        ({subCategory.items?.length || 0})
                                      </span>
                                    </div>
                                    <div
                                      className={cn(gridColumnsClass, "transition-all duration-200")}
                                      style={{ gap: 'var(--density-grid-gap, 1rem)' }}
                                    >
                                      {sortedSubItems.map((item: any) => (
                                        <NavigationCard
                                          key={item.id}
                                          item={item}
                                          siteConfig={siteData}
                                          onPeek={setPeekItem}
                                          cardDisplayMode={cardDisplayMode}
                                          isPinnedInCategory={subPinnedItemIds.includes(item.id)}
                                          onTogglePinInCategory={(siteId) => togglePinSiteInCategory(subCategory.id, siteId)}
                                          isDraggable={isEditingLayout}
                                          sourceCategoryId={subCategory.id}
                                          selectable={selectionMode}
                                          selected={selectedIds.includes(item.id)}
                                          onToggleSelect={toggleSelectOne}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )
                              })}

                            {/* 空分类提示 */}
                            {totalCount === 0 && !isCustom && (
                              <div className="text-center py-6 border border-dashed border-border/60 rounded-xl text-muted-foreground text-xs">
                                该分类下暂无收录站点，可通过卡片右上角的图钉或添加站点进行收录。
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </section>
                  )
                })}

                {sortedCategories.length === 0 && (
                  <div className="text-center py-16 text-muted-foreground space-y-3">
                    <p className="text-sm">当前所有分类已被隐藏或工作台下暂无匹配站点</p>
                    <Button variant="outline" size="sm" onClick={() => setActiveWorkspace('all')}>
                      查看全部站点
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 首页浮动 DIY 排版与分类管理托盘 */}
        <HomeDIYToolbar
          allCategoryIds={allCategoryIds}
          categoryTitleMap={categoryTitleMap}
          categories={sortedCategories}
          raised={selectionMode}
        />

        {/* 页脚 */}
        <Footer siteInfo={siteData} />

        {/* 4.0 弹窗：空格键沙箱速览与行动视窗 */}
        <SitePeekDialog item={peekItem} open={!!peekItem} onOpenChange={(open) => !open && setPeekItem(null)} />

        {/* 4.0 弹窗：内置开发者微工具抽屉 */}
        <QuickToolsDrawer open={isToolsOpen} onOpenChange={setIsToolsOpen} />

        {/* 4.0 弹窗：快捷键指南与 Maestro 监听 */}
        <KeyboardShortcutsDialog open={isShortcutsOpen} onOpenChange={setIsShortcutsOpen} />

        {/* 多选批量操作坞：选中任意卡片后自底部升起（批量导出 / 复制 / 置顶） */}
        {selectionMode && (
          <BatchOperationDock
            selectedSites={selectedSites}
            customCategories={customAsCategories.map((c: any) => ({
              id: c.id,
              title: c.title,
              items: (c.items as any[]) || [],
            }))}
            onClearSelection={clearSelection}
            onSelectAll={selectAllVisible}
            totalCount={visibleSites.length}
            onBatchAddToCustomCategory={(categoryId) => {
              const usable = selectedSites.filter((site) => isSafeSiteHref(site.href))
              if (usable.length === 0) {
                toast({ title: '⚠️ 没有可收录的站点', description: '选中的站点网址不合法。' })
                return
              }
              for (const site of usable) {
                addSiteToCustomCategory(categoryId, {
                  id: createCustomSiteId(),
                  title: site.title,
                  href: site.href,
                  description: site.description,
                })
              }
              toast({
                title: '✨ 已收录 ' + usable.length + ' 个站点',
                description: '已批量加入所选专属分类。',
              })
              clearSelection()
            }}
            onBatchPinToWorkbench={() => {
              let pinned = 0
              for (const site of selectedSites) {
                if (!isSafeSiteHref(site.href)) continue
                const res = pinSiteToWorkbench({
                  siteId: site.id,
                  title: site.title,
                  href: site.href,
                  icon: site.icon,
                  description: site.description,
                })
                if (res.ok) pinned++
              }
              toast(
                pinned > 0
                  ? { title: '📌 已固定 ' + pinned + ' 个站点', description: '已加入收藏与工作台启动坞。' }
                  : { title: '⚠️ 固定失败', description: '浏览器本地存储不可用，或网址不合法。' },
              )
            }}
          />
        )}

        {/* 自定义站点录入弹窗 */}
        <Dialog open={!!addSiteTargetCatId} onOpenChange={(open) => !open && setAddSiteTargetCatId(null)}>
          <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md max-h-[85dvh] overflow-y-auto p-4 sm:p-6">
            <DialogHeader className="pr-8 sm:pr-6">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Plus className="w-5 h-5 text-emerald-500" />
                <span>添加网址到专属分类</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                录入您想要收录的自定义网站，仅保存在当前设备的私人看板中。
              </DialogDescription>
            </DialogHeader>

            <div className="py-3 space-y-3">
              <div>
                <label htmlFor="custom-site-title" className="text-xs font-medium text-foreground block mb-1">网站标题 *</label>
                <Input id="custom-site-title"
                  placeholder="例如：My Internal Dashboard"
                  value={customSiteTitle}
                  onChange={(e) => setCustomSiteTitle(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="custom-site-href" className="text-xs font-medium text-foreground block mb-1">网站网址 (URL) *</label>
                <Input id="custom-site-href"
                  placeholder="例如：https://internal.company.io 或 192.168.1.100:8080"
                  value={customSiteHref}
                  onChange={(e) => setCustomSiteHref(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="custom-site-desc" className="text-xs font-medium text-foreground block mb-1">简要描述 (可选)</label>
                <Input id="custom-site-desc"
                  placeholder="例如：公司内部指标监控看板"
                  value={customSiteDesc}
                  onChange={(e) => setCustomSiteDesc(e.target.value)}
                />
              </div>

              {/* 智能模糊分类归属推荐卡片 */}
              {categorySuggestion && (
                <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Sparkles className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                    <span className="text-muted-foreground truncate">
                      AI 推荐分类：<strong className="text-foreground">{categorySuggestion.categoryTitle}</strong> ({Math.round(categorySuggestion.confidence * 100)}% 匹配)
                    </span>
                  </div>
                  {addSiteTargetCatId !== categorySuggestion.categoryId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => setAddSiteTargetCatId(categorySuggestion.categoryId)}
                      className="h-6 px-2 text-[11px] text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 shrink-0 font-medium"
                    >
                      选入该类
                    </Button>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" size="sm" onClick={() => setAddSiteTargetCatId(null)}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={handleAddCustomSiteSubmit}
                disabled={!customSiteTitle.trim() || !customSiteHref.trim()}
              >
                保存到分类
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  )
}
