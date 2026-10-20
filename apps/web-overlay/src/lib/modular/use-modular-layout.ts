'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { WidgetInstance, ModularPageLayout } from '@/types/modular'
import { WIDGET_REGISTRY, PRESET_TEMPLATES, createWidgetInstance } from './registry'
import { sanitizeWidgetInstances } from './sanitize'
import { backupCorruptPayload } from './workspace-storage'
import { STORAGE_KEY } from './layout-storage'

export { STORAGE_KEY }
const LEGACY_STORAGE_KEY = 'navhub_modular_layout_v1'
/** 撤销栈深度上限：一次拖拽/缩放只算一步，25 步足够回退整段编辑 */
const HISTORY_LIMIT = 25

export interface Board {
  id: string
  name: string
  widgets: WidgetInstance[]
}

interface StoredWorkspaceState {
  version: number
  activeBoardId: string
  boards: Board[]
}

export function useModularLayout() {
  const [boards, setBoards] = useState<Board[]>([])
  const [activeBoardId, setActiveBoardId] = useState<string>('default')
  const [isEditing, setIsEditing] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [history, setHistory] = useState<Board[][]>([])
  const [future, setFuture] = useState<Board[][]>([])

  /**
   * boards / history / future 的 ref 镜像。
   *
   * 为什么需要：撤销、重做、删除看板、连续拖拽缩放都要求"一次事件里原子地
   * 读最新值 → 计算 → 一次性写回多个 state"。若沿用 setState updater 里
   * 嵌套调用其它 setState 的写法（本 hook 此前的实现），React 18 StrictMode
   * 下 updater 会被双跑，future / history 被重复入栈——表现为"每改一次，
   * 撤销要按两次""重做栈里出现重复快照"。ref 镜像让这些流程保持纯一次写入。
   * 渲染提交后由 effect 同步，事件处理器读到的永远是最新已提交值。
   */
  const boardsRef = useRef(boards)
  const historyRef = useRef(history)
  const futureRef = useRef(future)
  /**
   * 加载阶段发现存储损坏时置位：抑制紧随其后的「默认模板回写」。
   * 该副作用本来会把默认布局写回同一个 key，把损坏但仍有救的原始数据彻底覆盖。
   */
  const skipNextPersistRef = useRef(false)
  useEffect(() => {
    boardsRef.current = boards
  }, [boards])
  useEffect(() => {
    historyRef.current = history
  }, [history])
  useEffect(() => {
    futureRef.current = future
  }, [future])

  /**
   * 从 LocalStorage 读取工作台状态（初始化与外部写入刷新共用）。
   * 返回 null 表示没有可用数据，调用方应落到默认模版。
   */
  const loadWorkspaceFromStorage = useCallback((): { boards: Board[]; activeBoardId: string } | null => {
    const isKnownType = (type: string) => Boolean(WIDGET_REGISTRY[type])
    try {
      // 优先读取 v2 多看板格式
      const savedV2 = localStorage.getItem(STORAGE_KEY)
      if (savedV2) {
        const parsed: StoredWorkspaceState = JSON.parse(savedV2)
        if (parsed.boards && Array.isArray(parsed.boards) && parsed.boards.length > 0) {
          // 过滤掉已被删除的无效模块类型（防僵尸卡片）
          const cleanedBoards = parsed.boards.map((b) => ({
            ...b,
            widgets: sanitizeWidgetInstances<WidgetInstance>(b.widgets, isKnownType),
          }))
          const firstBoard = cleanedBoards[0]
          return { boards: cleanedBoards, activeBoardId: parsed.activeBoardId || firstBoard?.id || 'default' }
        }
      }

      // 尝试平滑迁移 v1 单看板数据
      const savedV1 = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (savedV1) {
        const parsedV1: ModularPageLayout = JSON.parse(savedV1)
        if (parsedV1.widgets && Array.isArray(parsedV1.widgets)) {
          const migratedBoard: Board = {
            id: 'default',
            name: '默认工作台',
            widgets: sanitizeWidgetInstances<WidgetInstance>(parsedV1.widgets, isKnownType),
          }
          return { boards: [migratedBoard], activeBoardId: 'default' }
        }
      }
    } catch (e) {
      // 解析失败：先把现场备份下来再回退默认模板。
      // 否则紧接着的自动持久化会把默认模板写回同一个 key，用户布局再无迹可寻。
      let raw: string | null = null
      try {
        raw = localStorage.getItem(STORAGE_KEY)
      } catch {
        // 读都读不了（隐私模式）：没有现场可备份
      }
      const backupKey = raw ? backupCorruptPayload(STORAGE_KEY, raw, Date.now(), localStorage) : null
      skipNextPersistRef.current = true
      console.warn('加载工作台配置失败，已备份原始数据并使用默认模版', { backupKey, error: e })
    }
    return null
  }, [])

  // 1. 初始化时从 LocalStorage 加载或迁移
  useEffect(() => {
    const loaded = loadWorkspaceFromStorage()
    if (loaded) {
      setBoards(loaded.boards)
      setActiveBoardId(loaded.activeBoardId)
      setInitialized(true)
      return
    }

    // 默认创建两套开箱即用的工作台
    const defaultTemplate = PRESET_TEMPLATES[0]
    const initialWidgets: WidgetInstance[] = (defaultTemplate?.widgets || []).map((w, idx) => ({
      ...w,
      id: `widget-${w.type}-${Date.now()}-${idx}`,
      createdAt: Date.now(),
    }))

    const secondTemplate = PRESET_TEMPLATES[1] || defaultTemplate
    const initialBoards: Board[] = [
      {
        id: 'default',
        name: '💻 全栈极客工作台',
        widgets: initialWidgets,
      },
      {
        id: 'focus',
        name: '⚡ 极速效率启动坞',
        widgets: (secondTemplate?.widgets || []).map((w, idx) => ({
          ...w,
          id: `widget-focus-${w.type}-${Date.now()}-${idx}`,
          createdAt: Date.now(),
        })),
      },
    ]

    setBoards(initialBoards)
    setActiveBoardId('default')
    setInitialized(true)
  }, [loadWorkspaceFromStorage])

  // 1.1 外部写入同步：站点卡片"固定到工作台"(workbench-bridge) 与其它标签页
  // 都会改 localStorage 后派发事件。此前 hook 不监听 → 用户在 /custom 页面
  // 上固定站点时，新模块要手动刷新才出现。这里监听事件并重新加载。
  // 防环：自身的持久化写入不会触发 storage 事件（同文档），bridge 事件只在
  // 外部写入时派发，重新加载也不会再派发，因此不会形成循环。
  useEffect(() => {
    if (!initialized) return
    const handleExternalUpdate = () => {
      const loaded = loadWorkspaceFromStorage()
      if (!loaded) return
      boardsRef.current = loaded.boards
      setBoards(loaded.boards)
      setActiveBoardId(loaded.activeBoardId)
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) handleExternalUpdate()
    }
    window.addEventListener('navhub_workbench_updated', handleExternalUpdate)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('navhub_workbench_updated', handleExternalUpdate)
      window.removeEventListener('storage', onStorage)
    }
  }, [initialized, loadWorkspaceFromStorage])

  // 2. 状态改变自动持久化
  useEffect(() => {
    if (!initialized || boards.length === 0) return
    if (skipNextPersistRef.current) {
      // 加载阶段发现存储损坏：跳过这次「默认模板回写」，
      // 把原始（损坏但有备份）的数据留在原 key，等用户真正编辑时再覆盖。
      skipNextPersistRef.current = false
      return
    }
    try {
      const state: StoredWorkspaceState = {
        version: 2,
        activeBoardId,
        boards,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (e) {
      console.error('保存多看板工作台布局失败', e)
    }
  }, [boards, activeBoardId, initialized])

  // 当前激活的看板与小部件列表
  const currentBoard = boards.find((b) => b.id === activeBoardId) || boards[0] || { id: 'default', name: '工作台', widgets: [] }
  const widgets = currentBoard.widgets

  // 更新当前看板的 widgets 辅助方法（ref 原子写入，无嵌套 setState）
  const updateCurrentWidgets = useCallback(
    (updater: (prev: WidgetInstance[]) => WidgetInstance[], recordHistory = true) => {
      const prevBoards = boardsRef.current
      if (recordHistory) {
        const newHistory = [...historyRef.current.slice(-(HISTORY_LIMIT - 1)), prevBoards]
        historyRef.current = newHistory
        futureRef.current = []
        setHistory(newHistory)
        setFuture([])
      }
      const nextBoards = prevBoards.map((b) => {
        if (b.id !== activeBoardId) return b
        return {
          ...b,
          widgets: updater(b.widgets),
        }
      })
      boardsRef.current = nextBoards
      setBoards(nextBoards)
    },
    [activeBoardId]
  )

  // 撤销 (Undo)
  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return
    const previousState = historyRef.current[historyRef.current.length - 1]
    if (!previousState) return
    const newHistory = historyRef.current.slice(0, -1)
    const newFuture = [boardsRef.current, ...futureRef.current]

    historyRef.current = newHistory
    futureRef.current = newFuture
    boardsRef.current = previousState

    setHistory(newHistory)
    setFuture(newFuture)
    setBoards(previousState)
  }, [])

  // 重做 (Redo)
  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return
    const nextState = futureRef.current[0]
    if (!nextState) return
    const newFuture = futureRef.current.slice(1)
    const newHistory = [...historyRef.current, boardsRef.current]

    historyRef.current = newHistory
    futureRef.current = newFuture
    boardsRef.current = nextState

    setHistory(newHistory)
    setFuture(newFuture)
    setBoards(nextState)
  }, [])

  // 3. 添加模块
  const addWidget = useCallback(
    (type: string) => {
      const newInstance = createWidgetInstance(type)
      updateCurrentWidgets((prev) => [...prev, newInstance])
    },
    [updateCurrentWidgets]
  )

  // 4. 删除模块
  const removeWidget = useCallback(
    (id: string) => {
      updateCurrentWidgets((prev) => prev.filter((w) => w.id !== id))
    },
    [updateCurrentWidgets]
  )

  // 5. 拖拽重新排序
  const reorderWidgets = useCallback(
    (sourceIndex: number, destinationIndex: number) => {
      if (sourceIndex === destinationIndex) return
      updateCurrentWidgets((prev) => {
        if (sourceIndex < 0 || sourceIndex >= prev.length) return prev
        if (destinationIndex < 0 || destinationIndex >= prev.length) return prev
        const next = [...prev]
        const removed = next.splice(sourceIndex, 1)
        const moved = removed[0]
        if (moved) {
          next.splice(destinationIndex, 0, moved)
        }
        return next
      })
    },
    [updateCurrentWidgets]
  )

  // 6. 移动端/方向位移 (上移 / 下移)
  const shiftWidget = useCallback(
    (index: number, direction: 'up' | 'down') => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= widgets.length) return
      reorderWidgets(index, targetIndex)
    },
    [reorderWidgets, widgets.length]
  )

  /**
   * 开始一次连续交互（拖拽换位 / 拖拽缩放）。
   *
   * 为什么需要：缩放过程中每个栅格变化都会走 updateCurrentWidgets，
   * 若每次都记历史，一次拖拽会塞进十几条快照（且每次都要深拷贝 boards 数组），
   * 既拖慢拖拽、又让"撤销"只能回退一格。这里在开始时压入**一份**快照，
   * 过程中的更新用 recordHistory=false，于是：一次拖拽 = 一步撤销。
   */
  const beginInteraction = useCallback(() => {
    const newHistory = [...historyRef.current.slice(-(HISTORY_LIMIT - 1)), boardsRef.current]
    historyRef.current = newHistory
    futureRef.current = []
    setHistory(newHistory)
    setFuture([])
  }, [])

  // 7. 调整模块大小
  // recordHistory=false 用于拖拽过程中的连续更新（配合 beginInteraction 使用）
  const resizeWidget = useCallback(
    (id: string, colSpan: number, rowSpan?: number, recordHistory = true) => {
      updateCurrentWidgets(
        (prev) =>
          prev.map((w) => {
            if (w.id !== id) return w
            const def = WIDGET_REGISTRY[w.type]
            const clampedCol = Math.min(
              def?.maxColSpan ?? 12,
              Math.max(def?.minColSpan ?? 3, colSpan)
            )
            const clampedRow = rowSpan
              ? Math.min(def?.maxRowSpan ?? 4, Math.max(def?.minRowSpan ?? 1, rowSpan))
              : w.rowSpan

            return {
              ...w,
              colSpan: clampedCol,
              rowSpan: clampedRow,
            }
          }),
        recordHistory
      )
    },
    [updateCurrentWidgets]
  )

  // 7.1 更新模块个性化配置与自定义标题
  const updateWidgetConfig = useCallback(
    (id: string, newConfig: Record<string, any>, newTitle?: string) => {
      updateCurrentWidgets((prev) =>
        prev.map((w) => {
          if (w.id !== id) return w
          return {
            ...w,
            config: { ...w.config, ...newConfig },
            customTitle: newTitle !== undefined ? newTitle : w.customTitle,
          }
        })
      )
    },
    [updateCurrentWidgets]
  )

  // 8. 套用预设模版
  const applyTemplate = useCallback(
    (templateId: string) => {
      const tpl = PRESET_TEMPLATES.find((t) => t.id === templateId)
      if (!tpl) return
      const newWidgets: WidgetInstance[] = tpl.widgets.map((w, idx) => ({
        ...w,
        id: `widget-${w.type}-${Date.now()}-${idx}`,
        createdAt: Date.now(),
      }))
      updateCurrentWidgets(() => newWidgets)
    },
    [updateCurrentWidgets]
  )

  // 9. 重置为默认模版
  const resetToDefault = useCallback(() => {
    applyTemplate(PRESET_TEMPLATES[0].id)
  }, [applyTemplate])

  // 10. 多看板管理：新建看板
  const createBoard = useCallback((name: string) => {
    const newBoardId = `board-${Date.now()}`
    const defaultTemplate = PRESET_TEMPLATES[0]
    const newWidgets: WidgetInstance[] = defaultTemplate.widgets.map((w, idx) => ({
      ...w,
      id: `widget-${w.type}-${Date.now()}-${idx}`,
      createdAt: Date.now(),
    }))

    const newBoard: Board = {
      id: newBoardId,
      name: name.trim() || `新看板 ${new Date().toLocaleDateString('zh-CN')}`,
      widgets: newWidgets,
    }

    const nextBoards = [...boardsRef.current, newBoard]
    boardsRef.current = nextBoards
    setBoards(nextBoards)
    setActiveBoardId(newBoardId)
  }, [])

  // 11. 切换看板
  const switchBoard = useCallback((boardId: string) => {
    setActiveBoardId(boardId)
  }, [])

  // 12. 重命名看板
  const renameBoard = useCallback((boardId: string, newName: string) => {
    const nextBoards = boardsRef.current.map((b) =>
      b.id === boardId ? { ...b, name: newName.trim() || b.name } : b
    )
    boardsRef.current = nextBoards
    setBoards(nextBoards)
  }, [])

  // 13. 删除看板 (保证至少保留 1 个看板)
  const deleteBoard = useCallback(
    (boardId: string) => {
      const prev = boardsRef.current
      if (prev.length <= 1) return
      const nextBoards = prev.filter((b) => b.id !== boardId)
      boardsRef.current = nextBoards
      setBoards(nextBoards)
      // 删的就是当前看板时同批切换激活项（React 自动批处理，无需 setTimeout）
      if (activeBoardId === boardId) {
        setActiveBoardId(nextBoards[0]?.id || 'default')
      }
    },
    [activeBoardId]
  )

  // 14. 导出多看板 JSON
  const exportLayoutJson = useCallback(() => {
    return JSON.stringify({ version: 2, exportedAt: Date.now(), activeBoardId, boards }, null, 2)
  }, [boards, activeBoardId])

  // 15. 导入多看板 JSON
  const importLayoutJson = useCallback((jsonStr: string) => {
    const isKnownType = (type: string) => Boolean(WIDGET_REGISTRY[type])
    try {
      const parsed = JSON.parse(jsonStr)
      // 过滤已被删除/改名的模块类型：与加载逻辑同源（sanitizeWidgetInstances），
      // 否则无效类型会渲染成"删不掉的僵尸卡片"（ModularItem 另有降级兜底）
      if (parsed.boards && Array.isArray(parsed.boards) && parsed.boards.length > 0) {
        const boardsToImport: Board[] = parsed.boards
          .filter((b: unknown) => Boolean(b) && typeof b === 'object')
          .map((b: Board) => ({
            id: String(b.id || `imported-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
            name: String(b.name || '导入看板'),
            widgets: sanitizeWidgetInstances<WidgetInstance>(b.widgets, isKnownType),
          }))
          .filter((b: Board) => b.widgets.length > 0)
        if (boardsToImport.length === 0) return false
        const prevBoards = boardsRef.current
        const newHistory = [...historyRef.current.slice(-(HISTORY_LIMIT - 1)), prevBoards]
        historyRef.current = newHistory
        futureRef.current = []
        boardsRef.current = boardsToImport
        setHistory(newHistory)
        setFuture([])
        setBoards(boardsToImport)
        const firstImported = boardsToImport[0]
        setActiveBoardId(
          boardsToImport.some((b) => b.id === parsed.activeBoardId)
            ? String(parsed.activeBoardId)
            : firstImported?.id || 'default'
        )
        return true
      }
      // 兼容单看板导入
      if (parsed.widgets && Array.isArray(parsed.widgets)) {
        const widgetsToImport = sanitizeWidgetInstances<WidgetInstance>(parsed.widgets, isKnownType)
        if (widgetsToImport.length === 0) return false
        const nextBoards: Board[] = [
          ...boardsRef.current,
          {
            id: `imported-${Date.now()}`,
            name: `导入看板 (${new Date().toLocaleDateString('zh-CN')})`,
            widgets: widgetsToImport,
          },
        ]
        boardsRef.current = nextBoards
        setBoards(nextBoards)
        return true
      }
    } catch {
      // 导入文本不是合法 JSON（或结构认不出来）：返回 false，
      // 调用方据此提示「格式不正确」—— 这不是静默吞掉，而是失败经由返回值上报
    }
    return false
  }, [])

  // 16. 智能紧凑网格重排
  const compactLayout = useCallback(() => {
    updateCurrentWidgets((prev) => {
      if (prev.length <= 1) return prev
      const remaining = [...prev]
      const compacted: WidgetInstance[] = []

      while (remaining.length > 0) {
        let currentRowCols = 0
        const rowItems: WidgetInstance[] = []

        for (let i = 0; i < remaining.length; ) {
          const item = remaining[i]
          if (!item) {
            i++
            continue
          }
          const span = Math.min(12, Math.max(1, item.colSpan || 4))

          if (currentRowCols + span <= 12) {
            rowItems.push(item)
            currentRowCols += span
            remaining.splice(i, 1)
          } else {
            i++
          }
        }

        if (rowItems.length === 0 && remaining.length > 0) {
          const first = remaining.shift()
          if (first) {
            compacted.push(first)
          }
        } else {
          compacted.push(...rowItems)
        }
      }

      return compacted
    })
  }, [updateCurrentWidgets])

  // 17. 插件市场工作台预设安装 (Plugin Preset Installer)
  const installWidgetPreset = useCallback(
    (
      preset?: {
        boards?: Array<{
          name?: string
          widgets?: Array<Record<string, unknown>>
        }>
      } | null,
      mode: 'append' | 'replace' = 'append'
    ) => {
      if (!preset || !Array.isArray(preset.boards) || preset.boards.length === 0) return false
      const isKnownType = (type: string) => Boolean(WIDGET_REGISTRY[type])
      const newBoards: Board[] = preset.boards
        .map((b: { name?: string; widgets?: Array<Record<string, unknown>> }, bIdx: number) => {
          const instances: WidgetInstance[] = (b.widgets || []).map(
            (w: Record<string, unknown>, wIdx: number) => ({
              id: `widget-preset-${Date.now()}-${bIdx}-${wIdx}`,
              type: String(w.type ?? ''),
              customTitle: typeof w.customTitle === 'string' ? w.customTitle : undefined,
              colSpan: typeof w.colSpan === 'number' ? w.colSpan : 4,
              rowSpan: typeof w.rowSpan === 'number' ? w.rowSpan : 1,
              config: typeof w.config === 'object' && w.config !== null ? (w.config as Record<string, unknown>) : {},
              createdAt: Date.now(),
            })
          )
          return {
            id: `board-preset-${Date.now()}-${bIdx}`,
            name: b.name || `预设看板 ${bIdx + 1}`,
            widgets: sanitizeWidgetInstances<WidgetInstance>(instances, isKnownType),
          }
        })
        .filter((b: Board) => b.widgets.length > 0)

      if (newBoards.length === 0) return false

      const prevBoards = boardsRef.current
      const nextBoards = mode === 'replace' ? newBoards : [...prevBoards, ...newBoards]

      const newHistory = [...historyRef.current.slice(-(HISTORY_LIMIT - 1)), prevBoards]
      historyRef.current = newHistory
      futureRef.current = []
      boardsRef.current = nextBoards
      setHistory(newHistory)
      setFuture([])
      setBoards(nextBoards)
      if (newBoards[0]) {
        setActiveBoardId(newBoards[0].id)
      }
      return true
    },
    []
  )

  return {
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
    renameBoard,
    deleteBoard,
    exportLayoutJson,
    importLayoutJson,
    compactLayout,
    installWidgetPreset,
    undo,
    redo,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
  }
}


