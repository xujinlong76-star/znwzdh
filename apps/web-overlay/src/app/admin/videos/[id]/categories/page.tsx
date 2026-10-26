'use client'

export const runtime = 'edge'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from "@/registry/new-york/ui/button"
import { useToast } from "@/registry/new-york/hooks/use-toast"
import {
    Plus,
    Folder,
    Search,
    X,
    ArrowLeft,
    List,
    Pencil,
    Trash,
} from 'lucide-react'
import { NavigationItem, NavigationCategory } from '@/types/navigation'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
    DialogDescription,
} from "@/registry/new-york/ui/dialog"
import { AddVideoCategoryForm } from '../../components/AddVideoCategoryForm'
import { Input } from "@/registry/new-york/ui/input"
import { Badge } from "@/registry/new-york/ui/badge"
import { Skeleton } from "@/registry/new-york/ui/skeleton"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/registry/new-york/ui/select"
import { describeDegrade } from '@/lib/degrade'

export default function VideoCategoriesPage() {
    const params = useParams<{ id: string }>()
    const router = useRouter()
    const { toast } = useToast()
    const [navigation, setNavigation] = useState<NavigationItem | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [editingCategory, setEditingCategory] = useState<{ index: number; category: NavigationCategory } | null>(null)
    const [deletingCategory, setDeletingCategory] = useState<{ index: number; category: NavigationCategory } | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [loadError, setLoadError] = useState<unknown>(null)
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
    const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all')

    useEffect(() => {
        if (!params?.id) {
            router.push('/admin/videos')
            return
        }
        fetchNavigation()
    }, [params?.id, router])

    const fetchNavigation = async () => {
        if (!params?.id) return
        try {
            setIsLoading(true)
            const response = await fetch(`/api/videos/${params.id}`)
            if (!response.ok) throw new Error('Failed to fetch')
            const data = await response.json()
            setNavigation(data)
            setLoadError(null)
        } catch (error) {
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

    const addCategory = async (values: {
        title: string,
        icon: string,
        description?: string,
        enabled: boolean
    }) => {
        if (!params?.id || !navigation) return

        try {
            const newCategory: NavigationCategory = {
                id: crypto.randomUUID(),
                title: values.title,
                icon: values.icon,
                description: values.description,
                enabled: values.enabled,
                items: []
            }

            const updatedNavigation: NavigationItem = {
                ...navigation,
                subCategories: [...(navigation.subCategories || []), newCategory]
            }

            const response = await fetch(`/api/videos/${params.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedNavigation)
            })

            if (!response.ok) throw new Error('Failed to save')

            await fetchNavigation()
            toast({
                title: "成功",
                description: "添加成功"
            })
            setIsAddDialogOpen(false)
        } catch (error) {
            console.error('Save error:', error)
            toast({
                title: "错误",
                description: error instanceof Error ? error.message : "保存失败",
                variant: "destructive"
            })
        }
    }

    const editCategory = async (values: {
        title: string,
        icon: string,
        description?: string,
        enabled: boolean
    }) => {
        if (!params?.id || !navigation || !editingCategory) return

        try {
            const updatedCategories = navigation.subCategories?.map((cat, index) =>
                index === editingCategory.index
                    ? {
                        ...cat,
                        title: values.title,
                        icon: values.icon,
                        description: values.description,
                        enabled: values.enabled
                    }
                    : cat
            ) || []

            const updatedNavigation: NavigationItem = {
                ...navigation,
                subCategories: updatedCategories
            }

            const response = await fetch(`/api/videos/${params.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedNavigation)
            })

            if (!response.ok) throw new Error('Failed to save')

            await fetchNavigation()
            setEditingCategory(null)

            toast({
                title: "成功",
                description: "更新成功"
            })
        } catch (error) {
            toast({
                title: "错误",
                description: "保存失败",
                variant: "destructive"
            })
        }
    }

    const deleteCategory = async (categoryId: string) => {
        if (!params?.id || !navigation) return

        try {
            const updatedCategories = navigation.subCategories?.filter(cat => cat.id !== categoryId) || []

            const updatedNavigation: NavigationItem = {
                ...navigation,
                subCategories: updatedCategories
            }

            const response = await fetch(`/api/videos/${params.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedNavigation)
            })

            if (!response.ok) throw new Error('Failed to delete')

            await fetchNavigation()
            toast({
                title: "成功",
                description: "删除成功"
            })
        } catch (error) {
            toast({
                title: "错误",
                description: "删除失败",
                variant: "destructive"
            })
        }
    }

    const filteredCategories = navigation?.subCategories?.filter(category => {
        const matchesSearch = category.title.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesStatus = statusFilter === 'all'
            ? true
            : statusFilter === 'enabled'
                ? category.enabled
                : !category.enabled
        return matchesSearch && matchesStatus
    }) || []

    if (isLoading) {
        return (
            <div className="space-y-4">
                <div className="flex items-center gap-4">
                    <Skeleton className="h-8 w-8" />
                    <Skeleton className="h-7 w-48" />
                </div>
                <div className="grid gap-2">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-4 p-4 rounded-lg border">
                            <Skeleton className="h-8 w-8 rounded-lg" />
                            <div className="space-y-2 flex-1">
                                <Skeleton className="h-4 w-48" />
                                <Skeleton className="h-3 w-32" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    if (loadError && !navigation) {
        const notice = describeDegrade(loadError)
        return (
            <div role="status" className="mx-auto max-w-xl rounded-md border border-red-200 bg-red-50 px-6 py-16 text-center dark:border-red-900 dark:bg-red-950/20">
                <h2 className="mb-2 text-lg font-medium text-red-700 dark:text-red-300">子分类数据加载失败</h2>
                <p className="mb-6 text-sm text-red-600 dark:text-red-400">{notice.message}</p>
                <Button variant="outline" onClick={() => void fetchNavigation()}>重试</Button>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 sm:gap-4 flex-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.back()}
                        className="h-8 w-8"
                        title="返回"
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h2 className="text-base sm:text-lg font-semibold flex items-center gap-2">
                        {navigation?.title || '未命名分类'} - 子分类管理
                    </h2>
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            aria-label="搜索子分类"
                            placeholder="搜索子分类..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8"
                        />
                        {searchQuery && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSearchQuery("")}
                                className="absolute right-1 top-1 h-7 w-7 p-0"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                    <Select
                        value={statusFilter}
                        onValueChange={(value: 'all' | 'enabled' | 'disabled') => setStatusFilter(value)}
                    >
                        <SelectTrigger className="w-[120px]" aria-label="按状态筛选">
                            <SelectValue placeholder="状态筛选" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部</SelectItem>
                            <SelectItem value="enabled">已启用</SelectItem>
                            <SelectItem value="disabled">已禁用</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="mr-2 h-4 w-4" />
                            添加子分类
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>添加子分类</DialogTitle>
                        </DialogHeader>
                        <AddVideoCategoryForm
                            onSubmit={addCategory}
                            onCancel={() => setIsAddDialogOpen(false)}
                        />
                    </DialogContent>
                </Dialog>
            </div>

            <div className="grid gap-2">
                {filteredCategories.map((category, index) => (
                    <div
                        key={category.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 px-4 bg-card rounded-lg border shadow-xs hover:border-primary/50 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
                                <Folder className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm leading-none">{category.title}</span>
                                    <Badge
                                        variant={(category.enabled ?? true) ? "default" : "secondary"}
                                        className="text-xs"
                                    >
                                        {(category.enabled ?? true) ? "已启用" : "已禁用"}
                                    </Badge>
                                </div>
                                {category.description && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                        {category.description}
                                    </div>
                                )}
                                <div className="text-xs text-muted-foreground mt-0.5">
                                    {category.items?.length || 0} 个视频项目
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-1 self-end sm:self-center">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                    if (params?.id) {
                                        router.push(`/admin/videos/${params.id}/categories/${category.id}/items`)
                                    }
                                }}
                                title="管理视频条目"
                                className="h-8 w-8"
                            >
                                <List className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditingCategory({ index, category })}
                                title="编辑"
                                className="h-8 w-8"
                            >
                                <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeletingCategory({ index, category })}
                                title="删除"
                                className="h-8 w-8"
                            >
                                <Trash className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                ))}
                {filteredCategories.length === 0 && (
                    <div className="text-center py-10 text-muted-foreground text-sm">
                        {navigation?.subCategories?.length === 0 ? "暂无子分类" : "未找到匹配的子分类"}
                    </div>
                )}
            </div>

            <Dialog open={!!editingCategory} onOpenChange={(open) => !open && setEditingCategory(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>编辑子分类</DialogTitle>
                    </DialogHeader>
                    <AddVideoCategoryForm
                        defaultValues={{
                            title: editingCategory?.category.title || '',
                            icon: editingCategory?.category.icon || '',
                            description: editingCategory?.category.description || '',
                            enabled: editingCategory?.category.enabled ?? true
                        }}
                        onSubmit={editCategory}
                        onCancel={() => setEditingCategory(null)}
                    />
                </DialogContent>
            </Dialog>

            <Dialog open={!!deletingCategory} onOpenChange={(open) => !open && setDeletingCategory(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>删除确认</DialogTitle>
                        <DialogDescription>
                            确定要删除子分类 &ldquo;{deletingCategory?.category.title}&rdquo; 吗？此操作无法撤销，子分类下的所有视频也将被删除。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => setDeletingCategory(null)}
                        >
                            取消
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                if (deletingCategory) {
                                    deleteCategory(deletingCategory.category.id)
                                    setDeletingCategory(null)
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
