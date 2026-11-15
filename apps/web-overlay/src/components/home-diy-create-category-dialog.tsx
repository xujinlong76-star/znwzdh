'use client'

import { FolderPlus } from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/registry/new-york/ui/dialog'
import { Input } from '@/registry/new-york/ui/input'

interface HomeDIYCreateCategoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  onTitleChange: (title: string) => void
  onCreate: () => void
}

/**
 * 新建专属分类对话框（从 home-diy-toolbar.tsx 抽出，守住工具栏 ≤900 行）。
 * 纯展示组件：分类创建逻辑（addCustomCategory + toast）仍由工具栏的
 * handleCreateCategory 持有，这里只负责表单与确认。
 */
export function HomeDIYCreateCategoryDialog({
  open,
  onOpenChange,
  title,
  onTitleChange,
  onCreate,
}: HomeDIYCreateCategoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-md p-4 sm:p-6">
        <DialogHeader className="pr-8 sm:pr-6">
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="w-5 h-5 text-emerald-500" />
            <span>创建首页专属私人分类</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            为您的日常工作或高频需求创建专属分类板块。创建后呈现在首页，支持自由置顶与添加站点。
          </DialogDescription>
        </DialogHeader>

        <div className="py-3 space-y-3">
          <div>
            <label htmlFor="diy-new-category-title" className="text-xs font-medium text-foreground block mb-1.5">
              分类名称
            </label>
            <Input
              id="diy-new-category-title"
              placeholder="例如：极客日常 / 深度学习速查 / 监控大盘"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onCreate()}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" className="min-h-11" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" className="min-h-11" onClick={onCreate} disabled={!title.trim()}>
            确认创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
