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

    const videoCount = item.items?.length || 0
    const maxCapacity = item.harvestPolicy?.maxItems || 12
    const policy = item.harvestPolicy

    return (
        <div
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-lg border bg-card text-card-foreground shadow-xs hover:border-primary/50 transition-colors"
        >
            <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0 mt-0.5 sm:mt-0">
                    <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold truncate">{item.title}</h3>
                        <Badge
                            variant={(item.enabled ?? true) ? "default" : "secondary"}
                            className={cn(
                                "text-[11px] h-4.5 px-1.5",
                                (item.enabled ?? true)
                                    ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300 hover:bg-green-100"
                                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-100"
                            )}
                        >
                            {(item.enabled ?? true) ? "已启用" : "已禁用"}
                        </Badge>
                        {policy?.enabled ? (
                            <Badge variant="outline" className="text-[11px] h-4.5 px-1.5 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5">
                                🔥 自动采集
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="text-[11px] h-4.5 px-1.5 text-muted-foreground">
                                手工维护
                            </Badge>
                        )}
                        <span className="text-xs text-muted-foreground ml-1">
                            {videoCount} / {maxCapacity} 视频
                        </span>
                    </div>

                    {item.description && (
                        <p className="text-xs text-muted-foreground mt-1 truncate max-w-xl">{item.description}</p>
                    )}

                    {policy?.keywords && policy.keywords.length > 0 && (
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                            <span className="text-[11px] text-muted-foreground">热点词:</span>
                            {policy.keywords.slice(0, 4).map((kw, i) => (
                                <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                    {kw}
                                </span>
                            ))}
                            {policy.keywords.length > 4 && (
                                <span className="text-[11px] text-muted-foreground">+{policy.keywords.length - 4}</span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={isHarvesting}
                                onClick={handleRunSingleHarvest}
                                className="h-8 gap-1 text-xs px-2.5 mr-1"
                            >
                                <Play className={cn("h-3.5 w-3.5", isHarvesting && "animate-spin text-amber-500")} />
                                <span>{isHarvesting ? "采集中..." : "立即采集"}</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>根据策略关键词抓取最新高赞视频并按规则轮换</p>
                        </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="采集策略设置"
                                title="采集策略设置"
                                onClick={() => setIsPolicyDialogOpen(true)}
                                className="h-8 w-8 text-amber-600 dark:text-amber-400"
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
                                aria-label="子分类管理"
                                title="子分类管理"
                                onClick={() => router.push(`/admin/videos/${item.id}/categories`)}
                                className="h-8 w-8"
                            >
                                <FolderOpen className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>子分类管理</p>
                        </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="视频条目管理"
                                title="视频条目管理"
                                onClick={() => router.push(`/admin/videos/${item.id}/items`)}
                                className="h-8 w-8"
                            >
                                <List className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>视频条目管理</p>
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
                                className="h-8 w-8"
                            >
                                <Pencil className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>编辑基础信息</p>
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
                                className="h-8 w-8 text-destructive hover:text-destructive"
                            >
                                <Trash className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>删除分类</p>
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
                        <DialogTitle>确认删除</DialogTitle>
                        <DialogDescription>
                            确定要删除这个分类吗？此操作无法撤消，所有相关的视频都将被删除。
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
