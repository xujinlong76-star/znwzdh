'use client'

/**
 * 首页 DIY 的共享状态、本地存储、迁移与分享 hash（从 use-home-diy.ts 拆出，2026-10-19 P1-1）。
 *
 * 拆分边界：这里不依赖 React，也不认识 hook；use-home-diy.ts 通过
 * `export * from './home-diy-storage'` 保持既有导入路径可用。
 */
import {
  createLayoutHistory,
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
export type CardDisplayMode = 'compact' | 'standard' | 'rich'
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
const STORAGE_CLOCKS_KEY = 'navhub_home_diy_clocks_v1'
/**
 * 本地改动广播事件。组件之间现在走共享状态（useSyncExternalStore），
 * 不再依赖这个事件；保留它是因为它是对外既有约定（外部脚本/旧监听方可能靠它刷新）。
 */
export const HOME_DIY_UPDATED_EVENT = 'navhub_home_diy_updated'

const DEFAULT_HERO_WIDGETS = [
  'quick-search',
  'clock-pomodoro',
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
 * 代码里其实已经在四处 dispatch 了 'navhub_home_diy_updated'，但从来没有人监听它
 * —— 跨标签页同步（BroadcastChannel）反而是通的，于是这个缺陷很容易被当成「偶发」。
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
}

export interface HomeDiySharedState {
  config: HomeDIYConfig
  history: LayoutHistoryState<HomeDIYConfig>
  /** 编排模式：工具栏与导航区共享同一份，否则拖拽手柄不会出现 */
  isEditingLayout: boolean
  /** 非 null = 上次落盘失败；改动已在内存生效，但刷新会丢 */
  storageWarning: string | null
}

const HASH_SHARE_MAX_BYTES = 4096

const INITIAL_SHARED_STATE: HomeDiySharedState = {
  config: DEFAULT_CONFIG,
  history: createLayoutHistory(DEFAULT_CONFIG),
  isEditingLayout: false,
  storageWarning: null,
}

let sharedState: HomeDiySharedState = INITIAL_SHARED_STATE
const sharedListeners = new Set<() => void>()
/** 本地存储只读一次（见下方 hydrateHomeDiy 的说明） */
let sharedHydrated = false

export function subscribeHomeDiy(listener: () => void): () => void {
  sharedListeners.add(listener)
  return () => {
    sharedListeners.delete(listener)
  }
}

export function getHomeDiySnapshot(): HomeDiySharedState {
  return sharedState
}

/** 仅供测试隔离：把共享状态退回初始值（生产代码不要调用） */
export function resetHomeDiySharedState(): void {
  sharedState = INITIAL_SHARED_STATE
  sharedHydrated = false
  for (const listener of sharedListeners) listener()
}

function commitSharedState(patch: Partial<HomeDiySharedState>): void {
  sharedState = { ...sharedState, ...patch }
  for (const listener of sharedListeners) listener()
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
  /** false = 没能落盘（改动仍已在内存生效，storageWarning 已写入共享状态） */
  ok: boolean
  error?: unknown
}

/**
 * 把一份配置写进共享状态并落盘。
 * 内存里的改动**永远**生效：不能因为写盘失败（配额满 / 隐私模式）就把用户刚做的
 * 编辑整个丢掉；失败只降级为界面提示。
 */
function writeHomeDiyState(
  next: HomeDIYConfig,
  history: LayoutHistoryState<HomeDIYConfig>,
  clocksOverride?: LayoutSlotClocks,
): HomeDiyWriteResult {
  const prev = sharedState.config
  const clocks =
    clocksOverride ?? bumpClocks(readSlotClocks(STORAGE_CLOCKS_KEY), diffChangedSlots(prev, next))
  const storage = safeLocalStorage()
  let ok = true
  let error: unknown
  if (!storage) {
    ok = false
  } else {
    try {
      writeSlotClocks(STORAGE_CLOCKS_KEY, clocks)
      storage.setItem(STORAGE_KEY, JSON.stringify(next))
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event(HOME_DIY_UPDATED_EVENT))
      }
    } catch (err) {
      // 写盘失败要留痕：改动已在内存生效，但用户有权知道「刷新就没了」
      ok = false
      error = err
    }
  }
  commitSharedState({
    config: next,
    history,
    // 成功即清空提示：每次都是整份写回，上一次失败的那份改动也一并落盘了
    storageWarning: ok ? null : describeHomeDiyStorageFailure(error),
  })
  return { config: next, clocks, ok, error }
}

/** 提交一次用户编辑（会压入撤销历史） */
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
  const history =
    options.pushHistory === false ? sharedState.history : pushLayoutHistory(sharedState.history, next)
  return writeHomeDiyState(next, history)
}

/** 撤销 / 重做：栈在共享状态里，谁按 Ctrl+Z 撤的都是同一条历史 */
export function undoHomeDiy(): HomeDiyWriteResult | null {
  const history = sharedState.history
  if (history.past.length === 0) return null
  const next = undoLayoutHistory(history)
  return writeHomeDiyState(next.present, next)
}

export function redoHomeDiy(): HomeDiyWriteResult | null {
  const history = sharedState.history
  if (history.future.length === 0) return null
  const next = redoLayoutHistory(history)
  return writeHomeDiyState(next.present, next)
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
    { config: sharedState.config, clocks: readSlotClocks(STORAGE_CLOCKS_KEY) },
    { config: payload.config, clocks: payload.clocks || {} },
  )
  if (!merged.changed) return null
  return writeHomeDiyState(merged.config, sharedState.history, merged.clocks)
}

export function setHomeDiyEditingLayout(next: boolean): void {
  if (sharedState.isEditingLayout === next) return
  commitSharedState({ isEditingLayout: next })
}

export function dismissHomeDiyStorageWarning(): void {
  if (sharedState.storageWarning === null) return
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
 */
export function hydrateHomeDiy(): void {
  if (sharedHydrated) return
  sharedHydrated = true
  const storage = safeLocalStorage()
  if (!storage) return
  const share = applyHomeDiyShareHash()
  if (share.warning) commitSharedState({ storageWarning: share.warning })
  if (share.applied) return
  let raw: string | null = null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch (err) {
    // 连读都不让读：说清楚是「存储不可用」，而不是「没有配置」
    commitSharedState({ storageWarning: describeHomeDiyStorageFailure(err) })
    return
  }
  const stored = readStoredHomeDiyConfig(raw)
  if (stored.status === 'ok') {
    commitSharedState({ config: stored.config, history: createLayoutHistory(stored.config) })
    return
  }
  if (stored.status === 'corrupt') {
    const backupKey = stored.corruptRaw ? backupCorruptHomeDiyConfig(storage, stored.corruptRaw) : null
    commitSharedState({
      config: stored.config,
      history: createLayoutHistory(stored.config),
      storageWarning: describeCorruptHomeDiyConfig(backupKey),
    })
    return
  }
  const migrated = migrateLegacyHomeDiyConfig(storage)
  if (migrated) {
    commitSharedState({ config: migrated, history: createLayoutHistory(migrated) })
  }
}

/** v2 → v1 迁移（老的键名仍然留着，迁移成功后写回 v3 键） */
export function migrateLegacyHomeDiyConfig(storage: HomeDiyStorage): HomeDIYConfig | null {
  for (const legacy of [
    { key: LEGACY_STORAGE_KEY_V2, from: 2 },
    { key: LEGACY_STORAGE_KEY_V1, from: 1 },
  ]) {
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
    const migrated: HomeDIYConfig =
      legacy.from === 2
        ? {
            ...DEFAULT_CONFIG,
            viewMode: (['hybrid', 'classic', 'workbench'] as const).includes(parsed.viewMode as HomeViewMode)
              ? (parsed.viewMode as HomeViewMode)
              : 'hybrid',
            cardDisplayMode: (['compact', 'standard', 'rich'] as const).includes(parsed.cardDisplayMode as CardDisplayMode)
              ? (parsed.cardDisplayMode as CardDisplayMode)
              : 'standard',
            canvasBackground: (['mesh', 'dots', 'grid', 'aurora', 'clean'] as const).includes(parsed.canvasBackground as CanvasBackground)
              ? (parsed.canvasBackground as CanvasBackground)
              : 'mesh',
            heroDeckCollapsed: Boolean(parsed.heroDeckCollapsed),
            heroDeckWidgets: Array.isArray(parsed.heroDeckWidgets) ? (parsed.heroDeckWidgets as string[]) : DEFAULT_HERO_WIDGETS,
            categoryOrder: Array.isArray(parsed.categoryOrder) ? (parsed.categoryOrder as string[]) : [],
            pinnedCategoryIds: Array.isArray(parsed.pinnedCategoryIds) ? (parsed.pinnedCategoryIds as string[]) : [],
            hiddenCategoryIds: Array.isArray(parsed.hiddenCategoryIds) ? (parsed.hiddenCategoryIds as string[]) : [],
            collapsedCategoryIds: Array.isArray(parsed.collapsedCategoryIds) ? (parsed.collapsedCategoryIds as string[]) : [],
            customCategories: Array.isArray(parsed.customCategories) ? (parsed.customCategories as CustomCategory[]) : [],
            updatedAt: Date.now(),
          }
        : {
            ...DEFAULT_CONFIG,
            viewMode: (['hybrid', 'classic', 'workbench'] as const).includes(parsed.viewMode as HomeViewMode)
              ? (parsed.viewMode as HomeViewMode)
              : 'hybrid',
            heroDeckCollapsed: Boolean(parsed.heroDeckCollapsed),
            heroDeckWidgets: Array.isArray(parsed.heroDeckWidgets) ? (parsed.heroDeckWidgets as string[]) : DEFAULT_HERO_WIDGETS,
            updatedAt: Date.now(),
          }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(migrated))
    } catch (err) {
      // 迁移结果写不进去：仍然返回它（内存里先按迁移后的配置用），
      // 只是提醒用户刷新后会退回默认值
      commitSharedState({ storageWarning: describeHomeDiyStorageFailure(err) })
    }
    return migrated
  }
  return null
}

/**
 * 处理 `#diy=` 免登分享链接（不可信输入：统一走 validateAndCleanDIYConfig + 4KB 上限）。
 * 成功即落盘生效；warning 非空表示链接里有内容被白名单/上限吃掉，必须让用户看到。
 */
export function applyHomeDiyShareHash(): { applied: boolean; warning: string | null } {
  if (typeof window === 'undefined') return { applied: false, warning: null }
  const hash = window.location.hash || ''
  if (!hash.startsWith('#diy=')) return { applied: false, warning: null }
  const clearHash = () => {
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    } catch {
      // 清 hash 只是顺手收拾现场；清不掉也没有别的可做
    }
  }
  try {
    const b64 = hash.replace(/^#diy=/, '')
    // 长度上限 4KB：超限直接丢弃（防 hash 炸弹撑爆 JSON.parse / localStorage）
    if (b64.length > HASH_SHARE_MAX_BYTES) {
      console.warn('[diy] 分享 hash 超过 4KB 上限，已忽略')
      clearHash()
      return { applied: false, warning: '分享链接超过 4KB 上限，已整条忽略，沿用本地排版。' }
    }
    const json = decodeURIComponent(atob(b64))
    if (json.length > HASH_SHARE_MAX_BYTES) throw new Error('decoded payload too large')
    const parsed = JSON.parse(json)
    // 兼容分享短字段 (vm/cdm/bg/...) → 全量字段，再统一清洗
    const normalized =
      parsed && typeof parsed === 'object'
        ? {
            viewMode: parsed.vm ?? parsed.viewMode,
            cardDisplayMode: parsed.cdm ?? parsed.cardDisplayMode,
            canvasBackground: parsed.bg ?? parsed.canvasBackground,
            accentColor: parsed.ac ?? parsed.accentColor,
            categoryOrder: parsed.co ?? parsed.categoryOrder,
            pinnedCategoryIds: parsed.pco ?? parsed.pinnedCategoryIds,
            hiddenCategoryIds: parsed.hco ?? parsed.hiddenCategoryIds,
            siteCategoryOverrides: parsed.sco ?? parsed.siteCategoryOverrides,
            customWallpaperUrl: parsed.wp ?? parsed.customWallpaperUrl,
            glassmorphismBlur: parsed.gb ?? parsed.glassmorphismBlur,
            cardOpacity: parsed.co_op ?? parsed.cardOpacity,
          }
        : null
    const check = validateAndCleanDIYConfig(normalized)
    if (!check.valid || !check.config) {
      console.warn('[diy] 分享 hash 校验失败，已忽略:', check.error)
      clearHash()
      return { applied: false, warning: `分享链接未能应用：${check.error || '配置不合法'}，已沿用本地排版。` }
    }
    const imported: HomeDIYConfig = {
      ...DEFAULT_CONFIG,
      ...check.config,
      collapsedCategoryIds: Array.isArray(check.config.collapsedCategoryIds)
        ? check.config.collapsedCategoryIds
        : [],
      updatedAt: Date.now(),
    }
    // 导入即生效并落盘（与旧行为一致）；撤销历史重置为导入后的状态
    writeHomeDiyState(imported, createLayoutHistory(imported))
    clearHash()
    // 分享链接只有 4KB，超限/非法内容被悄悄吃掉时，接收方完全看不出来：这里申报
    let warning: string | null = null
    if (check.notes.length > 0) {
      const head =
        check.dropped > 0 ? `${check.dropped} 项内容被丢弃或截断` : '部分设置值不在支持列表，已回退默认'
      const shown = check.notes.slice(0, 3).join('；')
      const more = check.notes.length > 3 ? ` 等 ${check.notes.length} 项` : ''
      warning = `分享链接已应用，但${head}：${shown}${more}`
    }
    return { applied: true, warning }
  } catch (e) {
    // 失败 quiet：清掉 hash 后回落默认配置，不抛错（避免「打开链接即报错」）
    console.warn('[diy] 分享 hash 解析失败，已忽略', e)
    clearHash()
    return { applied: false, warning: '分享链接解析失败，已沿用本地排版。' }
  }
}

