'use client'

/**
 * 「今日中心」按需小窗口（A2）：
 * 原先直接堆在首页正文中上方的 HomeTodayZone（663px~1330px）与 HomeTodayMore 4 条带，
 * 统一收拢进顶栏 `📅 今日` 按钮触发的 4 Tab 小窗口；首页正文占 0 行。
 */
import type { ReactNode } from 'react'
import Link from 'next/link'
import { CalendarDays, ExternalLink, Flame, Newspaper, Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/registry/new-york/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/registry/new-york/ui/tabs'

export interface TodayCenterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  todayContent: ReactNode
  briefContent: ReactNode
  examContent: ReactNode
  handoffContent: ReactNode
  countdownLabel?: string | null
  todayCount?: number
}

export function TodayCenterDialog({
  open,
  onOpenChange,
  todayContent,
  briefContent,
  examContent,
  handoffContent,
  countdownLabel,
  todayCount = 0,
}: TodayCenterDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[600px] w-[calc(100vw-1.5rem)] max-h-[82vh] flex flex-col gap-3 p-4 sm:p-5 overflow-hidden">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <CalendarDays className="h-4 w-4 text-primary" />
              <span>今日中心</span>
            </DialogTitle>
            {countdownLabel ? (
              <span className="inline-flex items-center rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {countdownLabel}
              </span>
            ) : null}
            {todayCount > 0 ? (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                今日 {todayCount} 项节点
              </span>
            ) : null}
            <Link
              href="/exam"
              className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10"
            >
              <span>完整考试日历</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            今日专注、考试提醒、热榜简报与接力连胜均收纳于此，随时弹出查看、用完即关。
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="focus" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="grid w-full grid-cols-4 shrink-0 h-auto p-1">
            <TabsTrigger value="focus" className="min-h-9 gap-1 px-1.5 py-1.5 text-xs">
              <Sparkles className="h-3.5 w-3.5 shrink-0 hidden sm:inline" />
              <span>专注与提醒</span>
            </TabsTrigger>
            <TabsTrigger value="brief" className="min-h-9 gap-1 px-1.5 py-1.5 text-xs">
              <Newspaper className="h-3.5 w-3.5 shrink-0 hidden sm:inline" />
              <span>今日简报</span>
            </TabsTrigger>
            <TabsTrigger value="exam" className="min-h-9 gap-1 px-1.5 py-1.5 text-xs">
              <CalendarDays className="h-3.5 w-3.5 shrink-0 hidden sm:inline" />
              <span>考试日历</span>
            </TabsTrigger>
            <TabsTrigger value="handoff" className="min-h-9 gap-1 px-1.5 py-1.5 text-xs">
              <Flame className="h-3.5 w-3.5 shrink-0 hidden sm:inline" />
              <span>接力与连胜</span>
            </TabsTrigger>
          </TabsList>

          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
            <TabsContent value="focus" className="mt-0 space-y-2 [&>*]:mx-0 [&>*]:px-0">
              {todayContent}
            </TabsContent>
            <TabsContent value="brief" className="mt-0 space-y-2 [&>*]:mx-0 [&>*]:px-0">
              {briefContent}
            </TabsContent>
            <TabsContent value="exam" className="mt-0 space-y-2 [&>*]:mx-0 [&>*]:px-0">
              {examContent}
            </TabsContent>
            <TabsContent value="handoff" className="mt-0 space-y-3 [&>*]:mx-0 [&>*]:px-0">
              {handoffContent}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
