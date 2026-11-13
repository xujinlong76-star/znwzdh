'use client'

/**
 * 首页 DIY 的共享状态、本地存储、迁移与分享 hash（从 use-home-diy.ts 拆出，2026-10-19 P1-1）。
 *
 * 拆分边界：这里不依赖 React，也不认识 hook；use-home-diy.ts 通过
 * `export * from './home-diy-storage'` 保持既有导入路径可用。
 */
import { decodeShareLinkPayload, parseSharePayload } from '@/lib/diy-share-link'
import {
  clampCardOpacity,
  createLayoutHistory,
  isSafeWallpaperUrl,
  pushLayoutHistory,
  redoLayoutHistory,
  undoLayoutHistory,
  validateAndCleanDIYConfig,
  type LayoutHistoryState,
} from '@/lib/modular/diy-presets'
import {
  bumpClocks,
  diffChangedSlots,
  mergeLayoutSlots,
  readSlotClocks,
  writeSlotClocks,
  type LayoutSlotClocks,
} from '@/lib/modular/layout-sync'

export type HomeViewMode = 'hybrid' | 'classic' | 'workbench'
export type CardDisplayMode = 'compact' | 'standard' | 'rich' | 'minimal' | 'mini-chip'
export type CanvasBackground = 'mesh' | 'dots' | 'grid' | 'aurora' | 'clean'
export type AccentColor = 'default' | 'violet' | 'emerald' | 'amber' | 'rose'

export interface CustomCategoryItem {
  id: string
  title: string
  href: string
  icon?: string
  description?: string
}

export interface CustomCategory {
  id: string
  title: string
  icon?: string
  items: CustomCategoryItem[]
  createdAt: number
}

export interface HomeDIYConfig {
  version: 3
  viewMode: HomeViewMode
  cardDisplayMode: CardDisplayMode
  canvasBackground: CanvasBackground
  accentColor: AccentColor
  heroDeckCollapsed: boolean
  heroDeckWidgets: string[]
  enableAdaptiveRanking: boolean
  // 分类可视化编排
  categoryOrder: string[]
  pinnedCategoryIds: string[]
  hiddenCategoryIds: string[]
  collapsedCategoryIds: string[]
  pinnedSiteIdsByCategory: Record<string, string[]>
  customCategories: CustomCategory[]
  siteCategoryOverrides: Record<string, string>
  // 单分类卡片形态单独覆盖 (Category Density Overrides)
  categoryDensityOverrides?: Record<string, CardDisplayMode>
  // 首屏常驻速览星标坞 (Pinned Speed Dial Dock)
  speedDialEnabled?: boolean
  speedDialPinnedIds?: string[]
  customWallpaperUrl?: string
  glassmorphismBlur?: number
  cardOpacity?: number
  updatedAt: number
}

export const STORAGE_KEY = 'navhub_home_diy_config_v3'
const LEGACY_STORAGE_KEY_V2 = 'navhub_home_diy_config_v2'
const LEGACY_STORAGE_KEY_V1 = 'navhub_home_diy_config_v1'
/**
 * 插槽时钟独立存储，不塞进 config。
 * 原因：validateAndCleanDIYConfig 是白名单清洗，任何加进 config 的
 * 额外字段都会在每次加载时被静默剔除，时钟根本活不过一次刷新。
 */
export const STORAGE_CLOCKS_KEY = 'navhub_home_diy_clocks_v1'

const DEFAULT_HERO_WIDGETS = [
  'quick-search',
  'clock-pomodoro',
  'weather-clock',
  'favorites-dock',
  'quick-tools',
]

export const DEFAULT_CONFIG: HomeDIYConfig = {
  version: 3,
  viewMode: 'hybrid',
  cardDisplayMode: 'standard',
  canvasBackground: 'mesh',
  accentColor: 'default',
  heroDeckCollapsed: false,
  heroDeckWidgets: DEFAULT_HERO_WIDGETS,
  enableAdaptiveRanking: false,
  categoryOrder: [],
  pinnedCategoryIds: [],
  hiddenCategoryIds: [],
  collapsedCategoryIds: [],
  pinnedSiteIdsByCategory: {},
  customCategories: [],
  siteCategoryOverrides: {},
  categoryDensityOverrides: {},
  speedDialEnabled: true,
  speedDialPinnedIds: [],
  customWallpaperUrl: '',
  glassmorphismBlur: 12,
  cardOpacity: 0.9,
  updatedAt: Date.now(),
}

/* ------------------------------------------------------------------ *
 * 共享状态：整个页面只保留一份 DIY 配置
 * ------------------------------------------------------------------ */

/**
 * 为什么不是 useState（这是修一个真实缺陷，不是洁癖）：
 *
 * 首页有 6 个组件各自调用 useHomeDIY()（navigation-content / home-diy-toolbar /
 * home-hero-deck / view-mode-toggle / category-in-situ-controls /
 * keyboard-shortcuts-dialog），而 useState 在**每个组件里各存一份**。于是：
 *
 *   - view-mode-toggle 里 setViewMode('classic') 只改了它自己那份，
 *     navigation-content 渲染用的 viewMode 纹丝不动 —— 用户点「经典全景流」
 *     页面毫无变化，刷新后才生效；
 *   - 工具栏点「DIY 排版工坊」只改了工具栏那份 isEditingLayout，
 *     navigation-content 里靠 isEditingLayout 显示的拖拽手柄永远不会出现，
 *     整个拖拽编排形同虚设；
 *   - 撤销栈各存一份：在 A 处按 Ctrl+Z 撤销的是 A 的最后一次改动，
 *     而不是用户刚刚做的那次。
 *
 * 代码里以前 dispatch 过 'navhub_home_diy_updated'，但从来没有人监听它，
 * 2026-11-12 已随事件一并删除 —— 跨标签页同步（BroadcastChannel）反而是通的，
 * 于是这个缺陷很容易被当成「偶发」。
 *
 * 正确做法：状态挪到模块级单例，组件用 useSyncExternalStore 订阅。两点必须注意：
 *   1. 首帧要和 SSR 一致，所以 sharedState 的初始值就是 DEFAULT_CONFIG，
 *      读本地存储放在挂载后的 effect 里（hydrateHomeDiy），且**只读一次**；
 *   2. getHomeDiySnapshot 必须「没变就返回同一个引用」，否则
 *      useSyncExternalStore 会认为状态在无限变化。
 */

/** 只用到读写的存储接口：测试里塞个假实现即可，不必把 DOM 拖进来 */
export interface HomeDiyStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  /** 可选：迁移后删老键、分享备份剪枝时用；没有它时调用方退回「不删」 */
  removeItem?(key: string): void
  /** 可选：分享备份剪枝时枚举键；没有它时走 length/key(i) 枚举 */
  keys?(): string[]
}

/**
 * #diy= 分享链接能携带的字段（长字段名）。短字段 → 长字段的映射只有一处：
 * diy-layout-schema.ts 的 SHARE_SHORT_KEY_MAP（vm→viewMode、cdm→cardDisplayMode、
 * bg→canvasBackground、ac→accentColor、co→categoryOrder、pco→pinnedCategoryIds、
 * hco→hiddenCategoryIds、sco→siteCategoryOverrides、wp→customWallpaperUrl、
 * gb→glassmorphismBlur、co_op→cardOpacity），由 parseSharePayload 展开。
 * 分享链接以外的字段（自建分类、折叠状态、速览坞等）永远不在 carriedFields 里，
 * 确认时也永远不会被改动。
 */
export type HomeDiyShareField =
  | 'viewMode'
  | 'cardDisplayMode'
  | 'canvasBackground'
  | 'accentColor'
  | 'categoryOrder'
  | 'pinnedCategoryIds'
  | 'hiddenCategoryIds'
  | 'siteCategoryOverrides'
  | 'customWallpaperUrl'
  | 'glassmorphismBlur'
  | 'cardOpacity'

export interface PendingHomeDiyShare {
  imported: HomeDIYConfig
  diff: string[]
  warning: string | null
  /**
   * 待确认内容的来源：'share' = #diy= 分享链接，'import' = 文件/剪贴板导入。
   * 确认对话框据此换标题与提示文案；不填默认 'share'（旧分享路径）。
   */
  source?: 'share' | 'import'
  /**
   * 链接实际携带的字段（按解析时短/长键是否出现记录）。
   * imported 是清洗后的全量配置（没携带的字段填的是默认值），
   * 所以确认与差异预览都必须以 carriedFields 为准过滤：
   * 只应用/只列出 carriedFields 里的字段，没携带的字段保持本地值。
   */
  carriedFields: HomeDiyShareField[]
}

export interface HomeDiySharedState {
  config: HomeDIYConfig
  history: LayoutHistoryState<HomeDIYConfig>
  /** 编排模式：工具栏与导航区共享同一份，否则拖拽手柄不会出现 */
  isEditingLayout: boolean
  /** 非 null = 上次落盘失败；改动已在内存生效，但刷新会丢 */
  storageWarning: string | null
  pendingShare: PendingHomeDiyShare | null
  /**
   * 预设悬停预览（只覆盖快照里的 config，不落盘、不进撤销栈）。
   * 悬停结束会清掉它；真实提交只清「本次改动确实碰到的」预览字段——
   * 拖拽改分类顺序时预览的卡片形态/背景没变，快照就不该突然跳回真实值。
   * 渲染层读到的 config 永远是「真实配置 + 预览覆盖」，提交路径读
   * sharedState.config（真实值）。
   */
  preview: DiyPreviewPatch | null
}

/** 预览覆盖的渲染字段：卡片形态 / 画布背景 / 视图模式 / 展板折叠 / 展板组件。
 * 密度走 document 的 data-density 属性覆盖，不在这里。
 * 渲染层读的是快照 config（真实配置 + 预览覆盖），所以扩这个类型即可生效，
 * 无需改渲染：viewMode 由 navigation-content 从快照读、heroDeckCollapsed /
 * heroDeckWidgets 由 home-hero-deck 从快照读。 */
export type DiyPreviewPatch = Partial<
  Pick<
    HomeDIYConfig,
    'cardDisplayMode' | 'canvasBackground' | 'viewMode' | 'heroDeckCollapsed' | 'heroDeckWidgets'
  >
>

/** 分享备份键前缀（`STORAGE_KEY.share-backup.<时间戳>`），剪枝与快照列表共用 */
export const DIY_SHARE_BACKUP_PREFIX = `${STORAGE_KEY}.share-backup.`
/** 分享备份键最多保留份数：新建备份时剪掉更旧的，键不许无界增长 */
export const DIY_SHARE_BACKUP_MAX_COUNT = 10

const INITIAL_SHARED_STATE: HomeDiySharedState = {
  config: DEFAULT_CONFIG,
  history: createLayoutHistory(DEFAULT_CONFIG),
  isEditingLayout: false,
  storageWarning: null,
  pendingShare: null,
  preview: null,
}

let sharedState: HomeDiySharedState = INITIAL_SHARED_STATE
const sharedListeners = new Set<() => void>()
/** 本地存储只读一次（见下方 hydrateHomeDiy 的说明） */
let sharedHydrated = false

/**
 * 按来源登记的 storageWarning：不同来源的提示互不覆盖、也不被无关的成功清掉。
 *
 * 旧实现是单值：hydrate 里损坏提示刚写上就被分享提示盖掉（用户永远看不到
 * 前一条），而任何一次落盘成功又把「与落盘无关」的提示（损坏/分享）一并清零。
 * 现在三个来源各记一条 —— 'corrupt'（本地配置读不出来）、'share'
 * （#diy= 链接有内容被吃掉）、'disk'（落盘失败）—— 对外仍拼成一条字符串
 * （横幅只画一条），但：后来的提示不再悄悄顶掉前一条没读过的；落盘成功
 * 只清 'disk' 这一路；用户点关闭 / 取消分享只清自己那一路。
 */
const activeStorageWarnings = new Map<string, string>()

/** 各来源提示拼成的对外文案（无提示时 null；顺序按来源首次登记） */
function rebuildStorageWarning(): string | null {
  return activeStorageWarnings.size === 0 ? null : [...activeStorageWarnings.values()].join('\n')
}

/**
 * 登记（message 非空）或清除（message 为 null）某来源的提示，返回合并后的
 * 对外文案 —— 调用方把它随本次提交一起写进共享状态，只改提示本身。
 */
function trackStorageWarning(source: string, message: string | null): string | null {
  if (message === null) activeStorageWarnings.delete(source)
  else activeStorageWarnings.set(source, message)
  return rebuildStorageWarning()
}

function clearAllStorageWarnings(): void {
  activeStorageWarnings.clear()
}

/**
 * 对外快照缓存：预览开启时返回「真实配置 + 预览覆盖」的新对象，
 * 没开预览时直接返回 sharedState 本身。没变就返回同一个引用，
 * 否则 useSyncExternalStore 会认为状态在无限变化。
 */
let cachedSnapshot: HomeDiySharedState = INITIAL_SHARED_STATE

function rebuildSnapshot(): void {
  cachedSnapshot = sharedState.preview
    ? { ...sharedState, config: { ...sharedState.config, ...sharedState.preview } }
    : sharedState
}

export function subscribeHomeDiy(listener: () => void): () => void {
  sharedListeners.add(listener)
  return () => {
    sharedListeners.delete(listener)
  }
}

export function getHomeDiySnapshot(): HomeDiySharedState {
  return cachedSnapshot
}

/** 仅供测试隔离：把共享状态退回初始值（生产代码不要调用） */
export function resetHomeDiySharedState(): void {
  clearPendingDiskWrite()
  clearUndoCoalesce()
  clearAllStorageWarnings()
  lastClocks = {}
  sharedState = INITIAL_SHARED_STATE
  sharedHydrated = false
  rebuildSnapshot()
  for (const listener of sharedListeners) listener()
}

/**
 * 设置 / 清除预设悬停预览。只改快照、不碰磁盘与撤销栈；
 * 传 null 恢复真实配置。调用方（工具栏）负责在悬停结束、菜单关闭、
 * 点击应用时清掉；真实提交只清本次改动碰到的预览字段（见 writeHomeDiyState）。
 */
export function setHomeDiyPreview(patch: DiyPreviewPatch | null): void {
  commitSharedState({ preview: patch })
}

function commitSharedState(patch: Partial<HomeDiySharedState>): void {
  sharedState = { ...sharedState, ...patch }
  rebuildSnapshot()
  for (const listener of sharedListeners) listener()
}

/**
 * 把一份已准备好的待确认内容（分享或导入）挂起：只改共享状态，不落盘、
 * 不替换本地配置；用户在确认对话框里确认后才应用。
 * 导入路径（home-diy-io.ts 的 prepareHomeDiyImport）用它复用分享确认管线。
 */
export function stageHomeDiyPendingShare(pending: PendingHomeDiyShare): void {
  commitSharedState({ pendingShare: pending })
}

/** localStorage 取不到时返回 null（SSR / 隐私模式），调用方据此降级并如实提示 */
export function safeLocalStorage(): HomeDiyStorage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    // 隐私模式 / 站点权限被拒：连读 window.localStorage 本身就会抛
    return null
  }
}

export type HomeDiyStorageFailureKind = 'quota' | 'unavailable' | 'unknown'

export function classifyHomeDiyStorageFailure(err: unknown): HomeDiyStorageFailureKind {
  if (err === null || err === undefined) {
    // 拿不到 localStorage（隐私模式 / SSR）：归入「不可用」，而不是「未知」
    return 'unavailable'
  }
  const name =
    typeof err === 'object' && 'name' in err ? String((err as { name?: unknown }).name ?? '') : ''
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota|exceeded|full/i.test(message)) {
    return 'quota'
  }
  if (name === 'SecurityError' || /denied|disabled|blocked|security/i.test(message)) {
    return 'unavailable'
  }
  return 'unknown'
}

/** 落盘失败必须能说清楚：为什么失败、这次改动还在不在、接下来怎么办 */
export function describeHomeDiyStorageFailure(err: unknown): string {
  const base = '这次排版改动没能写入浏览器本地存储：改动已经生效，但刷新后会丢失。'
  switch (classifyHomeDiyStorageFailure(err)) {
    case 'quota':
      return base + '本地存储已满，可以先删掉一些自定义分类或自定义壁纸，再重做这次调整。'
    case 'unavailable':
      return base + '浏览器不允许本站读写本地存储（隐私模式或站点权限被拒）。'
    default:
      return base + '建议用「导出配置」留一份备份，避免刷新后重做。'
  }
}

export interface HomeDiyWriteResult {
  config: HomeDIYConfig
  clocks: LayoutSlotClocks
  /**
   * false = 没能落盘（改动仍已在内存生效，storageWarning 已写入共享状态）。
   * 注意：落盘现在是防抖异步的，ok: true 只表示「已接纳进内存并排队落盘」；
   * 配额满之类只有真正 setItem 时才知道，成败以 storageWarning 为准。
   * 拿不到 localStorage 时 ok 立即为 false（同步可知）。
   */
  ok: boolean
  error?: unknown
}

/* ------------------------------------------------------------------ *
 * 落盘防抖 + 撤销合并：内存立即生效，磁盘写与撤销记录都节流
 * ------------------------------------------------------------------ */

/** 内存立即生效，磁盘写在最后一次改动后约 300ms 才执行一次 */
export const HOME_DIY_DISK_WRITE_DEBOUNCE_MS = 300
/** 同字段连续编辑合并进同一条撤销记录的时间窗 */
export const HOME_DIY_UNDO_COALESCE_WINDOW_MS = 500

interface PendingHomeDiyDiskWrite {
  config: HomeDIYConfig
  clocks: LayoutSlotClocks
}

let pendingDiskWrite: PendingHomeDiyDiskWrite | null = null
let pendingDiskTimer: ReturnType<typeof setTimeout> | null = null

/** 插槽时钟的内存最新值：防抖期间磁盘上的时钟还是旧的，bump 必须以它为准，
 * 否则两次快速提交会算出同一个 Lamport 值，跨标签合并时丢增量。 */
let lastClocks: LayoutSlotClocks = {}

function clearPendingDiskWrite(): void {
  pendingDiskWrite = null
  if (pendingDiskTimer !== null) {
    clearTimeout(pendingDiskTimer)
    pendingDiskTimer = null
  }
}

function scheduleHomeDiyDiskWrite(config: HomeDIYConfig, clocks: LayoutSlotClocks): void {
  pendingDiskWrite = { config, clocks }
  if (pendingDiskTimer !== null) clearTimeout(pendingDiskTimer)
  pendingDiskTimer = setTimeout(() => {
    pendingDiskTimer = null
    flushHomeDiyDiskWrites()
  }, HOME_DIY_DISK_WRITE_DEBOUNCE_MS)
}

/**
 * 立即执行挂起的磁盘写（没有挂起时什么都不做）。
 * 供测试确定性断言与页面卸载前兜底（beforeunload）用；正常路径走防抖定时器。
 * 成功时只在有旧提示要清掉的情况下才通知订阅者，避免每次编辑都多一次渲染。
 */
export function flushHomeDiyDiskWrites(): void {
  if (!pendingDiskWrite) return
  const { config, clocks } = pendingDiskWrite
  pendingDiskWrite = null
  if (pendingDiskTimer !== null) {
    clearTimeout(pendingDiskTimer)
    pendingDiskTimer = null
  }
  const storage = safeLocalStorage()
  let ok = true
  let error: unknown
  if (!storage) {
    ok = false
  } else {
    try {
      writeSlotClocks(STORAGE_CLOCKS_KEY, clocks)
      storage.setItem(STORAGE_KEY, JSON.stringify(config))
    } catch (err) {
      // 写盘失败要留痕：改动已在内存生效，但用户有权知道「刷新就没了」
      ok = false
      error = err
    }
  }
  const warning = ok
    ? trackStorageWarning('disk', null)
    : trackStorageWarning('disk', describeHomeDiyStorageFailure(error))
  if (sharedState.storageWarning !== warning) {
    commitSharedState({ storageWarning: warning })
  }
}

/** 同字段合并撤销的窗口状态：窗口起点配置 + 那次改动的顶层字段 */
let coalesceBase: HomeDIYConfig | null = null
let coalesceKeys: string[] | null = null
let coalesceAt = 0

function clearUndoCoalesce(): void {
  coalesceBase = null
  coalesceKeys = null
  coalesceAt = 0
}

/** 顶层变化字段（updatedAt 每次都变，不算；比较用引用，updater 只新建改动的字段） */
function changedTopLevelKeys(prev: HomeDIYConfig, next: HomeDIYConfig): string[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  const changed: string[] = []
  for (const k of keys) {
    if (k === 'updatedAt') continue
    if ((prev as unknown as Record<string, unknown>)[k] !== (next as unknown as Record<string, unknown>)[k]) {
      changed.push(k)
    }
  }
  return changed.sort()
}

/**
 * 磁盘时钟 + 内存最新时钟的合并值：防抖期间磁盘上的时钟还是旧的，
 * 一次本地提交（<300ms，还没落盘）必须以它为准，否则跨标签合并会把
 * 这次本地改动当成「磁盘上没有」而丢掉。写路径与远端合并路径共用同一份。
 */
export function getEffectiveSlotClocks(): Record<string, number> {
  const diskClocks = readSlotClocks(STORAGE_CLOCKS_KEY)
  const effective: LayoutSlotClocks = { ...diskClocks }
  for (const [k, v] of Object.entries(lastClocks)) {
    effective[k] = Math.max(effective[k] ?? 0, v)
  }
  return effective
}

/**
 * 提交后预览剩下的部分：只清本次提交确实改动的预览字段。
 * 拖拽改分类顺序、改强调色之类没碰预览字段的提交，预览原样保留；
 * 改了其中一个，只清那一个，其余继续盖着快照。按预览的键逐个比对，
 * 这样 patch 扩了新字段（viewMode / heroDeckCollapsed / heroDeckWidgets）
 * 也不用再改这里。
 */
function previewAfterCommit(
  prev: HomeDIYConfig,
  next: HomeDIYConfig,
  preview: DiyPreviewPatch | null,
): DiyPreviewPatch | null {
  if (!preview) return null
  const changed = changedTopLevelKeys(prev, next)
  const remaining = { ...preview }
  for (const key of Object.keys(remaining) as (keyof DiyPreviewPatch)[]) {
    if (changed.includes(key)) delete remaining[key]
  }
  return Object.keys(remaining).length > 0 ? remaining : null
}

/**
 * 把一份配置写进共享状态并（防抖后）落盘。
 * 内存里的改动**永远**立即生效：不能因为写盘失败（配额满 / 隐私模式）就把用户刚做的
 * 编辑整个丢掉；失败只降级为界面提示（写盘成功时清掉）。
 * 返回的 ok 只表示「已接纳进内存并排队落盘」：配额满之类只有 setItem 那一刻才知道，
 * 真正的落盘成败以 storageWarning 为准；拿不到 localStorage 时 ok 立即为 false。
 */
function writeHomeDiyState(
  next: HomeDIYConfig,
  history: LayoutHistoryState<HomeDIYConfig>,
  clocksOverride?: LayoutSlotClocks,
): HomeDiyWriteResult {
  const prev = sharedState.config
  const clocks =
    clocksOverride ?? bumpClocks(getEffectiveSlotClocks(), diffChangedSlots(prev, next))
  lastClocks = { ...clocks }
  const preview = previewAfterCommit(prev, next, sharedState.preview)
  const storage = safeLocalStorage()
  if (!storage) {
    commitSharedState({
      config: next,
      history,
      preview,
      storageWarning: trackStorageWarning('disk', describeHomeDiyStorageFailure(undefined)),
    })
    return { config: next, clocks, ok: false, error: undefined }
  }
  commitSharedState({ config: next, history, preview })
  scheduleHomeDiyDiskWrite(next, clocks)
  return { config: next, clocks, ok: true }
}

/**
 * 提交一次用户编辑（会压入撤销历史）。
 * 同字段 500ms 内的连续编辑合并成一条撤销记录（滑杆每 tick 一次提交、
 * 预设悬停之类也不会把撤销栈刷爆）；不同字段或超出时间窗则正常压栈。
 * 合并窗口内又拖回起点时整段合并直接撤销（不留一条「撤销了个寂寞」的记录）。
 */
export function commitHomeDiyConfig(
  updater: (prev: HomeDIYConfig) => HomeDIYConfig,
  options: { pushHistory?: boolean } = {},
): HomeDiyWriteResult {
  const prev = sharedState.config
  const next = updater(prev)
  if (next === prev) {
    // 空操作（例如把分类移到列表边界外）：不写盘、不推历史，也不弹「保存失败」
    return { config: prev, clocks: readSlotClocks(STORAGE_CLOCKS_KEY), ok: true }
  }
  let history = sharedState.history
  if (options.pushHistory === false) {
    clearUndoCoalesce()
  } else {
    const now = Date.now()
    const keys = changedTopLevelKeys(prev, next)
    if (
      coalesceBase !== null &&
      coalesceKeys !== null &&
      now - coalesceAt <= HOME_DIY_UNDO_COALESCE_WINDOW_MS &&
      keys.length === coalesceKeys.length &&
      keys.every((k, i) => k === coalesceKeys![i])
    ) {
      // 比较时忽略 updatedAt：每次提交都会刷它，否则「拖回起点」永远比不出来。
      const stripUpdatedAt = (c: HomeDIYConfig) => {
        const { updatedAt: _ignored, ...rest } = c
        return JSON.stringify(rest)
      }
      if (stripUpdatedAt(next) === stripUpdatedAt(coalesceBase)) {
        // 又改回窗口起点：整段合并等于没改过，把那条历史也撤掉
        history = {
          past: history.past.slice(0, -1),
          present: next,
          future: [],
        }
        clearUndoCoalesce()
      } else {
        history = { ...history, present: next, future: [] }
        coalesceAt = now
      }
    } else {
      history = pushLayoutHistory(history, next)
      coalesceBase = prev
      coalesceKeys = keys
      coalesceAt = now
    }
  }
  return writeHomeDiyState(next, history)
}

/** 撤销 / 重做：栈在共享状态里，谁按 Ctrl+Z 撤的都是同一条历史 */
export function undoHomeDiy(): HomeDiyWriteResult | null {
  const history = sharedState.history
  if (history.past.length === 0) return null
  clearUndoCoalesce()
  const next = undoLayoutHistory(history)
  return writeHomeDiyState(next.present, next)
}

export function redoHomeDiy(): HomeDiyWriteResult | null {
  const history = sharedState.history
  if (history.future.length === 0) return null
  clearUndoCoalesce()
  const next = redoLayoutHistory(history)
  return writeHomeDiyState(next.present, next)
}

/**
 * 同一按键只撤销一步（W2-9）的认领制：Ctrl+Z 有三条 window keydown 监听——
 * 画布撤销（modular-canvas，未编排态也挂着）、排版撤销（use-home-diy，
 * 仅编排态）、回收站恢复（navigation-content）——不拦就会一次按键撤两步。
 * 同一任务（task）里第一个认领者返回 true 并执行，其余返回 false；
 * 认领在微任务末尾自动清零（同一按键的后续监听都在同一任务里跑完）。
 * 注意：这里不拦 undoHomeDiy 本身——旧测试在同一 `it` 里同步连调两次
 * undoHomeDiy()，拦它会把测试也拦了；认领只拦按键入口（use-home-diy
 * 的 undo/redo 回调 + navigation-content 的恢复监听）。
 */
let homeDiyHistoryStepClaimed = false

export function claimHomeDiyHistoryStep(): boolean {
  if (homeDiyHistoryStepClaimed) return false
  homeDiyHistoryStepClaimed = true
  queueMicrotask(() => {
    homeDiyHistoryStepClaimed = false
  })
  return true
}

export function didHomeDiyHistoryStepClaimThisTask(): boolean {
  return homeDiyHistoryStepClaimed
}

/**
 * 接收其它标签页的改动：按插槽 LWW 合并，绝不整表覆盖。
 * 不压撤销历史（远端改动不是本标签页的操作），也用合并后的 clocks 落盘。
 */
export function applyRemoteHomeDiyConfig(payload: {
  config: HomeDIYConfig
  clocks: LayoutSlotClocks
}): HomeDiyWriteResult | null {
  if (!payload?.config) return null
  const merged = mergeLayoutSlots(
    { config: sharedState.config, clocks: getEffectiveSlotClocks() },
    { config: payload.config, clocks: payload.clocks || {} },
  )
  if (!merged.changed) return null
  clearUndoCoalesce()
  return writeHomeDiyState(merged.config, sharedState.history, merged.clocks)
}

export function setHomeDiyEditingLayout(next: boolean): void {
  if (sharedState.isEditingLayout === next) return
  commitSharedState({ isEditingLayout: next })
}

export function dismissHomeDiyStorageWarning(): void {
  if (sharedState.storageWarning === null) return
  clearAllStorageWarnings()
  commitSharedState({ storageWarning: null })
}

/**
 * 读 v3 配置。**「读不出来」和「没有配置」必须分开**：
 * 以前是 `const parsed = JSON.parse(raw)` 抛错就整段跳过、配置回落默认值，
 * 紧接着第一次编辑就把用户原布局覆盖掉（和收藏夹那个坑同源）。
 * 现在读不出来会先把原始字节备份到 `....corrupt.<时间戳>`，并带一条提示。
 */
export function readStoredHomeDiyConfig(raw: string | null): {
  status: 'ok' | 'absent' | 'corrupt'
  config: HomeDIYConfig
  /** 需要备份的原始串（status === 'corrupt' 时非空） */
  corruptRaw: string | null
} {
  if (!raw) return { status: 'absent', config: DEFAULT_CONFIG, corruptRaw: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 半截写入 / 被外部脚本改写：读不出来就是读不出来，不能当成「没有配置」
    return { status: 'corrupt', config: DEFAULT_CONFIG, corruptRaw: raw }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'corrupt', config: DEFAULT_CONFIG, corruptRaw: raw }
  }
  const check = validateAndCleanDIYConfig(parsed)
  if (!check.valid || !check.config) {
    // 结构不合法（旧格式 / 被改写）同样不能静默当成「没有配置」
    return { status: 'corrupt', config: DEFAULT_CONFIG, corruptRaw: raw }
  }
  const source = parsed as Record<string, unknown>
  const config: HomeDIYConfig = {
    ...check.config,
    collapsedCategoryIds: Array.isArray(check.config.collapsedCategoryIds)
      ? check.config.collapsedCategoryIds
      : [],
    accentColor: ['default', 'violet', 'emerald', 'amber', 'rose'].includes(
      String(source.accentColor),
    )
      ? (source.accentColor as AccentColor)
      : 'default',
  }
  return { status: 'ok', config, corruptRaw: null }
}

/** 备份键带时间戳：连续损坏时不会互相覆盖掉更早的那份 */
export function homeDiyCorruptBackupKey(now: number): string {
  return `${STORAGE_KEY}.corrupt.${now}`
}

/**
 * 把读不出来的原始数据挪到备份键，返回备份键名（失败返回 null）。
 * 这里刻意**不**选「拒绝一切写入」：DIY 是整页交互，一旦停摆用户什么都改不了；
 * 而备份已经保证原数据不丢，提示里会写出备份键名，可人工找回。
 */
export function backupCorruptHomeDiyConfig(storage: HomeDiyStorage, raw: string): string | null {
  const key = homeDiyCorruptBackupKey(Date.now())
  try {
    storage.setItem(key, raw)
    return key
  } catch {
    // 备份都写不进去（配额满）：返回 null，由提示文案说明「备份失败」
    return null
  }
}

export function describeCorruptHomeDiyConfig(backupKey: string | null): string {
  if (backupKey) {
    return `本地排版配置读不出来（可能写入中断，或被其它程序改写），已把原数据备份到 ${backupKey}，本次以默认排版启动。之后的改动会正常保存。`
  }
  return '本地排版配置读不出来，原始数据也没能备份（本地存储写入失败），本次以默认排版启动。'
}

/**
 * 读本地存储（v3 → v2 → v1 迁移 + `#diy=` 免登分享链接）。**只执行一次**：
 * 共享状态只有一份，6 个组件各自挂载时都读一遍会互相覆盖；后挂载的组件
 * （例如切到 hybrid 才动态加载的 HomeHeroDeck）还会把撤销栈一起冲掉。
 *
 * async 原因：#diy= 分享走唯一的 live 解码 parseSharePayload，它要 dynamic
 * import zod（首屏不付这笔账），所以分享挂起在一次 await 之后；v3 读取与
 * 旧版迁移仍在 await 之前同步完成。
 */
export async function hydrateHomeDiy(): Promise<void> {
  if (sharedHydrated) return
  sharedHydrated = true
  const storage = safeLocalStorage()
  if (!storage) return
  let raw: string | null = null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch (err) {
    // 连读都不让读：说清楚是「存储不可用」，而不是「没有配置」
    commitSharedState({ storageWarning: trackStorageWarning('disk', describeHomeDiyStorageFailure(err)) })
    return
  }
  const stored = readStoredHomeDiyConfig(raw)
  if (stored.status === 'ok') {
    commitSharedState({ config: stored.config, history: createLayoutHistory(stored.config) })
  }
  if (stored.status === 'corrupt') {
    const backupKey = stored.corruptRaw ? backupCorruptHomeDiyConfig(storage, stored.corruptRaw) : null
    commitSharedState({
      config: stored.config,
      history: createLayoutHistory(stored.config),
      storageWarning: trackStorageWarning('corrupt', describeCorruptHomeDiyConfig(backupKey)),
    })
  }
  // 旧版迁移合到「当前已落位的 v3 配置」上（不是拿默认值重建整表），
  // 成功后老键即删，只迁一次。
  const migrated = migrateLegacyHomeDiyConfig(storage, sharedState.config)
  if (migrated) {
    commitSharedState({ config: migrated, history: createLayoutHistory(migrated) })
  }
  // 顺序很关键：先让本地配置（含旧版迁移）落位，再解析 #diy 分享——
  // 差异预览要对照『用户真实的本地配置』算，而不是对照默认配置；
  // 分享只挂起待确认，绝不整表替换本地配置。
  const share = await applyHomeDiyShareHash()
  if (share.warning) commitSharedState({ storageWarning: trackStorageWarning('share', share.warning) })
}

const isLegacyRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * 老键里「这次真的带了」的字段：只取 present 且合法的，缺失的一律不动。
 * v2 认的字段比旧迁移多：旧迁移只读了 viewMode / 形态 / 背景 / 展板 /
 * 分类列表等 9 个字段，老键里哪怕带了强调色 / 置顶 / 壁纸 / 不透明度，
 * 合并时也被默认值打回去；这里按清洗器的同口径把它们也认回来。
 * v1 是极早期形态，只认 viewMode / 展板折叠 / 展板组件三项。
 */
function pickLegacyFields(parsed: Record<string, unknown>, from: 2 | 1): Partial<HomeDIYConfig> {
  const out: Partial<HomeDIYConfig> = {}
  const viewModes = ['hybrid', 'classic', 'workbench'] as const
  const cardModes = ['compact', 'standard', 'rich', 'minimal', 'mini-chip'] as const
  const canvasBgs = ['mesh', 'dots', 'grid', 'aurora', 'clean'] as const
  const accents = ['default', 'violet', 'emerald', 'amber', 'rose'] as const
  if (typeof parsed.viewMode === 'string' && (viewModes as readonly string[]).includes(parsed.viewMode)) {
    out.viewMode = parsed.viewMode as HomeDIYConfig['viewMode']
  }
  if (typeof parsed.heroDeckCollapsed === 'boolean') out.heroDeckCollapsed = parsed.heroDeckCollapsed
  if (Array.isArray(parsed.heroDeckWidgets)) out.heroDeckWidgets = parsed.heroDeckWidgets as string[]
  if (from === 2) {
    if (
      typeof parsed.cardDisplayMode === 'string' &&
      (cardModes as readonly string[]).includes(parsed.cardDisplayMode)
    ) {
      out.cardDisplayMode = parsed.cardDisplayMode as HomeDIYConfig['cardDisplayMode']
    }
    if (
      typeof parsed.canvasBackground === 'string' &&
      (canvasBgs as readonly string[]).includes(parsed.canvasBackground)
    ) {
      out.canvasBackground = parsed.canvasBackground as HomeDIYConfig['canvasBackground']
    }
    if (typeof parsed.accentColor === 'string' && (accents as readonly string[]).includes(parsed.accentColor)) {
      out.accentColor = parsed.accentColor as HomeDIYConfig['accentColor']
    }
    if (typeof parsed.enableAdaptiveRanking === 'boolean') {
      out.enableAdaptiveRanking = parsed.enableAdaptiveRanking
    }
    if (Array.isArray(parsed.categoryOrder)) out.categoryOrder = parsed.categoryOrder as string[]
    if (Array.isArray(parsed.pinnedCategoryIds)) out.pinnedCategoryIds = parsed.pinnedCategoryIds as string[]
    if (Array.isArray(parsed.hiddenCategoryIds)) out.hiddenCategoryIds = parsed.hiddenCategoryIds as string[]
    if (Array.isArray(parsed.collapsedCategoryIds)) {
      out.collapsedCategoryIds = parsed.collapsedCategoryIds as string[]
    }
    if (Array.isArray(parsed.customCategories)) {
      out.customCategories = parsed.customCategories as CustomCategory[]
    }
    if (isLegacyRecord(parsed.pinnedSiteIdsByCategory)) {
      out.pinnedSiteIdsByCategory = parsed.pinnedSiteIdsByCategory as Record<string, string[]>
    }
    if (isLegacyRecord(parsed.siteCategoryOverrides)) {
      out.siteCategoryOverrides = parsed.siteCategoryOverrides as Record<string, string>
    }
    if (isLegacyRecord(parsed.categoryDensityOverrides)) {
      out.categoryDensityOverrides = parsed.categoryDensityOverrides as Record<string, CardDisplayMode>
    }
    if (typeof parsed.speedDialEnabled === 'boolean') out.speedDialEnabled = parsed.speedDialEnabled
    if (Array.isArray(parsed.speedDialPinnedIds)) {
      out.speedDialPinnedIds = parsed.speedDialPinnedIds as string[]
    }
    if (typeof parsed.customWallpaperUrl === 'string' && isSafeWallpaperUrl(parsed.customWallpaperUrl)) {
      out.customWallpaperUrl = parsed.customWallpaperUrl
    }
    if (typeof parsed.glassmorphismBlur === 'number' && Number.isFinite(parsed.glassmorphismBlur)) {
      out.glassmorphismBlur = Math.min(30, Math.max(0, parsed.glassmorphismBlur))
    }
    if (typeof parsed.cardOpacity === 'number') out.cardOpacity = clampCardOpacity(parsed.cardOpacity)
  }
  return out
}

/**
 * v2 + v1 迁移：两个老键里的字段**合到当前 v3 配置上**，只写老键里真的带了的
 * 字段，老键没带的字段保持当前值；迁移成功后删掉老键，只迁一次。
 *
 * 旧实现是拿 DEFAULT_CONFIG 重建整份再整表覆盖：v3 里已有的强调色 / 站内置顶 /
 * 站点归属 / 密度覆盖 / 速览坞 / 壁纸 / 模糊 / 不透明度 / 自适应排序全被打回
 * 默认，且老键永远留着、每次加载都重跑一遍把 v3 再盖一次。
 *
 * W2-4 两处修正：
 *   1. 两个老键都读：V2 优先，V1 只补 V2 没带的字段。旧实现在第一个
 *      找到的老键后直接 return，V2 存在时 V1 独有的字段就被静默丢掉。
 *   2. 合并结果先过 validateAndCleanDIYConfig 再写盘：pickLegacyFields
 *      只是「认字段」，数组/记录原样强转（as string[] / as CustomCategory[]，
 *      无长度上限、无 isSafeIdKey、无白名单），脏值直接进 v3 键等于把
 *      清洗器绕过去了；这里统一用清洗器的同口径收尾（id 白名单、上限截断、
 *      自定义分类逐条验 href）。
 */
export function migrateLegacyHomeDiyConfig(
  storage: HomeDiyStorage,
  current: HomeDIYConfig = DEFAULT_CONFIG,
): HomeDIYConfig | null {
  const legacyKeys = [
    { key: LEGACY_STORAGE_KEY_V2, from: 2 as const },
    { key: LEGACY_STORAGE_KEY_V1, from: 1 as const },
  ]
  // V2 优先、V1 补位：只合「对方没带」的字段，V2 已带的字段 V1 不许覆盖。
  let merged: Partial<HomeDIYConfig> | null = null
  const readKeys: string[] = []
  for (const legacy of legacyKeys) {
    let raw: string | null = null
    try {
      raw = storage.getItem(legacy.key)
    } catch {
      // 读不了这个老键：跳过即可，它还在浏览器里，不会被我们动到
      continue
    }
    if (!raw) continue
    let parsed: Record<string, unknown>
    try {
      const value = JSON.parse(raw)
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      parsed = value as Record<string, unknown>
    } catch {
      // 老键本身是坏的：不动它（用户数据留在原处），也不做迁移
      continue
    }
    readKeys.push(legacy.key)
    const fields = pickLegacyFields(parsed, legacy.from)
    if (!merged) {
      merged = { ...fields }
    } else {
      for (const [k, v] of Object.entries(fields)) {
        if (!(k in merged)) {
          const target = merged as Record<string, unknown>
          target[k] = v
        }
      }
    }
  }
  if (!merged || readKeys.length === 0) return null
  // 先清洗再写盘：脏 id / 超长数组 / 非法 href 在这里被截断或丢弃，
  // 不再原样写进 v3 键；清洗不通过则不动 v3、不删老键，下次加载再试一次。
  const check = validateAndCleanDIYConfig({ ...current, ...merged, updatedAt: Date.now() })
  if (!check.valid || !check.config) return null
  const migrated: HomeDIYConfig = {
    ...check.config,
    updatedAt: Date.now(),
  }
  let wrote = true
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(migrated))
  } catch (err) {
    // 迁移结果写不进去：仍然返回它（内存里先按迁移后的配置用），
    // 只是提醒用户刷新后会退回默认值；老键留着，下次加载再试一次。
    wrote = false
    commitSharedState({ storageWarning: trackStorageWarning('disk', describeHomeDiyStorageFailure(err)) })
  }
  if (wrote) {
    // 只迁一次：v3 已落盘，老键使命完成。删不掉也不致命——合并是幂等的，
    // 下次加载重跑一遍还是同一份结果。
    for (const key of readKeys) {
      try {
        storage.removeItem?.(key)
      } catch {
        // 删不掉就留着，下次重跑合并结果不变
      }
    }
  }
  return migrated
}

/**
 * 处理 `#diy=` 免登分享链接（不可信输入：统一走 decode + parseSharePayload
 * 单条管线 —— base64 解码、4KB 上限、v1 信封 `{ diy: 1, config }` 与旧裸
 * 配置双读、短字段展开、危险键深剥、未知字段点名、条目级清洗全在那条
 * 管线里；这里只负责挂起待确认与清 hash，不再留第二份内联解析）。
 * 成功只挂起待确认（pendingShare），不落盘、不替换本地配置；warning 非空表示链接里有内容被白名单/上限吃掉，必须让用户看到。
 */
export async function applyHomeDiyShareHash(): Promise<{ applied: boolean; warning: string | null }> {
  if (typeof window === 'undefined') return { applied: false, warning: null }
  const hash = window.location.hash || ''
  if (!hash.startsWith('#diy=')) return { applied: false, warning: null }
  const decoded = decodeShareLinkPayload(hash)
  if (!decoded.ok) {
    console.warn('[diy] 分享 hash 解码失败，已忽略:', decoded.reason)
    // 失败不清除 hash：地址栏里的 hash 就是这份分享的唯一一份拷贝，
    // 清掉等于连重试、复制、转发的机会一起丢了（UX 审计 P2）。成功挂起
    // 待确认时才清（下面），确认/取消分享时也清——那两处是用户已处置。
    return { applied: false, warning: decoded.reason }
  }
  const parsed = await parseSharePayload(decoded.raw)
  if (!parsed.ok || !parsed.config) {
    console.warn('[diy] 分享 hash 校验失败，已忽略:', parsed.error)
    // 同上：失败不清 hash，链接留在地址栏，刷新页面即可重试。
    return { applied: false, warning: `分享链接未能应用：${parsed.error || '配置不合法'}，已沿用本地排版。` }
  }
  const imported: HomeDIYConfig = {
    ...DEFAULT_CONFIG,
    ...parsed.config,
    collapsedCategoryIds: Array.isArray(parsed.config.collapsedCategoryIds)
      ? parsed.config.collapsedCategoryIds
      : [],
    updatedAt: Date.now(),
  }
  // 只挂起待确认：不落盘、不替换本地配置；用户确认后才走 commitHomeDiyConfig 应用
  clearDiyShareHash()
  // 分享链接只有 4KB，超限/非法内容被悄悄吃掉时，接收方完全看不出来：这里申报
  const warning = parsed.warning
  const carriedFields = (parsed.carriedFields ?? []) as HomeDiyShareField[]
  const diff = computeHomeDiyShareDiff(sharedState.config, imported, carriedFields)
  commitSharedState({ pendingShare: { imported, diff, warning, carriedFields, source: 'share' } })
  return { applied: false, warning }
}

// —— #diy 分享：只挂起待确认，绝不整表替换 ——
// 分享只带少量字段，其余字段在 imported 里是 DEFAULT_CONFIG 的值。
// 差异预览只比分享实际携带的字段（carriedFields）：没携带的字段在 imported 里
// 是默认值，拿它比对会把「本地本来就有、链接没带」的字段也算成变化——
// 那正是字段级合并之前预览撒谎的根源。不传 carriedFields 时（直接拿两份
// 全量配置比对的旧调用）保持全字段比对，行为不变。
export function computeHomeDiyShareDiff(
  current: HomeDIYConfig,
  imported: HomeDIYConfig,
  carriedFields?: readonly HomeDiyShareField[] | null,
): string[] {
  const diff: string[] = []
  const carried = carriedFields ? new Set<string>(carriedFields) : null
  // 没给 carriedFields = 全字段比对（旧行为）；给了 = 只比携带的字段。
  const includes = (field: string): boolean => !carried || carried.has(field)
  const eqList = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean => {
    const x = a ?? []
    const y = b ?? []
    return x.length === y.length && x.every((v, i) => v === y[i])
  }
  const setDiff = (a: readonly string[] | undefined, b: readonly string[] | undefined) => {
    const x = new Set(a ?? [])
    const y = new Set(b ?? [])
    return { add: [...y].filter((v) => !x.has(v)), del: [...x].filter((v) => !y.has(v)) }
  }
  const idList = (label: string, a: readonly string[] | undefined, b: readonly string[] | undefined): void => {
    const d = setDiff(a, b)
    if (d.add.length === 0 && d.del.length === 0) return
    const p: string[] = []
    if (d.add.length > 0) p.push('新增 ' + d.add.length + ' 个')
    if (d.del.length > 0) p.push('移除 ' + d.del.length + ' 个')
    diff.push(label + '：' + p.join('、'))
  }
  if (includes('categoryOrder') && !eqList(current.categoryOrder, imported.categoryOrder)) {
    const d = setDiff(current.categoryOrder, imported.categoryOrder)
    if (d.add.length === 0 && d.del.length === 0) diff.push('分类顺序会改变（分类不变，仅重新排序）')
    else diff.push('分类顺序会改变（新增 ' + d.add.length + ' 个、移除 ' + d.del.length + ' 个）')
  }
  if (includes('pinnedCategoryIds')) idList('置顶分类', current.pinnedCategoryIds, imported.pinnedCategoryIds)
  if (includes('hiddenCategoryIds')) idList('隐藏分类', current.hiddenCategoryIds, imported.hiddenCategoryIds)
  if (includes('collapsedCategoryIds')) idList('折叠状态', current.collapsedCategoryIds, imported.collapsedCategoryIds)
  if (includes('heroDeckWidgets')) idList('速览坞组件', current.heroDeckWidgets, imported.heroDeckWidgets)
  if (includes('speedDialPinnedIds')) idList('速览星标', current.speedDialPinnedIds, imported.speedDialPinnedIds)
  if (includes('customCategories')) {
    const cur = new Map(current.customCategories.map((c) => [c.id, c]))
    const imp = new Map(imported.customCategories.map((c) => [c.id, c]))
    const add = [...imp.keys()].filter((id) => !cur.has(id))
    const del = [...cur.keys()].filter((id) => !imp.has(id))
    const chg = [...imp.keys()].filter((id) => {
      const a = cur.get(id)
      const b = imp.get(id)
      return !!a && !!b && (a.title !== b.title || a.items.length !== b.items.length)
    })
    const p: string[] = []
    if (add.length > 0) p.push('新增 ' + add.length + ' 个')
    if (del.length > 0) {
      p.push('删除 ' + del.length + ' 个（' + del.map((id) => cur.get(id)?.title ?? id).join('、') + '）')
    }
    if (chg.length > 0) p.push('修改 ' + chg.length + ' 个')
    if (p.length > 0) diff.push('自建分类：' + p.join('、'))
  }
  if (includes('siteCategoryOverrides')) {
    const keys = new Set([...Object.keys(current.siteCategoryOverrides), ...Object.keys(imported.siteCategoryOverrides)])
    const chg = [...keys].filter((k) => current.siteCategoryOverrides[k] !== imported.siteCategoryOverrides[k])
    if (chg.length > 0) diff.push('站点归属：' + chg.length + ' 个站点改分类')
  }
  if (includes('pinnedSiteIdsByCategory')) {
    const keys = new Set([...Object.keys(current.pinnedSiteIdsByCategory), ...Object.keys(imported.pinnedSiteIdsByCategory)])
    const chg = [...keys].filter((k) => !eqList(current.pinnedSiteIdsByCategory[k], imported.pinnedSiteIdsByCategory[k]))
    if (chg.length > 0) diff.push('站内置顶：' + chg.length + ' 个分类的置顶站点会变')
  }
  if (includes('heroDeckCollapsed') && current.heroDeckCollapsed !== imported.heroDeckCollapsed) {
    diff.push('速览坞将' + (imported.heroDeckCollapsed ? '折叠' : '展开'))
  }
  if (includes('speedDialEnabled') && current.speedDialEnabled !== imported.speedDialEnabled) {
    diff.push('速览星标坞将' + (imported.speedDialEnabled ? '开启' : '关闭'))
  }
  if (includes('enableAdaptiveRanking') && current.enableAdaptiveRanking !== imported.enableAdaptiveRanking) {
    diff.push('自适应排序将' + (imported.enableAdaptiveRanking ? '开启' : '关闭'))
  }
  const values: Array<[string, string, string | number | undefined, string | number | undefined]> = [
    ['视图模式', 'viewMode', current.viewMode, imported.viewMode],
    ['卡片形态', 'cardDisplayMode', current.cardDisplayMode, imported.cardDisplayMode],
    ['画布背景', 'canvasBackground', current.canvasBackground, imported.canvasBackground],
    ['强调色', 'accentColor', current.accentColor, imported.accentColor],
    ['毛玻璃模糊', 'glassmorphismBlur', current.glassmorphismBlur, imported.glassmorphismBlur],
    ['卡片不透明度', 'cardOpacity', current.cardOpacity, imported.cardOpacity],
  ]
  for (const [label, field, a, b] of values) {
    if (!includes(field)) continue
    if (a !== b) diff.push(label + '：' + (a ?? '未设置') + ' → ' + (b ?? '未设置'))
  }
  if (includes('customWallpaperUrl') && current.customWallpaperUrl !== imported.customWallpaperUrl) {
    diff.push(imported.customWallpaperUrl ? '自定义壁纸将更换' : '自定义壁纸将被清除')
  }
  return diff
}

/**
 * 字段级合并：只把 imported 里 carriedFields 列出的字段写进当前配置，
 * 其余字段原样保留本地值。carriedFields 为空/未给时退回整份 imported
 *（旧调用的兜底；applyHomeDiyShareHash 产生的 pending 永远带 carriedFields）。
 */
export function mergeHomeDiyShareFields(
  current: HomeDIYConfig,
  imported: HomeDIYConfig,
  carriedFields: readonly HomeDiyShareField[] | null | undefined,
): HomeDIYConfig {
  if (!carriedFields) return { ...imported, updatedAt: Date.now() }
  const next = { ...current }
  for (const field of carriedFields) {
    // 联合键直接写 next[field] 时 TS 把左侧收窄成 never（各字段类型求交）；
    // 在赋值点把对象视为 Record<string, unknown> 再写，值侧仍是 imported 的原值。
    ;(next as unknown as Record<string, unknown>)[field] = imported[field]
  }
  next.updatedAt = Date.now()
  return next
}

// 清掉地址栏里的 #diy= 分享 hash：确认/取消/忽略分享时都要做；
// 清不掉也无妨（只是收拾现场），不抛错。
function clearDiyShareHash(): void {
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch {
    // 清 hash 只是顺手收拾现场；清不掉也没有别的可做
  }
}

// 分享确认前的备份键：带时间戳，连续确认多份分享时不会互相覆盖。
export function homeDiyShareBackupKey(now: number): string {
  return DIY_SHARE_BACKUP_PREFIX + String(now)
}

function shareBackupTimestamp(key: string): number {
  const ts = Number(key.slice(DIY_SHARE_BACKUP_PREFIX.length))
  return Number.isFinite(ts) ? ts : 0
}

/** 列出已有的分享备份键（新在前）：优先用 storage.keys()，没有时走 length/key(i) 枚举（原生 localStorage） */
function listHomeDiyShareBackupKeys(storage: HomeDiyStorage): string[] {
  let keys: string[] = []
  if (typeof storage.keys === 'function') {
    try {
      keys = storage.keys()
    } catch {
      keys = []
    }
  } else {
    const probe = storage as unknown as { length?: unknown; key?: unknown }
    if (typeof probe.length === 'number' && typeof probe.key === 'function') {
      const keyFn = probe.key as (index: number) => string | null
      try {
        for (let i = 0; i < probe.length; i++) {
          const k = keyFn(i)
          if (k) keys.push(k)
        }
      } catch {
        keys = []
      }
    }
  }
  return keys
    .filter((k) => k.startsWith(DIY_SHARE_BACKUP_PREFIX))
    .sort((a, b) => shareBackupTimestamp(b) - shareBackupTimestamp(a))
}

/**
 * 分享备份剪枝：只留最新的 DIY_SHARE_BACKUP_MAX_COUNT 份，删掉更旧的。
 * 返回删掉的份数；枚举不到键（存储实现既没 keys() 也没 length/key）时
 * 什么都不做——删不掉总比删错强。
 */
export function pruneHomeDiyShareBackups(
  storage: HomeDiyStorage,
  keep: number = DIY_SHARE_BACKUP_MAX_COUNT,
): number {
  let removed = 0
  for (const key of listHomeDiyShareBackupKeys(storage).slice(keep)) {
    try {
      storage.removeItem?.(key)
      removed++
    } catch {
      // 单个删不掉不影响其它
    }
  }
  return removed
}

// 确认分享前，把当前配置原样备份到独立备份键，返回备份键名（写不进去返回 null）。
// 写完即剪枝：备份键带时间戳、每次确认都新建一个，不剪就会无界增长。
export function backupHomeDiyShareConfig(storage: HomeDiyStorage, config: HomeDIYConfig): string | null {
  const key = homeDiyShareBackupKey(Date.now())
  try {
    storage.setItem(key, JSON.stringify(config))
  } catch {
    return null
  }
  pruneHomeDiyShareBackups(storage)
  return key
}

// 确认应用待确认的 #diy 分享：先把当前配置备份到独立备份键，
// 再按字段级合并应用（只写链接实际携带的字段，没携带的字段保持本地值），
// 走标准提交路径（commitHomeDiyConfig 默认把旧配置压进撤销栈，可 Ctrl+Z 撤回），
// 最后清掉分享状态与地址栏 hash。备份失败也不拦确认——撤销栈里还留着旧配置。
export function confirmHomeDiyShare(): { applied: boolean; backupKey: string | null } {
  const pending = sharedState.pendingShare
  if (!pending) return { applied: false, backupKey: null }
  const storage = safeLocalStorage()
  const backupKey = storage ? backupHomeDiyShareConfig(storage, sharedState.config) : null
  commitHomeDiyConfig((prev) => mergeHomeDiyShareFields(prev, pending.imported, pending.carriedFields))
  commitSharedState({ pendingShare: null })
  clearDiyShareHash()
  return { applied: true, backupKey }
}

// 取消待确认的 #diy 分享：本地配置原样不动，只清掉分享状态与地址栏 hash。
// 若横幅上还挂着这份分享的提示（'share' 来源），一并清除，其它来源的提示不动。
export function dismissHomeDiyShare(): boolean {
  const pending = sharedState.pendingShare
  if (!pending) return false
  commitSharedState({
    pendingShare: null,
    storageWarning: trackStorageWarning('share', null),
  })
  clearDiyShareHash()
  return true
}
