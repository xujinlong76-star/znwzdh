'use client'

import { useState } from 'react'
import {
  X,
  Pin,
  FolderPlus,
  Share2,
  Download,
  Copy,
  Trash2,
  CheckSquare,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/registry/new-york/ui/dropdown-menu'
import { useToast } from '@/components/ui/use-toast'
import { copyText } from '@/lib/clipboard'
import {
  batchExportSitesToMarkdown,
  batchExportSitesToOneTab,
  type BatchSiteItem,
} from '@/lib/batch-operations'

interface BatchOperationDockProps {
  selectedSites: BatchSiteItem[]
  customCategories: Array<{
    id: string
    title: string
    items: any[]
  }>
  onClearSelection: () => void
  onSelectAll?: () => void
  totalCount?: number
  onBatchAddToCustomCategory?: (categoryId: string) => void
  onBatchPinToWorkbench?: () => void
  onBatchDeleteFromCustomCategories?: () => void
}

/**
 * 屏幕底部多选批量操作控制微浮坞 (Batch Operations Floating Dock)
 * 赛博毛玻璃材质，当用户多选卡片时平滑自底部升起，提供批处理收录、导出、置顶与清理能力。
 */
export function BatchOperationDock({
  selectedSites,
  customCategories,
  onClearSelection,
  onSelectAll,
  totalCount,
  onBatchAddToCustomCategory,
  onBatchPinToWorkbench,
  onBatchDeleteFromCustomCategories,
}: BatchOperationDockProps) {
  const { toast } = useToast()
  const count = selectedSites.length

  if (count === 0) return null

  // 1. 复制 Markdown
  const handleCopyMarkdown = async () => {
    try {
      const md = batchExportSitesToMarkdown(selectedSites, {
        categoryTitle: `NavHub 批量导读书签 (${count}项)`,
      })
      const result = await copyText(md)
      if (!result.ok) throw new Error(result.reason)
      toast({
        title: '📋 Markdown 已复制',
        description: `已成功将 ${count} 个站点的 Markdown 清单写入系统剪贴板。`,
      })
    } catch {
      toast({
        title: '复制失败',
        description: '请检查浏览器剪贴板写入权限。',
        variant: 'destructive',
      })
    }
  }

  // 2. 下载 Markdown 文件
  const handleDownloadMarkdown = () => {
    const md = batchExportSitesToMarkdown(selectedSites, {
      categoryTitle: `NavHub 批量导读书签 (${count}项)`,
    })
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `navhub-export-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
    toast({
      title: '📥 Markdown 文件已下载',
      description: `已保存 ${count} 个站点到本地文件。`,
    })
  }

  // 3. 复制 OneTab 格式
  const handleCopyOneTab = async () => {
    try {
      const txt = batchExportSitesToOneTab(selectedSites)
      const result = await copyText(txt)
      if (!result.ok) throw new Error(result.reason)
      toast({
        title: '📋 OneTab 格式已复制',
        description: `已生成 ${count} 行 OneTab 标准导入文本。`,
      })
    } catch {
      toast({
        title: '复制失败',
        description: '请检查浏览器剪贴板写入权限。',
        variant: 'destructive',
      })
    }
  }

  return (
    <aside
      aria-label="批量操作微浮坞"
      className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] inset-x-0 mx-auto w-fit max-w-[95vw] z-40 animate-in fade-in slide-in-from-bottom-4 duration-200"
    >
      <div className="flex items-center gap-1.5 sm:gap-2.5 p-1.5 sm:p-2 pl-3 sm:pl-4 rounded-2xl bg-background/90 dark:bg-zinc-900/90 backdrop-blur-xl border border-border/80 shadow-2xl shadow-primary/10 ring-1 ring-white/10 dark:ring-white/5">
        {/* 选中数量徽标与全选 */}
        <div className="flex items-center gap-2 pr-2 border-r border-border/60">
          <span className="flex items-center justify-center h-6 px-2.5 rounded-full bg-primary text-primary-foreground font-mono font-bold text-xs shadow-xs">
            {count}
          </span>
          <span className="text-xs font-semibold text-foreground hidden sm:inline">
            项已选中
          </span>
          {onSelectAll && totalCount && count < totalCount && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSelectAll}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckSquare className="w-3.5 h-3.5 mr-1" />
              <span>全选 ({totalCount})</span>
            </Button>
          )}
        </div>

        {/* 批量操作按钮组 */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* 1. 批量收录至专属分类 */}
          {customCategories.length > 0 && onBatchAddToCustomCategory && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 text-xs font-medium border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 shadow-2xs"
                >
                  <FolderPlus className="w-3.5 h-3.5 sm:mr-1.5" />
                  <span className="hidden sm:inline">收录至分类</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-48 p-1 shadow-xl">
                <DropdownMenuLabel className="text-xs text-muted-foreground px-2 py-1">
                  选择收录的目标分类
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {customCategories.map((cat) => (
                  <DropdownMenuItem
                    key={cat.id}
                    onClick={() => onBatchAddToCustomCategory(cat.id)}
                    className="text-xs cursor-pointer flex items-center gap-2"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="truncate">{cat.title}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* 2. 批量固定到工作台 */}
          {onBatchPinToWorkbench && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBatchPinToWorkbench}
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
              title="批量固定到工作台启动坞"
            >
              <Pin className="w-3.5 h-3.5 sm:mr-1.5 text-amber-500" />
              <span className="hidden sm:inline">固定工作台</span>
            </Button>
          )}

          {/* 3. 批量导出菜单 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
                title="批量导出所选站点"
              >
                <Share2 className="w-3.5 h-3.5 sm:mr-1.5 text-sky-500" />
                <span className="hidden sm:inline">导出</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-48 p-1 shadow-xl">
              <DropdownMenuLabel className="text-xs text-muted-foreground px-2 py-1">
                导出 {count} 个站点
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleCopyMarkdown} className="text-xs cursor-pointer flex items-center gap-2">
                <Copy className="w-3.5 h-3.5 text-primary" />
                <span>复制为 Markdown</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDownloadMarkdown} className="text-xs cursor-pointer flex items-center gap-2">
                <Download className="w-3.5 h-3.5 text-sky-500" />
                <span>下载 .md 文档</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleCopyOneTab} className="text-xs cursor-pointer flex items-center gap-2">
                <Copy className="w-3.5 h-3.5 text-amber-500" />
                <span>复制为 OneTab 格式</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 4. 批量自专属分类移除 (若有配置) */}
          {onBatchDeleteFromCustomCategories && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBatchDeleteFromCustomCategories}
              className="h-8 px-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10"
              title="从自建分类中移除所选项"
            >
              <Trash2 className="w-3.5 h-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">移除</span>
            </Button>
          )}

          {/* 5. 取消全部选择 */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClearSelection}
            className="h-8 w-8 rounded-xl text-muted-foreground hover:text-foreground ml-1"
            title="退出多选"
            aria-label="退出多选"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </aside>
  )
}
