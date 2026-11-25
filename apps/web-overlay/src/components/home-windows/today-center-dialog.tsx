'use client'

/**
 * 「今日与效率中心」融合多标签小窗口（P0 效率三合一）：
 *   1. 今日概览（专注与提醒 / 今日简报 / 考试日历 / 接力与连胜）；
 *   2. 桌面小组件盒（番茄钟 / 天气时钟 / 便签 / 钉到桌面角落 / 切换工作台）；
 *   3. 开发者极速微工具（JSON / Base64 / UUID & 时间戳 / URL / JWT / Cron / Curl）。
 *
 * 顶栏从此只需保留 1 个「📅 今日与效率」入口，首页正文占 0 行，组件全部按需懒加载。
 */
import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  CalendarDays,
  ExternalLink,
  Flame,
  Newspaper,
  Puzzle,
  Sparkles,
  Wrench,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/registry/new-york/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/registry/new-york/ui/tabs'

const LazyWidgetBoxBody = dynamic(
  () => import('@/components/home-windows/widget-box-dialog').then((m) => m.WidgetBoxBody),
  { ssr: false, loading: () => <div className="h-56 animate-pulse rounded-xl bg-muted/40" /> },
)
const LazyQuickToolsBody = dynamic(
  () => import('@/components/quick-tools-drawer').then((m) => m.QuickToolsBody),
  { ssr: false, loading: () => <div className="h-56 animate-pulse rounded-xl bg-muted/40" /> },
)

export type TodayCenterTab = 'focus' | 'brief' | 'exam' | 'handoff' | 'widgets' | 'tools'

export interface TodayCenterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  todayContent: ReactNode
  briefContent: ReactNode
  examContent: ReactNode
  handoffContent: ReactNode
  countdownLabel?: string | null
  todayCount?: number
  pinnedWidgetCount?: number
  defaultTab?: TodayCenterTab
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
  pinnedWidgetCount = 0,
  defaultTab = 'focus',
}: TodayCenterDialogProps) {
  const [activeTab, setActiveTab] = useState<TodayCenterTab>(defaultTab)

  useEffect(() => {
    if (open) setActiveTab(defaultTab)
  }, [open, defaultTab])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[740px] w-[calc(100vw-1.5rem)] max-h-[85vh] flex flex-col gap-3 p-4 sm:p-5 overflow-hidden">
        <DialogHeader className="shrink-0 pr-8 text-left">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <CalendarDays className="h-4 w-4 text-primary" />
              <span>今日与效率中心</span>
            </DialogTitle>
            {countdownLabel ? (
              <span className="inline-flex items-center rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {countdownLabel}
              </span>
            ) : null}
            {todayCount > 0 ? (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                今日 {todayCount} 项
              </span>
            ) : null}
            {pinnedWidgetCount > 0 ? (
              <span className="inline-flex items-center rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                已钉 {pinnedWidgetCount} 微件
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <DialogDescription className="text-xs text-muted-foreground">
              融合今日专注/简报/考试/接力、桌面小组件与极客微工具（快捷键 T）。
            </DialogDescription>
            <Link
              href={activeTab === 'brief' ? '/brief' : '/exam'}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              <span>{activeTab === 'brief' ? '完整每日简报' : '完整考试日历'}</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TodayCenterTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6 shrink-0 h-auto gap-1 p-1">
            <TabsTrigger value="focus" className="min-h-8 gap-1 px-1.5 py-1 text-xs">
              <Sparkles className="h-3.5 w-3.5 shrink-0 hidden sm:inline" />
              <span>专注提醒</span>
            </TabsTrigger>
            <TabsTrigger value="brief" className="min-h-8 gap-1 px-1.5 py-1 text-xs">
              <Newspaper className="h-3.5 w-3.5 shrink-0 hidden sm:inline" />
              <span>今日简报</span>
            </TabsTrigger>
            <TabsTrigger value="exam" className="min-h-8 gap-1 px-1.5 py-1 text-xs">
              <CalendarDays className="h-3.5 w-3.5 shrink-0 hidden sm:inline" />
              <span>考试日历</span>
            </TabsTrigger>
            <TabsTrigger value="handoff" className="min-h-8 gap-1 px-1.5 py-1 text-xs">
              <Flame className="h-3.5 w-3.5 shrink-0 hidden sm:inline" />
              <span>接力连胜</span>
            </TabsTrigger>
            <TabsTrigger value="widgets" className="min-h-8 gap-1 px-1.5 py-1 text-xs">
              <Puzzle className="h-3.5 w-3.5 shrink-0 hidden sm:inline" />
              <span>桌面微件</span>
            </TabsTrigger>
            <TabsTrigger value="tools" className="min-h-8 gap-1 px-1.5 py-1 text-xs">
              <Wrench className="h-3.5 w-3.5 shrink-0 hidden sm:inline" />
              <span>极客工具</span>
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
            <TabsContent value="widgets" className="mt-0 flex min-h-0 flex-col">
              {activeTab === 'widgets' ? (
                <LazyWidgetBoxBody onEnterWorkbench={() => onOpenChange(false)} />
              ) : null}
            </TabsContent>
            <TabsContent value="tools" className="mt-0">
              {activeTab === 'tools' ? <LazyQuickToolsBody /> : null}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
