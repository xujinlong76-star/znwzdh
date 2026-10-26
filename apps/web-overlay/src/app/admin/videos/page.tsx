'use client'

export const runtime = 'edge'

import { useState } from "react"
import { Button } from "@/registry/new-york/ui/button"
import { VideoCategoryCard } from "./components/VideoCategoryCard"
import { AddVideoCategoryForm } from "./components/AddVideoCategoryForm"
import { HarvestModal } from "./components/HarvestModal"
import { ReplacementHistoryDialog } from "./components/ReplacementHistoryDialog"
import { Input } from "@/registry/new-york/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/registry/new-york/ui/dialog"
import { useToast } from "@/registry/new-york/hooks/use-toast"
import { Skeleton } from "@/registry/new-york/ui/skeleton"
import useSWR from 'swr'
import { NavigationItem } from "@/types/navigation"
import { Plus, AlertTriangle, Inbox, Sparkles, History, MonitorPlay } from 'lucide-react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/registry/new-york/ui/select"

async function fetcher(url: string): Promise<NavigationItem[]> {
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to fetch video categories')
    const data = await res.json()
    return data.navigationItems || []
}

interface HarvestOverview {
    totalVideos: number
    autoHarvestCategories: number
    averageFreshness: number
    outdatedCount: number
    historyCount: number
}

async function overviewFetcher(url: string): Promise<HarvestOverview> {
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to fetch overview')
    return res.json()
}

export default function VideosAdminPage() {
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [isHarvestModalOpen, setIsHarvestModalOpen] = useState(false)
    const [isHistoryOpen, setIsHistoryOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")
    const [showEnabled, setShowEnabled] = useState<boolean | null>(null)
    const { toast } = useToast()

    const { data: items = [], error, isLoading, mutate } = useSWR<NavigationItem[]>(
        '/api/videos',
        fetcher,
        {
            fallbackData: [],
            revalidateOnFocus: false,
        }
    )

    const { data: overview, mutate: mutateOverview } = useSWR<HarvestOverview>(
        '/api/videos/harvest',
        overviewFetcher,
        {
            revalidateOnFocus: false,
        }
    )

    const handleAdd = async (values: {
        title: string;
        icon: string;
        description?: string;
        enabled?: boolean
    }) => {
        try {
            const newItem: NavigationItem = {
                id: Date.now().toString(),
                title: values.title,
                icon: values.icon,
                description: values.description || '',
                enabled: values.enabled ?? true,
                items: [],
                subCategories: [],
                harvestPolicy: {
                    enabled: true,
                    keywords: [values.title],
                    syncSiteHotTrends: true,
                    maxItems: 12,
                    minQualityScore: 60,
                    minDurationSec: 180,
                    freshnessHalfLifeDays: 90,
                    autoReplaceOutdated: true
                }
            }

            const response = await fetch('/api/videos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    navigationItems: [
                        ...items,
                        newItem
                    ]
                })
            })

            if (!response.ok) {
                throw new Error('Failed to add')
            }

            setIsDialogOpen(false)
            mutate()
            mutateOverview()
            toast({
                title: "成功",
                description: "添加分类成功"
            })
        } catch (error) {
            console.error('添加分类错误:', error)
            toast({
                title: "错误",
                description: "添加失败",
                variant: "destructive"
            })
        }
    }

    const filteredItems = items
        .filter(item =>
            item.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
            (showEnabled === null || item.enabled === showEnabled)
        )

    return (
        <div className="h-full flex-1 flex-col space-y-5 sm:space-y-6 p-3 sm:p-6 lg:p-8 md:flex">
            {/* 顶层治理看板 */}
            <div className="relative overflow-hidden rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                <MonitorPlay className="h-5 w-5" />
                            </div>
                            <h1 className="text-base sm:text-lg font-bold tracking-tight">
                                视频管理与智能热点采集中心
                            </h1>
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            支持各大技术专栏自动采集高赞视频、根据时效模型与热点自动淘汰置换过时内容，并提供完整审计回滚。
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsHistoryOpen(true)}
                            className="gap-1.5 text-xs h-9"
                        >
                            <History className="h-4 w-4" />
                            <span>替换历史与回滚 ({overview?.historyCount ?? 0})</span>
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => setIsHarvestModalOpen(true)}
                            className="gap-1.5 text-xs h-9 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white shadow-xs"
                        >
                            <Sparkles className="h-4 w-4" />
                            <span>热点采集与自动轮换</span>
                        </Button>
                    </div>
                </div>

                <div className="mt-4 pt-3.5 border-t border-border/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="space-y-0.5">
                        <span className="text-muted-foreground">在架视频总数</span>
                        <div className="text-base font-semibold text-foreground">
                            {overview?.totalVideos ?? 0} 部
                        </div>
                    </div>
                    <div className="space-y-0.5">
                        <span className="text-muted-foreground">已开启自动采集</span>
                        <div className="text-base font-semibold text-amber-600 dark:text-amber-400">
                            {overview?.autoHarvestCategories ?? 0} / {items.length} 个分类
                        </div>
                    </div>
                    <div className="space-y-0.5">
                        <span className="text-muted-foreground">平均内容保鲜度</span>
                        <div className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
                            {overview?.averageFreshness ?? 100} 分
                        </div>
                    </div>
                    <div className="space-y-0.5">
                        <span className="text-muted-foreground">待轮换老化视频</span>
                        <div className="text-base font-semibold text-muted-foreground">
                            {overview?.outdatedCount ?? 0} 部
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 sm:gap-4 flex-1 w-full sm:w-auto">
                    <Input
                        aria-label="搜索视频分类"
                        placeholder="搜索视频分类或关键词..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full sm:max-w-[300px]"
                    />
                    <Select
                        value={showEnabled === null ? "all" : String(showEnabled)}
                        onValueChange={(value) => {
                            if (value === "all") {
                                setShowEnabled(null)
                            } else {
                                setShowEnabled(value === "true")
                            }
                        }}
                    >
                        <SelectTrigger className="w-full sm:w-[150px]" aria-label="状态筛选">
                            <SelectValue placeholder="状态筛选" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部状态</SelectItem>
                            <SelectItem value="true">已启用</SelectItem>
                            <SelectItem value="false">已禁用</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <Button onClick={() => setIsDialogOpen(true)} className="w-full sm:w-auto shrink-0">
                    <Plus className="mr-2 h-4 w-4" />
                    新建视频分类
                </Button>
            </div>

            <div className="space-y-4">
                {error ? (
                    <div className="flex h-[350px] shrink-0 items-center justify-center rounded-md border border-dashed">
                        <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                            <AlertTriangle className="h-10 w-10 text-muted-foreground" />
                            <h3 className="mt-4 text-lg font-semibold">加载失败</h3>
                            <p className="mb-4 mt-2 text-sm text-muted-foreground">
                                获取视频分类数据时发生错误，请稍后重试。
                            </p>
                            <Button
                                variant="outline"
                                onClick={() => mutate()}
                            >
                                重试
                            </Button>
                        </div>
                    </div>
                ) : isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="p-4 rounded-lg border">
                            <div className="flex items-center space-x-4">
                                <Skeleton className="h-6 w-6 rounded" />
                                <div className="space-y-2 flex-1">
                                    <Skeleton className="h-4 w-[200px]" />
                                    <Skeleton className="h-3 w-[300px]" />
                                </div>
                            </div>
                        </div>
                    ))
                ) : filteredItems.length === 0 ? (
                    <div className="flex h-[350px] shrink-0 items-center justify-center rounded-md border border-dashed">
                        <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                            <Inbox className="h-10 w-10 text-muted-foreground" />
                            <h3 className="mt-4 text-lg font-semibold">暂无分类</h3>
                            <p className="mb-4 mt-2 text-sm text-muted-foreground">
                                {searchQuery ? "没有找到匹配的分类。" : "还没有添加任何视频分类，点击上方新建按钮开始。"}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredItems.map((item, index) => (
                            <VideoCategoryCard
                                key={item.id}
                                item={item}
                                index={index}
                                onUpdate={() => {
                                    mutate()
                                    mutateOverview()
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            <HarvestModal
                open={isHarvestModalOpen}
                onOpenChange={setIsHarvestModalOpen}
                onCompleted={() => {
                    mutate()
                    mutateOverview()
                }}
            />

            <ReplacementHistoryDialog
                open={isHistoryOpen}
                onOpenChange={setIsHistoryOpen}
                onRolledBack={() => {
                    mutate()
                    mutateOverview()
                }}
            />

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>新建视频分类</DialogTitle>
                    </DialogHeader>
                    <AddVideoCategoryForm
                        onSubmit={handleAdd}
                        onCancel={() => setIsDialogOpen(false)}
                    />
                </DialogContent>
            </Dialog>
        </div>
    )
}
