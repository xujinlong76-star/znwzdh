'use client'

import React, { useState, useRef } from 'react'
import { WIDGET_REGISTRY } from '@/lib/modular/registry'
import { ModuleErrorBoundary } from '@/components/modular/module-error-boundary'
import { ModuleResizeHandles } from '@/components/modular/module-resize-handles'
import { useModuleWindowSize } from '@/lib/modular/module-resize-store'
import {
  Sparkles,
  ChevronUp,
  ChevronDown,
  Settings2,
  Check,
  RotateCcw,
  Layers,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useHomeDIY } from '@/lib/modular/use-home-diy'

const AVAILABLE_HERO_WIDGET_IDS = Object.keys(WIDGET_REGISTRY)

const HERO_COL_CLASS_MAP: Record<number, string> = {
  3: 'col-span-12 sm:col-span-6 lg:col-span-3',
  4: 'col-span-12 sm:col-span-6 lg:col-span-4',
  5: 'col-span-12 sm:col-span-6 lg:col-span-5',
  6: 'col-span-12 lg:col-span-6',
  7: 'col-span-12 lg:col-span-7',
  8: 'col-span-12 lg:col-span-8',
  9: 'col-span-12 lg:col-span-9',
  10: 'col-span-12 lg:col-span-10',
  11: 'col-span-12 lg:col-span-11',
  12: 'col-span-12',
}

function HeroDeckWidgetItem({
  type,
  totalWidgets,
  isEditing,
}: {
  type: string
  totalWidgets: number
  isEditing: boolean
}) {
  const def = WIDGET_REGISTRY[type]
  const cardRef = useRef<HTMLDivElement | null>(null)
  const defaultCol =
    totalWidgets === 1
      ? 12
      : totalWidgets === 2
        ? 6
        : totalWidgets === 3
          ? 4
          : (def?.defaultColSpan ?? 3) >= 6
            ? 6
            : 3

  const { colSpan, heightPx, setSize, resetSize } = useModuleWindowSize(
    `hero:${type}`,
    { colSpan: defaultCol }
  )

  if (!def) return null
  const WidgetComponent = def.component
  const colClass = HERO_COL_CLASS_MAP[colSpan] || 'col-span-12 sm:col-span-6 lg:col-span-3'

  return (
    <div
      ref={cardRef}
      style={heightPx ? { height: `${heightPx}px` } : undefined}
      className={`relative group @container rounded-2xl border border-border/70 hover:border-primary/40 bg-card/85 dark:bg-card/45 backdrop-blur-xs depth-card nav-card-glow transition-all duration-200 min-h-[160px] flex flex-col justify-between ${colClass}`}
    >
      <ModuleResizeHandles
        moduleRef={cardRef}
        colSpan={colSpan}
        minColSpan={3}
        maxColSpan={12}
        heightPx={heightPx}
        minHeightPx={160}
        maxHeightPx={640}
        isEditing={isEditing}
        onResizeChange={(next) => setSize(next)}
        onReset={resetSize}
      />
      <div className="flex-1 w-full min-h-0 overflow-hidden rounded-2xl flex flex-col justify-between">
        <ModuleErrorBoundary title={def.title}>
          <WidgetComponent config={{}} />
        </ModuleErrorBoundary>
      </div>
    </div>
  )
}

export function HomeHeroDeck() {
  const {
    isEditingLayout,
    isHeroDeckCollapsed,
    toggleHeroDeckCollapsed,
    heroDeckWidgets,
    setHeroDeckWidgets,
    resetDIYConfig,
  } = useHomeDIY()

  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [selectedWidgets, setSelectedWidgets] = useState<string[]>(heroDeckWidgets)

  // 打开配置弹窗时同步最新状态
  const handleOpenConfig = (open: boolean) => {
    if (open) {
      setSelectedWidgets(heroDeckWidgets)
    }
    setIsConfigOpen(open)
  }

  const handleToggleWidget = (type: string) => {
    setSelectedWidgets((prev) => {
      if (prev.includes(type)) {
        if (prev.length <= 1) return prev // 至少保留 1 个
        return prev.filter((id) => id !== type)
      } else {
        return [...prev, type]
      }
    })
  }

  const handleSaveConfig = () => {
    setHeroDeckWidgets(selectedWidgets)
    setIsConfigOpen(false)
  }

  const handleResetToDefault = () => {
    resetDIYConfig()
    setSelectedWidgets(['quick-search', 'clock-pomodoro', 'favorites-dock', 'quick-tools'])
    setIsConfigOpen(false)
  }

  return (
    <section className="mb-6 sm:mb-8 space-y-3 animate-in fade-in duration-200">
      {/* 展板顶部功能条 */}
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-lg bg-primary/10 text-primary">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <h2 className="text-xs sm:text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
            <span>极速启动展板</span>
            {isEditingLayout && (
              <span className="text-[11px] font-normal text-muted-foreground hidden sm:inline">
                (首屏即插即用 · 支持左右上下拖拉边框调整窗口大小)
              </span>
            )}
          </h2>
        </div>

        <div className="flex items-center gap-1">
          {/* 配置小组件弹窗触发器（仅在编辑模式下呈现） */}
          {isEditingLayout && (
            <Dialog open={isConfigOpen} onOpenChange={handleOpenConfig}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 px-2 text-xs rounded-lg text-muted-foreground hover:text-foreground gap-1"
                  title="自定义首屏挂载组件"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">配置展板</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md p-5 rounded-2xl glass-surface depth-modal">
                <DialogHeader>
                  <DialogTitle className="text-sm font-bold flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary" />
                    <span>自定义首屏极速启动展板</span>
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    勾选您希望在首页首屏快速呈现的功能组件。所选模块将以自适应栅格优雅排布。
                  </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 py-3 max-h-[360px] overflow-y-auto no-scrollbar">
                  {AVAILABLE_HERO_WIDGET_IDS.map((type) => {
                    const def = WIDGET_REGISTRY[type]
                    if (!def) return null
                    const isChecked = selectedWidgets.includes(type)
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => handleToggleWidget(type)}
                        className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-left transition-all ${
                          isChecked
                            ? 'border-primary/50 bg-primary/10 text-primary font-medium'
                            : 'border-border/60 hover:border-border hover:bg-muted/40 text-muted-foreground'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 mt-0.5 ${
                            isChecked ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate text-foreground" title={def.title}>{def.title}</div>
                          <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                            {def.description}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border/50">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleResetToDefault}
                    className="min-h-11 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>恢复默认</span>
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsConfigOpen(false)}
                      className="min-h-11 px-3 text-xs rounded-xl"
                    >
                      取消
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveConfig}
                      className="min-h-11 px-3.5 text-xs rounded-xl font-medium"
                    >
                      保存配置
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}

          {/* 折叠/展开按钮 */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleHeroDeckCollapsed}
            className="min-h-11 px-2 text-xs rounded-lg text-muted-foreground hover:text-foreground gap-1"
            title={isHeroDeckCollapsed ? '展开首屏展板' : '收起首屏展板'}
          >
            {isHeroDeckCollapsed ? (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">展开展板</span>
              </>
            ) : (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">收起展板</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 展板内容区域 */}
      {isHeroDeckCollapsed ? (
        /* 折叠后的轻量微胶囊栏 —— 本身就是一个按钮，键盘也能展开 */
        <button
          type="button"
          onClick={toggleHeroDeckCollapsed}
          className="w-full text-left flex items-center justify-between p-2.5 px-4 rounded-xl border border-dashed border-border/70 hover:border-primary/40 bg-card/50 hover:bg-card/80 backdrop-blur-xs cursor-pointer transition-all text-xs text-muted-foreground group"
        >
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>首屏极速启动展板已收起</span>
            <span className="text-muted-foreground hidden sm:inline">
              · 已挂载 {heroDeckWidgets.length} 个快捷小组件
            </span>
          </div>
          <span className="text-xs text-primary group-hover:underline flex items-center gap-1 font-medium">
            <span>点击展开</span>
            <ChevronDown className="w-3 h-3" />
          </span>
        </button>
      ) : (
        /* 展开后的 12 栅格自适应容器 */
        <div
          className="grid grid-cols-12 transition-all duration-300"
          style={{ gap: 'var(--density-grid-gap, 1rem)' }}
        >
          {heroDeckWidgets.map((type) => (
            <HeroDeckWidgetItem
              key={type}
              type={type}
              totalWidgets={heroDeckWidgets.length}
              isEditing={isEditingLayout}
            />
          ))}
        </div>
      )}
    </section>
  )
}
