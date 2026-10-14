'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { WidgetInstance, ModularPageLayout } from '@/types/modular'
import { WIDGET_REGISTRY, PRESET_TEMPLATES, createWidgetInstance } from './registry'
import { sanitizeWidgetInstances } from './sanitize'

export const STORAGE_KEY = 'navhub_modular_multi_boards_v2'
const LEGACY_STORAGE_KEY = 'navhub_modular_layout_v1'
/** 撤销栈深度上限：一次拖拽/缩放只算一步，25 步足够回退整段编辑 */
const HISTORY_LIMIT = 25

export interface Board {
  id: string
  name: string
  widgets: WidgetInstance[]
}

/** 兜底看板（无任何配置时的空态）：必须是常量，否则每次渲染都产生新引用 */
const EMPTY_BOARD: Board = { id: 'default', name: '工作台', widgets: [] }

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
  /** 是否有尚未落盘的改动（决定卸载 flush 是否真的写存储） */
  const dirtyRef = useRef(false)
  /** activeBoardId 的 ref 镜像：事件处理器里要读最新值做「与当前比较」 */
  const activeBoardIdRef = useRef(activeBoardId)
  useEffect(() => {
    boardsRef.current = boards
  }, [boards])
  useEffect(() => {
    activeBoardIdRef.current = activeBoardId
  }, [activeBoardId])
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
      console.warn('加载工作台配置失败，将使用默认模版', e)
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
      const prev = boardsRef.current
      // 内容相同则跳过：持久化 effect 与外源刷新都写同一个 key，
      // 无谓的 setState 会触发一次全量序列化写盘。
      const same =
        prev.length === loaded.boards.length &&
        prev.every((b, i) => b === loaded.boards[i])
      if (same && loaded.activeBoardId === activeBoardIdRef.current) return
      // 外源刷新也要可撤销：否则它会静默冲掉本地正在进行的编辑且无法回退。
      const newHistory = [...historyRef.current.slice(-(HISTORY_LIMIT - 1)), prev]
      historyRef.current = newHistory
      futureRef.current = []
      setHistory(newHistory)
      setFuture([])
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
  //
  // 防抖写入：拖拽/缩放时 boards 每帧都变，原先每帧一次 JSON.stringify + 同步
  // setItem 会阻塞主线程（模块多时明显掉帧）。改为静默 200ms 后落盘；
  // 页面隐藏/卸载前由下面的 flush 保证最后一批改动不丢。
  const persistNow = useCallback((force = false) => {
    if (!initialized || boardsRef.current.length === 0) return
    // 只有「有未落盘改动」时才写。否则页面卸载/隐藏时会把当前（可能已过期）
    // 的 state 写回存储，覆盖掉其它标签页或 bridge 刚写入的新数据。
    if (!force && !dirtyRef.current) return
    try {
      const state: StoredWorkspaceState = {
        version: 2,
        activeBoardId: activeBoardIdRef.current,
        boards: boardsRef.current,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      dirtyRef.current = false
    } catch (e) {
      console.error('保存多看板工作台布局失败', e)
    }
  }, [initialized])

  useEffect(() => {
    if (!initialized || boards.length === 0) return
    // 与存储内容一致则不写：初始化/外源刷新会让 boards 变化好几次
    // （boards、activeBoardId、initialized 各自触发一次 effect），
    // 用「一次性标记」挡不住全部，改为直接比较序列化结果 —— 既不会误标 dirty，
    // 也避免在刷新时把刚从存储读到的内容原样写回、覆盖其它标签页的新数据。
    try {
      const nextRaw = JSON.stringify({ version: 2, activeBoardId, boards })
      if (localStorage.getItem(STORAGE_KEY) === nextRaw) return
    } catch {
      /* 读存储失败则按有改动处理 */
    }
    dirtyRef.current = true
    const timer = setTimeout(() => persistNow(), 200)
    return () => clearTimeout(timer)
  }, [boards, activeBoardId, initialized, persistNow])

  // 页面隐藏/关闭前立即落盘，避免防抖窗口内的最后一批改动丢失
  useEffect(() => {
    if (!initialized) return
    const flush = () => persistNow()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      // 卸载时兜底写一次
      flush()
    }
  }, [initialized, persistNow])

  // 当前激活的看板与小部件列表
  // 兜底对象提为模块级常量：每次 render 新建会让 widgets 引用变化，击穿下游 memo
  const currentBoard = boards.find((b) => b.id === activeBoardId) || boards[0] || EMPTY_BOARD
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
      // 目标看板缺失时（初始化竞态 / 导入后 activeBoardId 与 boards 不一致）
      // 回退到第一个看板，避免 map 出空数组把整个工作台冲空。
      const targetId = prevBoards.some((b) => b.id === activeBoardId)
        ? activeBoardId
        : prevBoards[0]?.id
      const nextBoards = prevBoards.map((b) => {
        if (b.id !== targetId) return b
        return {
          ...b,
          widgets: updater(b.widgets),
        }
      })
      if (!targetId) return
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
        const importedId = `imported-${Date.now()}`
        const nextBoards: Board[] = [
          ...boardsRef.current,
          {
            id: importedId,
            name: `导入看板 (${new Date().toLocaleDateString('zh-CN')})`,
            widgets: widgetsToImport,
          },
        ]
        // 压入历史：导入属于可撤销的破坏性操作
        const newHistory = [...historyRef.current.slice(-(HISTORY_LIMIT - 1)), boardsRef.current]
        historyRef.current = newHistory
        futureRef.current = []
        setHistory(newHistory)
        setFuture([])
        boardsRef.current = nextBoards
        setBoards(nextBoards)
        // 切到新导入的看板：否则界面还停在旧看板，用户会以为导入没生效
        activeBoardIdRef.current = importedId
        setActiveBoardId(importedId)
        return true
      }
    } catch {}
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
    undo,
    redo,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
  }
}

