'use client'

import { useState } from "react"
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from "@/registry/new-york/ui/button"
import { NavigationList } from "./components/NavigationList"
import { AddNavigationForm } from "./components/AddNavigationForm"
import { Input } from "@/registry/new-york/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/registry/new-york/ui/dialog"
import { useToast } from "@/registry/new-york/hooks/use-toast"
import { Skeleton } from "@/registry/new-york/ui/skeleton"
import useSWR from 'swr'
import { NavigationItem } from "@/types/navigation"
import type { DropResult } from '@hello-pangea/dnd'
import { Plus, AlertTriangle, Inbox } from 'lucide-react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/registry/new-york/ui/select"


async function fetcher(url: string): Promise<NavigationItem[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch navigation items')
  const data = await res.json()
  return data.navigationItems || []
}

export default function NavigationPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [showEnabled, setShowEnabled] = useState<boolean | null>(null)
  const { toast } = useToast()

  const { data: items = [], error, isLoading, mutate } = useSWR<NavigationItem[]>(
    '/api/navigation',
    fetcher,
    {
      fallbackData: [],
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
      // 生成唯一ID
      const newItem: NavigationItem = {
        id: Date.now().toString(),
        title: values.title,
        icon: values.icon,
        description: values.description || '',
        enabled: values.enabled ?? true,
        items: [],
        subCategories: []
      }

      const response = await fetch('/api/navigation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          navigationItems: [
            ...items,  // 保留现有的导航项
            newItem    // 添加新的导航项
          ]
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('添加失败:', errorText)
        throw new Error('Failed to add')
      }

      setIsDialogOpen(false)
      mutate()
      toast({
        title: "成功",
        description: "添加成功"
      })
    } catch (error) {
      console.error('添加导航项错误:', error)
      toast({
        title: "错误",
        description: "添加失败：" + (error as Error).message,
        variant: "destructive"
      })
    }
  }

  const handleMoveToTop = async (id: string) => {
    try {
      const response = await fetch(`/api/navigation/${id}/move-to-top`, {
        method: 'POST'
      })

      if (!response.ok) throw new Error('Failed to move')

      mutate()
      toast({
        title: "成功",
        description: "移动成功"
      })
    } catch (error) {
      toast({
        title: "错误",
        description: "移动失败",
        variant: "destructive"
      })
    }
  }

  const handleMoveToBottom = async (id: string) => {
    try {
      const response = await fetch(`/api/navigation/${id}/move-to-bottom`, {
        method: 'POST'
      })

      if (!response.ok) throw new Error('Failed to move')

      mutate()
      toast({
        title: "成功",
        description: "移动成功"
      })
    } catch (error) {
      toast({
        title: "错误",
        description: "移动失败",
        variant: "destructive"
      })
    }
  }

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return

    const sourceIndex = result.source.index
    const destinationIndex = result.destination.index

    if (sourceIndex === destinationIndex) return

    // 创建一个新的数组副本
    const currentItems = Array.isArray(items) ? [...items] : []

    // 记录原始顺序，用于可能的回滚
    const originalItems = [...currentItems]

    // 移动元素
    const [movedItem] = currentItems.splice(sourceIndex, 1)
    currentItems.splice(destinationIndex, 0, movedItem)

    // 乐观更新：立即更新本地状态
    await mutate(currentItems, {
      revalidate: false  // 阻止重新获取数据
    })

    try {
      const response = await fetch('/api/navigation/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceIndex,
          destinationIndex,
          itemId: result.draggableId
        })
      })

      if (!response.ok) {
        // 如果服务器请求失败，回滚到原始状态
        await mutate(originalItems, { revalidate: false })
        throw new Error('排序失败')
      }

      // 成功后重新获取最新数据以确保一致性
      await mutate()

      toast({
        title: "成功",
        description: "排序已更新"
      })

    } catch (error) {
      // 回滚到原始状态
      await mutate(originalItems, { revalidate: false })

      toast({
        title: "错误",
        description: "排序失败，已恢复原状",
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
    <div className="h-full flex-1 flex-col space-y-5 sm:space-y-8 p-3 sm:p-6 lg:p-8 md:flex">
      <div>
        <h1 className="text-xl font-bold">导航架构管理</h1>
        <p className="text-xs text-muted-foreground mt-1">
          管理全站层级分类与二级子类：拖拽调整顺序、按启用状态筛选，改动即时对前台导航生效。
        </p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 flex-1 w-full sm:w-auto">
          <Input aria-label="搜索分类"
            placeholder="搜索分类..."
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
            <SelectTrigger aria-label="状态筛选" className="w-full sm:w-[180px]">
              <SelectValue placeholder="状态筛选" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="true">已启用</SelectItem>
              <SelectItem value="false">已禁用</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setIsDialogOpen(true)} className="w-full sm:w-auto shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          添加分类
        </Button>
      </div>
      <div className="space-y-4">
        {error ? (
          <div className="flex h-[450px] shrink-0 items-center justify-center rounded-md border border-dashed">
            <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
              <AlertTriangle className="h-10 w-10 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">加载失败</h3>
              <p className="mb-4 mt-2 text-sm text-muted-foreground">
                获取导航数据时发生错误，请稍后重试。
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
                <div className="space-y-2">
                  <Skeleton className="h-4 w-[200px]" />
                </div>
              </div>
            </div>
          ))
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="暂无分类"
            description={searchQuery ? "没有找到匹配的分类，换个关键词试试。" : "还没有添加任何分类，点击上方的添加按钮开始创建。"}
            action={
              searchQuery ? (
                <Button variant="outline" onClick={() => setSearchQuery("")}>
                  清除搜索
                </Button>
              ) : undefined
            }
          />
        ) : (
          <NavigationList
            items={filteredItems}
            onDragEnd={handleDragEnd}
            onUpdate={mutate}
            onMoveToTop={handleMoveToTop}
            onMoveToBottom={handleMoveToBottom}
          />
        )}
      </div>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加分类</DialogTitle>
          </DialogHeader>
          <AddNavigationForm
            onSubmit={handleAdd}
            onCancel={() => setIsDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}