'use client'

/**
 * 「桌面小组件盒」按需小窗口（A3）：
 * 默认首页不再首屏铺开 5 张 528px 大卡片（HomeHeroDeck）；
 * 改为顶栏 `🧩 小组件` 打开轻量多 Tab 盒子，支持：
 *  1) 小窗内直接使用番茄专注、天气时钟、便签、意图算式等微件；
 *  2) 一键「📌 钉到桌面角落」（最多 2 个，持久化在 localStorage）；
 *  3) 一键「切换沉浸工作台」进入完整 12 栅格 ModularCanvas。
 */
import { Suspense, useState } from 'react'
import { LayoutGrid, Pin, PinOff, Puzzle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { ModuleErrorBoundary } from '@/components/modular/module-error-boundary'
import { WIDGET_COMPONENTS, WIDGET_REGISTRY } from '@/lib/modular/registry'
import {
  MAX_PINNED_CORNER_WIDGETS,
  usePinnedCornerWidgets,
} from '@/lib/modular/pinned-widgets-store'
import { useHomeDIY } from '@/lib/modular/use-home-diy'

const BOX_WIDGET_TYPES = [
  'clock-pomodoro',
  'weather-clock',
  'markdown-notes',
  'speculative-terminal',
  'favorites-dock',
  'quick-tools',
] as const

export interface WidgetBoxDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSwitchToWorkbench?: () => void
}

export interface WidgetBoxBodyProps {
  onEnterWorkbench?: () => void
  showWorkbenchAction?: boolean
}

export function WidgetBoxBody({
  onEnterWorkbench,
  showWorkbenchAction = true,
}: WidgetBoxBodyProps = {}) {
  const [selectedType, setSelectedType] = useState<string>('clock-pomodoro')
  const { pinned, togglePin } = usePinnedCornerWidgets()
  const { viewMode, setViewMode } = useHomeDIY()

  const activeDef = WIDGET_REGISTRY[selectedType] ?? WIDGET_REGISTRY['clock-pomodoro']
  const LazyWidget = Object.prototype.hasOwnProperty.call(WIDGET_COMPONENTS, selectedType)
    ? WIDGET_COMPONENTS[selectedType]
    : undefined
  const isPinned = pinned.some((item) => item.type === selectedType)

  const handleEnterWorkbench = () => {
    setViewMode('workbench')
    onEnterWorkbench?.()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {BOX_WIDGET_TYPES.map((type) => {
          const def = WIDGET_REGISTRY[type]
          if (!def) return null
          const active = selectedType === type
          const pinnedThis = pinned.some((item) => item.type === type)
          return (
            <button
              key={type}
              type="button"
              onClick={() => setSelectedType(type)}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/70 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <span>{def.title}</span>
              {pinnedThis ? <Pin className="h-3 w-3 text-primary" aria-label="已固定" /> : null}
            </button>
          )
        })}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">{activeDef?.title}</p>
          <p className="truncate text-[11px] text-muted-foreground">{activeDef?.description}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {showWorkbenchAction ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleEnterWorkbench}
              className="h-8 gap-1 text-xs"
            >
              <LayoutGrid className="h-3.5 w-3.5 text-primary" />
              <span>{viewMode === 'workbench' ? '当前工作台' : '沉浸工作台'}</span>
            </Button>
          ) : null}
          <Button
            type="button"
            variant={isPinned ? 'secondary' : 'default'}
            size="sm"
            onClick={() => togglePin(selectedType)}
            className="h-8 shrink-0 gap-1.5 text-xs"
          >
            {isPinned ? (
              <>
                <PinOff className="h-3.5 w-3.5" />
                <span>取消固定</span>
              </>
            ) : (
              <>
                <Pin className="h-3.5 w-3.5" />
                <span>钉到桌面角落</span>
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="min-h-[240px] flex-1 overflow-y-auto rounded-2xl border border-border/70 bg-card/60 p-2">
        {LazyWidget && activeDef ? (
          <ModuleErrorBoundary title={activeDef.title} isEditing={false} onRemove={() => undefined}>
            <Suspense fallback={<div className="h-48 w-full animate-pulse rounded-xl bg-muted/40" />}>
              <LazyWidget config={{}} title={activeDef.title} />
            </Suspense>
          </ModuleErrorBoundary>
        ) : null}
      </div>
    </div>
  )
}

export function WidgetBoxDialog({
  open,
  onOpenChange,
  onSwitchToWorkbench,
}: WidgetBoxDialogProps) {
  const { viewMode, setViewMode } = useHomeDIY()

  const handleEnterWorkbench = () => {
    setViewMode('workbench')
    onOpenChange(false)
    onSwitchToWorkbench?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px] w-[calc(100vw-1.5rem)] max-h-[84vh] flex flex-col gap-3 p-4 sm:p-5 overflow-hidden">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Puzzle className="h-4 w-4 text-primary" />
              <span>桌面小组件盒</span>
            </DialogTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleEnterWorkbench}
              className="ml-auto h-9 gap-1.5 text-xs"
            >
              <LayoutGrid className="h-3.5 w-3.5 text-primary" />
              <span>{viewMode === 'workbench' ? '当前已是工作台' : '切换沉浸工作台'}</span>
            </Button>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            小窗内随手使用常用效率组件，也可将最多 {MAX_PINNED_CORNER_WIDGETS} 个组件「钉到桌面角落」随时伴随。
          </DialogDescription>
        </DialogHeader>

        <WidgetBoxBody
          showWorkbenchAction={false}
          onEnterWorkbench={handleEnterWorkbench}
        />
      </DialogContent>
    </Dialog>
  )
}
