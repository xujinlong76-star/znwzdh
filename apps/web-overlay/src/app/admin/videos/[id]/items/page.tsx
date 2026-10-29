'use client'

import { useState, useEffect, useMemo } from 'react'
import { safeHref } from '@/lib/safe-url'
import { useParams, useRouter } from 'next/navigation'
import { Button } from "@/registry/new-york/ui/button"
import { useToast } from "@/registry/new-york/hooks/use-toast"
import { Icons } from "@/components/icons"
import { NavigationItem, NavigationSubItem } from '@/types/navigation'
import { Input } from "@/registry/new-york/ui/input"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogDescription,
    DialogFooter,
} from "@/registry/new-york/ui/dialog"
import { AddVideoItemForm } from '../../components/AddVideoItemForm'
import { Skeleton } from "@/registry/new-york/ui/skeleton"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/registry/new-york/ui/select"
import { Badge } from "@/registry/new-york/ui/badge"
import { describeDegrade } from '@/lib/degrade'
import { formatDuration } from '@/lib/video-format'
import { Pin, PinOff, Sparkles, Loader2, ArrowLeft, FolderOpen, Layers, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react'

interface FlatVideoItem extends NavigationSubItem {
    subCategoryId?: string
    subCategoryTitle?: string
    originalIndex: number
    isSubCategoryItem: boolean
}

function LoadingSkeleton() {
    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-[200px]" />
                    <Skeleton className="h-4 w-[300px]" />
                </div>
                <Skeleton className="h-10 w-[100px]" />
            </div>
            <div className="grid gap-2">
                {[1, 2, 3].map((i) => (
                    <div
                        key={i}
                        className="flex items-center justify-between p-4 rounded-lg border"
                    >
                        <div className="flex items-center gap-3">
                            <Skeleton className="h-8 w-8 rounded-lg" />
                            <div>
                                <Skeleton className="h-4 w-[200px] mb-2" />
                                <Skeleton className="h-3 w-[150px]" />
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <Skeleton className="h-8 w-8 rounded-md" />
                            <Skeleton className="h-8 w-8 rounded-md" />
                            <Skeleton className="h-8 w-8 rounded-md" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default function VideoItemsPage() {
    const params = useParams<{ id: string }>()
    const router = useRouter()
    const { toast } = useToast()
    const [navigation, setNavigation] = useState<NavigationItem | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
    const [selectedSubCategory, setSelectedSubCategory] = useState<string>('all')
    const [targetSubCategoryId, setTargetSubCategoryId] = useState<string>('')
    const [currentPage, setCurrentPage] = useState(1)
    const pageSize = 30

    const [editingItem, setEditingItem] = useState<FlatVideoItem | null>(null)
    const [deletingItem, setDeletingItem] = useState<FlatVideoItem | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [loadError, setLoadError] = useState<unknown>(null)
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
    const [isHarvesting, setIsHarvesting] = useState(false)

    useEffect(() => {
        if (!params?.id) {
            router.push('/admin/videos')
            return
        }
        fetchNavigation()
    }, [params?.id, router])

    const fetchNavigation = async () => {
        setIsLoading(true)
        try {
            if (!params?.id) throw new Error('Navigation ID not found')
            const response = await fetch(`/api/videos/${params.id}`)
            if (!response.ok) throw new Error('Failed to fetch')

            const data = await response.json()
            setNavigation(data)
            if (data.subCategories && data.subCategories.length > 0 && !targetSubCategoryId) {
                setTargetSubCategoryId(data.subCategories[0].id)
            }
            setLoadError(null)
        } catch (error) {
            console.error(error)
            toast({
                title: "错误",
                description: describeDegrade(error).message,
                variant: "destructive"
            })
            setLoadError(error)
        } finally {
            setIsLoading(false)
        }
    }

    const allFlatItems: FlatVideoItem[] = useMemo(() => {
        if (!navigation) return []
        const list: FlatVideoItem[] = []

        // 直属条目
        ;(navigation.items || []).forEach((it, idx) => {
            list.push({
                ...it,
                subCategoryTitle: '直属大类',
                originalIndex: idx,
                isSubCategoryItem: false,
            })
        })

        // 各二级分类条目
        ;(navigation.subCategories || []).forEach(sub => {
            ;(sub.items || []).forEach((it, idx) => {
                list.push({
                    ...it,
                    subCategoryId: sub.id,
                    subCategoryTitle: sub.title,
                    originalIndex: idx,
                    isSubCategoryItem: true,
                })
            })
        })

        return list
    }, [navigation])

    const filteredItems = useMemo(() => {
        return allFlatItems.filter(item => {
            const matchesSearch =
                item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                item.href.toLowerCase().includes(searchQuery.toLowerCase()) ||
                item.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (item.videoConfig?.author && item.videoConfig.author.toLowerCase().includes(searchQuery.toLowerCase()))

            const matchesEnabled =
                enabledFilter === 'all' ? true :
                enabledFilter === 'enabled' ? item.enabled :
                enabledFilter === 'disabled' ? !item.enabled : true

            const matchesSub =
                selectedSubCategory === 'all' ? true :
                selectedSubCategory === 'direct' ? !item.isSubCategoryItem :
                item.subCategoryId === selectedSubCategory

            return matchesSearch && matchesEnabled && matchesSub
        })
    }, [allFlatItems, searchQuery, enabledFilter, selectedSubCategory])

    const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize))
    const pagedItems = useMemo(() => {
        const start = (currentPage - 1) * pageSize
        return filteredItems.slice(start, start + pageSize)
    }, [filteredItems, currentPage, pageSize])

    const handleRunCategoryHarvest = async () => {
        if (!params?.id) return
        setIsHarvesting(true)
        try {
            const response = await fetch('/api/videos/harvest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    categoryId: params.id,
                    dryRun: false
                })
            })
            if (!response.ok) throw new Error('采集失败')
            const data = await response.json()
            await fetchNavigation()
            toast({
                title: '采集与轮换完成',
                description: `新增 ${data.report?.totalAddedCount || 0} 个，淘汰替换 ${data.report?.totalReplacedCount || 0} 个`
            })
        } catch (err) {
            toast({
                title: '采集失败',
                description: (err as Error).message || '网络请求失败',
                variant: 'destructive'
            })
        } finally {
            setIsHarvesting(false)
        }
    }

    const toggleItemPin = async (item: FlatVideoItem) => {
        const currentlyPinned = Boolean(item.videoConfig?.pinned)
        const updatedItem: NavigationSubItem = {
            ...item,
            videoConfig: {
                ...item.videoConfig,
                type: item.videoConfig?.type || 'bilibili',
                pinned: !currentlyPinned
            }
        }
        await updateItem(item, updatedItem)
        toast({
            title: !currentlyPinned ? '已锁定防替换' : '已解除锁定',
            description: !currentlyPinned ? '该视频将免于全自动优胜劣汰轮换' : '该视频将参与正常保鲜度轮换'
        })
    }

    const addItem = async (values: NavigationSubItem) => {
        try {
            if (!params?.id) throw new Error('Navigation ID not found')
            const response = await fetch(`/api/videos/${params.id}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item: values,
                    subCategoryId: targetSubCategoryId === 'direct' ? undefined : targetSubCategoryId
                })
            })

            if (!response.ok) throw new Error('Failed to save')

            await fetchNavigation()
            toast({
                title: "成功",
                description: "添加视频成功"
            })
            setIsAddDialogOpen(false)
        } catch (error) {
            toast({
                title: "错误",
                description: "保存失败",
                variant: "destructive"
            })
        }
    }

    const updateItem = async (target: FlatVideoItem, values: NavigationSubItem) => {
        try {
            if (!params?.id) throw new Error('Navigation ID not found')
            const response = await fetch(`/api/videos/${params.id}/items`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    index: target.originalIndex,
                    subCategoryId: target.isSubCategoryItem ? target.subCategoryId : undefined,
                    item: values
                })
            })

            if (!response.ok) throw new Error('Failed to save')

            await fetchNavigation()
            toast({
                title: "成功",
                description: "保存成功"
            })
            setEditingItem(null)
        } catch (error) {
            toast({
                title: "错误",
                description: "保存失败",
                variant: "destructive"
            })
        }
    }

    const deleteItem = async (target: FlatVideoItem) => {
        try {
            if (!params?.id) throw new Error('Navigation ID not found')
            const response = await fetch(`/api/videos/${params.id}/items`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    index: target.originalIndex,
                    subCategoryId: target.isSubCategoryItem ? target.subCategoryId : undefined
                })
            })

            if (!response.ok) throw new Error('Failed to delete')

            await fetchNavigation()
            toast({
                title: "成功",
                description: "删除成功"
            })
            setDeletingItem(null)
        } catch (error) {
            toast({
                title: "错误",
                description: "删除失败",
                variant: "destructive"
            })
        }
    }

    if (isLoading) {
        return <LoadingSkeleton />
    }

    if (loadError && !navigation) {
        const notice = describeDegrade(loadError)
        return (
            <div role="status" className="mx-auto max-w-xl rounded-md border border-red-200 bg-red-50 px-6 py-16 text-center dark:border-red-900 dark:bg-red-950/20">
                <h2 className="mb-2 text-lg font-medium text-red-700 dark:text-red-300">视频分类数据加载失败</h2>
                <p className="mb-6 text-sm text-red-600 dark:text-red-400">{notice.message}</p>
                <Button variant="outline" onClick={() => void fetchNavigation()}>重试</Button>
            </div>
        )
    }

    if (!navigation) {
        return (
            <div className="flex items-center justify-center h-[50vh]">
                <p className="text-muted-foreground">视频分类不存在</p>
            </div>
        )
    }

    return (
        <div className="space-y-5">
            {/* 顶栏信息 */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl border border-border/80 bg-card">
                <div className="flex items-center gap-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.push('/admin/videos')}
                        className="h-8.5 w-8.5 shrink-0"
                        title="返回分类列表"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-base sm:text-lg font-bold text-foreground">
                                {navigation.title}
                            </h1>
                            <Badge variant="outline" className="text-xs bg-primary/5 text-primary border-primary/20">
                                共 {allFlatItems.length} 部视频
                            </Badge>
                            <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">
                                {navigation.subCategories?.length || 0} 个二级分类
                            </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            支持按二级分类筛选、直属条目管理、一键解析加收、锁定防置换及视频编辑
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/admin/videos/${params.id}/categories`)}
                        className="gap-1.5 text-xs h-9 bg-primary/5 hover:bg-primary/10 text-primary border-primary/20"
                    >
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>二级分类治理 ({navigation.subCategories?.length || 0})</span>
                    </Button>

                    <Button
                        variant="outline"
                        size="sm"
                        disabled={isHarvesting}
                        onClick={handleRunCategoryHarvest}
                        className="gap-1.5 text-xs h-9 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    >
                        {isHarvesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        <span>{isHarvesting ? '采集中...' : '分类自动采集'}</span>
                    </Button>

                    <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="h-9 gap-1.5 text-xs">
                                <Icons.plus className="h-4 w-4" />
                                <span>添加视频</span>
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                            <DialogHeader>
                                <DialogTitle>添加视频条目</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-3 pt-2">
                                {navigation.subCategories && navigation.subCategories.length > 0 && (
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                                            <FolderOpen className="h-3.5 w-3.5 text-primary" />
                                            <span>归属二级分类:</span>
                                        </label>
                                        <Select value={targetSubCategoryId} onValueChange={setTargetSubCategoryId}>
                                            <SelectTrigger className="w-full" aria-label="归属二级分类">
                                                <SelectValue placeholder="选择所属子分类" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {navigation.subCategories.map(sub => (
                                                    <SelectItem key={sub.id} value={sub.id}>
                                                        {sub.title} ({sub.items?.length || 0}部视频)
                                                    </SelectItem>
                                                ))}
                                                <SelectItem value="direct">直属于大类主列表</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                                <AddVideoItemForm
                                    onSubmit={async (values) => {
                                        await addItem(values)
                                    }}
                                    onCancel={() => setIsAddDialogOpen(false)}
                                />
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* 综合筛选与搜索控制栏 */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 flex-1">
                    <div className="relative flex-1 min-w-[200px] max-w-sm">
                        <Icons.search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            aria-label="搜索视频"
                            placeholder="搜索视频标题、UP主、链接或描述..."
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value)
                                setCurrentPage(1)
                            }}
                            className="pl-8 text-xs h-9"
                        />
                        {searchQuery && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                    setSearchQuery("")
                                    setCurrentPage(1)
                                }}
                                className="absolute right-1 top-1 h-7 w-7 p-0"
                            >
                                <Icons.x className="h-3.5 w-3.5" />
                            </Button>
                        )}
                    </div>

                    {/* 二级子分类筛选器 */}
                    <Select
                        value={selectedSubCategory}
                        onValueChange={(val) => {
                            setSelectedSubCategory(val)
                            setCurrentPage(1)
                        }}
                    >
                        <SelectTrigger className="w-[180px] text-xs h-9" aria-label="按二级分类筛选">
                            <SelectValue placeholder="全部分类" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部二级分类 ({allFlatItems.length})</SelectItem>
                            {navigation.subCategories?.map(sub => (
                                <SelectItem key={sub.id} value={sub.id}>
                                    {sub.title} ({sub.items?.length || 0})
                                </SelectItem>
                            ))}
                            {(navigation.items?.length || 0) > 0 && (
                                <SelectItem value="direct">直属条目 ({navigation.items?.length || 0})</SelectItem>
                            )}
                        </SelectContent>
                    </Select>

                    {/* 状态筛选 */}
                    <Select
                        value={enabledFilter}
                        onValueChange={(value: 'all' | 'enabled' | 'disabled') => {
                            setEnabledFilter(value)
                            setCurrentPage(1)
                        }}
                    >
                        <SelectTrigger aria-label="按状态筛选" className="w-[110px] text-xs h-9">
                            <SelectValue placeholder="状态" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部状态</SelectItem>
                            <SelectItem value="enabled">已启用</SelectItem>
                            <SelectItem value="disabled">已禁用</SelectItem>
                        </SelectContent>
                    </Select>

                    <div className="text-xs text-muted-foreground font-medium ml-1">
                        筛选出 <span className="text-foreground font-semibold">{filteredItems.length}</span> 部
                    </div>
                </div>

                {/* 分页控制指示 */}
                {totalPages > 1 && (
                    <div className="flex items-center gap-2 self-end lg:self-center">
                        <span className="text-xs text-muted-foreground">
                            第 {currentPage} / {totalPages} 页
                        </span>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                aria-label="上一页"
                                disabled={currentPage <= 1}
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8"
                                aria-label="下一页"
                                disabled={currentPage >= totalPages}
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* 视频条目列表 */}
            {pagedItems.length > 0 ? (
                <div className="grid gap-2.5">
                    {pagedItems.map((item) => (
                        <div
                            key={item.id}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-xl border border-border/80 bg-card text-card-foreground shadow-xs hover:border-primary/50 transition-colors"
                        >
                            <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                                <div className="flex items-center justify-center w-14 h-14 rounded-lg bg-primary/10 overflow-hidden relative shrink-0">
                                    {item.icon ? (
                                        <img src={item.icon} alt={item.title} className="w-full h-full object-cover" />
                                    ) : (
                                        <Icons.video className="h-6 w-6 text-primary" />
                                    )}
                                    {item.videoConfig && (
                                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                                            <div className="w-4 h-4 bg-white/90 rounded-full flex items-center justify-center shadow-xs">
                                                <div className="w-0 h-0 border-t-3 border-t-transparent border-l-5 border-l-black border-b-3 border-b-transparent ml-0.5"></div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-semibold text-sm leading-tight text-foreground line-clamp-1">{item.title}</span>
                                        {!item.enabled && (
                                            <Badge variant="secondary" className="text-[11px] h-4.5 px-1.5">已禁用</Badge>
                                        )}
                                        {item.subCategoryTitle && (
                                            <Badge variant="outline" className="text-[11px] h-4.5 px-1.5 bg-primary/5 text-primary border-primary/20">
                                                <Layers className="w-2.5 h-2.5 mr-1" />
                                                {item.subCategoryTitle}
                                            </Badge>
                                        )}
                                        {item.videoConfig && (
                                            <Badge variant="outline" className="text-[11px] h-4.5 px-1.5">
                                                {item.videoConfig.type === 'bilibili' ? 'B站' : 'YouTube'}
                                            </Badge>
                                        )}
                                        {item.videoConfig?.pinned ? (
                                            <Badge variant="outline" className="text-[11px] h-4.5 px-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                                                📌 锁定防置换
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="text-[11px] h-4.5 px-1.5 text-muted-foreground">
                                                自动轮换
                                            </Badge>
                                        )}
                                        {item.videoConfig?.freshnessScore !== undefined && (
                                            <Badge
                                                variant="outline"
                                                className={`text-[11px] h-4.5 px-1.5 ${
                                                    item.videoConfig.freshnessScore >= 75
                                                        ? 'text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                                        : item.videoConfig.freshnessScore >= 50
                                                        ? 'text-amber-600 dark:text-amber-400 border-amber-500/30'
                                                        : 'text-red-500 border-red-500/30'
                                                }`}
                                            >
                                                保鲜 {item.videoConfig.freshnessScore}分
                                            </Badge>
                                        )}
                                        {item.videoConfig?.sourceType === 'auto_trend' && (
                                            <Badge variant="outline" className="text-[11px] h-4.5 px-1.5 text-amber-600 border-amber-500/30">
                                                🔥 热点
                                            </Badge>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                        {item.videoConfig?.author && (
                                            <span>UP主: <strong className="text-foreground font-medium">{item.videoConfig.author}</strong></span>
                                        )}
                                        {item.videoConfig?.durationSec ? (
                                            <span>时长: {formatDuration(item.videoConfig.durationSec)}</span>
                                        ) : null}
                                        {item.videoConfig?.stats?.views ? (
                                            <span>播放: {(item.videoConfig.stats.views / 10000).toFixed(1)}万</span>
                                        ) : null}
                                        {item.href && (
                                            <a
                                                // 外链必须过安全闸：`safeHref` 会拒绝 javascript:/data:、
                                                // 协议相对路径与含控制字符的串，回落到 '#'。
                                                // 保留 <a> 而不是改成 safeWindowOpen 按钮：链接要支持
                                                // 中键新标签与右键复制地址，那是管理端常用操作。
                                                href={safeHref(item.href, '#')}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1 text-primary hover:underline"
                                            >
                                                <span>打开原站</span>
                                                <ExternalLink className="h-3 w-3" />
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => toggleItemPin(item)}
                                    title={item.videoConfig?.pinned ? "已锁定（点击解锁自动轮换）" : "未锁定（点击锁定防止被淘汰）"}
                                    className={`h-8 w-8 ${item.videoConfig?.pinned ? 'text-amber-500 hover:text-amber-600 bg-amber-500/10' : 'text-muted-foreground'}`}
                                >
                                    {item.videoConfig?.pinned ? <Pin className="h-4 w-4 fill-current" /> : <PinOff className="h-4 w-4" />}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setEditingItem(item)}
                                    title="编辑视频信息"
                                    className="h-8 w-8"
                                >
                                    <Icons.pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setDeletingItem(item)}
                                    title="删除视频"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                >
                                    <Icons.trash className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center py-16 border rounded-xl border-dashed bg-card/50">
                    <Icons.video className="h-8 w-8 mx-auto text-muted-foreground/60 mb-2" />
                    <h3 className="text-sm font-semibold text-foreground">没有找到匹配的视频条目</h3>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                        {searchQuery ? "请尝试更改搜索词或重置筛选条件" : "该分类下暂无视频条目，点击上方「添加视频」开始收录。"}
                    </p>
                </div>
            )}

            {/* 分页控制底部 */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-muted-foreground">
                        共 {filteredItems.length} 部视频，当前显示第 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, filteredItems.length)} 部
                    </span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage <= 1}
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            className="h-8 text-xs gap-1"
                        >
                            <ChevronLeft className="h-3.5 w-3.5" />
                            <span>上一页</span>
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage >= totalPages}
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            className="h-8 text-xs gap-1"
                        >
                            <span>下一页</span>
                            <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>
            )}

            {/* 编辑模态框 */}
            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>编辑视频条目</DialogTitle>
                    </DialogHeader>
                    {editingItem && (
                        <AddVideoItemForm
                            defaultValues={editingItem}
                            onSubmit={async (values) => {
                                await updateItem(editingItem, values)
                            }}
                            onCancel={() => setEditingItem(null)}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* 删除确认框 */}
            <Dialog open={!!deletingItem} onOpenChange={(open) => !open && setDeletingItem(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>删除确认</DialogTitle>
                        <DialogDescription>
                            确定要删除视频 &ldquo;{deletingItem?.title}&rdquo; 吗？此操作无法撤销。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDeletingItem(null)}
                        >
                            取消
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                if (deletingItem) {
                                    deleteItem(deletingItem)
                                }
                            }}
                        >
                            删除
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
