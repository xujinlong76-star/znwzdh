'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from "@/registry/new-york/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/registry/new-york/ui/dialog"
import { useToast } from "@/registry/new-york/hooks/use-toast"
import { AddVideoCategoryForm } from './AddVideoCategoryForm'
import { HarvestPolicyDialog } from './HarvestPolicyDialog'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/registry/new-york/ui/tooltip"
import { NavigationItem, VideoHarvestPolicy } from '@/types/navigation'
import { navigationIcons, type IconType } from '@/lib/icons'
import {
    FolderOpen,
    List,
    Pencil,
    Trash,
    Sparkles,
    Play,
    Layers,
    Video,
} from 'lucide-react'
import { cn } from "@/lib/utils"
import { Badge } from "@/registry/new-york/ui/badge"

interface VideoCategoryCardProps {
    item: NavigationItem
    index: number
    onUpdate: () => void
}

export function VideoCategoryCard({
    item,
    onUpdate
}: VideoCategoryCardProps) {
    const router = useRouter()
    const { toast } = useToast()
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
    const [isPolicyDialogOpen, setIsPolicyDialogOpen] = useState(false)
    const [isHarvesting, setIsHarvesting] = useState(false)

    const Icon = item.icon && navigationIcons[item.icon as IconType] ? navigationIcons[item.icon as IconType] : navigationIcons.Folder

    const handleEdit = async (values: {
        title: string;
        description?: string;
        icon: string;
        enabled: boolean;
    }) => {
        try {
            const response = await fetch(`/api/videos/${item.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...item,
                    title: values.title,
                    description: values.description,
                    icon: values.icon,
                    enabled: values.enabled
                })
            })

            if (!response.ok) throw new Error('Failed to save')

            setIsEditDialogOpen(false)
            onUpdate()
            toast({
                title: "成功",
                description: "保存成功"
            })
        } catch (error) {
            toast({
                title: "错误",
                description: "保存失败",
                variant: "destructive"
            })
        }
    }

    const handleSavePolicy = async (policy: VideoHarvestPolicy) => {
        try {
            const response = await fetch(`/api/videos/${item.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...item,
                    harvestPolicy: policy
                })
            })

            if (!response.ok) throw new Error('Failed to update policy')

            onUpdate()
            toast({
                title: "成功",
                description: "自动采集策略已更新"
            })
        } catch (error) {
            toast({
                title: "错误",
                description: "保存策略失败",
                variant: "destructive"
            })
        }
    }

    const handleRunSingleHarvest = async () => {
        setIsHarvesting(true)
        try {
            const response = await fetch('/api/videos/harvest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    categoryId: item.id,
                    dryRun: false
                })
            })

            if (!response.ok) throw new Error('Failed to harvest')
            const data = await response.json()

            onUpdate()
            toast({
                title: "采集完成",
                description: `新增 ${data.report?.totalAddedCount || 0} 个视频，替换 ${data.report?.totalReplacedCount || 0} 个过时内容`
            })
        } catch (error) {
            toast({
                title: "错误",
                description: "执行单分类采集失败",
                variant: "destructive"
            })
        } finally {
            setIsHarvesting(false)
        }
    }

    const handleDelete = async () => {
        try {
            const response = await fetch(`/api/videos/${item.id}`, {
                method: 'DELETE'
            })

            if (!response.ok) throw new Error('Failed to delete')

            setIsDeleteDialogOpen(false)
            onUpdate()
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

    const directVideoCount = item.items?.length || 0
    const subCategories = item.subCategories || []
    const subVideoCount = subCategories.reduce((sum, sub) => sum + (sub.items?.length || 0), 0)
    const totalVideoCount = directVideoCount + subVideoCount
    const maxCapacity = item.harvestPolicy?.maxItems || 500
    const policy = item.harvestPolicy

    return (
        <div
            className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 sm:p-5 rounded-xl border border-border/80 bg-card text-card-foreground shadow-xs hover:border-primary/50 transition-all duration-200"
        >
            <div className="flex items-start gap-3.5 min-w-0 flex-1">
                <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0 mt-0.5">
                    <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-semibold tracking-tight text-foreground">{item.title}</h3>
                        <Badge
                            variant={(item.enabled ?? true) ? "default" : "secondary"}
                            className={cn(
                                "text-[11px] h-5 px-2 font-medium",
                                (item.enabled ?? true)
                                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/20"
                                    : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20"
                            )}
                        >
                            {(item.enabled ?? true) ? "已启用" : "已禁用"}
                        </Badge>
                        <Badge variant="outline" className="text-[11px] h-5 px-2 bg-primary/5 text-primary border-primary/20 gap-1 font-medium">
                            <FolderOpen className="w-3 h-3" />
                            <span>{subCategories.length} 个二级分类</span>
                        </Badge>
                        <Badge variant="outline" className="text-[11px] h-5 px-2 bg-blue-500/5 text-blue-600 dark:text-blue-400 border-blue-500/20 gap-1 font-medium">
                            <Video className="w-3 h-3" />
                            <span>共 {totalVideoCount} 部视频</span>
                        </Badge>
                        {policy?.enabled ? (
                            <Badge variant="outline" className="text-[11px] h-5 px-2 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5">
                                🔥 自动采集
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="text-[11px] h-5 px-2 text-muted-foreground">
                                手工维护
                            </Badge>
                        )}
                    </div>

                    {item.description && (
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 max-w-2xl">{item.description}</p>
                    )}

                    {/* 二级分类快速胶囊导航 */}
                    {subCategories.length > 0 && (
                        <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                            <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1 mr-1">
                                <Layers className="w-3.5 h-3.5 text-primary/80" /> 二级分类:
                            </span>
                            {subCategories.map((sub) => (
                                <button
                                    key={sub.id}
                                    type="button"
                                    onClick={() => router.push(`/admin/videos/${item.id}/categories/${sub.id}/items`)}
                                    className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md bg-muted/60 hover:bg-primary/10 hover:text-primary hover:border-primary/40 border border-border/60 text-muted-foreground transition-all duration-150"
                                    title={`点击直达子分类 "${sub.title}" (${sub.items?.length || 0}部视频)`}
                                >
                                    <span className="font-medium text-foreground">{sub.title}</span>
                                    <span className="text-[10px] px-1 py-0.2 rounded bg-background text-muted-foreground font-semibold">
                                        {sub.items?.length || 0}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* 采集热点关键词 */}
                    {policy?.keywords && policy.keywords.length > 0 && (
                        <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                            <span className="text-[11px] text-muted-foreground font-medium">采集热词:</span>
                            {policy.keywords.slice(0, 5).map((kw, i) => (
                                <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-amber-500/5 text-amber-700 dark:text-amber-300 border border-amber-500/15">
                                    {kw}
                                </span>
                            ))}
                            {policy.keywords.length > 5 && (
                                <span className="text-[11px] text-muted-foreground">+{policy.keywords.length - 5}</span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2 self-start lg:self-center shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-border/40 w-full lg:w-auto justify-end">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={isHarvesting}
                    onClick={handleRunSingleHarvest}
                    className="h-8.5 gap-1.5 text-xs px-2.5 bg-amber-500/5 hover:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
                >
                    <Play className={cn("h-3.5 w-3.5", isHarvesting && "animate-spin text-amber-500")} />
                    <span>{isHarvesting ? "采集中..." : "立即采集"}</span>
                </Button>

                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/admin/videos/${item.id}/categories`)}
                    className="h-8.5 gap-1.5 text-xs px-2.5 bg-primary/5 hover:bg-primary/10 text-primary border-primary/20"
                    title="管理二级分类"
                >
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>二级分类 ({subCategories.length})</span>
                </Button>

                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/admin/videos/${item.id}/items`)}
                    className="h-8.5 gap-1.5 text-xs px-2.5"
                    title="管理该分类下的全部视频"
                >
                    <List className="h-3.5 w-3.5" />
                    <span>全部条目 ({totalVideoCount})</span>
                </Button>

                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="采集策略设置"
                                title="采集策略设置"
                                onClick={() => setIsPolicyDialogOpen(true)}
                                className="h-8.5 w-8.5 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                            >
                                <Sparkles className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>配置自动采集策略与保鲜半衰期</p>
                        </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="编辑分类"
                                title="编辑分类"
                                onClick={() => setIsEditDialogOpen(true)}
                                className="h-8.5 w-8.5 hover:bg-muted"
                            >
                                <Pencil className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>编辑分类基础信息</p>
                        </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="删除分类"
                                title="删除分类"
                                onClick={() => setIsDeleteDialogOpen(true)}
                                className="h-8.5 w-8.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                                <Trash className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>删除分类及关联内容</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>

            <HarvestPolicyDialog
                open={isPolicyDialogOpen}
                onOpenChange={setIsPolicyDialogOpen}
                categoryTitle={item.title}
                policy={item.harvestPolicy}
                onSave={handleSavePolicy}
            />

            <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>编辑分类</DialogTitle>
                    </DialogHeader>
                    <AddVideoCategoryForm
                        defaultValues={{
                            title: item.title,
                            description: item.description || '',
                            icon: item.icon || '',
                            enabled: item.enabled ?? true
                        }}
                        onSubmit={handleEdit}
                        onCancel={() => setIsEditDialogOpen(false)}
                    />
                </DialogContent>
            </Dialog>

            <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>确认删除分类</DialogTitle>
                        <DialogDescription>
                            确定要删除分类 &ldquo;{item.title}&rdquo; 吗？此操作无法撤消，该分类下的所有二级分类和视频条目都将被一并删除。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
                            取消
                        </Button>
                        <Button variant="destructive" onClick={handleDelete}>
                            删除
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
