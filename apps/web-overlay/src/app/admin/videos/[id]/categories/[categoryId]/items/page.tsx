'use client'

import { useState, useEffect, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from "@/registry/new-york/ui/button"
import { useToast } from "@/registry/new-york/hooks/use-toast"
import { Icons } from "@/components/icons"
import type { NavigationCategory, NavigationItem, NavigationSubItem } from '@/types/navigation'
import { Input } from "@/registry/new-york/ui/input"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/registry/new-york/ui/dialog"
import { AddVideoItemForm } from '../../../../components/AddVideoItemForm'
import { Skeleton } from "@/registry/new-york/ui/skeleton"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/registry/new-york/ui/select"
import { Badge } from "@/registry/new-york/ui/badge"
import { describeDegrade } from '@/lib/degrade'
import { formatDuration } from '@/lib/video-format'
import { VIDEO_PLATFORM_REGISTRY } from '@/lib/video-platform-registry'
import { safeHref } from '@/lib/safe-url'
import {
    ArrowLeft,
    FolderOpen,
    Layers,
    Plus,
    Pin,
    PinOff,
    ExternalLink,
    ChevronLeft,
    ChevronRight,
    FileText,
    Sparkles,
} from 'lucide-react'

export default function SubCategoryVideoItemsPage() {
    const params = useParams<{ id: string; categoryId: string }>()
    // 依赖数组里只放**简单标识符**：React Compiler 不接受 `params?.id` 这种
    // 带可选链的表达式当依赖，会判成 "Compilation Skipped: Existing
    // memoization could not be preserved"（react-hooks/immutability 报 error）。
    // 这里把路由参数摊平成普通常量，deps 与 effect 体都用它。
    const paramsId = params?.id
    const categoryId = params?.categoryId
    const router = useRouter()
    const { toast } = useToast()

    const [navigation, setNavigation] = useState<NavigationItem | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
    const [currentPage, setCurrentPage] = useState(1)
    const pageSize = 30

    const [editingItem, setEditingItem] = useState<{ index: number; item: NavigationSubItem } | null>(null)
    const [deletingItem, setDeletingItem] = useState<{ index: number; item: NavigationSubItem } | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [loadError, setLoadError] = useState<unknown>(null)
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)

    const fetchNavigation = async () => {
        setIsLoading(true)
        try {
            if (!params?.id) throw new Error('未找到主分类 ID')
            const response = await fetch(`/api/videos/${params.id}`)
            if (!response.ok) throw new Error('获取分类信息失败')

            const data = await response.json()
            setNavigation(data)
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

    // fetchNavigation 必须**先声明再被 effect 调用**：原先 effect 在前、函数在后，
    // 是典型的暂时性死区，React Compiler 因此无法保留该组件的 memoization，
    // eslint 的 react-hooks/immutability 会判成 error（"Compilation Skipped"）。
    // effect 体在渲染后执行，纯粹调整声明顺序不改变行为。
    useEffect(() => {
        if (!paramsId || !categoryId) {
            router.push('/admin/videos')
            return
        }
        fetchNavigation()
    }, [paramsId, categoryId])

    const subCategory: NavigationCategory | null = useMemo(() => {
        if (!navigation || !categoryId) return null
        return (navigation.subCategories || []).find(s => s.id === categoryId) || null
    }, [navigation, categoryId])

    const subCategoryItems: NavigationSubItem[] = useMemo(() => {
        return subCategory?.items || []
    }, [subCategory])

    const filteredItems = useMemo(() => {
        return subCategoryItems
            .map((item, originalIndex) => ({ item, originalIndex }))
            .filter(({ item }) => {
                const q = searchQuery.toLowerCase().trim()
                const matchesSearch =
                    !q ||
                    item.title.toLowerCase().includes(q) ||
                    item.href.toLowerCase().includes(q) ||
                    (item.description?.toLowerCase().includes(q) ?? false) ||
                    (item.videoConfig?.author?.toLowerCase().includes(q) ?? false) ||
                    (item.videoConfig?.seoSlug?.toLowerCase().includes(q) ?? false)

                const matchesEnabled =
                    enabledFilter === 'all'
                        ? true
                        : enabledFilter === 'enabled'
                            ? item.enabled !== false
                            : item.enabled === false

                return matchesSearch && matchesEnabled
            })
    }, [subCategoryItems, searchQuery, enabledFilter])

    const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize))
    const pagedItems = useMemo(() => {
        const start = (currentPage - 1) * pageSize
        return filteredItems.slice(start, start + pageSize)
    }, [filteredItems, currentPage, pageSize])

    const addItem = async (values: NavigationSubItem) => {
        try {
            if (!params?.id || !params?.categoryId) throw new Error('缺少必要分类标识')
            const response = await fetch(`/api/videos/${params.id}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item: values,
                    subCategoryId: params.categoryId
                })
            })

            if (!response.ok) throw new Error('保存视频失败')

            await fetchNavigation()
            toast({
                title: "成功",
                description: "添加视频成功"
            })
            setIsAddDialogOpen(false)
        } catch (error) {
            toast({
                title: "错误",
                description: (error as Error).message || "保存失败",
                variant: "destructive"
            })
        }
    }

    const updateItem = async (index: number, values: NavigationSubItem) => {
        try {
            if (!params?.id || !params?.categoryId) throw new Error('缺少必要分类标识')
            const response = await fetch(`/api/videos/${params.id}/items`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    index,
                    subCategoryId: params.categoryId,
                    item: values
                })
            })

            if (!response.ok) throw new Error('更新视频失败')

            await fetchNavigation()
            toast({
                title: "成功",
                description: "保存成功"
            })
            setEditingItem(null)
        } catch (error) {
            toast({
                title: "错误",
                description: (error as Error).message || "更新失败",
                variant: "destructive"
            })
        }
    }

    const deleteItem = async (index: number) => {
        try {
            if (!params?.id || !params?.categoryId) throw new Error('缺少必要分类标识')
            const response = await fetch(`/api/videos/${params.id}/items`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    index,
                    subCategoryId: params.categoryId
                })
            })

            if (!response.ok) throw new Error('删除视频失败')

            await fetchNavigation()
            toast({
                title: "成功",
                description: "删除视频成功"
            })
            setDeletingItem(null)
        } catch (error) {
            toast({
                title: "错误",
                description: (error as Error).message || "删除失败",
                variant: "destructive"
            })
        }
    }

    const toggleItemPin = async (index: number, item: NavigationSubItem) => {
        const currentlyPinned = Boolean(item.videoConfig?.pinned)
        const updatedItem: NavigationSubItem = {
            ...item,
            videoConfig: {
                ...item.videoConfig,
                type: item.videoConfig?.type || 'bilibili',
                pinned: !currentlyPinned
            }
        }
        await updateItem(index, updatedItem)
        toast({
            title: !currentlyPinned ? '已锁定防替换' : '已解除锁定',
            description: !currentlyPinned ? '该视频将免于全自动优胜劣汰轮换' : '该视频将参与正常保鲜度轮换'
        })
    }

    if (isLoading) {
        return (
            <div className="space-y-4 p-4 sm:p-6 lg:p-8">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-96" />
                <div className="space-y-3 pt-4">
                    {[1, 2, 3, 4].map(i => (
                        <Skeleton key={i} className="h-16 w-full rounded-xl" />
                    ))}
                </div>
            </div>
        )
    }

    if (loadError && !subCategory) {
        const notice = describeDegrade(loadError)
        return (
            <div role="status" className="mx-auto max-w-xl rounded-md border border-red-200 bg-red-50 px-6 py-16 text-center dark:border-red-900 dark:bg-red-950/20">
                <h2 className="mb-2 text-lg font-medium text-red-700 dark:text-red-300">子分类数据加载失败</h2>
                <p className="mb-6 text-sm text-red-600 dark:text-red-400">{notice.message}</p>
                <Button variant="outline" onClick={() => void fetchNavigation()}>重试</Button>
            </div>
        )
    }

    if (!subCategory) {
        return (
            <div className="p-8 text-center space-y-4">
                <p className="text-muted-foreground">子分类不存在</p>
                <Button variant="outline" onClick={() => router.push(`/admin/videos/${params.id}/categories`)}>
                    返回二级分类列表
                </Button>
            </div>
        )
    }

    return (
        <div className="h-full flex-1 flex-col space-y-5 p-4 sm:p-6 lg:p-8 md:flex">
            {/* 顶部面包屑与标题区 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border/60">
                <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Link href="/admin/videos" className="hover:text-foreground transition-colors">
                            视频管理
                        </Link>
                        <span>/</span>
                        <Link href={`/admin/videos/${navigation?.id ?? params.id}/categories`} className="hover:text-foreground transition-colors">
                            {navigation?.title ?? '视频分类'}
                        </Link>
                        <span>/</span>
                        <span className="text-foreground font-medium">{subCategory.title}</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 -ml-2"
                            onClick={() => router.push(`/admin/videos/${navigation?.id || params.id}/categories`)}
                            title="返回二级分类列表"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <h1 className="text-lg sm:text-xl font-bold tracking-tight flex items-center gap-2">
                            <span>{subCategory.title}</span>
                            <Badge variant="outline" className="text-xs font-normal">
                                {subCategoryItems.length} 部视频
                            </Badge>
                        </h1>
                    </div>
                    {subCategory.description && (
                        <p className="text-xs text-muted-foreground line-clamp-1">{subCategory.description}</p>
                    )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/admin/videos/${navigation?.id ?? params.id}/items`)}
                        className="text-xs h-9 gap-1.5"
                    >
                        <Layers className="h-3.5 w-3.5 text-primary" />
                        <span>查看全部条目</span>
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => setIsAddDialogOpen(true)}
                        className="text-xs h-9 gap-1.5 bg-amber-500 hover:bg-amber-600 text-white"
                    >
                        <Plus className="h-4 w-4" />
                        <span>添加视频到此分类</span>
                    </Button>
                </div>
            </div>

            {/* 搜索与状态过滤工具栏 */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 flex-1">
                    <Input
                        placeholder="搜索标题、UP主、平台标识或 SEO Slug..."
                        aria-label="搜索视频条目"
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value)
                            setCurrentPage(1)
                        }}
                        className="w-full sm:max-w-xs text-xs h-9"
                    />
                    <Select
                        value={enabledFilter}
                        onValueChange={(val: 'all' | 'enabled' | 'disabled') => {
                            setEnabledFilter(val)
                            setCurrentPage(1)
                        }}
                    >
                        <SelectTrigger aria-label="状态筛选" className="w-full sm:w-32 text-xs h-9">
                            <SelectValue placeholder="状态筛选" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部状态</SelectItem>
                            <SelectItem value="enabled">已启用</SelectItem>
                            <SelectItem value="disabled">已禁用</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* 视频条目列表 */}
            <div className="space-y-2.5">
                {subCategory?.items && subCategory.items.length > 0 ? (
                    filteredItems.length === 0 ? (
                        <div className="p-12 text-center border border-dashed rounded-xl space-y-3">
                            <FolderOpen className="w-10 h-10 mx-auto text-muted-foreground/60" />
                            <div className="text-sm font-medium text-foreground">没有找到匹配的视频</div>
                            <p className="text-xs text-muted-foreground">
                                请尝试更换搜索词或筛选条件。
                            </p>
                        </div>
                    ) : (
                        pagedItems.map(({ item, originalIndex }) => {
                        const vc = item.videoConfig
                        const platform = vc?.type || 'bilibili'
                        const platformMeta = VIDEO_PLATFORM_REGISTRY[platform] || VIDEO_PLATFORM_REGISTRY.custom

                        return (
                            <div
                                key={item.id || originalIndex}
                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-border/80 bg-card hover:border-primary/40 transition-colors shadow-xs"
                            >
                                <div className="flex items-start gap-3 min-w-0 flex-1">
                                    {/* 封面缩略图 */}
                                    <div className="w-20 h-12 rounded-lg bg-black/40 overflow-hidden shrink-0 relative border border-border/60">
                                        {item.icon ? (
                                            <img
                                                src={item.icon}
                                                alt={item.title}
                                                className="w-full h-full object-cover"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">
                                                无图
                                            </div>
                                        )}
                                        {vc?.durationSec ? (
                                            <span className="absolute bottom-0.5 right-0.5 text-[9px] font-mono px-1 rounded bg-black/80 text-white">
                                                {formatDuration(vc.durationSec)}
                                            </span>
                                        ) : null}
                                    </div>

                                    {/* 标题与多平台/SEO 元数据 */}
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            <Badge
                                                className="text-[10px] h-4.5 px-1.5 text-white"
                                                style={{ backgroundColor: platformMeta.badgeColor }}
                                            >
                                                {platformMeta.shortName}
                                            </Badge>
                                            {vc?.pinned ? (
                                                <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 text-amber-500 border-amber-500/30 bg-amber-500/5">
                                                    📌 锁定
                                                </Badge>
                                            ) : null}
                                            {vc?.indexable ? (
                                                <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/5">
                                                    ✓ SEO 可索引
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-[10px] h-4.5 px-1.5 text-muted-foreground">
                                                    noindex
                                                </Badge>
                                            )}
                                            <h3 className="text-sm font-semibold text-foreground truncate max-w-md" title={item.title}>
                                                {item.title}
                                            </h3>
                                        </div>

                                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                                            {vc?.author && <span>作者: {vc.author}</span>}
                                            {vc?.qualityScore ? (
                                                <span>质量分: <strong className="text-foreground">{vc.qualityScore}</strong></span>
                                            ) : null}
                                            {vc?.freshnessScore ? (
                                                <span>保鲜度: <strong className="text-emerald-600 dark:text-emerald-400">{vc.freshnessScore}</strong></span>
                                            ) : null}
                                            {vc?.seoSlug && (
                                                <span className="font-mono text-[10px] opacity-75 truncate max-w-xs">
                                                    slug: {vc.seoSlug}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* 右侧操作按钮 */}
                                <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-amber-500 hover:bg-amber-500/10"
                                        onClick={() => toggleItemPin(originalIndex, item)}
                                        title={vc?.pinned ? "点击解除锁定（参与自动轮换）" : "点击锁定防替换（免于自动淘汰）"}
                                    >
                                        {vc?.pinned ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4 opacity-50" />}
                                    </Button>

                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-emerald-500 hover:bg-emerald-500/10"
                                        asChild
                                        title="查看独立 SEO 落地页 (/videos/v/[id])"
                                    >
                                        <Link href={`/videos/v/${encodeURIComponent(item.id)}`} target="_blank">
                                            <FileText className="h-4 w-4" />
                                        </Link>
                                    </Button>

                                    {item.href ? (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 hover:bg-muted"
                                            asChild
                                            title="前往原站播放"
                                        >
                                            <a href={safeHref(item.href)} target="_blank" rel="noopener noreferrer">
                                                <ExternalLink className="h-4 w-4" />
                                            </a>
                                        </Button>
                                    ) : null}

                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 hover:bg-muted"
                                        onClick={() => setEditingItem({ index: originalIndex, item })}
                                        title="编辑视频信息"
                                    >
                                        <Icons.pencil className="h-4 w-4" />
                                    </Button>

                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                        onClick={() => setDeletingItem({ index: originalIndex, item })}
                                        title="删除视频"
                                    >
                                        <Icons.trash className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )
                    })
                )
            ) : (
                <div className="p-12 text-center border border-dashed rounded-xl space-y-3">
                    <FolderOpen className="w-10 h-10 mx-auto text-muted-foreground/60" />
                    <div className="text-sm font-medium text-foreground">当前二级分类下暂无视频</div>
                    <p className="text-xs text-muted-foreground">
                        可点击右上角「添加视频到此分类」或使用一键智能链接解析自动收录。
                    </p>
                </div>
            )}
            </div>

            {/* 分页控制器 */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between pt-3 border-t text-xs text-muted-foreground">
                    <span>
                        共 {filteredItems.length} 条记录，第 {currentPage} / {totalPages} 页
                    </span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            disabled={currentPage <= 1}
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        >
                            <ChevronLeft className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2"
                            disabled={currentPage >= totalPages}
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        >
                            <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>
            )}

            {/* 新建视频对话框 */}
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>添加视频到「{subCategory.title}」</DialogTitle>
                        <DialogDescription>
                            支持国内外 12+ 主流平台链接一键智能提取与自动 SEO 语义富化
                        </DialogDescription>
                    </DialogHeader>
                    <AddVideoItemForm
                        onSubmit={addItem}
                        onCancel={() => setIsAddDialogOpen(false)}
                    />
                </DialogContent>
            </Dialog>

            {/* 编辑视频对话框 */}
            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>编辑视频</DialogTitle>
                    </DialogHeader>
                    {editingItem && (
                        <AddVideoItemForm
                            defaultValues={editingItem.item}
                            onSubmit={(updated) => updateItem(editingItem.index, updated)}
                            onCancel={() => setEditingItem(null)}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* 确认删除对话框 */}
            <Dialog open={!!deletingItem} onOpenChange={(open) => !open && setDeletingItem(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>确认删除视频</DialogTitle>
                        <DialogDescription>
                            确定要删除视频「{deletingItem?.item.title}」吗？此操作无法撤销。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeletingItem(null)}>
                            取消
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                if (deletingItem) deleteItem(deletingItem.index)
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
