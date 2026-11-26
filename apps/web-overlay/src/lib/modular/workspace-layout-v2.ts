/**
 * DIY 排版工坊 Phase 2：12 列 Bento 自由画布核心 Schema 与无损迁移引擎（纯模块，零 DOM/React 依赖）。
 *
 * 设计要点：
 * 1. 严格 TypeScript 契约（零 any），完整支持 lg(12列) / md(8列) / sm(4列) 独立断点记忆；
 * 2. 幂等迁移器 `migrateLayoutToV2`：无损升维 Phase 1 / 旧版 HomeDIYConfig 与回收站数据，
 *    同时把无效坐标自动纠偏、缺失断点按 lg 派生生成；
 * 3. 与 Phase 1 内容覆写（siteOrderByCategory / siteCategoryOverrides / pinnedSiteIdsByCategory）
 *    和回收站（trash）保持双向兼容，原始站点库 Catalog 始终只读不可变。
 */

export type WorkspaceBreakpointKey = 'lg' | 'md' | 'sm'
export type ActiveDragLayer = 'none' | 'block' | 'card' | 'resize'
export type LayoutBlockType = 'category' | 'search' | 'dock' | 'hotlist' | 'custom_group' | 'widget'
export type LayoutCompactType = 'vertical' | null
export type BlockHeightMode = 'auto' | 'fixed-scroll'
export type BlockCardVariant = 'capsule' | 'compact' | 'icon-only'

export interface BlockStyleConfig {
  cardVariant?: BlockCardVariant
  innerCols?: number | 'auto'
  collapsed?: boolean
  accentColor?: string
}

export interface LayoutBlock {
  id: string
  type: LayoutBlockType
  refId?: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  maxW?: number
  minH?: number
  locked?: boolean
  heightMode?: BlockHeightMode
  style?: BlockStyleConfig
}

export interface BlockContentConfig {
  /** Phase 1 分类内卡片排序覆写 */
  siteOrder?: string[]
  /** 分类内置顶卡片 id */
  pinnedSiteIds?: string[]
  /** 区块内隐藏站点 id */
  hiddenSiteIds?: string[]
}

export interface TrashedItem {
  id: string
  type: LayoutBlockType | 'site' | 'subcategory' | 'module'
  title: string
  refId?: string
  deletedAt: number
  /** 软删除前在各断点的原始坐标，还原时优先原位恢复 */
  previousLayout?: Partial<Record<WorkspaceBreakpointKey, LayoutBlock>>
}

export interface WorkspaceLayoutV2 {
  version: 2
  id: string
  name: string
  gridConfig: {
    columns: 12
    rowHeight: number
    gap: [number, number]
    compactType: LayoutCompactType
  }
  breakpoints: {
    lg: LayoutBlock[]
    md: LayoutBlock[]
    sm: LayoutBlock[]
  }
  blockOverrides: Record<string, BlockContentConfig>
  trash: TrashedItem[]
}

export const WORKSPACE_GRID_COLS: Readonly<Record<WorkspaceBreakpointKey, number>> = {
  lg: 12,
  md: 8,
  sm: 4,
}

/**
 * 容器真实宽度断点（非 window.innerWidth）：
 * 桌面视口 1280px~1440px 扣除 240px 侧边栏与内边距后，主内容容器约 976px~1136px，
 * 因此 lg 阈值定在 960px 确保所有标准桌面端均命中 12 列画布；md=640px（8列）；sm=0（4列单列）。
 */
export const WORKSPACE_BREAKPOINT_PX: Readonly<Record<WorkspaceBreakpointKey, number>> = {
  lg: 960,
  md: 640,
  sm: 0,
}

export const DEFAULT_WORKSPACE_ROW_HEIGHT = 40
export const DEFAULT_WORKSPACE_GAP: [number, number] = [16, 16]

/** 根据父容器实测宽度返回断点（避免依赖 window.innerWidth 导致侧边栏展开/收起错位） */
export function resolveBreakpointForWidth(width: number): WorkspaceBreakpointKey {
  if (!Number.isFinite(width) || width < WORKSPACE_BREAKPOINT_PX.md) return 'sm'
  if (width < WORKSPACE_BREAKPOINT_PX.lg) return 'md'
  return 'lg'
}

export function colsForBreakpoint(bp: WorkspaceBreakpointKey): number {
  return WORKSPACE_GRID_COLS[bp]
}

/** 区块类型对应的默认尺寸边界与推荐初始高度（按 rowHeight=40px 估算） */
export function defaultBoundsForBlockType(type: LayoutBlockType): {
  w: number
  h: number
  minW: number
  maxW: number
  minH: number
} {
  switch (type) {
    case 'search':
      return { w: 12, h: 2, minW: 4, maxW: 12, minH: 2 }
    case 'dock':
      return { w: 12, h: 2, minW: 4, maxW: 12, minH: 2 }
    case 'hotlist':
      return { w: 4, h: 6, minW: 4, maxW: 12, minH: 4 }
    case 'custom_group':
      return { w: 12, h: 6, minW: 4, maxW: 12, minH: 3 }
    case 'widget':
      return { w: 6, h: 5, minW: 4, maxW: 12, minH: 3 }
    case 'category':
    default:
      return { w: 12, h: 8, minW: 4, maxW: 12, minH: 3 }
  }
}

const VALID_BLOCK_TYPES = new Set<LayoutBlockType>([
  'category',
  'search',
  'dock',
  'hotlist',
  'custom_group',
  'widget',
])

const VALID_CARD_VARIANTS = new Set<BlockCardVariant>(['capsule', 'compact', 'icon-only'])

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function rectsOverlap(a: LayoutBlock, b: LayoutBlock): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function sanitizeBlockStyle(raw: unknown): BlockStyleConfig | undefined {
  if (!isRecord(raw)) return undefined
  const out: BlockStyleConfig = {}
  if (typeof raw.cardVariant === 'string' && VALID_CARD_VARIANTS.has(raw.cardVariant as BlockCardVariant)) {
    out.cardVariant = raw.cardVariant as BlockCardVariant
  }
  if (raw.innerCols === 'auto') {
    out.innerCols = 'auto'
  } else if (typeof raw.innerCols === 'number' && Number.isFinite(raw.innerCols)) {
    out.innerCols = clampInt(raw.innerCols, 1, 6, 3)
  }
  if (typeof raw.collapsed === 'boolean') {
    out.collapsed = raw.collapsed
  }
  if (typeof raw.accentColor === 'string' && raw.accentColor.trim().length > 0 && raw.accentColor.length <= 32) {
    out.accentColor = raw.accentColor.trim()
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function sanitizeSingleBlock(raw: unknown, cols: number): LayoutBlock | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id || id.length > 128) return null
  const type: LayoutBlockType =
    typeof raw.type === 'string' && VALID_BLOCK_TYPES.has(raw.type as LayoutBlockType)
      ? (raw.type as LayoutBlockType)
      : 'category'
  const bounds = defaultBoundsForBlockType(type)
  const minW = clampInt(raw.minW, 1, cols, Math.min(bounds.minW, cols))
  const maxW = clampInt(raw.maxW, minW, cols, cols)
  const minH = clampInt(raw.minH, 2, 40, bounds.minH)
  const w = clampInt(raw.w, minW, maxW, Math.min(bounds.w, cols))
  const h = clampInt(raw.h, minH, 120, bounds.h)
  const x = clampInt(raw.x, 0, Math.max(0, cols - w), 0)
  const y = clampInt(raw.y, 0, 10000, 0)
  const heightMode: BlockHeightMode =
    raw.heightMode === 'fixed-scroll' ? 'fixed-scroll' : 'auto'
  const style = sanitizeBlockStyle(raw.style)

  const block: LayoutBlock = {
    id,
    type,
    x,
    y,
    w,
    h,
    minW,
    maxW,
    minH,
    heightMode,
  }
  if (typeof raw.refId === 'string' && raw.refId.trim()) {
    block.refId = raw.refId.trim().slice(0, 128)
  }
  if (raw.locked === true) {
    block.locked = true
  }
  if (style) {
    block.style = style
  }
  return block
}

/** 校验并清洗单个断点下的区块列表：去重、坐标钳制、消除碰撞重叠 */
export function sanitizeLayoutBlocks(rawBlocks: unknown, cols: number): LayoutBlock[] {
  if (!Array.isArray(rawBlocks)) return []
  const seen = new Set<string>()
  const placed: LayoutBlock[] = []

  for (const item of rawBlocks) {
    const clean = sanitizeSingleBlock(item, cols)
    if (!clean || seen.has(clean.id)) continue
    seen.add(clean.id)

    let guard = 0
    while (placed.some((existing) => rectsOverlap(existing, clean)) && guard < 2000) {
      clean.y += 1
      guard += 1
    }
    placed.push(clean)
  }

  return placed.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x !== b.x ? a.x - b.x : a.id.localeCompare(b.id)))
}

/**
 * 由桌面端 lg(12列) 自动派生 md(8列) 或 sm(4列) 断点布局：
 * - sm(4列)：默认单列满宽（w: 4, x: 0）依次排布，保证窄屏零溢出；
 * - md(8列)：按 8/12 比例缩放列宽并就地消重，兼顾平板双列并排。
 */
export function deriveBreakpointFromLg(
  lgBlocks: readonly LayoutBlock[],
  targetBp: 'md' | 'sm',
): LayoutBlock[] {
  const cols = WORKSPACE_GRID_COLS[targetBp]
  const ordered = [...lgBlocks].sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x))
  const placed: LayoutBlock[] = []

  if (targetBp === 'sm') {
    let cursorY = 0
    for (const block of ordered) {
      const next: LayoutBlock = {
        ...block,
        x: 0,
        y: cursorY,
        w: cols,
        minW: cols,
        maxW: cols,
      }
      cursorY += next.h
      placed.push(next)
    }
    return placed
  }

  // md (8 cols): 比例映射并消除碰撞
  for (const block of ordered) {
    const scaledW = Math.min(cols, Math.max(4, Math.round((block.w / 12) * cols)))
    const scaledX = Math.min(cols - scaledW, Math.max(0, Math.round((block.x / 12) * cols)))
    const candidate: LayoutBlock = {
      ...block,
      x: scaledX,
      y: block.y,
      w: scaledW,
      minW: Math.min(block.minW ?? 4, cols),
      maxW: cols,
    }
    let guard = 0
    while (placed.some((existing) => rectsOverlap(existing, candidate)) && guard < 2000) {
      candidate.y += 1
      guard += 1
    }
    placed.push(candidate)
  }

  return placed.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x))
}

export interface LegacyPhase1LayoutInput {
  version?: number
  categoryOrder?: string[]
  pinnedCategoryIds?: string[]
  hiddenCategoryIds?: string[]
  collapsedCategoryIds?: string[]
  pinnedSiteIdsByCategory?: Record<string, string[]>
  siteOrderByCategory?: Record<string, string[]>
  /** 兼容早期 V1 布局快照字段 */
  customSiteOrders?: Record<string, string[]>
  hiddenSites?: string[]
  blockOverrides?: Record<string, { colSpan?: number; rowSpan?: number; order?: number }>
  customCategories?: Array<{ id: string; title: string }>
  workspaceLayoutV2?: unknown
}

export interface MigrateToV2Options {
  /** 当前目录可见分类 id 列表（按默认顺序） */
  catalogCategoryIds?: string[]
  /** 现有回收站条目（来自 feature-mask-store 或历史 V2 trash） */
  legacyTrash?: Array<{
    id: string
    title: string
    level?: string
    deletedAt?: number
  }>
  /** 预设或工作区 ID/名称 */
  workspaceId?: string
  workspaceName?: string
}

function buildBlockOverridesFromPhase1(
  legacy: LegacyPhase1LayoutInput,
  existingOverrides?: Record<string, BlockContentConfig>,
): Record<string, BlockContentConfig> {
  const out: Record<string, BlockContentConfig> = {}
  if (existingOverrides) {
    for (const [k, v] of Object.entries(existingOverrides)) {
      if (!isRecord(v)) continue
      const item: BlockContentConfig = {}
      if (Array.isArray(v.siteOrder)) {
        item.siteOrder = v.siteOrder.filter((s): s is string => typeof s === 'string' && s.length > 0)
      }
      if (Array.isArray(v.pinnedSiteIds)) {
        item.pinnedSiteIds = v.pinnedSiteIds.filter((s): s is string => typeof s === 'string' && s.length > 0)
      }
      if (Array.isArray(v.hiddenSiteIds)) {
        item.hiddenSiteIds = v.hiddenSiteIds.filter((s): s is string => typeof s === 'string' && s.length > 0)
      }
      if (Object.keys(item).length > 0) out[k] = item
    }
  }
  for (const [catId, order] of Object.entries(legacy.siteOrderByCategory || {})) {
    if (!Array.isArray(order) || order.length === 0) continue
    out[catId] = { ...(out[catId] || {}), siteOrder: [...order] }
  }
  for (const [catId, order] of Object.entries(legacy.customSiteOrders || {})) {
    if (!Array.isArray(order) || order.length === 0) continue
    if (!out[catId]?.siteOrder) {
      out[catId] = { ...(out[catId] || {}), siteOrder: [...order] }
    }
  }
  for (const [catId, pinned] of Object.entries(legacy.pinnedSiteIdsByCategory || {})) {
    if (!Array.isArray(pinned) || pinned.length === 0) continue
    out[catId] = { ...(out[catId] || {}), pinnedSiteIds: [...pinned] }
  }
  if (Array.isArray(legacy.hiddenSites) && legacy.hiddenSites.length > 0) {
    const cleanHidden = legacy.hiddenSites.filter((s): s is string => typeof s === 'string' && s.length > 0)
    if (cleanHidden.length > 0) {
      out.__global__ = { ...(out.__global__ || {}), hiddenSiteIds: cleanHidden }
    }
  }
  return out
}

function sanitizeTrashedItems(raw: unknown): TrashedItem[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TrashedItem[] = []
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) continue
    const id = entry.id.trim()
    if (seen.has(id)) continue
    seen.add(id)
    const rawType = typeof entry.type === 'string' ? entry.type : 'category'
    const validType: TrashedItem['type'] =
      VALID_BLOCK_TYPES.has(rawType as LayoutBlockType) ||
      rawType === 'site' ||
      rawType === 'subcategory' ||
      rawType === 'module'
        ? (rawType as TrashedItem['type'])
        : 'category'
    const item: TrashedItem = {
      id,
      type: validType,
      title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim().slice(0, 128) : id,
      deletedAt: typeof entry.deletedAt === 'number' && Number.isFinite(entry.deletedAt) ? entry.deletedAt : Date.now(),
    }
    if (typeof entry.refId === 'string' && entry.refId.trim()) {
      item.refId = entry.refId.trim().slice(0, 128)
    }
    if (isRecord(entry.previousLayout)) {
      const prev: Partial<Record<WorkspaceBreakpointKey, LayoutBlock>> = {}
      for (const bp of ['lg', 'md', 'sm'] as const) {
        const cleaned = sanitizeSingleBlock(entry.previousLayout[bp], WORKSPACE_GRID_COLS[bp])
        if (cleaned) prev[bp] = cleaned
      }
      if (Object.keys(prev).length > 0) item.previousLayout = prev
    }
    out.push(item)
  }
  return out
}

/**
 * 幂等无损迁移器：Phase 1 / 旧版配置 / 已迁移 V2 对象 → 标准 `WorkspaceLayoutV2`。
 *
 * 特性：
 * - 重复执行 `migrateLayoutToV2(migrateLayoutToV2(x))` 结果严格一致（幂等）；
 * - 若输入已是合法 V2，原样保留各断点坐标并清洗异常值、补全缺失断点；
 * - 若输入是 Phase 1 配置，将既有分类顺序转为 lg 断点 `w: 12, x: 0` 依次排布，
 *   保留 Phase 1 预留的 `blockOverrides` 宽度/排序以及 `siteOrderByCategory` 与 `trash`。
 */
export function migrateLayoutToV2(
  input: unknown,
  options: MigrateToV2Options = {},
): WorkspaceLayoutV2 {
  const workspaceId = options.workspaceId || 'workspace-default'
  const workspaceName = options.workspaceName || '默认自由画布'
  const catalogIds = options.catalogCategoryIds || []

  // 情况 1：输入本身（或其 workspaceLayoutV2 字段）已是 V2
  const candidateV2 =
    isRecord(input) && input.version === 2 && isRecord(input.breakpoints)
      ? input
      : isRecord(input) && isRecord(input.workspaceLayoutV2) && input.workspaceLayoutV2.version === 2
        ? input.workspaceLayoutV2
        : null

  const legacyPhase1: LegacyPhase1LayoutInput = isRecord(input) ? (input as LegacyPhase1LayoutInput) : {}

  if (candidateV2) {
    const rawGrid = isRecord(candidateV2.gridConfig) ? candidateV2.gridConfig : {}
    const rowHeight = clampInt(rawGrid.rowHeight, 24, 96, DEFAULT_WORKSPACE_ROW_HEIGHT)
    const rawGap = Array.isArray(rawGrid.gap) ? rawGrid.gap : DEFAULT_WORKSPACE_GAP
    const gap: [number, number] = [
      clampInt(rawGap[0], 0, 48, DEFAULT_WORKSPACE_GAP[0]),
      clampInt(rawGap[1], 0, 48, DEFAULT_WORKSPACE_GAP[1]),
    ]
    const compactType: LayoutCompactType = rawGrid.compactType === null ? null : 'vertical'

    const rawBp = isRecord(candidateV2.breakpoints) ? candidateV2.breakpoints : {}
    const lg = sanitizeLayoutBlocks(rawBp.lg, WORKSPACE_GRID_COLS.lg)
    const rawMd = sanitizeLayoutBlocks(rawBp.md, WORKSPACE_GRID_COLS.md)
    const rawSm = sanitizeLayoutBlocks(rawBp.sm, WORKSPACE_GRID_COLS.sm)

    const md = rawMd.length > 0 ? rawMd : deriveBreakpointFromLg(lg, 'md')
    const sm = rawSm.length > 0 ? rawSm : deriveBreakpointFromLg(lg, 'sm')

    const existingOverrides = isRecord(candidateV2.blockOverrides)
      ? (candidateV2.blockOverrides as Record<string, BlockContentConfig>)
      : undefined
    const blockOverrides = buildBlockOverridesFromPhase1(legacyPhase1, existingOverrides)
    const trash = sanitizeTrashedItems(candidateV2.trash)

    return {
      version: 2,
      id: typeof candidateV2.id === 'string' && candidateV2.id.trim() ? candidateV2.id.trim() : workspaceId,
      name: typeof candidateV2.name === 'string' && candidateV2.name.trim() ? candidateV2.name.trim() : workspaceName,
      gridConfig: {
        columns: 12,
        rowHeight,
        gap,
        compactType,
      },
      breakpoints: { lg, md, sm },
      blockOverrides,
      trash,
    }
  }

  // 情况 2：从 Phase 1 / 旧版 HomeDIYConfig 升维
  const customIdSet = new Set((legacyPhase1.customCategories || []).map((c) => c.id))
  const hiddenSet = new Set(legacyPhase1.hiddenCategoryIds || [])
  const collapsedSet = new Set(legacyPhase1.collapsedCategoryIds || [])

  // 按 Phase 1 顺序合成全量分类序列：pinned → categoryOrder → customCategories → catalogIds
  const orderedIds: string[] = []
  const pushUnique = (id: string) => {
    if (!id || hiddenSet.has(id) || orderedIds.includes(id)) return
    orderedIds.push(id)
  }
  for (const id of legacyPhase1.pinnedCategoryIds || []) pushUnique(id)
  for (const id of legacyPhase1.categoryOrder || []) pushUnique(id)
  for (const c of legacyPhase1.customCategories || []) pushUnique(c.id)
  for (const id of catalogIds) pushUnique(id)

  const lgBlocks: LayoutBlock[] = []
  let cursorY = 0
  for (const id of orderedIds) {
    const type: LayoutBlockType = customIdSet.has(id) ? 'custom_group' : 'category'
    const bounds = defaultBoundsForBlockType(type)
    const legacyOverride = legacyPhase1.blockOverrides?.[id]
    const w = clampInt(legacyOverride?.colSpan, bounds.minW, 12, 12)
    const h = collapsedSet.has(id) ? 2 : clampInt(legacyOverride?.rowSpan ? legacyOverride.rowSpan * 4 : undefined, bounds.minH, 60, bounds.h)
    const block: LayoutBlock = {
      id,
      type,
      refId: id,
      x: 0,
      y: cursorY,
      w,
      h,
      minW: bounds.minW,
      maxW: bounds.maxW,
      minH: bounds.minH,
      heightMode: 'auto',
      ...(collapsedSet.has(id) ? { style: { collapsed: true } } : {}),
    }
    cursorY += block.h
    lgBlocks.push(block)
  }

  const lg = sanitizeLayoutBlocks(lgBlocks, WORKSPACE_GRID_COLS.lg)
  const md = deriveBreakpointFromLg(lg, 'md')
  const sm = deriveBreakpointFromLg(lg, 'sm')

  const trash: TrashedItem[] = (options.legacyTrash || []).map((t) => ({
    id: t.id,
    type:
      t.level === 'L3_SITE'
        ? 'site'
        : t.level === 'L2_SUBCATEGORY'
          ? 'subcategory'
          : t.level === 'L1_MODULE'
            ? 'module'
            : 'category',
    title: t.title,
    deletedAt: t.deletedAt ?? Date.now(),
  }))
  if (Array.isArray(legacyPhase1.hiddenSites)) {
    for (const siteId of legacyPhase1.hiddenSites) {
      if (typeof siteId === 'string' && siteId.trim() && !trash.some((t) => t.id === siteId)) {
        trash.push({
          id: siteId.trim(),
          type: 'site',
          title: siteId.trim(),
          deletedAt: Date.now(),
        })
      }
    }
  }

  return {
    version: 2,
    id: workspaceId,
    name: workspaceName,
    gridConfig: {
      columns: 12,
      rowHeight: DEFAULT_WORKSPACE_ROW_HEIGHT,
      gap: [...DEFAULT_WORKSPACE_GAP] as [number, number],
      compactType: 'vertical',
    },
    breakpoints: { lg, md, sm },
    blockOverrides: buildBlockOverridesFromPhase1(legacyPhase1),
    trash,
  }
}

export interface AvailableWorkspaceBlock {
  id: string
  type: LayoutBlockType
  refId?: string
  defaultW?: number
  defaultH?: number
}

/**
 * 将运行时的可用区块列表（分类 + 自定义分组 + 可选顶层小组件）与已保存的 V2 断点坐标对齐：
 * - 已保存区块保留用户的精确 (x, y, w, h, locked, heightMode, style)；
 * - 新出现的分类/自定义分组按顺序追加到底部（不破坏已有坐标）；
 * - 已删除或隐藏的区块从当前视图过滤。
 */
export function reconcileBreakpointBlocks(
  layout: WorkspaceLayoutV2,
  bp: WorkspaceBreakpointKey,
  available: readonly AvailableWorkspaceBlock[],
): LayoutBlock[] {
  const cols = WORKSPACE_GRID_COLS[bp]
  const availableMap = new Map<string, AvailableWorkspaceBlock>()
  for (const item of available) {
    if (!availableMap.has(item.id)) availableMap.set(item.id, item)
  }

  const sourceList =
    layout.breakpoints[bp].length > 0
      ? layout.breakpoints[bp]
      : bp === 'lg'
        ? []
        : deriveBreakpointFromLg(layout.breakpoints.lg, bp)

  const placed: LayoutBlock[] = []
  const seen = new Set<string>()

  for (const existing of sourceList) {
    const meta = availableMap.get(existing.id)
    if (!meta || seen.has(existing.id)) continue
    seen.add(existing.id)
    const bounds = defaultBoundsForBlockType(meta.type)
    const minW = Math.min(existing.minW ?? bounds.minW, cols)
    const w = Math.min(cols, Math.max(minW, existing.w))
    const x = Math.min(Math.max(0, existing.x), Math.max(0, cols - w))
    placed.push({
      ...existing,
      type: meta.type,
      refId: meta.refId ?? existing.refId,
      w,
      x,
      minW,
      maxW: cols,
      minH: existing.minH ?? bounds.minH,
    })
  }

  let maxBottom = placed.reduce((max, b) => Math.max(max, b.y + b.h), 0)
  for (const meta of available) {
    if (seen.has(meta.id)) continue
    seen.add(meta.id)
    const bounds = defaultBoundsForBlockType(meta.type)
    const defaultW = bp === 'sm' ? cols : Math.min(cols, meta.defaultW ?? bounds.w)
    const block: LayoutBlock = {
      id: meta.id,
      type: meta.type,
      refId: meta.refId ?? meta.id,
      x: 0,
      y: maxBottom,
      w: defaultW,
      h: meta.defaultH ?? bounds.h,
      minW: bp === 'sm' ? cols : Math.min(bounds.minW, cols),
      maxW: cols,
      minH: bounds.minH,
      heightMode: 'auto',
    }
    maxBottom += block.h
    placed.push(block)
  }

  return sanitizeLayoutBlocks(placed, cols)
}

/** RGL onDragStop / onResizeStop 返回项的最小结构 */
export interface RglCommittedItem {
  i: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * 将 RGL 回调的新坐标写入指定断点（仅改动该断点，严格隔离 lg / md / sm）：
 * 若坐标与旧值完全一致返回 null，调用方据此跳过撤销栈提交，避免脏 Patch。
 */
export function applyRglCommitToLayout(
  layout: WorkspaceLayoutV2,
  bp: WorkspaceBreakpointKey,
  committed: readonly RglCommittedItem[],
  available: readonly AvailableWorkspaceBlock[],
  options: { markFixedScrollForId?: string } = {},
): WorkspaceLayoutV2 | null {
  const cols = WORKSPACE_GRID_COLS[bp]
  const currentBlocks = reconcileBreakpointBlocks(layout, bp, available)
  const commitMap = new Map<string, RglCommittedItem>()
  for (const item of committed) {
    commitMap.set(item.i, item)
  }

  let changed = false
  const nextBlocks = currentBlocks.map((block) => {
    const nextPos = commitMap.get(block.id)
    if (!nextPos) return block
    const w = clampInt(nextPos.w, block.minW ?? Math.min(4, cols), cols, block.w)
    const h = clampInt(nextPos.h, block.minH ?? 2, 120, block.h)
    const x = clampInt(nextPos.x, 0, Math.max(0, cols - w), block.x)
    const y = clampInt(nextPos.y, 0, 10000, block.y)
    const heightMode: BlockHeightMode =
      options.markFixedScrollForId === block.id && h !== block.h
        ? 'fixed-scroll'
        : block.heightMode ?? 'auto'
    if (
      x === block.x &&
      y === block.y &&
      w === block.w &&
      h === block.h &&
      heightMode === (block.heightMode ?? 'auto')
    ) {
      return block
    }
    changed = true
    return { ...block, x, y, w, h, heightMode }
  })

  if (!changed) return null

  const cleanedBp = sanitizeLayoutBlocks(nextBlocks, cols)
  return {
    ...layout,
    breakpoints: {
      ...layout.breakpoints,
      [bp]: cleanedBp,
    },
  }
}

export interface BlockUpdatePatch {
  w?: number
  h?: number
  x?: number
  y?: number
  locked?: boolean
  heightMode?: BlockHeightMode
  style?: Partial<BlockStyleConfig>
}

/** 更新指定断点下单个区块的属性（快捷列宽 / 高度模式 / 卡片形态 / 锁定 / 折叠） */
export function updateBlockInLayout(
  layout: WorkspaceLayoutV2,
  bp: WorkspaceBreakpointKey,
  blockId: string,
  patch: BlockUpdatePatch,
  available: readonly AvailableWorkspaceBlock[],
): WorkspaceLayoutV2 | null {
  const cols = WORKSPACE_GRID_COLS[bp]
  const currentBlocks = reconcileBreakpointBlocks(layout, bp, available)
  let changed = false

  const nextBlocks = currentBlocks.map((block) => {
    if (block.id !== blockId) return block
    const minW = block.minW ?? Math.min(4, cols)
    const nextW = patch.w !== undefined ? clampInt(patch.w, minW, cols, block.w) : block.w
    const nextX =
      patch.x !== undefined
        ? clampInt(patch.x, 0, Math.max(0, cols - nextW), block.x)
        : Math.min(block.x, Math.max(0, cols - nextW))
    const nextY = patch.y !== undefined ? clampInt(patch.y, 0, 10000, block.y) : block.y
    const nextH = patch.h !== undefined ? clampInt(patch.h, block.minH ?? 2, 120, block.h) : block.h
    const nextLocked = patch.locked !== undefined ? patch.locked : block.locked
    const nextHeightMode = patch.heightMode !== undefined ? patch.heightMode : block.heightMode ?? 'auto'
    const nextStyle =
      patch.style !== undefined
        ? sanitizeBlockStyle({ ...(block.style || {}), ...patch.style })
        : block.style

    const nextBlock: LayoutBlock = {
      ...block,
      x: nextX,
      y: nextY,
      w: nextW,
      h: nextH,
      heightMode: nextHeightMode,
      ...(nextLocked ? { locked: true } : {}),
      ...(nextStyle ? { style: nextStyle } : {}),
    }
    if (!nextLocked) delete nextBlock.locked
    if (!nextStyle) delete nextBlock.style

    if (JSON.stringify(nextBlock) === JSON.stringify(block)) return block
    changed = true
    return nextBlock
  })

  if (!changed) return null

  return {
    ...layout,
    breakpoints: {
      ...layout.breakpoints,
      [bp]: sanitizeLayoutBlocks(nextBlocks, cols),
    },
  }
}

/**
 * 软删除区块到 V2 回收站，记录它在 lg/md/sm 三个断点上的完整坐标，
 * 还原时可精准尝试原位恢复。
 */
export function trashBlockInLayout(
  layout: WorkspaceLayoutV2,
  blockId: string,
  title: string,
  available: readonly AvailableWorkspaceBlock[],
): WorkspaceLayoutV2 {
  const previousLayout: Partial<Record<WorkspaceBreakpointKey, LayoutBlock>> = {}
  const nextBreakpoints: WorkspaceLayoutV2['breakpoints'] = {
    lg: [],
    md: [],
    sm: [],
  }
  let blockType: LayoutBlockType = 'category'

  for (const bp of ['lg', 'md', 'sm'] as const) {
    const list = reconcileBreakpointBlocks(layout, bp, available)
    for (const b of list) {
      if (b.id === blockId) {
        previousLayout[bp] = b
        blockType = b.type
      } else {
        nextBreakpoints[bp].push(b)
      }
    }
  }

  const nextTrash: TrashedItem[] = [
    {
      id: blockId,
      type: blockType,
      title,
      refId: blockId,
      deletedAt: Date.now(),
      previousLayout,
    },
    ...layout.trash.filter((item) => item.id !== blockId),
  ]

  return {
    ...layout,
    breakpoints: nextBreakpoints,
    trash: nextTrash,
  }
}

/** 从 V2 回收站还原区块，优先按原 (x, y, w, h) 坐标原位插入（碰撞时向下顺延） */
export function restoreBlockInLayout(
  layout: WorkspaceLayoutV2,
  blockId: string,
): WorkspaceLayoutV2 {
  const target = layout.trash.find((item) => item.id === blockId)
  if (!target) return layout

  const nextBreakpoints: WorkspaceLayoutV2['breakpoints'] = {
    lg: [...layout.breakpoints.lg],
    md: [...layout.breakpoints.md],
    sm: [...layout.breakpoints.sm],
  }

  if (target.previousLayout) {
    for (const bp of ['lg', 'md', 'sm'] as const) {
      const saved = target.previousLayout[bp]
      if (saved && !nextBreakpoints[bp].some((b) => b.id === blockId)) {
        nextBreakpoints[bp] = sanitizeLayoutBlocks([...nextBreakpoints[bp], saved], WORKSPACE_GRID_COLS[bp])
      }
    }
  }

  return {
    ...layout,
    breakpoints: nextBreakpoints,
    trash: layout.trash.filter((item) => item.id !== blockId),
  }
}

/** 由内容真实像素高度换算 RGL 行数 h（用于 heightMode: 'auto'） */
export function computeAutoRowsForHeight(
  contentHeightPx: number,
  rowHeight: number = DEFAULT_WORKSPACE_ROW_HEIGHT,
  gapY: number = DEFAULT_WORKSPACE_GAP[1],
  minH: number = 3,
): number {
  if (!Number.isFinite(contentHeightPx) || contentHeightPx <= 0) return minH
  // RGL 高度公式：height = rowHeight * h + gapY * (h - 1) => h = ceil((height + gapY) / (rowHeight + gapY))
  const rows = Math.ceil((contentHeightPx + gapY) / (rowHeight + gapY))
  return Math.min(120, Math.max(minH, rows))
}
