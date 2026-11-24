/**
 * 网址展示模式强类型单一真相注册表（`VIEW_MODE_REGISTRY`）。
 *
 * 整合 Raycast / Linear / Arc / Raindrop.io / iTab / Pinboard 7 大主流网址展示范式，
 * 集中声明每种模式的元信息、响应式 `@container` 网格、整行条数算法、移动端降级策略与 DIY 编辑态协议。
 *
 * 兼容历史别名 `'mini-chip'`（运行时自动归一为 `'minimal'`）。
 * 纯 TypeScript 模块：零 React / zod 依赖，可被 SSR、客户端存储、配置清洗器与测试共享。
 */
import {
  CARD_GRID,
  CARD_GRID_COMPACT_BAR,
  CARD_GRID_DIRECTORY,
  CARD_GRID_ICON_WALL,
  CARD_GRID_LIST,
  CARD_GRID_MINIMAL,
  CARD_GRID_RICH,
} from '../responsive-grid'

export type CanonicalCardDisplayMode =
  | 'standard'
  | 'icon-wall'
  | 'list'
  | 'minimal'
  | 'compact'
  | 'rich'
  | 'directory'

/** 包含历史别名 `'mini-chip'`（运行时与保存路径均兼容并归一为 `'minimal'`） */
export type CardDisplayMode = CanonicalCardDisplayMode | 'mini-chip'

export const VIEW_MODE_IDS: readonly CanonicalCardDisplayMode[] = [
  'standard',
  'directory',
  'icon-wall',
  'list',
  'minimal',
  'compact',
  'rich',
] as const

export const VALID_CARD_DISPLAY_MODES: readonly CardDisplayMode[] = [
  'standard',
  'icon-wall',
  'list',
  'minimal',
  'compact',
  'rich',
  'directory',
  'mini-chip',
] as const

export type ViewModeDiyHandleStyle = 'inline-compact' | 'overlay-corner' | 'bottom-dock'

export interface ViewModeDiyBehavior {
  /** 是否支持 DIY 拖拽与原位编排 */
  supported: boolean
  /** 编辑态手柄形态：极简列表/目录使用紧凑内联手柄，绝不出现大号悬浮条遮挡标题 */
  handleStyle: ViewModeDiyHandleStyle
  /** 简短编辑态行为说明 */
  note: string
}

export interface ViewModeConfig {
  id: CanonicalCardDisplayMode
  /** 规范名称 */
  name: string
  /** 窄屏顶栏精简短名（2 字） */
  shortName: string
  /** 兼容旧字段：完整中文名（等同 name） */
  label: string
  /** 兼容旧字段：桌面顶栏短名 */
  shortLabel: string
  /** 兼容旧字段：中窄屏 2 字名（等同 shortName） */
  compactLabel: string
  /** 英文副标 */
  enLabel: string
  /** 简短特色标签 */
  badge: string
  /** 简短适用场景说明（≤14 字） */
  description: string
  /** 密度与一屏容量提示（如 `高密度 · 一屏 ~27 站`） */
  densityLabel: string
  /** 折叠态基准展示行数 */
  previewRows: number
  /** 折叠态单组条数上限（自动向下取整到列数的整倍数，防止高列数无谓 DOM 膨胀） */
  maxPreviewItems: number
  /** 全宽模块响应式 `@container` 网格类名 */
  gridClassName: string
  /** 兼容旧字段：等同 gridClassName */
  gridClass: string
  /** 中窄模块（moduleColSpan 6..9）网格类名 */
  mediumGridClass: string
  /** 极窄模块（moduleColSpan <= 5）网格类名 */
  narrowGridClass: string
  /** 按容器真实列数计算每子分类默认展示条数（始终为列数的精确整倍数） */
  defaultItemsPerSubcategory: (cols: number) => number
  /** `<640px` 移动端自动降级目标模式（null 表示原生完美适配手机端）；切回桌面端自动恢复原选择 */
  mobileFallbackId: CanonicalCardDisplayMode | null
  /** DIY 排版模式下的编辑行为声明 */
  diyCompatible: ViewModeDiyBehavior
  /** 是否使用用户密度变量 `--density-grid-gap` 控制外层间距 */
  usesDensityGap: boolean
}

/** 兼容既有类型导出名 */
export type CardDisplayModeMeta = ViewModeConfig

function createDefaultItemsCalculator(previewRows: number, maxPreviewItems: number) {
  return (cols: number): number => {
    const safeCols = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 0
    if (safeCols <= 0) return 1
    const cappedRows = Math.max(
      1,
      Math.min(previewRows, Math.floor(maxPreviewItems / safeCols)),
    )
    return safeCols * cappedRows
  }
}

/**
 * 7 大网址展示模式强类型注册表（Single Source of Truth）。
 */
export const VIEW_MODE_REGISTRY: Readonly<Record<CanonicalCardDisplayMode, ViewModeConfig>> = {
  standard: {
    id: 'standard',
    name: '标准卡片',
    shortName: '卡片',
    label: '标准卡片',
    shortLabel: '标准卡片',
    compactLabel: '卡片',
    enLabel: 'Standard',
    badge: '默认推荐',
    description: '图文均衡 · 简介标签俱全',
    densityLabel: '均衡 · 一屏 ~9 站',
    previewRows: 2,
    maxPreviewItems: 8,
    gridClassName: CARD_GRID,
    gridClass: CARD_GRID,
    mediumGridClass: 'grid grid-cols-1 gap-[var(--density-grid-gap,0.875rem)] @xl:grid-cols-2',
    narrowGridClass: 'grid grid-cols-1 gap-[var(--density-grid-gap,0.875rem)]',
    defaultItemsPerSubcategory: createDefaultItemsCalculator(2, 8),
    mobileFallbackId: null,
    diyCompatible: {
      supported: true,
      handleStyle: 'bottom-dock',
      note: '底部通栏显式拖拽与微动作',
    },
    usesDensityGap: true,
  },
  'icon-wall': {
    id: 'icon-wall',
    name: '图标启动台',
    shortName: '图标',
    label: '图标启动台',
    shortLabel: '图标墙',
    compactLabel: '图标',
    enLabel: 'App Dock',
    badge: 'iTab 桌面',
    description: '大图标方阵 · 桌面直觉秒开',
    densityLabel: '高密度 · 一屏 ~24 站',
    previewRows: 2,
    maxPreviewItems: 16,
    gridClassName: CARD_GRID_ICON_WALL,
    gridClass: CARD_GRID_ICON_WALL,
    mediumGridClass: 'grid grid-cols-3 gap-2.5 @xl:grid-cols-4',
    narrowGridClass: 'grid grid-cols-2 gap-2.5 @sm:grid-cols-3',
    defaultItemsPerSubcategory: createDefaultItemsCalculator(2, 16),
    mobileFallbackId: null,
    diyCompatible: {
      supported: true,
      handleStyle: 'overlay-corner',
      note: '左上角紧凑手柄，零遮挡图标与标题',
    },
    usesDensityGap: false,
  },
  list: {
    id: 'list',
    name: '极客清单',
    shortName: '清单',
    label: '极客清单',
    shortLabel: '清单列表',
    compactLabel: '清单',
    enLabel: 'List View',
    badge: '高可读',
    description: '表格明细流 · 简介域名同扫',
    densityLabel: '明细流 · 一屏 ~12 站',
    previewRows: 6,
    maxPreviewItems: 6,
    gridClassName: CARD_GRID_LIST,
    gridClass: CARD_GRID_LIST,
    mediumGridClass: CARD_GRID_LIST,
    narrowGridClass: CARD_GRID_LIST,
    defaultItemsPerSubcategory: createDefaultItemsCalculator(6, 6),
    mobileFallbackId: 'standard',
    diyCompatible: {
      supported: true,
      handleStyle: 'inline-compact',
      note: '右侧紧凑内联拖拽手柄，不遮挡标题与简介',
    },
    usesDensityGap: false,
  },
  minimal: {
    id: 'minimal',
    name: '极速胶囊',
    shortName: '胶囊',
    label: '极速胶囊',
    shortLabel: '极速胶囊',
    compactLabel: '胶囊',
    enLabel: 'Mini Chip',
    badge: '超高密度',
    description: '极速药丸流 · 单屏超高密度',
    densityLabel: '极高密 · 一屏 ~45 站',
    previewRows: 3,
    maxPreviewItems: 15,
    gridClassName: CARD_GRID_MINIMAL,
    gridClass: CARD_GRID_MINIMAL,
    mediumGridClass: 'grid grid-cols-2 gap-2 @xl:grid-cols-3',
    narrowGridClass: 'grid grid-cols-2 gap-2',
    defaultItemsPerSubcategory: createDefaultItemsCalculator(3, 15),
    mobileFallbackId: null,
    diyCompatible: {
      supported: true,
      handleStyle: 'inline-compact',
      note: '胶囊尾部紧凑内联拖拽手柄，标题零遮挡',
    },
    usesDensityGap: false,
  },
  compact: {
    id: 'compact',
    name: '紧凑条形',
    shortName: '紧凑',
    label: '紧凑条形',
    shortLabel: '紧凑条形',
    compactLabel: '紧凑',
    enLabel: 'Compact',
    badge: '高效均衡',
    description: '精炼单行条 · 高效省屏空间',
    densityLabel: '高密度 · 一屏 ~24 站',
    previewRows: 3,
    maxPreviewItems: 12,
    gridClassName: CARD_GRID_COMPACT_BAR,
    gridClass: CARD_GRID_COMPACT_BAR,
    mediumGridClass: 'grid grid-cols-1 gap-2 @xl:grid-cols-2',
    narrowGridClass: 'grid grid-cols-1 gap-2',
    defaultItemsPerSubcategory: createDefaultItemsCalculator(3, 12),
    mobileFallbackId: null,
    diyCompatible: {
      supported: true,
      handleStyle: 'inline-compact',
      note: '右侧渐隐紧凑内联手柄，保留单行清晰度',
    },
    usesDensityGap: false,
  },
  rich: {
    id: 'rich',
    name: '视觉画廊',
    shortName: '画廊',
    label: '视觉画廊',
    shortLabel: '视觉画廊',
    compactLabel: '画廊',
    enLabel: 'Gallery',
    badge: '沉浸大卡',
    description: '渐变封面图 · 沉浸画廊探索',
    densityLabel: '宽幅画廊 · 一屏 ~6 站',
    previewRows: 2,
    maxPreviewItems: 6,
    gridClassName: CARD_GRID_RICH,
    gridClass: CARD_GRID_RICH,
    mediumGridClass: 'grid grid-cols-1 gap-[var(--density-grid-gap,0.875rem)] @xl:grid-cols-2',
    narrowGridClass: 'grid grid-cols-1 gap-[var(--density-grid-gap,0.875rem)]',
    defaultItemsPerSubcategory: createDefaultItemsCalculator(2, 6),
    mobileFallbackId: null,
    diyCompatible: {
      supported: true,
      handleStyle: 'bottom-dock',
      note: '底部通栏编辑操作，不遮挡封面横幅',
    },
    usesDensityGap: true,
  },
  directory: {
    id: 'directory',
    name: '书签目录',
    shortName: '目录',
    label: '书签目录',
    shortLabel: '书签目录',
    compactLabel: '目录',
    enLabel: 'Directory',
    badge: '无边框极简',
    description: '极简高效 · 扫视快零疲劳',
    densityLabel: '高密度 · 一屏 ~27 站',
    previewRows: 3,
    maxPreviewItems: 12,
    gridClassName: CARD_GRID_DIRECTORY,
    gridClass: CARD_GRID_DIRECTORY,
    mediumGridClass: 'grid grid-cols-1 gap-x-4 gap-y-0.5 @xl:grid-cols-2',
    narrowGridClass: 'grid grid-cols-1 gap-y-0.5',
    defaultItemsPerSubcategory: createDefaultItemsCalculator(3, 12),
    mobileFallbackId: null,
    diyCompatible: {
      supported: true,
      handleStyle: 'inline-compact',
      note: '右侧紧凑内联拖拽手柄，零悬浮遮挡标题',
    },
    usesDensityGap: false,
  },
} as const

/** 按展示顺序排列的全部 7 种模式列表（兼容既有调用方） */
export const CARD_DISPLAY_MODE_OPTIONS: readonly ViewModeConfig[] = [
  VIEW_MODE_REGISTRY.standard,
  VIEW_MODE_REGISTRY['icon-wall'],
  VIEW_MODE_REGISTRY.list,
  VIEW_MODE_REGISTRY.minimal,
  VIEW_MODE_REGISTRY.compact,
  VIEW_MODE_REGISTRY.rich,
  VIEW_MODE_REGISTRY.directory,
] as const

/** 规范化任意卡片展示模式值（兼容历史 `'mini-chip'` 别名与非法值回退 `'standard'`） */
export function normalizeCardDisplayMode(mode?: string | null): CanonicalCardDisplayMode {
  if (!mode) return 'standard'
  if (mode === 'mini-chip') return 'minimal'
  if (mode in VIEW_MODE_REGISTRY) return mode as CanonicalCardDisplayMode
  return 'standard'
}

/** 读取模式元数据 */
export function getCardDisplayModeMeta(mode?: string | null): ViewModeConfig {
  return VIEW_MODE_REGISTRY[normalizeCardDisplayMode(mode)]
}

/**
 * 解析当前视口下实际渲染的展示模式：
 * - `<640px` 移动端遇到声明了 `mobileFallbackId` 的桌面专属宽表模式时自动降级，
 *   但绝不改写用户保存的偏好；切回桌面端（`>=640px`）自动恢复用户原选择。
 */
export function resolveEffectiveViewMode(
  mode: CardDisplayMode | undefined,
  isMobileViewport: boolean,
): CanonicalCardDisplayMode {
  const canonical = normalizeCardDisplayMode(mode)
  if (!isMobileViewport) return canonical
  const fallback = VIEW_MODE_REGISTRY[canonical].mobileFallbackId
  return fallback ?? canonical
}

/** 按卡片展示模式与模块列宽（12 列栅格）返回容器查询网格类名 */
export function getGridClassForCardMode(mode: CardDisplayMode | undefined, moduleColSpan = 12): string {
  const meta = getCardDisplayModeMeta(mode)
  if (moduleColSpan <= 5) return meta.narrowGridClass
  if (moduleColSpan <= 9) return meta.mediumGridClass
  return meta.gridClassName
}

/** 返回该模式折叠态下的理想展示行数 */
export function getPreviewRowsForCardMode(mode?: CardDisplayMode): number {
  return getCardDisplayModeMeta(mode).previewRows
}

/**
 * 统一计算任意展示模式在指定容器列数下的折叠态预览条数（19 大类同口径）：
 * 委托至 `VIEW_MODE_REGISTRY[mode].defaultItemsPerSubcategory(cols)`。
 */
export function computePreviewCountForMode(mode: CardDisplayMode | undefined, cols: number): number {
  return getCardDisplayModeMeta(mode).defaultItemsPerSubcategory(cols)
}

/** 从网址中提取干净的展示用域名（去掉协议与 www. 前缀），供清单/目录/提示展示 */
export function extractDisplayHostname(href: string | undefined): string {
  if (!href) return ''
  try {
    const parsed = new URL(href)
    return parsed.hostname.replace(/^www\./i, '')
  } catch {
    return href.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0] || ''
  }
}
