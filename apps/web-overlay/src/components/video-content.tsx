'use client'

import { useState, useMemo } from 'react'
import type { NavigationData, NavigationItem, NavigationSubItem } from '@/types/navigation'
import type { SiteConfig } from '@/types/site'
import { VideoCard } from '@/components/video-card'
import { Sidebar } from '@/components/sidebar'
import { SearchBar } from '@/components/search-bar'
import { ModeToggle } from '@/components/mode-toggle'
import { DensityToggle } from '@/components/density-toggle'
import { Footer } from '@/components/footer'
import { MonitorPlay, Menu, Home } from 'lucide-react'
import { Button } from "@/registry/new-york/ui/button"
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useOverlayBehavior } from '@/components/ui/overlay'

interface VideoContentProps {
    navigationData: NavigationData
    siteData: SiteConfig
}

export function VideoContent({ navigationData, siteData }: VideoContentProps) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false)
    // 抽屉的公共行为：Esc 关、点遮罩关、锁背景滚动、焦点圈养与还原、role=dialog
    const { containerProps, scrimProps } = useOverlayBehavior({
      open: isSidebarOpen,
      onClose: () => setIsSidebarOpen(false),
      // 抽屉常驻 DOM，读屏需要一个稳定名称来说明「这是频道导航」
      ariaLabel: '频道导航抽屉',
    })
    const [searchQuery, setSearchQuery] = useState('')

    // 修复类型检查和搜索逻辑
    const searchResults = useMemo(() => {
        const query = searchQuery.toLowerCase().trim()
        if (!query) return []

        const results: Array<{
            category: NavigationItem
            items: (NavigationItem | NavigationSubItem)[]
            subCategories: Array<{
                title: string
                items: (NavigationItem | NavigationSubItem)[]
            }>
        }> = []

        navigationData.navigationItems.forEach(category => {
            // 搜索主分类下的项目（只搜索启用的）
            const items = (category.items || []).filter(item => {
                if (item.enabled === false) return false
                const titleMatch = item.title.toLowerCase().includes(query)
                const descMatch = item.description?.toLowerCase().includes(query)
                return titleMatch || descMatch
            })

            // 搜索子分类下的项目（只搜索启用的）
            const subResults: Array<{
                title: string
                items: (NavigationItem | NavigationSubItem)[]
            }> = []

            if (category.subCategories) {
                category.subCategories.forEach(sub => {
                    if (sub.enabled === false) return
                    const subItems = (sub.items || []).filter(item => {
                        if (item.enabled === false) return false
                        const titleMatch = item.title.toLowerCase().includes(query)
                        const descMatch = item.description?.toLowerCase().includes(query)
                        return titleMatch || descMatch
                    })

                    if (subItems.length > 0) {
                        subResults.push({
                            title: sub.title,
                            items: subItems
                        })
                    }
                })
            }

            // 只有当主分类或子分类有匹配结果时才添加到结果中
            if (items.length > 0 || subResults.length > 0) {
                results.push({
                    category,
                    items,
                    subCategories: subResults
                })
            }
        })

        return results
    }, [navigationData, searchQuery])

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

    /** 首屏第一张封面：优先加载，其余保持懒加载 */
    const firstItemId = useMemo(() => {
        for (const category of visibleNavigationData.navigationItems) {
            const first = category.subCategories?.length
                ? category.subCategories[0]?.items?.[0]
                : category.items?.[0]
            if (first) return first.id
        }
        return null
    }, [visibleNavigationData])

    /** 视频页概览计数：与侧边栏同一份数据，禁用项不计 */
    const videoStats = useMemo(() => {
        let categories = 0
        let subCategories = 0
        let videos = 0
        visibleNavigationData.navigationItems.forEach((category) => {
            if (category.enabled === false) return
            categories += 1
            videos += (category.items || []).filter((item) => item.enabled !== false).length
            ;(category.subCategories || []).forEach((sub) => {
                if (sub.enabled === false) return
                subCategories += 1
                videos += (sub.items || []).filter((item) => item.enabled !== false).length
            })
        })
        return { categories, subCategories, videos }
    }, [visibleNavigationData])

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
                        {/* 页头展板（对齐市场轮展板语言） */}
                        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-5 sm:p-6">
                            <div aria-hidden className="pointer-events-none absolute -right-12 -top-16 w-56 h-56 bg-violet-500/10 rounded-full blur-3xl" />
                            <div aria-hidden className="pointer-events-none absolute -left-16 bottom-0 w-40 h-40 bg-sky-400/10 rounded-full blur-3xl" />
                            <MonitorPlay
                                aria-hidden
                                strokeWidth={1}
                                className="pointer-events-none absolute right-5 top-5 hidden sm:block w-14 h-14 text-border/70"
                            />
                            <div className="relative z-10 space-y-3">
                                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground px-2.5 py-1 rounded-md bg-background/60 border border-border/60">
                                    <MonitorPlay className="w-3.5 h-3.5" />
                                    视频中心
                                </span>
                                <div>
                                    <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight flex items-center gap-2.5">
                                        <div className="p-2 rounded-xl bg-violet-500/10 text-violet-500 border border-violet-500/20 shadow-xs">
                                            <MonitorPlay className="w-5 h-5" />
                                        </div>
                                        <span>按分类浏览视频与教程</span>
                                    </h1>
                                    <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-2xl">
                                        收录开发者常用的视频频道与教程源，按技术分类归档；支持播放器模式与实时搜索。
                                    </p>
                                </div>
                                <div className="mt-4 pt-3.5 border-t border-border/50 flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-violet-500/25 bg-violet-500/5 text-xs text-violet-600 dark:text-violet-400">
                                        {videoStats.categories} 个分类
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                                        {videoStats.subCategories} 个子分类
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                                        {videoStats.videos} 个视频源
                                    </span>
                                </div>
                            </div>
                        </div>

                        {visibleNavigationData.navigationItems.map((category) => (
                            <section key={category.id} id={category.id} className="scroll-m-16">
                                <div className="space-y-4">
                                    <h2 className="text-base font-bold tracking-tight">
                                        {category.title}
                                    </h2>

                                    {category.subCategories && category.subCategories.length > 0 ? (
                                        category.subCategories.map((subCategory) => (
                                             <div key={subCategory.id} id={subCategory.id} className="space-y-3">
                                                 <h3 className="text-sm font-semibold text-muted-foreground">
                                                     {subCategory.title}
                                                 </h3>
                                                 <div
                                                     className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5! transition-all duration-200"
                                                     style={{ gap: 'var(--density-grid-gap, 1rem)' }}
                                                 >
                                                     {(subCategory.items || []).map((item) => (
                                                         <VideoCard key={item.id} item={item} siteConfig={siteData} priority={item.id === firstItemId} />
                                                     ))}
                                                 </div>
                                             </div>
                                        ))
                                    ) : (
                                        <div
                                            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 min-[1536px]:grid-cols-5! transition-all duration-200"
                                            style={{ gap: 'var(--density-grid-gap, 1rem)' }}
                                        >
                                            {(category.items || []).map((item) => (
                                                <VideoCard key={item.id} item={item} siteConfig={siteData} priority={item.id === firstItemId} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </section>
                        ))}
                    </div>
                </div>
                {/* 页脚 */}
                <Footer siteInfo={siteData} />
            </main>
        </div>
    )
}
