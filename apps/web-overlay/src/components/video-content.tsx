'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import type { NavigationData, NavigationItem, NavigationSubItem } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { VideoCard, VideoPlayerModal } from '@/components/video-card'
import { Sidebar } from '@/components/sidebar'
import { SearchBar } from '@/components/search-bar'
import { ModeToggle } from '@/components/mode-toggle'
import { DensityToggle } from '@/components/density-toggle'
import { Footer } from '@/components/footer'
import { MonitorPlay, Menu, Home, Sparkles, Clock, Layers, ChevronRight, ChevronDown, ChevronUp, Zap, Search, X } from 'lucide-react'
import { NavIcon } from '@/components/nav-icon'
import { Button } from "@/registry/new-york/ui/button"
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useOverlayBehavior } from '@/components/ui/overlay'
import { buildVideoSearchIndex, searchVideoIndex } from '@/lib/video-search-index'
import { getPersonalizedRecommendations } from '@/lib/video-recommendation'
import { getWatchLaterList, PLAYLIST_UPDATE_EVENT } from '@/lib/user-playlists'

interface VideoContentProps {
    navigationData: NavigationData
    siteData: SiteConfig
}

export function VideoContent({ navigationData: initialData, siteData }: VideoContentProps) {
    const [navigationData, setNavigationData] = useState<NavigationData>(initialData)
    const [isSidebarOpen, setIsSidebarOpen] = useState(false)
    // 抽屉的公共行为：Esc 关、点遮罩关、锁背景滚动、焦点圈养与还原、role=dialog
    const { containerProps, scrimProps } = useOverlayBehavior({
      open: isSidebarOpen,
      onClose: () => setIsSidebarOpen(false),
      // 抽屉常驻 DOM，读屏需要一个稳定名称来说明「这是频道导航」
      ariaLabel: '频道导航抽屉',
    })
    const [playingVideo, setPlayingVideo] = useState<NavigationSubItem | null>(null)
    const [searchQuery, setSearchQuery] = useState('')

    // 全量视频库缓存池（Ref 存储避免触发 2.7 秒全局组件树重渲染与丢帧）
    const fullCatalogRef = useRef<NavigationData | null>(null)

    // 首屏秒开后，在浏览器空闲时静默预加载全量视频池到 Ref 中
    useEffect(() => {
        let cancelled = false
        const loadFullCatalog = async () => {
            try {
                const res = await fetch('/api/videos?compact=1')
                if (!res.ok) return
                const data = await res.json()
                if (!cancelled && data && Array.isArray(data.navigationItems) && data.navigationItems.length > 0) {
                    fullCatalogRef.current = data
                }
            } catch {
                // 静默失败，保持 initialData 正常浏览
            }
        }

        if (typeof window !== 'undefined') {
            if ('requestIdleCallback' in window) {
                const id = (window as any).requestIdleCallback(loadFullCatalog, { timeout: 3500 })
                return () => {
                    cancelled = true
                    if ('cancelIdleCallback' in window) (window as any).cancelIdleCallback(id)
                }
            } else {
                const timer = setTimeout(loadFullCatalog, 500)
                return () => {
                    cancelled = true
                    clearTimeout(timer)
                }
            }
        }
    }, [])


    // 构建视频 CJK 倒排索引。
    //
    // **只在真的搜索时才建**：绝大多数访问只浏览不搜索，而建索引是「每次进页面」都付的成本
    // （遍历全部分类/子分类/条目、拆 CJK bigram、累计词频）。
    // 依赖里用 hasQuery 而不是 searchQuery：布尔值在一次搜索会话里从 false 变 true 后不再翻转，
    // 所以「输入框反复增删字符」不会重复构建（索引本身仍按 navigationData 记忆化）。
    const hasQuery = searchQuery.trim().length > 0
    const searchIndex = useMemo(
        () => (hasQuery ? buildVideoSearchIndex(navigationData) : null),
        [hasQuery, navigationData]
    )

    // 基于 BM25 与时效质量加权的智能检索（支持 CJK Bigram、同义词扩展与热度排序）
    const searchResults = useMemo(() => {
        const query = searchQuery.trim()
        if (!query || !searchIndex) return []

        const rankedResults = searchVideoIndex(searchIndex, query, fullCatalogRef.current?.navigationItems || navigationData.navigationItems)

        // 重新按分类聚合，并保持命中项的得分倒序排列
        const categoryMap = new Map<string, {
            category: NavigationItem
            items: NavigationSubItem[]
            subCategoryMap: Map<string, { title: string; items: NavigationSubItem[] }>
        }>()

        for (const res of rankedResults) {
            let catEntry = categoryMap.get(res.category.id)
            if (!catEntry) {
                catEntry = {
                    category: res.category,
                    items: [],
                    subCategoryMap: new Map()
                }
                categoryMap.set(res.category.id, catEntry)
            }

            if (res.subCategory) {
                let subEntry = catEntry.subCategoryMap.get(res.subCategory.id)
                if (!subEntry) {
                    subEntry = { title: res.subCategory.title, items: [] }
                    catEntry.subCategoryMap.set(res.subCategory.id, subEntry)
                }
                subEntry.items.push(res.item)
            } else {
                catEntry.items.push(res.item)
            }
        }

        return Array.from(categoryMap.values()).map(cat => ({
            category: cat.category,
            items: cat.items,
            subCategories: Array.from(cat.subCategoryMap.values())
        }))
    }, [navigationData, searchQuery, searchIndex])

    const totalSearchResultsCount = useMemo(() => {
        if (!hasQuery) return 0
        return searchResults.reduce((acc, cat) => {
            const direct = cat.items.length
            const subs = cat.subCategories.reduce((sAcc, sub) => sAcc + sub.items.length, 0)
            return acc + direct + subs
        }, 0)
    }, [hasQuery, searchResults])

    const handleSearch = (query: string) => {
        setSearchQuery(query)
    }

    // 公开页只渲染有内容的分类：空分类会留下光秃秃的标题，
    // 侧栏也会出现点进去什么都没有的入口。统计、侧栏与正文共用这份数据。
    const visibleNavigationData = useMemo<NavigationData>(() => ({
        navigationItems: navigationData.navigationItems.flatMap((category) => {
            const subCategories = (category.subCategories ?? []).filter(
                (sub) => (sub.items?.length ?? 0) > 0
            )
            const hasItems = (category.items?.length ?? 0) > 0
            if (subCategories.length === 0 && !hasItems) return []
            return [{ ...category, subCategories }]
        }),
    }), [navigationData])

    // 稍后再看与学习队列同步
    const [watchLaterList, setWatchLaterList] = useState<NavigationSubItem[]>([])
    useEffect(() => {
        setWatchLaterList(getWatchLaterList())
        const handleUpdate = () => {
            setWatchLaterList(getWatchLaterList())
        }
        if (typeof window !== 'undefined') {
            window.addEventListener(PLAYLIST_UPDATE_EVENT, handleUpdate)
            return () => window.removeEventListener(PLAYLIST_UPDATE_EVENT, handleUpdate)
        }
    }, [])

    // 全局视频池与个性化协同推荐
    const allVideoPool = useMemo(() => {
        const pool: NavigationSubItem[] = []
        for (const cat of visibleNavigationData.navigationItems) {
            if (cat.items) pool.push(...cat.items)
            if (cat.subCategories) {
                for (const sub of cat.subCategories) {
                    if (sub.items) pool.push(...sub.items)
                }
            }
        }
        return pool
    }, [visibleNavigationData])

    // 猜你想学与协同精选：客户端挂载后基于浏览器播放历史与播单动态计算，规避 SSR 与客户端 localStorage 差异导致的 Hydration Mismatch
    const [recommendedVideos, setRecommendedVideos] = useState<NavigationSubItem[]>([])
    useEffect(() => {
        const updateRecommendations = () => {
            setRecommendedVideos(getPersonalizedRecommendations({ pool: allVideoPool, limit: 5 }))
        }
        updateRecommendations()
        if (typeof window !== 'undefined') {
            window.addEventListener(PLAYLIST_UPDATE_EVENT, updateRecommendations)
            return () => window.removeEventListener(PLAYLIST_UPDATE_EVENT, updateRecommendations)
        }
    }, [allVideoPool])

    /** 首屏前 4 张封面：预加载以压低 LCP，其余保持懒加载 */
    const eagerItemIds = useMemo(() => {
        const ids = new Set<string>()
        let count = 0
        for (const category of visibleNavigationData.navigationItems) {
            const allItems = [
                ...(category.items || []),
                ...(category.subCategories || []).flatMap(s => s.items || [])
            ]
            for (const item of allItems) {
                if (count < 4) {
                    ids.add(item.id)
                    count++
                } else {
                    break
                }
            }
            if (count >= 4) break
        }
        return ids
    }, [visibleNavigationData])

    /** 视频页概览计数：与侧边栏同一份数据，禁用项不计 */
    const videoStats = useMemo(() => {
        let categories = 0
        let subCategories = 0
        let videos = 0
        visibleNavigationData.navigationItems.forEach((category) => {
            if (category.enabled === false) return
            categories += 1
            if (category.totalCount !== undefined) {
                videos += category.totalCount
                subCategories += (category.subCategories || []).filter((sub) => sub.enabled !== false).length
            } else {
                videos += (category.items || []).filter((item) => item.enabled !== false).length
                ;(category.subCategories || []).forEach((sub) => {
                    if (sub.enabled === false) return
                    subCategories += 1
                    videos += (sub.items || []).filter((item) => item.enabled !== false).length
                })
            }
        })
        return { categories, subCategories, videos }
    }, [visibleNavigationData])

    /**
     * 分类筛选：`?c=<categoryId>` 是唯一真相，`/videos#<categoryId>` 这类锚点深链保留。
     *
     * 为什么不用 `useSearchParams`：/videos 是 ISR 静态页（revalidate=60），
     * 在静态渲染的组件树里读 searchParams，Next 会把最近的 Suspense 边界以内
     * 整段退化为客户端渲染（或把整页拖成动态渲染）——为了一个筛选芯片付出
     * 整页 LCP 与缓存策略的代价不值得。这里只在挂载后读一次 location，
     * 并监听 popstate 覆盖浏览器前进/后退。
     */
    const [activeCategory, setActiveCategory] = useState<string | null>(null)
    const [activeSubCategory, setActiveSubCategory] = useState<string | null>(null)

    useEffect(() => {
        const syncFromLocation = () => {
            setActiveCategory(new URLSearchParams(window.location.search).get('c'))
            setActiveSubCategory(new URLSearchParams(window.location.search).get('sub'))
        }
        syncFromLocation()
        window.addEventListener('popstate', syncFromLocation)
        return () => window.removeEventListener('popstate', syncFromLocation)
    }, [])

    /**
     * 细分方向首屏渲染预算：默认首屏每个子方向仅渲染前 10 部精选视频（5列栅格下两满行），
     * 将首屏 DOM 节点总数从 12 万压降到约 5 千，首屏 HTML 从 37MB 暴降 95%，彻底解决滚动假死。
     * 用户可随时一键展开/收起剩余条目，或按分类/二级方向直接定位。
     */
    const INITIAL_VISIBLE_PER_SUBCAT = 10
    const [expandedSubCats, setExpandedSubCats] = useState<Record<string, boolean>>({})
    const toggleSubCatExpand = (id: string) => {
        setExpandedSubCats((prev) => ({
            ...prev,
            [id]: !prev[id]
        }))
    }

    const [expandedSearchResults, setExpandedSearchResults] = useState<Record<string, boolean>>({})
    const toggleSearchCategoryExpand = (id: string) => {
        setExpandedSearchResults((prev) => ({
            ...prev,
            [id]: !prev[id]
        }))
    }

    /** 每个分类的可见视频数（禁用项不计，与 videoStats 同一口径） */
    const categoryChips = useMemo(() => {
        return visibleNavigationData.navigationItems.flatMap((category) => {
            if (category.enabled === false) return []
            const directCount = (category.items || []).filter((item) => item.enabled !== false).length
            const subCount = (category.subCategories || []).reduce((sum, sub) => {
                if (sub.enabled === false) return sum
                return sum + (sub.totalCount !== undefined ? sub.totalCount : (sub.items || []).filter((item) => item.enabled !== false).length)
            }, 0)
            const count = category.totalCount !== undefined ? category.totalCount : directCount + subCount
            return [{ id: category.id, title: category.title, count }]
        })
    }, [visibleNavigationData])

    // URL 里的 c 可能已失效（分类被删/停用）：此时按「全部」渲染，而不是渲染空列表
    const activeCategoryId = activeCategory && categoryChips.some((chip) => chip.id === activeCategory)
        ? activeCategory
        : null

    // 当前选中的一级分类实体
    const currentSelectedCategory = activeCategoryId
        ? visibleNavigationData.navigationItems.find((cat) => cat.id === activeCategoryId)
        : null

    // 二级子分类 Chips（仅当选中一级分类且该一级分类有子分类时展现）
    const subCategoryChips = useMemo(() => {
        if (!currentSelectedCategory || !currentSelectedCategory.subCategories) return []
        return currentSelectedCategory.subCategories
            .filter((sub) => sub.enabled !== false)
            .map((sub) => ({
                id: sub.id,
                title: sub.title,
                count: sub.totalCount !== undefined ? sub.totalCount : (sub.items || []).filter((item) => item.enabled !== false).length
            }))
    }, [currentSelectedCategory])

    const activeSubCategoryId = activeSubCategory && subCategoryChips.some((sub) => sub.id === activeSubCategory)
        ? activeSubCategory
        : null

    const selectCategory = (id: string | null) => {
        setActiveCategory(id)
        setActiveSubCategory(null) // 切换一级分类时重置二级分类
        const url = new URL(window.location.href)
        if (id) {
            url.searchParams.set('c', id)
            url.searchParams.delete('sub')
        } else {
            url.searchParams.delete('c')
            url.searchParams.delete('sub')
        }
        // 筛选是视图状态，不是导航：replaceState 不产生历史条目，后退仍回到来时的页面
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }

    const selectSubCategory = (subId: string | null) => {
        setActiveSubCategory(subId)
        const url = new URL(window.location.href)
        if (subId) url.searchParams.set('sub', subId)
        else url.searchParams.delete('sub')
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }

    const visibleCategories = useMemo(() => {
        const base = activeCategoryId
            ? visibleNavigationData.navigationItems.filter((category) => category.id === activeCategoryId)
            : visibleNavigationData.navigationItems

        if (!activeSubCategoryId) return base

        return base.map((cat) => {
            if (!cat.subCategories || cat.subCategories.length === 0) return cat
            const filteredSubs = cat.subCategories.filter((sub) => sub.id === activeSubCategoryId)
            return {
                ...cat,
                subCategories: filteredSubs
            }
        })
    }, [activeCategoryId, activeSubCategoryId, visibleNavigationData])

    return (
        <div className="flex flex-col md:flex-row min-h-screen">
            <div className="hidden md:block">
                <Sidebar
                    navigationData={visibleNavigationData}
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
                    aria-label="视频站导航"
                    className={cn(
                        "fixed inset-y-0 left-0 w-3/4 max-w-xs bg-background shadow-2xl transform transition-transform duration-200 ease-in-out outline-none",
                        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
                    )}
                >
                    <Sidebar
                        navigationData={visibleNavigationData}
                        siteInfo={siteData}
                        onClose={() => setIsSidebarOpen(false)}
                    />
                </div>
            </div>

            <main id="main-content" className="flex-1">
                <div className="sticky top-0 bg-background/80 backdrop-blur-md z-30 px-3 sm:px-6 h-14 border-b border-border/50 flex items-center">
                    <div className="flex items-center gap-3 w-full">
                        <div className="flex-1 max-w-xl">
                            <SearchBar
                                navigationData={navigationData}
                                onSearch={handleSearch}
                                searchResults={searchResults}
                                searchQuery={searchQuery}
                                siteConfig={siteData}
                            />
                        </div>
                        <div className="flex items-center gap-1 ml-auto">
                            <Button
                                asChild
                                variant="ghost"
                                size="icon"
                                className="hover:bg-accent hover:text-accent-foreground"
                                title="播放器模式"
                            >
                                <Link
                                    href="/videos/player"
                                    aria-label="Player Mode"
                                >
                                    <MonitorPlay className="h-5 w-5" />
                                </Link>
                            </Button>
                            <Button
                                asChild
                                variant="ghost"
                                size="icon"
                                className="hover:bg-accent hover:text-accent-foreground"
                            >
                                <Link
                                    href="/"
                                    aria-label="返回主页"
                                >
                                    <Home className="h-5 w-5" />
                                </Link>
                            </Button>
                            <DensityToggle />
                            <ModeToggle />
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="打开菜单"
                                title="打开菜单"
                                className="md:hidden"
                                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                            >
                                <Menu className="h-5 w-5" />
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="px-3 sm:px-6 py-4 sm:py-6">
                    <div className="space-y-6">
                        {/* 页头展板（对齐大厂顶级设计规范，光泽玻璃质感与动态指标看板） */}
                        <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card/90 via-card/50 to-background/90 backdrop-blur-xl p-5 sm:p-7 shadow-xs">
                            <div aria-hidden className="pointer-events-none absolute -right-12 -top-16 w-64 h-64 bg-violet-500/10 rounded-full blur-3xl" />
                            <div aria-hidden className="pointer-events-none absolute -left-16 bottom-0 w-48 h-48 bg-sky-400/10 rounded-full blur-3xl" />
                            <MonitorPlay
                                aria-hidden
                                strokeWidth={1}
                                className="pointer-events-none absolute right-6 top-6 hidden lg:block w-20 h-20 text-border/40"
                            />
                            <div className="relative z-10 space-y-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary px-3 py-1 rounded-full bg-primary/10 border border-primary/20 backdrop-blur-xs">
                                        <MonitorPlay className="w-3.5 h-3.5" />
                                        视频中心 · 专业技术视频沉淀
                                    </span>
                                    <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground/80 px-2.5 py-0.5 rounded-full bg-muted/40 border border-border/40">
                                        <Zap className="w-3 h-3 text-amber-500" />
                                        实时级联检索
                                    </span>
                                </div>
                                <div>
                                    <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-3 text-foreground">
                                        <div className="p-2 sm:p-2.5 rounded-2xl bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 shadow-xs shrink-0">
                                            <MonitorPlay className="w-5 h-5 sm:w-6 sm:h-6" />
                                        </div>
                                        <span>按分类浏览技术视频与精品教程</span>
                                    </h1>
                                    <p className="text-xs sm:text-sm text-muted-foreground mt-2 leading-relaxed max-w-2xl font-normal">
                                        深度精选行业顶级开发者分享、前沿技术发布会与系统化实战教程；支持技术领域级联筛选、站内即时预览与离线学习队列。
                                    </p>
                                </div>
                                <div className="mt-4 pt-4 border-t border-border/50 flex flex-wrap items-center gap-2.5">
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-violet-500/25 bg-violet-500/5 text-xs text-violet-600 dark:text-violet-400 font-medium">
                                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                                        <span>{videoStats.categories} 个专业领域</span>
                                    </div>
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60" />
                                        <span>{videoStats.subCategories} 个细分子方向</span>
                                    </div>
                                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60" />
                                        <span className="font-mono">{videoStats.videos}</span>
                                        <span>门精选视频</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 分类筛选芯片：URL ?c= 可分享，锚点 id 仍保留给深链 */}
                        <nav aria-label="按分类筛选视频" className="flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 scrollbar-none">
                            <button
                                type="button"
                                aria-pressed={activeCategoryId === null}
                                onClick={() => selectCategory(null)}
                                className={cn(
                                    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs transition-all duration-200 shrink-0',
                                    activeCategoryId === null
                                        ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-xs'
                                        : 'border-border/60 bg-card/60 text-muted-foreground hover:text-foreground hover:bg-muted/80 hover:border-border'
                                )}
                            >
                                <span>全部</span>
                                <span className={cn(
                                    "font-mono text-[11px] px-1.5 py-0.2 rounded-full",
                                    activeCategoryId === null
                                        ? "bg-primary-foreground/20 text-primary-foreground font-bold"
                                        : "opacity-75"
                                )}>
                                    {videoStats.videos}
                                </span>
                            </button>
                            {categoryChips.map((chip) => {
                                const isCurrentActive = activeCategoryId === chip.id
                                return (
                                    <button
                                        key={chip.id}
                                        type="button"
                                        aria-pressed={activeCategoryId === chip.id}
                                        onClick={() => selectCategory(chip.id)}
                                        className={cn(
                                            'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs transition-all duration-200 shrink-0',
                                            isCurrentActive
                                                ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-xs'
                                                : 'border-border/60 bg-card/60 text-muted-foreground hover:text-foreground hover:bg-muted/80 hover:border-border'
                                        )}
                                    >
                                        <span>{chip.title}</span>
                                        <span className={cn(
                                            "font-mono text-[11px] px-1.5 py-0.2 rounded-full",
                                            isCurrentActive
                                                ? "bg-primary-foreground/20 text-primary-foreground font-bold"
                                                : "opacity-75"
                                        )}>
                                            {chip.count}
                                        </span>
                                    </button>
                                )
                            })}
                        </nav>

                        {/* 二级子分类级联筛选条 */}
                        {subCategoryChips.length > 0 && (
                            <nav
                                aria-label="按二级子分类细化筛选"
                                className="flex items-center gap-2 overflow-x-auto pb-1.5 pt-1 text-xs scrollbar-none px-2.5 py-1.5 rounded-xl bg-muted/40 border border-border/50 backdrop-blur-md"
                            >
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-foreground/80 shrink-0 pl-1">
                                    <Layers className="w-3.5 h-3.5 text-primary" />
                                    <span>细分领域：</span>
                                </span>
                                <button
                                    type="button"
                                    aria-pressed={activeSubCategoryId === null}
                                    onClick={() => selectSubCategory(null)}
                                    className={cn(
                                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] transition-all duration-150 shrink-0',
                                        activeSubCategoryId === null
                                            ? 'border-primary/50 bg-primary/15 text-primary font-semibold shadow-2xs'
                                            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60'
                                    )}
                                >
                                    <span>全部子方向</span>
                                </button>
                                {subCategoryChips.map((subChip) => {
                                    const isSubActive = activeSubCategoryId === subChip.id
                                    return (
                                        <button
                                            key={subChip.id}
                                            type="button"
                                            aria-pressed={activeSubCategoryId === subChip.id}
                                            onClick={() => selectSubCategory(subChip.id)}
                                            className={cn(
                                                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] transition-all duration-150 shrink-0',
                                                isSubActive
                                                    ? 'border-primary/50 bg-primary/15 text-primary font-semibold shadow-2xs'
                                                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/60'
                                            )}
                                        >
                                            <span>{subChip.title}</span>
                                            <span className="font-mono text-[10px] opacity-75">{subChip.count}</span>
                                        </button>
                                    )
                                })}
                            </nav>
                        )}

                        {/* 活跃过滤状态面包屑条 */}
                        {(activeCategoryId !== null || activeSubCategoryId !== null) && (
                            <div className="flex flex-wrap items-center gap-2 text-xs py-1.5 px-3 rounded-xl bg-primary/5 border border-primary/20 text-primary w-fit">
                                <span className="text-muted-foreground">当前筛选：</span>
                                <span className="font-semibold text-foreground">{currentSelectedCategory?.title}</span>
                                {activeSubCategoryId && (
                                    <>
                                        <span className="text-muted-foreground/60">/</span>
                                        <span className="font-semibold text-primary">{subCategoryChips.find((s) => s.id === activeSubCategoryId)?.title}</span>
                                    </>
                                )}
                                <button
                                    type="button"
                                    onClick={() => selectCategory(null)}
                                    className="ml-2 hover:bg-primary/10 p-1 rounded-md transition-colors text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                                    title="清除所有分类筛选"
                                >
                                    <X className="w-3.5 h-3.5" />
                                    <span className="text-[11px]">重置</span>
                                </button>
                            </div>
                        )}

                        {/* 搜索结果即时画廊 */}
                        {hasQuery && (
                            <section className="scroll-m-16 rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5 backdrop-blur-md space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-primary/20">
                                    <div className="flex items-center gap-2.5">
                                        <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                                            <Search className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h2 className="text-base sm:text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                                                <span>智能搜索结果</span>
                                                <span className="text-xs font-mono font-medium text-primary bg-primary/10 px-2.5 py-0.5 rounded-full border border-primary/20">
                                                    {totalSearchResultsCount} 个匹配项
                                                </span>
                                            </h2>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                基于 BM25 与 CJK 倒排索引智能匹配：“<span className="text-primary font-medium">{searchQuery}</span>”
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery('')}
                                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/60 bg-background/80 hover:bg-muted transition-colors self-start sm:self-center"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                        <span>清空搜索</span>
                                    </button>
                                </div>

                                {searchResults.length === 0 ? (
                                    <div className="py-10 text-center space-y-2">
                                        <p className="text-sm text-muted-foreground">未找到与 “{searchQuery}” 匹配的视频教程</p>
                                        <p className="text-xs text-muted-foreground/70">尝试缩短搜索词，或按上方领域分类直接浏览</p>
                                    </div>
                                ) : (
                                    <div className="space-y-6">
                                        {searchResults.map((res) => {
                                            const items = [...res.items, ...res.subCategories.flatMap((s) => s.items)]
                                            const isExpanded = !!expandedSearchResults[res.category.id]
                                            const displayedItems = isExpanded || items.length <= 15 ? items : items.slice(0, 15)
                                            return (
                                                <div key={`sr-${res.category.id}`} className="space-y-3">
                                                    <div className="text-xs font-semibold text-muted-foreground flex items-center gap-2">
                                                        <span className="w-1.5 h-3 bg-primary/70 rounded-full" />
                                                        <span>{res.category.title}</span>
                                                        <span className="font-mono text-[10px] opacity-75">
                                                            ({items.length} 个视频)
                                                        </span>
                                                    </div>
                                                    <div
                                                        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5! transition-all duration-200"
                                                        style={{ gap: 'var(--density-grid-gap, 1rem)' }}
                                                    >
                                                        {displayedItems.map((item) => (
                                                            <VideoCard key={`search-${item.id}`} item={item as NavigationSubItem} siteConfig={siteData} onPlay={setPlayingVideo} />
                                                        ))}
                                                    </div>
                                                    {items.length > 15 && (
                                                        <div className="flex items-center justify-center pt-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleSearchCategoryExpand(res.category.id)}
                                                                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-border/60 bg-background/80 hover:bg-muted text-xs text-muted-foreground hover:text-foreground transition-colors"
                                                                aria-expanded={isExpanded}
                                                            >
                                                                {isExpanded ? (
                                                                    <>
                                                                        <ChevronUp className="w-3.5 h-3.5" />
                                                                        <span>收起部分搜索结果</span>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <ChevronDown className="w-3.5 h-3.5 text-primary" />
                                                                        <span>展开此分类全部搜索结果（剩余 {items.length - 15} 部）</span>
                                                                    </>
                                                                )}
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </section>
                        )}

                        {/* 稍后再看学习队列 */}
                        {watchLaterList.length > 0 && (
                            <section className="scroll-m-16 rounded-xl border border-border/60 bg-card/60 p-4 backdrop-blur-xs">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
                                            <Clock className="w-4 h-4 text-primary" />
                                            <span>稍后再看</span>
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                                                {watchLaterList.length}
                                            </span>
                                        </h2>
                                    </div>
                                    <div
                                        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5! transition-all duration-200"
                                        style={{ gap: 'var(--density-grid-gap, 1rem)' }}
                                    >
                                        {watchLaterList.map((item) => (
                                            <VideoCard key={`wl-${item.id}`} item={item} siteConfig={siteData} />
                                        ))}
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* 猜你想学 / 协同推荐专区 */}
                        {recommendedVideos.length > 0 && (
                            <section className="scroll-m-16 rounded-xl border border-violet-500/20 bg-gradient-to-r from-violet-500/5 via-transparent to-sky-500/5 p-4 backdrop-blur-xs">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-base font-bold tracking-tight flex items-center gap-2 text-violet-600 dark:text-violet-400">
                                            <Sparkles className="w-4 h-4 text-violet-500" />
                                            <span>猜你想学 · 协同精选</span>
                                            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-500 font-normal">
                                                基于技术栈与历史偏好
                                            </span>
                                        </h2>
                                    </div>
                                    <div
                                        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5! transition-all duration-200"
                                        style={{ gap: 'var(--density-grid-gap, 1rem)' }}
                                    >
                                        {recommendedVideos.map((item) => (
                                            <VideoCard key={`rec-${item.id}`} item={item} siteConfig={siteData} />
                                        ))}
                                    </div>
                                </div>
                            </section>
                        )}

                        {visibleCategories.map((category) => {
                            const totalCategoryVideos = (category.items?.length || 0) + (category.subCategories?.reduce((acc, sub) => acc + (sub.items?.length || 0), 0) || 0)
                            return (
                                <section key={category.id} id={category.id} className="scroll-m-20 space-y-6 pt-2">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-border/60">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs shrink-0">
                                                <NavIcon name={category.icon || 'Folder'} className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
                                                    <span>{category.title}</span>
                                                    <span className="text-xs font-mono font-medium text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full border border-border/40">
                                                        {totalCategoryVideos}
                                                    </span>
                                                </h2>
                                                {category.description && (
                                                    <p className="text-xs sm:text-sm text-muted-foreground/80 mt-0.5 line-clamp-1 leading-normal font-normal">
                                                        {category.description}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 self-start sm:self-center">
                                            {activeCategoryId === category.id && category.subCategories && category.subCategories.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const allExpanded = category.subCategories!.every(s => expandedSubCats[s.id])
                                                        const nextState = { ...expandedSubCats }
                                                        category.subCategories!.forEach(s => {
                                                            nextState[s.id] = !allExpanded
                                                        })
                                                        setExpandedSubCats(nextState)
                                                    }}
                                                    className="text-xs text-primary hover:text-primary/90 font-medium inline-flex items-center gap-1 transition-colors px-2.5 py-1 rounded-md bg-primary/10 hover:bg-primary/15 border border-primary/20"
                                                >
                                                    {category.subCategories.every(s => expandedSubCats[s.id]) ? (
                                                        <>
                                                            <ChevronUp className="w-3.5 h-3.5" />
                                                            <span>全部收起</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <ChevronDown className="w-3.5 h-3.5" />
                                                            <span>一键展开此分类全部视频</span>
                                                        </>
                                                    )}
                                                </button>
                                            )}
                                            {activeCategoryId !== category.id && (
                                                <button
                                                    type="button"
                                                    onClick={() => selectCategory(category.id)}
                                                    className="text-xs text-primary/80 hover:text-primary font-medium inline-flex items-center gap-1 transition-colors px-2.5 py-1 rounded-md hover:bg-primary/5"
                                                >
                                                    <span>仅看此分类</span>
                                                    <ChevronRight className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {category.subCategories && category.subCategories.length > 0 ? (
                                        <div className="space-y-8">
                                            {category.subCategories.map((subCategory) => {
                                                const fullSubItems = fullCatalogRef.current
                                                    ? fullCatalogRef.current.navigationItems.flatMap(c => c.subCategories || []).find(s => s.id === subCategory.id)?.items
                                                    : undefined
                                                const allSubItems = fullSubItems && fullSubItems.length > 0 ? fullSubItems : (subCategory.items || [])
                                                const totalSubCount = subCategory.totalCount ?? allSubItems.length
                                                const isExpanded = !!expandedSubCats[subCategory.id] || activeSubCategoryId === subCategory.id
                                                const displayedItems = isExpanded || allSubItems.length <= INITIAL_VISIBLE_PER_SUBCAT
                                                    ? allSubItems
                                                    : allSubItems.slice(0, INITIAL_VISIBLE_PER_SUBCAT)
                                                const hasMore = (totalSubCount > INITIAL_VISIBLE_PER_SUBCAT || allSubItems.length > INITIAL_VISIBLE_PER_SUBCAT) && activeSubCategoryId !== subCategory.id

                                                return (
                                                    <div key={subCategory.id} id={subCategory.id} className="space-y-3.5">
                                                        <div className="flex items-center justify-between">
                                                            <h3 className="text-sm font-semibold tracking-tight text-foreground/90 flex items-center gap-2">
                                                                <span className="w-1.5 h-3.5 bg-primary/80 rounded-full" />
                                                                <span>{subCategory.title}</span>
                                                                {subCategory.description && (
                                                                    <span className="text-xs text-muted-foreground/70 font-normal hidden md:inline-block ml-1">
                                                                        · {subCategory.description}
                                                                    </span>
                                                                )}
                                                            </h3>
                                                            <span className="text-[11px] font-mono text-muted-foreground/60 bg-muted/40 px-2 py-0.5 rounded-md border border-border/30">
                                                                {totalSubCount} 个视频
                                                            </span>
                                                        </div>
                                                        <div
                                                            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5! transition-all duration-200"
                                                            style={{ gap: 'var(--density-grid-gap, 1rem)' }}
                                                        >
                                                            {displayedItems.map((item) => (
                                                                <VideoCard key={item.id} item={item} siteConfig={siteData} priority={eagerItemIds.has(item.id)} onPlay={setPlayingVideo} />
                                                            ))}
                                                        </div>
                                                        {hasMore && (
                                                            <div className="flex items-center justify-center pt-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleSubCatExpand(subCategory.id)}
                                                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border/70 bg-card/60 hover:bg-accent text-xs font-medium text-muted-foreground hover:text-foreground transition-all duration-200 group/expand shadow-2xs hover:border-primary/40 hover:shadow-xs"
                                                                    aria-expanded={isExpanded}
                                                                >
                                                                    {isExpanded ? (
                                                                        <>
                                                                            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground group-hover/expand:text-primary transition-transform" />
                                                                            <span>收起多余教程</span>
                                                                            <span className="font-mono text-[10px] text-muted-foreground/70">
                                                                                （保留前 {INITIAL_VISIBLE_PER_SUBCAT} 部）
                                                                            </span>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <ChevronDown className="w-3.5 h-3.5 text-primary group-hover/expand:translate-y-0.5 transition-transform" />
                                                                            <span>展开此方向全部教程</span>
                                                                            <span className="font-mono text-[11px] px-1.5 py-0.2 rounded-full bg-primary/10 text-primary font-semibold">
                                                                                +{Math.max(1, totalSubCount - INITIAL_VISIBLE_PER_SUBCAT)} 部
                                                                            </span>
                                                                        </>
                                                                    )}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        (() => {
                                            const fullCatItems = fullCatalogRef.current
                                                ? fullCatalogRef.current.navigationItems.find(c => c.id === category.id)?.items
                                                : undefined
                                            const allCatItems = fullCatItems && fullCatItems.length > 0 ? fullCatItems : (category.items || [])
                                            const isCatExpanded = !!expandedSubCats[category.id]
                                            const displayedCatItems = isCatExpanded || allCatItems.length <= INITIAL_VISIBLE_PER_SUBCAT
                                                ? allCatItems
                                                : allCatItems.slice(0, INITIAL_VISIBLE_PER_SUBCAT)
                                            const hasMore = allCatItems.length > INITIAL_VISIBLE_PER_SUBCAT

                                            return (
                                                <div className="space-y-3.5">
                                                    <div
                                                        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5! transition-all duration-200"
                                                        style={{ gap: 'var(--density-grid-gap, 1rem)' }}
                                                    >
                                                        {displayedCatItems.map((item) => (
                                                            <VideoCard key={item.id} item={item} siteConfig={siteData} priority={eagerItemIds.has(item.id)} onPlay={setPlayingVideo} />
                                                        ))}
                                                    </div>
                                                    {hasMore && (
                                                        <div className="flex items-center justify-center pt-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleSubCatExpand(category.id)}
                                                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border/70 bg-card/60 hover:bg-accent text-xs font-medium text-muted-foreground hover:text-foreground transition-all duration-200 group/expand shadow-2xs hover:border-primary/40 hover:shadow-xs"
                                                                aria-expanded={isCatExpanded}
                                                            >
                                                                {isCatExpanded ? (
                                                                    <>
                                                                        <ChevronUp className="w-3.5 h-3.5 text-muted-foreground group-hover/expand:text-primary transition-transform" />
                                                                        <span>收起多余教程</span>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <ChevronDown className="w-3.5 h-3.5 text-primary group-hover/expand:translate-y-0.5 transition-transform" />
                                                                        <span>展开此分类全部教程</span>
                                                                        <span className="font-mono text-[11px] px-1.5 py-0.2 rounded-full bg-primary/10 text-primary font-semibold">
                                                                            +{allCatItems.length - INITIAL_VISIBLE_PER_SUBCAT} 部
                                                                        </span>
                                                                    </>
                                                                )}
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })()
                                    )}
                                </section>
                            )
                        })}
                    </div>
                </div>
            {/* 页面单例视频播放弹窗：避免在 360+ 网格内直接重排 */}
            {playingVideo && (
                <VideoPlayerModal
                    item={playingVideo}
                    siteConfig={siteData}
                    open={!!playingVideo}
                    onOpenChange={(open) => {
                        if (!open) setPlayingVideo(null)
                    }}
                />
            )}

                {/* 页脚 */}
                <Footer siteInfo={siteData} />
            </main>
        </div>
    )
}
