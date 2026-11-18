'use client'

/**
 * 「AI 智能找站」小窗口（234px 渐变大卡转小窗）：
 * 首页不直接堆砌整块渐变面板，改为微入口与搜索框呼出结果小窗。
 */
import Link from 'next/link'
import { ExternalLink, Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/registry/new-york/ui/dialog'
import { AiFinderPanel } from '@/components/ai/ai-finder-panel'

export interface AiFinderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sceneTrigger?: string | null
}

export function AiFinderDialog({
  open,
  onOpenChange,
  sceneTrigger,
}: AiFinderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[660px] w-[calc(100vw-1.5rem)] max-h-[82vh] flex flex-col gap-3 p-4 sm:p-5 overflow-hidden">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <div className="flex items-center gap-2">
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>AI 智能找站与场景工作台</span>
            </DialogTitle>
            <Link
              href="/scenes"
              className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10"
            >
              <span>全部场景</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            描述你想完成的任务或选择场景，即刻匹配本站工具与站外引擎，无需离开首页目录。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto [&>section]:mb-0 [&>section]:border-0 [&>section]:p-1 [&>section]:shadow-none [&>section]:bg-transparent">
          <AiFinderPanel key={sceneTrigger || 'default'} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
