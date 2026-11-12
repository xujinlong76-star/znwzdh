'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useModularLayout } from '@/lib/modular/use-modular-layout'
import type { WidgetInstance } from '@/types/modular'
import { WIDGET_REGISTRY } from '@/lib/modular/registry'
import { ModularItem } from './modular-item'
import { ModuleLibraryModal } from './module-library-modal'
import { TemplateModal } from './template-modal'
import { AiCanvasGeneratorModal } from './ai-canvas-generator-modal'
import { WidgetConfigModal } from './widget-config-modal'
import { 
  Plus, 
  SlidersHorizontal, 
  Check, 
  RotateCcw, 
  LayoutTemplate, 
  Download, 
  Upload, 
  Sparkles,
  Grid,
  Layers,
  Trash2,
  Undo2,
  Redo2,
  Palette,
  Package,
  AlertTriangle
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { DensityToggle } from '@/components/density-toggle'
import { takeStagedWorkspacePreset } from '@/lib/plugins/preset-staging'
import { formatLayoutReport, type NoticeTone } from '@/lib/modular/layout-report'
import { ExportPluginModal } from '@/components/plugins/export-plugin-modal'
import {
  DiyDragProvider,
  DiyDroppableZone,
  DiySortableWidget,
  readDiyDragData,
} from '@/components/diy/diy-drag-kit'
import type { DragEndEvent } from '@dnd-kit/react'
import { DiyRglGrid } from '@/components/diy/diy-rgl-grid'
import {
  GRID_COLS,
  applyGridLayoutToWidgets,
  planOrderMoves,
  type GridItem,
} from '@/lib/modular/grid-layout'

export function ModularCanvas() {
  const {
    boards,
    activeBoardId,
    currentBoard,
    widgets,
    isEditing,
    setIsEditing,
    initialized,
    addWidget,
    removeWidget,
    reorderWidgets,
    shiftWidget,
    resizeWidget,
    beginInteraction,
    updateWidgetConfig,
    applyTemplate,
    resetToDefault,
    createBoard,
    switchBoard,
    deleteBoard,
    exportLayoutJson,
    importLayoutJson,
    compactLayout,
    installWidgetPreset,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useModularLayout()

  const [isLibraryOpen, setIsLibraryOpen] = useState(false)
  const [isTemplateOpen, setIsTemplateOpen] = useState(false)
  const [isAiGenOpen, setIsAiGenOpen] = useState(false)
  const [isExportPluginOpen, setIsExportPluginOpen] = useState(false)
  const [configTargetWidget, setConfigTargetWidget] = useState<any | null>(null)
  const [exportNotice, setExportNotice] = useState<{ text: string; tone: NoticeTone } | null>(null)
  const [isCreatingBoard, setIsCreatingBoard] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const [canvasBg, setCanvasBg] = useState<'dots' | 'grid' | 'aurora' | 'clean'>('dots')

  /**
   * 浮层提示：措辞之外还带配色，导入这类「可能少了一部分」的结果必须用 warn。
   * 定时器收进 ref：连续两次提示时，前一次的 timeout 不能把后一条刚冒出来的
   * 告警提前抹掉（原来每个调用点各挂一个 setTimeout，重叠时长的确会串）。
   */
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showNotice = useCallback((text: string, tone: NoticeTone = 'ok', ms = 2500) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    setExportNotice({ text, tone })
    noticeTimerRef.current = setTimeout(() => {
      setExportNotice(null)
      noticeTimerRef.current = null
    }, ms)
  }, [])
  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    }
  }, [])

  // 初始化画布背景样式偏好
  useEffect(() => {
    try {
      const savedBg = localStorage.getItem('navhub_modular_bg_style')
      if (savedBg && ['dots', 'grid', 'aurora', 'clean'].includes(savedBg)) {
        setCanvasBg(savedBg as any)
      }
    } catch {
      // 读不到就沿用默认画布背景：纯外观偏好，不值得打扰用户
    }
  }, [])

  // 插件市场：消费暂存的工作台预设（详情页安装后写入，仅消费一次；
  // 必须等 initialized，否则会被 hydrate 的阶段覆盖掉）
  useEffect(() => {
    if (!initialized) return
    const staged = takeStagedWorkspacePreset()
    if (!staged) return
    // 逐因措辞：装了 3 个看板却只留下 1 个时，不能只说「安装成功」
    const report = installWidgetPreset(staged.payload, staged.mode ?? 'append')
    const notice = formatLayoutReport(report, `插件「${staged.name}」`)
    // 「可切换看板查看」只在真有新看板时才有意义，失败时留着只会误导
    showNotice(report.ok ? `${notice.text}，可切换看板查看` : notice.text, notice.tone, 5000)
  }, [initialized, installWidgetPreset, showNotice])

  // 画布背景风格切换
  const handleSelectBg = (bg: 'dots' | 'grid' | 'aurora' | 'clean') => {
    setCanvasBg(bg)
    try {
      localStorage.setItem('navhub_modular_bg_style', bg)
    } catch {
      // 写盘失败只影响「下次打开还记得」：本次切换已经生效
    }
  }

  // 打开模块配置弹窗（useCallback：传给 memo 化的 ModularItem）
  const handleOpenConfig = useCallback((w: WidgetInstance) => {
    setConfigTargetWidget(w)
  }, [])

  /** 撤销 / 重做：按钮与 Ctrl+Z 共用，操作完报一声（读屏用户否则不知道成功没） */
  const handleUndo = useCallback(() => {
    if (!canUndo) return
    undo()
    showNotice('已撤销上一步操作')
  }, [canUndo, undo, showNotice])

  const handleRedo = useCallback(() => {
    if (!canRedo) return
    redo()
    showNotice('已重做操作')
  }, [canRedo, redo, showNotice])

  // 快捷键支持：Ctrl+Z (撤销) 与 Ctrl+Y / Ctrl+Shift+Z (重做)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault()
          handleRedo()
        } else {
          e.preventDefault()
          handleUndo()
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault()
        handleRedo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo])

  /**
   * RGL 网格布局提交（DRAG-2）：拖拽/缩放结束时一次写盘。
   *
   * 撤销只记一步的写法（W4 + W5）：
   *  - 拖拽开始时 onDragStart 已 beginInteraction 压过一份拖拽前快照；
   *  - 这里先做顺序移动、再做尺寸：顺序移动走 reorderWidgets(..., false)，
   *    不再每步推一条中间态历史——一次拖拽带出多步 planOrderMoves（RGL 压实
   *    顶开多个组件）时，撤销也只有一步（回到 beginInteraction 那份快照）；
   *    尺寸走 resizeWidget(..., recordHistory=false) 不再推历史。
   *    单步拖拽同样只有 beginInteraction 那一份快照，一步撤销回到拖拽前。
   *  - 窄屏断点下 RGL 的 w 是断点相对值：只提交顺序，不写回尺寸。
   *  - 注意：没有「整表 setWidgets」入口可用（use-modular-layout
   *    只暴露单步 reorder/resize），所以不用全量替换。
   */
  const commitGridLayout = useCallback(
    (layout: GridItem[], cols: number = GRID_COLS) => {
      const next = applyGridLayoutToWidgets(widgets, layout, cols)
      // 窄屏断点下 RGL 的 w/h 是断点相对值（2 列里的 2 ≠ 12 列里的 2），
      // 只提交顺序，不写回尺寸，否则一次手机拖动会把组件永久缩成 2 列。
      const sized =
        cols === GRID_COLS
          ? next
          : next.map((w) => {
              const prev = widgets.find((item) => item.id === w.id)
              return prev ? { ...w, colSpan: prev.colSpan, rowSpan: prev.rowSpan } : w
            })
      const widgetTitle = (w: { id: string; type: string; customTitle?: string }) =>
        w.customTitle || WIDGET_REGISTRY[w.type]?.title || w.id
      // 先顺序、后尺寸（见上：第一次 reorder 推的快照就是拖拽前状态）。
      const moves = planOrderMoves(
        widgets.map((w) => w.id),
        sized.map((w) => w.id),
      )
      for (const [from, to] of moves) reorderWidgets(from, to, false)
      let resizedWidget: { id: string; type: string; customTitle?: string; colSpan: number; rowSpan: number } | null = null
      for (const w of sized) {
        const prev = widgets.find((item) => item.id === w.id)
        if (prev && (prev.colSpan !== w.colSpan || prev.rowSpan !== w.rowSpan)) {
          resizeWidget(w.id, w.colSpan, w.rowSpan, false)
          resizedWidget ??= w
        }
      }
      // 读屏播报：RGL 拖拽不走 dnd-kit，provider 的 live-region 报不到，
      // 这里用画布已有的 showNotice（role=status）报一次；没变化不报。
      if (moves.length > 0 || resizedWidget) {
        const parts: string[] = []
        if (moves.length > 0) {
          // 第一个顺序发生变化的位置就是被搬动的组件落点
          const movedIndex = sized.findIndex((w, i) => widgets[i]?.id !== w.id)
          const moved = movedIndex >= 0 ? sized[movedIndex] : undefined
          if (moved) {
            parts.push(`已将「${widgetTitle(moved)}」移到第 ${movedIndex + 1} 个，共 ${sized.length} 个`)
          }
        }
        if (resizedWidget) {
          parts.push(`已将「${widgetTitle(resizedWidget)}」调整为 ${resizedWidget.colSpan} 列 × ${resizedWidget.rowSpan} 行`)
        }
        showNotice(parts.join('，'))
      }
    },
    [widgets, resizeWidget, reorderWidgets, showNotice],
  )

  /** RGL 拖拽开始：压一份快照，整段拖拽 = 一步撤销（缩放同理，见下） */
  const handleGridDragStart = useCallback(() => {
    beginInteraction()
  }, [beginInteraction])

  /** RGL 缩放开始：压一份快照，整段缩放 = 一步撤销 */
  const handleGridResizeStart = useCallback(() => {
    beginInteraction()
  }, [beginInteraction])

  /** 小组件 ↑/↓ 移位：单步 reorder（一次历史），用画布 notice 播报位置 */
  const handleShiftWidget = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const widget = widgets[index]
      if (!widget) return
      const title = widget.customTitle || WIDGET_REGISTRY[widget.type]?.title || widget.id
      const toIndex = direction === 'up' ? index - 1 : index + 1
      if (toIndex < 0 || toIndex >= widgets.length) return
      shiftWidget(index, direction)
      showNotice(
        `已将「${title}」${direction === 'up' ? '上移' : '下移'}，现在是第 ${toIndex + 1} 个，共 ${widgets.length} 个`,
      )
    },
    [widgets, shiftWidget, showNotice],
  )

  /**
   * dnd-kit 落点处理（触屏/键盘排序通道 + 调色板拖入）。
   *
   *  - widget → widget：单步 reorderWidgets（一次历史）；
   *  - palette-widget → canvas-grid：调色板拖入，addWidget 落盘。
   *    调色板弹窗本身不在本次文件范围内：它只需把条目挂成
   *    useDraggable({ data: { kind: 'palette-widget', widgetType, title } })
   *    即可接线（见 diy-drag.ts 的 DiyPaletteDragData）。
   */
  const handleWidgetDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (event.canceled) return
      const source = readDiyDragData(event.operation.source)
      const target = readDiyDragData(event.operation.target)
      if (source?.kind === 'widget' && target?.kind === 'widget' && source.widgetId !== target.widgetId) {
        reorderWidgets(source.index, target.index)
        return
      }
      const targetKind = (event.operation.target?.data as { kind?: string } | undefined)?.kind
      if (source?.kind === 'palette-widget' && targetKind === 'canvas-grid') {
        addWidget(source.widgetType)
      }
    },
    [reorderWidgets, addWidget],
  )

  // 创建新看板
  const handleCreateBoardSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newBoardName.trim()) return
    createBoard(newBoardName)
    setNewBoardName('')
    setIsCreatingBoard(false)
    showNotice(`已创建并激活新看板「${newBoardName}」`)
  }

  // 导出 JSON
  const handleExport = () => {
    const json = exportLayoutJson()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `navhub-boards-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    // 延迟回收：个别浏览器（旧 Safari）下载是异步读取 blob 的，立即 revoke 会截断文件
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    // 报条数而不是「全部」：导入侧会剔掉下线的模块，用户需要知道这次带走的是几个看板
    showNotice(`已导出 ${boards.length} 个看板的配置`)
  }

  // 一键导出为工作台预设插件清单向导 (workspace-preset)
  const handleExportAsPlugin = () => {
    setIsExportPluginOpen(true)
  }

  // 导入 JSON
  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (event) => {
        const text = String(event.target?.result || '')
        // 台账直接进措辞：剔掉了几个模块、几个看板被清空，都必须说得出数
        const notice = formatLayoutReport(importLayoutJson(text), '工作台配置')
        showNotice(notice.text, notice.tone, 5000)
      }
      reader.readAsText(file)
    }
    input.click()
  }

  if (!initialized) {
    return (
      // 与动态 loading 占位保持同高：初始化只差一次 effect，若此处塌回 py-20，
      // 页脚仍会跟着画布高度跳变，白白多记一次 layout shift。
      <div className="min-h-[100vh] py-20 flex flex-col items-center justify-center space-y-3 text-muted-foreground">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-mono">正在加载自定义模块化排版系统...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/*
        * dnd-kit provider 抬到整个画布 return 的最外层：画布网格落点
        * （canvas-grid）与模块库弹窗里的调色板拖入源必须共用同一个
        * DragDropProvider，源和落点分属两个 provider 就接不上。
        * provider 本身不渲染可见内容，只提供拖拽上下文与播报。
        */}
      <DiyDragProvider enableCardDrops={false} onDragEnd={handleWidgetDragEnd}>
      {/* 多看板工作区切换标签栏 (Multi-Board Switcher) */}
      <div className="flex items-center justify-between gap-3 overflow-x-auto no-scrollbar touch-pan-x pb-1.5 border-b border-border/50 text-xs">
        <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
          <div className="flex items-center gap-1 text-muted-foreground mr-1 text-xs font-mono shrink-0">
            <Layers className="w-3.5 h-3.5 text-primary" />
            <span>我的工作台:</span>
          </div>
          {boards.map((b) => (
            <div key={b.id} className="flex items-center group/tab shrink-0">
              <button
                onClick={() => switchBoard(b.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  activeBoardId === b.id
                    ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                    : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>{b.name}</span>
                {/* 不要再叠 opacity：muted 前景色本身已是 AA 下限，75% 透明度会把 12px 计数压到 2.91:1 */}
                <span className="text-xs font-mono">({b.widgets.length})</span>
              </button>
              {isEditing && boards.length > 1 && (
                <button
                  onClick={() => deleteBoard(b.id)}
                  className="p-1 text-muted-foreground hover:text-red-500 transition-opacity ml-0.5 opacity-50 sm:opacity-0 sm:group-hover/tab:opacity-100"
                  title="删除此看板"
                  aria-label={`删除看板：${b.name}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}

          {/* 新建看板表单/按钮 */}
          {isEditing && (
            isCreatingBoard ? (
              <form onSubmit={handleCreateBoardSubmit} className="flex items-center gap-1">
                <input aria-label="看板名称"
                  type="text"
                  autoFocus
                  placeholder="看板名称..."
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  className="h-7 px-2 text-base sm:text-xs rounded-lg border border-border bg-background outline-none focus:ring-1 focus:ring-primary w-28"
                />
                <Button size="sm" type="submit" className="h-7 px-2 text-xs rounded-lg">
                  确定
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  className="h-7 px-2 text-xs rounded-lg"
                  onClick={() => setIsCreatingBoard(false)}
                >
                  取消
                </Button>
              </form>
            ) : (
              <button
                onClick={() => setIsCreatingBoard(true)}
                className="px-2.5 py-1.5 rounded-xl border border-dashed border-border/80 hover:border-primary/60 text-muted-foreground hover:text-foreground text-xs flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3 h-3" />
                <span>新建工作台</span>
              </button>
            )
          )}
        </div>
      </div>

      {/* 顶部控制栏与操作工具箱 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border border-border/80 glass-surface shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
            <Grid className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-foreground">
                {currentBoard.name}
              </h2>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                12 栅格自适应
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {isEditing
                ? '💡 编辑模式：鼠标拖动卡片换位、右下角手柄缩放；触屏与键盘用卡片左上角手柄拖动（空格开始，方向键移动，回车放下），或用 ⬆️/⬇️ 按钮移动'
                : '模块沙箱独立运行，点击右侧按钮开启自由排版'}
            </p>
          </div>
        </div>

        {/* 快捷操作胶囊按钮组 */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          {/* 画布背景风格切换 */}
          <div className="flex items-center gap-1 border border-border/60 rounded-xl p-0.5 bg-background/50 text-xs">
            <Palette className="w-3 h-3 text-muted-foreground ml-1 mr-0.5" />
            <button
              onClick={() => handleSelectBg('dots')}
              className={`px-1.5 py-0.5 rounded-lg transition-colors ${
                canvasBg === 'dots' ? 'bg-primary/15 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="赛博点阵画布"
            >
              点阵
            </button>
            <button
              onClick={() => handleSelectBg('grid')}
              className={`px-1.5 py-0.5 rounded-lg transition-colors ${
                canvasBg === 'grid' ? 'bg-primary/15 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="工程网格画布"
            >
              网格
            </button>
            <button
              onClick={() => handleSelectBg('aurora')}
              className={`px-1.5 py-0.5 rounded-lg transition-colors ${
                canvasBg === 'aurora' ? 'bg-primary/15 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="极光微光画布"
            >
              极光
            </button>
            <button
              onClick={() => handleSelectBg('clean')}
              className={`px-1.5 py-0.5 rounded-lg transition-colors ${
                canvasBg === 'clean' ? 'bg-primary/15 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="纯净底色"
            >
              纯净
            </button>
          </div>

          {isEditing && (
            <>
              {/* 撤销 / 重做按钮组 */}
              <div className="flex items-center gap-0.5 border border-border/60 rounded-xl p-0.5 bg-background/50">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-30"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  title="撤销历史操作 (Ctrl+Z)"
                  aria-label="撤销上一步操作"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-30"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  title="重做撤销操作 (Ctrl+Y / Ctrl+Shift+Z)"
                  aria-label="重做撤销的操作"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </Button>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs rounded-xl gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                onClick={() => setIsLibraryOpen(true)}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>添加模块</span>
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs rounded-xl gap-1.5"
                onClick={() => setIsTemplateOpen(true)}
              >
                <LayoutTemplate className="w-3.5 h-3.5" />
                <span>套用模版</span>
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs rounded-xl gap-1.5 border-purple-500/30 text-purple-700 dark:text-purple-400 hover:bg-purple-500/10 shadow-xs"
                onClick={() => setIsAiGenOpen(true)}
                title="一句话让 AI 智能规划专属工作台"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI 智能规划</span>
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs rounded-xl gap-1.5 border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                onClick={() => {
                  compactLayout()
                  // 只报「重排了几个模块」：单个模块时 compactLayout 是空操作，
                  // 「消除了多余空间碎片」这种断言没法验证，也不该写。
                  showNotice(`已按 12 栅格重排当前 ${widgets.length} 个模块`)
                }}
                title="自动紧凑排版：根据 12 栅格行容器贪心重排，消除空隙"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>智能紧凑</span>
              </Button>

              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs rounded-xl text-muted-foreground hover:text-foreground"
                onClick={resetToDefault}
                title="重置为默认模版"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>

              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs rounded-xl gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                onClick={handleExportAsPlugin}
                title="导出为插件市场规范的工作台预设清单（.json）"
              >
                <Package className="w-3.5 h-3.5" />
                <span>导出为插件</span>
              </Button>

              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs rounded-xl text-muted-foreground hover:text-foreground"
                onClick={handleExport}
                title="导出为 JSON 备份"
              >
                <Download className="w-3.5 h-3.5" />
              </Button>

              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs rounded-xl text-muted-foreground hover:text-foreground"
                onClick={handleImport}
                title="导入 JSON 配置文件"
              >
                <Upload className="w-3.5 h-3.5" />
              </Button>
            </>
          )}

          {/* 内容排版密度矩阵切换 */}
          <DensityToggle className="h-8 w-8" />

          {/* 切换编辑模式主按钮 */}
          <Button
            size="sm"
            className={`h-8 px-3.5 text-xs rounded-xl gap-1.5 font-medium shadow-xs transition-all ${
              isEditing
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-primary text-primary-foreground hover:opacity-90'
            }`}
            onClick={() => setIsEditing(!isEditing)}
          >
            {isEditing ? <Check className="w-3.5 h-3.5" /> : <SlidersHorizontal className="w-3.5 h-3.5" />}
            <span>{isEditing ? '完成排版' : '自定义排版'}</span>
          </Button>
        </div>
      </div>

      {/* 提示消息浮层：导入/安装的告警必须是琥珀色，绿色只留给一条没丢的结果 */}
      {exportNotice && (
        <div
          className={
            exportNotice.tone === 'warn'
              ? 'p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs flex items-start gap-2 animate-in fade-in duration-150'
              : 'p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs flex items-start gap-2 animate-in fade-in duration-150'
          }
          role={exportNotice.tone === 'warn' ? 'alert' : 'status'}
        >
          {exportNotice.tone === 'warn' ? (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{exportNotice.text}</span>
        </div>
      )}

      {/* 12 栅格自适应主画布 */}
      {widgets.length === 0 ? (
        <div className="p-12 rounded-2xl border-2 border-dashed border-border/80 text-center space-y-3 glass-surface">
          <div className="w-12 h-12 rounded-2xl bg-muted/50 mx-auto flex items-center justify-center text-muted-foreground">
            <Grid className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">当前工作台为空</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              当前看板中没有小组件。可点击下方按钮添加常用功能模块，或直接套用预设模版。
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button size="sm" onClick={() => setIsLibraryOpen(true)} className="gap-1.5 text-xs rounded-xl">
              <Plus className="w-3.5 h-3.5" />
              <span>选择并添加模块</span>
            </Button>
            <Button size="sm" variant="outline" onClick={resetToDefault} className="text-xs rounded-xl">
              恢复默认模版
            </Button>
          </div>
        </div>
      ) : (
        <div className={`p-2.5 sm:p-4 rounded-3xl border border-border/50 transition-all duration-300 ${
          canvasBg === 'dots'
            ? 'bg-[radial-gradient(#80808020_1px,transparent_1px)] [background-size:16px_16px]'
            : canvasBg === 'grid'
            ? 'bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]'
            : canvasBg === 'aurora'
            ? 'relative before:absolute before:inset-0 before:bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] before:from-primary/10 before:via-transparent before:to-transparent before:pointer-events-none'
            : ''
        }`}>
          {/*
            * 外层 Bento 网格（DRAG-2）：CSS grid + HTML5 DnD + 手写触控长按
            * 全部退役，改走 RGL v2（鼠标拖拽/缩放）+ dnd-kit sortable
            * （触屏/键盘拖拽，手柄在卡片左上角）。
            * RGL 只管外层定位；内层 DiySortableWidget 包着 ModularItem，
            * 两套 transform 各管一层（见 diy-rgl-grid / diy-drag-kit）。
            * ModularItem 的原生拖拽 props（draggable/onDragStart/
            * onDragOver/onDragEnd）已从接口里删掉，画布不再传原生
            * 拖拽处理函数，无需再用 preventDefault 中和。
            */}
          <DiyDroppableZone id="canvas-grid" data={{ kind: 'canvas-grid' }}>
              <DiyRglGrid
                widgets={widgets}
                isEditing={isEditing}
                onDragStart={handleGridDragStart}
                onResizeStart={handleGridResizeStart}
                onCommitLayout={commitGridLayout}
                renderItem={(widget, index) => (
                  <DiySortableWidget
                    data={{
                      kind: 'widget',
                      widgetId: widget.id,
                      index,
                      title:
                        widget.customTitle ||
                        WIDGET_REGISTRY[widget.type]?.title ||
                        widget.id,
                    }}
                    group="canvas-widgets"
                    disabled={!isEditing}
                  >
                    <ModularItem
                      widget={widget}
                      index={index}
                      totalWidgets={widgets.length}
                      isEditing={isEditing}
                      onRemove={removeWidget}
                      onResize={resizeWidget}
                      onBeginInteraction={beginInteraction}
                      onShiftPosition={handleShiftWidget}
                      onOpenConfig={handleOpenConfig}
                    />
                  </DiySortableWidget>
                )}
              />
            </DiyDroppableZone>

          {isEditing && (
            <button
              type="button"
              onClick={() => setIsLibraryOpen(true)}
              className="mt-4 w-full min-h-[64px] rounded-2xl border-2 border-dashed border-border/80 hover:border-primary/60 hover:bg-primary/5 transition-all flex items-center justify-center gap-2 text-muted-foreground hover:text-primary group shadow-2xs"
            >
              <div className="w-8 h-8 rounded-xl bg-muted/60 group-hover:bg-primary/10 flex items-center justify-center transition-colors">
                <Plus className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
              </div>
              <span className="text-xs font-semibold">添加更多功能模块</span>
              <span className="text-xs text-muted-foreground">浏览 {Object.keys(WIDGET_REGISTRY).length} 大组件库</span>
            </button>
          )}
        </div>
      )}


      {/* 模块配置弹窗 */}
      <WidgetConfigModal
        widget={configTargetWidget}
        isOpen={Boolean(configTargetWidget)}
        onClose={() => setConfigTargetWidget(null)}
        onSaveConfig={updateWidgetConfig}
      />

      {/* 模块库弹窗 */}
      <ModuleLibraryModal
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        onAddModule={addWidget}
      />

      {/* 预设模版弹窗 */}
      <TemplateModal
        isOpen={isTemplateOpen}
        onClose={() => setIsTemplateOpen(false)}
        onApplyTemplate={applyTemplate}
      />

      {/* AI 智能生成工作台弹窗 */}
      <AiCanvasGeneratorModal
        isOpen={isAiGenOpen}
        onClose={() => setIsAiGenOpen(false)}
        onApplyLayout={(layout, mode) => {
          const report = installWidgetPreset(
            {
              boards: [
                {
                  name: layout.title || 'AI 规划工作台',
                  widgets: layout.widgets.map((w) => ({
                    type: w.type,
                    customTitle: w.customTitle,
                    colSpan: w.colSpan,
                    rowSpan: w.rowSpan,
                    config: w.config,
                  })),
                },
              ],
            },
            mode === 'replace' ? 'replace' : 'append',
          )
          // AI 会编出注册表里根本没有的模块类型，以前一律报「已成功套用」；
          // 现在按台账说：一个都没落地就是「导入失败」，不是成功。
          const notice = formatLayoutReport(report, `AI 规划「${layout.title || '工作台'}」`)
          showNotice(notice.text, notice.tone, 5000)
        }}
      />

      {/* 导出为插件市场清单向导弹窗 */}
      <ExportPluginModal
        open={isExportPluginOpen}
        onOpenChange={setIsExportPluginOpen}
        kind="workspace-preset"
        defaultName={currentBoard ? `${currentBoard.name} 看板预设` : '我的工作台预设'}
        defaultDescription={`包含 ${boards.length} 个看板的工作台预设配置，由山羊胡工作台一键导出。`}
        defaultTags={['工作台', '预设', '看板']}
        payload={{
          boards: boards.map((b) => ({
            name: b.name,
            widgets: b.widgets.map((w) => ({
              type: w.type,
              customTitle: w.customTitle,
              colSpan: w.colSpan,
              rowSpan: w.rowSpan,
              config: w.config,
            })),
          })),
        }}
      />
      </DiyDragProvider>
    </div>
  )
}
