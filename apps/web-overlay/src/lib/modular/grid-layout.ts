/**
 * 网格布局模型（DIY 拖拽迁移）：纯函数，不依赖 React / RGL / dnd-kit。
 *
 * 背景（DRAG-2）：DIY 排版要从「一维顺序 + HTML5 DnD」升级到「二维网格坐标 +
 * RGL v2 / dnd-kit」，但 HomeDIYConfig（home-diy-storage.ts）只能存一维
 * categoryOrder，且那个文件不属于本次任务——所以这里只做「视图模型」：
 * grid 坐标是派生出来的，写回时再折回一维顺序。迁移是读时纯函数，
 * 失败永远回退默认布局，绝不抛错。
 *
 * GridItem 的形状刻意与 react-grid-layout v2 的 LayoutItem 对齐
 * （i/x/y/w/h/minW/maxW/minH/maxH），但本文件不 import 它：
 * 单测在 node 环境跑，不应拖进 RGL。
 */
import type { HomeDIYConfig } from './home-diy-storage'

export interface GridItem {
  /** 与 RGL LayoutItem.i 相同：分类 id / 小组件 id */
  i: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  maxW?: number
  minH?: number
  maxH?: number
  static?: boolean
}

/** 外层 Bento 网格列数（与模块化画布的 12 栅格一致） */
export const GRID_COLS = 12
/**
 * 响应式断点（容器宽度 px → 列数）。
 *
 * 桌面（容器 ≥1024px）保持 12 列，行为与原来完全一致；窄屏逐档收窄，
 * 否则 390px 手机上一个 colSpan:3 的小组件只有约 90px 宽，没法用：
 *   - ≥1024px：12 列（桌面）
 *   - ≥768px：8 列（小窗 / 平板横屏）
 *   - ≥480px：4 列（平板竖屏 / 大屏手机）
 *   - <480px：2 列（手机；colSpan 会钳到 2，约 170px 宽）
 * 列数只影响读时派生的网格坐标（widgetsToGrid），小组件自身的
 * colSpan/rowSpan 不写回、不丢失，窗口拉宽后自动恢复 12 列排布。
 */
export const GRID_BREAKPOINTS = { lg: 1024, md: 768, sm: 480, xs: 0 } as const
export const GRID_COLS_BY_BREAKPOINT = { lg: 12, md: 8, sm: 4, xs: 2 } as const

/** 容器宽度 → 当前列数（纯函数；宽度非法/未挂载时按最窄 2 列，不抛错） */
export function colsForWidth(width: number): number {
  if (!Number.isFinite(width) || width < GRID_BREAKPOINTS.sm) return GRID_COLS_BY_BREAKPOINT.xs
  if (width < GRID_BREAKPOINTS.md) return GRID_COLS_BY_BREAKPOINT.sm
  if (width < GRID_BREAKPOINTS.lg) return GRID_COLS_BY_BREAKPOINT.md
  return GRID_COLS_BY_BREAKPOINT.lg
}
/**
 * RGL 行高（px）。
 *
 * 取 175 而不是画布旧的 115：ModularItem 的 rowSpan=1 最小高度就是
 * 175px（min-h-[175px]），行高小于内容会被下一行视觉重叠；rowSpan 每加 1
 * 内容约 +115px，行高 175 时高卡片底部会多一点留白（flex 撑开，不裁切），
 * 是「不重叠」与「不太空」之间的折中。
 */
export const GRID_ROW_HEIGHT_PX = 175
/** RGL 网格间距（px），与画布 --density-grid-gap 默认 1rem 对齐 */
export const GRID_MARGIN_PX = 16
/** 小组件行跨度上限（与 use-modular-layout 的 resizeWidget 钳制一致） */
export const GRID_MAX_ROW_SPAN = 6

/** 排序口径：先行后列，同行同列按 id 兜底（保证确定性） */
export function compareGridPosition(a: GridItem, b: GridItem): number {
  if (a.y !== b.y) return a.y - b.y
  if (a.x !== b.x) return a.x - b.x
  return a.i < b.i ? -1 : a.i > b.i ? 1 : 0
}

function isValidId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 128
}

/** 全宽单列布局：每个分类占一整行（分类区块本就是通栏 section） */
export function defaultGridLayout(allIds: string[]): GridItem[] {
  const seen = new Set<string>()
  const layout: GridItem[] = []
  for (const id of allIds) {
    if (!isValidId(id) || seen.has(id)) continue
    seen.add(id)
    layout.push({ i: id, x: 0, y: layout.length, w: GRID_COLS, h: 1 })
  }
  return layout
}

/** 网格坐标 → 一维分类顺序（按行列排序；allIds 指定的缺失项补到末尾） */
export function gridToCategoryOrder(layout: GridItem[], allIds?: string[]): string[] {
  const sorted = [...layout].sort(compareGridPosition).map((item) => item.i)
  const seen = new Set<string>()
  const order = sorted.filter((id) => {
    if (seen.has(id)) return false
    seen.add(id)
    return !allIds || allIds.includes(id)
  })
  if (allIds) {
    for (const id of allIds) {
      if (!order.includes(id)) order.push(id)
    }
  }
  return order
}

export interface NormalizeGridResult {
  layout: GridItem[]
  notes: string[]
}

function rectsOverlap(a: GridItem, b: GridItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * 归一化一份不可信的 grid 布局（旧存储 / 导入 / RGL 回调都可能脏）：
 * 去重、钳制越界、重叠项向下推、缺失项按默认补行。输入不是数组、
 * 或归一化本身抛错，一律回退默认布局并记一条 note，绝不抛错。
 */
export function normalizeGridLayout(
  layout: unknown,
  allIds: string[],
  cols: number = GRID_COLS,
): NormalizeGridResult {
  const notes: string[] = []
  try {
    if (!Array.isArray(layout)) {
      notes.push('网格布局不是数组，已回退默认布局')
      return { layout: defaultGridLayout(allIds), notes }
    }
    const seen = new Set<string>()
    const placed: GridItem[] = []
    for (const raw of layout) {
      if (!raw || typeof raw !== 'object') {
        notes.push('网格布局里有一项不是对象，已丢弃')
        continue
      }
      const item = raw as Record<string, unknown>
      if (!isValidId(item.i)) {
        notes.push('网格布局里有一项没有合法 id，已丢弃')
        continue
      }
      if (seen.has(item.i)) {
        notes.push(`网格布局里「${item.i}」重复出现，只保留第一次`)
        continue
      }
      if (allIds.length > 0 && !allIds.includes(item.i)) {
        notes.push(`网格布局里「${item.i}」不在当前分类中，已丢弃`)
        continue
      }
      seen.add(item.i)
      const w = Math.min(cols, Math.max(1, Math.floor(Number(item.w)) || 1))
      const h = Math.max(1, Math.floor(Number(item.h)) || 1)
      const x = Math.min(Math.max(0, Math.floor(Number(item.x)) || 0), cols - w)
      const y = Math.max(0, Math.floor(Number(item.y)) || 0)
      const candidate: GridItem = { i: item.i, x, y, w, h }
      // 重叠就向下推一行，直到不撞为止（y 只增不减，一定终止）。
      let guard = 0
      while (placed.some((p) => rectsOverlap(p, candidate)) && guard < 10000) {
        candidate.y += 1
        guard += 1
      }
      if (guard >= 10000) {
        notes.push(`网格布局里「${item.i}」放不下，已移到末尾`)
        candidate.y = placed.reduce((max, p) => Math.max(max, p.y + p.h), 0)
      }
      placed.push(candidate)
    }
    for (const id of allIds) {
      if (!seen.has(id)) {
        notes.push(`分类「${id}」没有网格位置，已补到末尾`)
        placed.push({
          i: id,
          x: 0,
          y: placed.reduce((max, p) => Math.max(max, p.y + p.h), 0),
          w: cols,
          h: 1,
        })
        seen.add(id)
      }
    }
    placed.sort(compareGridPosition)
    return { layout: placed, notes }
  } catch (err) {
    notes.push(`网格布局归一化失败（${err instanceof Error ? err.message : '未知错误'}），已回退默认布局`)
    return { layout: defaultGridLayout(allIds), notes }
  }
}

export interface MigrateConfigToGridResult {
  layout: GridItem[]
  /** 输入顺序是否本来就完整（false = 迁移时补过 / 丢过 / 修过） */
  migrated: boolean
  notes: string[]
}

/**
 * 自动迁移：HomeDIYConfig → 网格坐标（读时纯函数）。
 *
 * - categoryOrder 为空 / 不是数组 / 混进非法 id / 缺分类 / 多出未知分类，
 *   全部就地修好并记 note；
 * - 任何异常（包括 config 本身不是对象）都回退默认布局，绝不抛错——
 *   调用方（use-home-diy-grid）在读时调它，抛错会直接白屏。
 */
export function migrateConfigToGrid(
  config: unknown,
  allIds: string[],
): MigrateConfigToGridResult {
  try {
    if (!config || typeof config !== 'object') {
      return {
        layout: defaultGridLayout(allIds),
        migrated: true,
        notes: ['DIY 配置不可读，已回退默认布局'],
      }
    }
    const order = (config as Partial<HomeDIYConfig>).categoryOrder
    if (!Array.isArray(order)) {
      return {
        layout: defaultGridLayout(allIds),
        migrated: true,
        notes: ['DIY 配置里没有分类顺序，已按当前分类生成默认网格布局'],
      }
    }
    const { layout, notes } = normalizeGridLayout(
      order.map((id, index) => ({ i: id, x: 0, y: index, w: GRID_COLS, h: 1 })),
      allIds,
    )
    return { layout, migrated: notes.length > 0, notes }
  } catch (err) {
    return {
      layout: defaultGridLayout(allIds),
      migrated: true,
      notes: [`DIY 配置迁移失败（${err instanceof Error ? err.message : '未知错误'}），已回退默认布局`],
    }
  }
}

/** 网格内移动一项到指定序号（分类全宽行：移动 = 重排后重新编行号） */
export function reorderGridItems(
  layout: GridItem[],
  id: string,
  toIndex: number,
): GridItem[] {
  const sorted = [...layout].sort(compareGridPosition)
  const fromIndex = sorted.findIndex((item) => item.i === id)
  if (fromIndex === -1) return sorted
  const target = Math.min(Math.max(0, toIndex), sorted.length - 1)
  if (target === fromIndex) return sorted
  const [moved] = sorted.splice(fromIndex, 1)
  if (!moved) return sorted
  sorted.splice(target, 0, moved)
  return sorted.map((item, index) => ({ ...item, y: index }))
}

/**
 * 把「旧顺序 → 新顺序」拆成若干次单步移动（每次 [from, to] 都是
 * reorderWidgets(from, to) 能直接执行的语义）。
 *
 * 先试「只动了一项」：RGL 拖拽 / dnd-kit 排序的常见情况就是搬一项，
 * 必须恰好 1 步（一步 = 一条撤销历史）。判断方法：首个不同位置 i
 * 与末个不同位置 j 之间，只可能是 from[i] 右移或 to[i] 左移，
 * 各试一次，命中即返回；否则退回贪心多步。
 */
export function planOrderMoves(fromIds: string[], toIds: string[]): Array<[from: number, to: number]> {
  if (fromIds.length === toIds.length && fromIds.every((id, i) => id === toIds[i])) return []
  const firstDiff = fromIds.findIndex((id, i) => id !== toIds[i])
  if (firstDiff === -1) return []
  let lastDiff = -1
  for (let i = fromIds.length - 1; i >= 0; i--) {
    if (fromIds[i] !== toIds[i]) {
      lastDiff = i
      break
    }
  }
  const relocated = (from: string[], removeAt: number, insertAt: number): string[] => {
    const next = [...from]
    const [moved] = next.splice(removeAt, 1)
    if (moved === undefined) return next
    next.splice(insertAt, 0, moved)
    return next
  }
  const matches = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every((id, i) => id === b[i])
  // 候选 A：from[firstDiff] 右移到 lastDiff
  if (matches(relocated(fromIds, firstDiff, lastDiff), toIds)) {
    return [[firstDiff, lastDiff]]
  }
  // 候选 B：to[firstDiff] 那个元素从后面左移到 firstDiff
  const movedBackIndex = fromIds.indexOf(toIds[firstDiff] as string)
  if (
    movedBackIndex !== -1 &&
    matches(relocated(fromIds, movedBackIndex, firstDiff), toIds)
  ) {
    return [[movedBackIndex, firstDiff]]
  }
  // 贪心多步：按目标顺序从前往后走，每一项不在位就把它移过来；
  // 已就位的前缀不再动。
  const current = [...fromIds]
  const moves: Array<[number, number]> = []
  for (let targetIndex = 0; targetIndex < toIds.length; targetIndex++) {
    const id = toIds[targetIndex]
    if (id === undefined) continue
    const currentIndex = current.indexOf(id)
    if (currentIndex === -1) continue
    if (currentIndex === targetIndex) continue
    const [moved] = current.splice(currentIndex, 1)
    if (moved === undefined) continue
    current.splice(targetIndex, 0, moved)
    moves.push([currentIndex, targetIndex])
  }
  return moves
}

/** 小组件尺寸钳制（与 use-modular-layout 的 resizeWidget 口径一致） */
export function clampWidgetSize(w: number, h: number, cols: number = GRID_COLS): { w: number; h: number } {
  return {
    w: Math.min(cols, Math.max(1, Math.floor(w) || 1)),
    h: Math.min(GRID_MAX_ROW_SPAN, Math.max(1, Math.floor(h) || 1)),
  }
}

export interface WidgetGridInput {
  id: string
  colSpan: number
  rowSpan: number
}

/**
 * 小组件列表 → RGL 布局：按顺序行主序流式排布（first-fit）。
 *
 * 画布旧的 CSS grid 是纯流式（grid-cols-12 自动换行），没有存过 x/y；
 * 这里在读时现算一份坐标给 RGL，写回时再按 (y, x) 排回顺序。
 * cols 是当前断点的列数（窄屏 < 12）：超宽项钳到 cols，行满即换行。
 */
export function widgetsToGrid<T extends WidgetGridInput>(widgets: T[], cols: number = GRID_COLS): GridItem[] {
  const layout: GridItem[] = []
  let x = 0
  let y = 0
  let rowHeight = 1
  for (const widget of widgets) {
    const { w, h } = clampWidgetSize(widget.colSpan, widget.rowSpan, cols)
    if (x + w > cols) {
      y += rowHeight
      x = 0
      rowHeight = 1
    }
    layout.push({ i: widget.id, x, y, w, h })
    x += w
    rowHeight = Math.max(rowHeight, h)
  }
  return layout
}

/**
 * RGL 布局 → 小组件列表：按 (y, x) 排回顺序，w/h 写回 colSpan/rowSpan。
 * RGL 里没有的 widget 按原顺序补到末尾；布局里多出来的未知 id 丢弃。
 * cols 是当前断点的列数（与 widgetsToGrid 同一口径钳制）。
 * 注意：窄屏断点下 RGL 的 w 是断点相对值（2 列里的 2 ≠ 12 列里的 2），
 * 调用方（modular-canvas 的 commitGridLayout）只在 12 列断点写回尺寸，
 * 窄屏只提交顺序——否则一次手机拖动会把组件永久缩成 2 列。
 */
export function applyGridLayoutToWidgets<T extends WidgetGridInput>(
  widgets: T[],
  layout: GridItem[],
  cols: number = GRID_COLS,
): T[] {
  const byId = new Map(widgets.map((w) => [w.id, w]))
  const ordered = [...layout]
    .sort(compareGridPosition)
    .map((item) => {
      const widget = byId.get(item.i)
      if (!widget) return null
      const { w, h } = clampWidgetSize(item.w, item.h, cols)
      if (w === widget.colSpan && h === widget.rowSpan) return widget
      return { ...widget, colSpan: w, rowSpan: h }
    })
    .filter((w): w is T => w !== null)
  const seen = new Set(ordered.map((w) => w.id))
  for (const widget of widgets) {
    if (!seen.has(widget.id)) ordered.push(widget)
  }
  return ordered
}
