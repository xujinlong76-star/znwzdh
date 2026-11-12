'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

/**
 * 新建工作空间弹窗（从 page.tsx 抽出，只为让 Radix Dialog 走动态加载）。
 *
 * /me/workspaces 首屏预算超 6 KB：Dialog（含 @radix-ui/react-dialog 及其
 * portal / focus-scope 依赖）只在用户点「新建空间」后才需要，首屏静态引入
 * 是纯死重。本文件由 page.tsx 经 next/dynamic 加载，且只在 createOpen 时
 * 才渲染，chunk 在首次点开时才下载。
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  description,
  onDescriptionChange,
  type,
  onTypeChange,
  isAnonymous,
  creating,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onNameChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
  type: 'personal' | 'team'
  onTypeChange: (value: 'personal' | 'team') => void
  isAnonymous: boolean
  creating: boolean
  onCreate: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">新建工作空间</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="ws-name" className="block text-xs font-medium text-muted-foreground">
              名称
            </label>
            <Input id="ws-name" value={name} maxLength={64} onChange={(e) => onNameChange(e.target.value)} className="h-9 text-xs" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ws-desc" className="block text-xs font-medium text-muted-foreground">
              描述（可选）
            </label>
            <Input id="ws-desc" value={description} maxLength={200} onChange={(e) => onDescriptionChange(e.target.value)} className="h-9 text-xs" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="ws-type" className="block text-xs font-medium text-muted-foreground">
              类型
            </label>
            <select
              id="ws-type"
              value={isAnonymous ? 'personal' : type}
              disabled={isAnonymous}
              onChange={(e) => onTypeChange(e.target.value as 'personal' | 'team')}
              className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs"
            >
              <option value="team">团队协作</option>
              <option value="personal">个人私有</option>
            </select>
            {isAnonymous && (
              <p className="text-[11px] text-muted-foreground">匿名身份只能创建个人空间；登录后可创建团队空间。</p>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="text-xs" disabled={creating || !name.trim()} onClick={onCreate}>
              {creating ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              创建
            </Button>
            <Button size="sm" variant="outline" className="text-xs" disabled={creating} onClick={() => onOpenChange(false)}>
              取消
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
