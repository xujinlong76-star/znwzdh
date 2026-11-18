'use client'

/**
 * 桌面角落固定悬浮小窗（A3）：
 * 仅在用户主动勾选「钉到桌面角落」后按需懒挂载（ssr: false），0 首屏加载、0 静态重叠；
 * 支持单卡折叠为 36px 迷你胶囊，避免遮挡右下角回顶控件或手机底栏。
 */
import { Suspense } from 'react'
import { ChevronDown, ChevronUp, Pin, X } from 'lucide-react'
import { ModuleErrorBoundary } from '@/components/modular/module-error-boundary'
import { WIDGET_COMPONENTS, WIDGET_REGISTRY } from '@/lib/modular/registry'
import { usePinnedCornerWidgets } from '@/lib/modular/pinned-widgets-store'

export function PinnedCornerWidgets() {
  const { mounted, pinned, toggleCollapse, unpin } = usePinnedCornerWidgets()

  if (!mounted || pinned.length === 0) return null

  return (
    <aside
      aria-label="桌面角落固定微件"
      className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] lg:bottom-20 z-30 flex w-[min(300px,calc(100vw-2rem))] flex-col gap-2 pointer-events-none"
    >
      {pinned.map((entry) => {
        const def = WIDGET_REGISTRY[entry.type]
        const LazyWidget = WIDGET_COMPONENTS[entry.type]
        if (!def || !LazyWidget) return null

        return (
          <section
            key={entry.type}
            aria-label={`固定小组件：${def.title}`}
            className="pointer-events-auto overflow-hidden rounded-xl border border-border/80 bg-background/95 shadow-lg backdrop-blur-md"
          >
            <div className="flex h-9 items-center justify-between gap-1 border-b border-border/50 bg-muted/50 px-2.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <Pin className="h-3 w-3 shrink-0 text-primary" />
                <span className="truncate text-xs font-semibold text-foreground">
                  {def.title}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => toggleCollapse(entry.type)}
                  aria-label={entry.collapsed ? `展开${def.title}` : `收起${def.title}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground cursor-pointer"
                >
                  {entry.collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => unpin(entry.type)}
                  aria-label={`取消固定${def.title}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/15 hover:text-destructive-text cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {!entry.collapsed ? (
              <div className="max-h-[230px] overflow-y-auto p-2 text-xs">
                <ModuleErrorBoundary title={def.title} isEditing={false} onRemove={() => unpin(entry.type)}>
                  <Suspense fallback={<div className="h-28 w-full animate-pulse rounded-lg bg-muted/40" />}>
                    <LazyWidget config={{}} title={def.title} />
                  </Suspense>
                </ModuleErrorBoundary>
              </div>
            ) : null}
          </section>
        )
      })}
    </aside>
  )
}
