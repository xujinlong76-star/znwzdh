'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { NavigationData, NavigationSubItem } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { Sidebar } from '@/components/sidebar'
import { NavigationToolbar } from '@/components/navigation-toolbar'
import { NavigationCategorySection } from '@/components/navigation-category-section'
import { useHomeDIY } from '@/lib/modular/use-home-diy'
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/registry/new-york/ui/dialog'
import { Input } from '@/registry/new-york/ui/input'
import { Plus, Tags } from 'lucide-react'

import { cn } from '@/lib/utils'
import { type WorkspaceId } from '@/components/workspace-filter'
import {
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

interface DirectoryLink {
  id: string
  /** URL 标识（slug；历史行没 slug 时是 id） */
  slug: string
  title: string
  count: number
}

interface NavigationContentProps {
  navigationData: NavigationData
  siteData: SiteConfig
  /** 服务端生成的达标分类入口（首页目录带）；中枢失败时为空数组 */
  directoryLinks?: DirectoryLink[]
}

export function NavigationContent({
  navigationData,
  siteData,
  directoryLinks = [],
}: NavigationContentProps) {
  const { toast } = useToast()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  // 抽屉的公共行为：Esc 关、点遮罩关、锁背景滚动、焦点圈养与还原、role=dialog
  const { containerProps, scrimProps } = useOverlayBehavior({
    open: isSidebarOpen,
    onClose: () => setIsSidebarOpen(false),
    // 抽屉常驻 DOM，读屏需要一个稳定名称来说明「这是分类导航」
    ariaLabel: '分类导航抽屉',
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
    categoryOrder,
    pinnedCategoryIds,
    hiddenCategoryIds,
    collapsedCategoryIds,
    customCategories,
    addSiteToCustomCategory,
    siteCategoryOverrides,
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
      return 'grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 min-[1536px]:grid-cols-6! min-[1920px]:grid-cols-7!'
    }
    if (cardDisplayMode === 'rich') {
      return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 min-[1536px]:grid-cols-4! min-[1920px]:grid-cols-5!'
    }
    return 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 min-[1536px]:grid-cols-5! min-[1920px]:grid-cols-6!'
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

  // 6. 自定义站点录入时的关键词重合度分类推荐（本地启发式，界面上要如实标注）
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

        <NavigationToolbar
          siteConfig={siteData}
          onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
          onOpenTools={() => setIsToolsOpen(true)}
          onOpenShortcuts={() => setIsShortcutsOpen(true)}
          activeWorkspace={activeWorkspace}
          onWorkspaceChange={setActiveWorkspace}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          visibleSiteCount={visibleSites.length}
          onToggleSelectMode={toggleSelectMode}
          onSelectAllVisible={selectAllVisible}
        />
        <div className="px-3 sm:px-6 md:px-8 py-4 sm:py-8 flex-1">
          {/* 站内目录带：首页此前 0 条 /category 链接，分类 hub 只能靠 sitemap
              发现。服务端下发达标分类，SSR 直出；三个总览入口常驻。 */}
          <nav
            aria-labelledby="home-directory-title"
            className="mb-4 sm:mb-6 rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 backdrop-blur-sm"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span id="home-directory-title" className="text-xs font-semibold text-foreground">
                站内目录
              </span>
              <Link href="/category" className="text-xs text-primary hover:underline">
                全部分类
              </Link>
              <Link href="/sites" className="text-xs text-primary hover:underline">
                全部站点
              </Link>
              <Link href="/tags" className="text-xs text-primary hover:underline">
                按标签浏览
              </Link>
              {directoryLinks.length > 0 && (
                <>
                  <span aria-hidden className="hidden sm:block h-3.5 w-px bg-border" />
                  <ul className="flex flex-wrap items-center gap-1.5">
                    {directoryLinks.map((link) => (
                      <li key={link.id}>
                        <Link
                          href={`/category/${encodeURIComponent(link.slug)}`}
                          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                        >
                          {link.title}
                          <span className="font-mono text-[10px] opacity-70">{link.count}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </nav>

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
                {sortedCategories.map((category, index) => (
                  <NavigationCategorySection
                    key={category.id}
                    category={category}
                    index={index}
                    totalCategories={sortedCategories.length}
                    allCategoryIds={allCategoryIds}
                    gridColumnsClass={gridColumnsClass}
                    cardDisplayMode={cardDisplayMode}
                    selectionMode={selectionMode}
                    selectedIds={selectedIds}
                    siteData={siteData}
                    dropCategoryTarget={dropCategoryTarget}
                    dragOverCustomCatId={dragOverCustomCatId}
                    setDropCategoryTarget={setDropCategoryTarget}
                    setDragOverCustomCatId={setDragOverCustomCatId}
                    setAddSiteTargetCatId={setAddSiteTargetCatId}
                    setPeekItem={setPeekItem}
                    toggleSelectOne={toggleSelectOne}
                  />
                ))}

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

              {/* 关键词分类推荐卡片：判据是字符串重合，界面上不许冒充 AI */}
              {categorySuggestion && (
                <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Tags className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-muted-foreground truncate">
                        按关键词推荐分类：
                        <strong className="text-foreground">{categorySuggestion.categoryTitle}</strong>
                        （重合度 {Math.round(categorySuggestion.confidence * 100)}%）
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {categorySuggestion.matchReason} · 本地字符串匹配，不是 AI 判断
                      </div>
                    </div>
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
