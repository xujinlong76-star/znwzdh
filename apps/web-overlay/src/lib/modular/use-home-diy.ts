'use client'

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react'
import {
  togglePinnedSiteInCategory,
  reorderCategoryToTarget,
  createLayoutHistory,
  pushLayoutHistory,
  undoLayoutHistory,
  redoLayoutHistory,
  toggleCollapsedCategory as toggleCollapsedCategoryPure,
  collapseAllCategories as collapseAllCategoriesPure,
  expandAllCategories as expandAllCategoriesPure,
  BUILTIN_DIY_PRESETS,
  validateAndCleanDIYConfig,
  type DIYPreset,
  type LayoutHistoryState,
} from '@/lib/modular/diy-presets'
import {
  encryptGenericPayload,
  decryptGenericPayload,
} from '@/lib/vault'
import { getIdentity } from '@/lib/identity'
import { fetchCloudVault, saveCloudVault, deleteCloudVault } from '@/lib/navhub-api'
import {
  bumpClocks,
  createLayoutSyncChannel,
  diffChangedSlots,
  getLayoutClientId,
  mergeLayoutSlots,
  readSlotClocks,
  writeSlotClocks,
  type LayoutSyncChannel,
  type LayoutSlotClocks,
} from '@/lib/modular/layout-sync'
import { encodeShareLink, type ShareLinkOutcome } from '@/lib/diy-share-link'

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
  if (applyHomeDiyShareHash()) return
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
 * 成功即落盘生效并返回 true。
 */
export function applyHomeDiyShareHash(): boolean {
  if (typeof window === 'undefined') return false
  const hash = window.location.hash || ''
  if (!hash.startsWith('#diy=')) return false
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
      return false
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
      return false
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
    return true
  } catch (e) {
    // 失败 quiet：清掉 hash 后回落默认配置，不抛错不 toast（避免「打开链接即报错」）
    console.warn('[diy] 分享 hash 解析失败，已忽略', e)
    clearHash()
    return false
  }
}

export function useHomeDIY() {
  const { config, history, isEditingLayout, storageWarning } = useSyncExternalStore(
    subscribeHomeDiy,
    getHomeDiySnapshot,
    getHomeDiySnapshot,
  )
  const [mounted, setMounted] = useState(false)
  // 跨标签页通道（挂载后才建立，SSR 阶段为 null）
  const syncChannelRef = useRef<LayoutSyncChannel<HomeDIYConfig> | null>(null)

  // 1. 客户端挂载时读本地存储（v3 / v2 / v1 迁移 + #diy 分享链接）并填充共享状态。
  //    只让第一个挂载的组件去读：共享状态只有一份，后挂载的组件
  //    （例如切到 hybrid 才动态加载的 HomeHeroDeck）再读一遍会把撤销栈冲掉。
  useEffect(() => {
    hydrateHomeDiy()
    setMounted(true)
  }, [])

  // 2. 动态同步强调色到文档根元素属性
  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (config.accentColor && config.accentColor !== 'default') {
        document.documentElement.setAttribute('data-accent', config.accentColor)
      } else {
        document.documentElement.removeAttribute('data-accent')
      }
    }
  }, [config.accentColor])

  // 3. 持久化 + 跨标签广播（撤销历史已挪进共享状态，见本文件顶部说明）
  const publishToOtherTabs = useCallback((result: HomeDiyWriteResult) => {
    // 落盘成功才广播：本地都没存住，广播出去只会让别的标签页拿到一份
    // 本标签页刷新后就消失的布局
    if (!result.ok) return
    syncChannelRef.current?.publish({
      clientId: getLayoutClientId(),
      config: result.config,
      clocks: result.clocks,
    })
  }, [])

  const persistConfig = useCallback((updater: (prev: HomeDIYConfig) => HomeDIYConfig) => {
    publishToOtherTabs(commitHomeDiyConfig(updater))
  }, [publishToOtherTabs])

  // 3.1 接收远端标签页的改动：按插槽 LWW 合并，绝不整表覆盖
  const applyRemoteConfig = useCallback((payload: { config: HomeDIYConfig; clocks: LayoutSlotClocks }) => {
    // 合并、落盘、更新共享状态都在 lib 里做：不压撤销历史（远端改动不是本标签页的
    // 操作，进栈会让 Ctrl+Z 行为不可预测），也不再广播（否则两边互相推回声）
    applyRemoteHomeDiyConfig(payload)
  }, [])

  // 3.2 建立 / 拆除跨标签页通道
  useEffect(() => {
    if (!mounted) return
    const channel = createLayoutSyncChannel<HomeDIYConfig>(applyRemoteConfig)
    syncChannelRef.current = channel
    return () => {
      channel.close()
      syncChannelRef.current = null
    }
  }, [mounted, applyRemoteConfig])

  // 4. 视图模态切换
  const setViewMode = useCallback((mode: HomeViewMode) => {
    persistConfig((prev) => ({ ...prev, viewMode: mode, updatedAt: Date.now() }))
  }, [persistConfig])

  // 5. 卡片视觉形态切换
  const setCardDisplayMode = useCallback((mode: CardDisplayMode) => {
    persistConfig((prev) => ({ ...prev, cardDisplayMode: mode, updatedAt: Date.now() }))
  }, [persistConfig])

  // 6. 画布背景切换
  const setCanvasBackground = useCallback((bg: CanvasBackground) => {
    persistConfig((prev) => ({ ...prev, canvasBackground: bg, updatedAt: Date.now() }))
  }, [persistConfig])

  // 7. 强调色切换
  const setAccentColor = useCallback((color: AccentColor) => {
    persistConfig((prev) => ({ ...prev, accentColor: color, updatedAt: Date.now() }))
  }, [persistConfig])

  // 8. 折叠/展开首屏组件展板
  const toggleHeroDeckCollapsed = useCallback(() => {
    persistConfig((prev) => ({ ...prev, heroDeckCollapsed: !prev.heroDeckCollapsed, updatedAt: Date.now() }))
  }, [persistConfig])

  // 9. 更新首屏挂载的组件列表
  const setHeroDeckWidgets = useCallback((widgets: string[]) => {
    persistConfig((prev) => ({ ...prev, heroDeckWidgets: widgets, updatedAt: Date.now() }))
  }, [persistConfig])

  // 10. 分类置顶/取消置顶
  const togglePinCategory = useCallback((categoryId: string) => {
    persistConfig((prev) => {
      const isPinned = prev.pinnedCategoryIds.includes(categoryId)
      const nextPinned = isPinned
        ? prev.pinnedCategoryIds.filter((id) => id !== categoryId)
        : [...prev.pinnedCategoryIds, categoryId]
      return { ...prev, pinnedCategoryIds: nextPinned, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 11. 分类隐藏/恢复
  const toggleHideCategory = useCallback((categoryId: string) => {
    persistConfig((prev) => {
      const isHidden = prev.hiddenCategoryIds.includes(categoryId)
      const nextHidden = isHidden
        ? prev.hiddenCategoryIds.filter((id) => id !== categoryId)
        : [...prev.hiddenCategoryIds, categoryId]
      return { ...prev, hiddenCategoryIds: nextHidden, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 12. 恢复单个分类
  const unhideCategory = useCallback((categoryId: string) => {
    persistConfig((prev) => ({
      ...prev,
      hiddenCategoryIds: prev.hiddenCategoryIds.filter((id) => id !== categoryId),
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // 13. 恢复全部隐藏的分类
  const unhideAllCategories = useCallback(() => {
    persistConfig((prev) => ({ ...prev, hiddenCategoryIds: [], updatedAt: Date.now() }))
  }, [persistConfig])

  // 14. 分类上下移动
  const moveCategory = useCallback((categoryId: string, direction: 'up' | 'down', currentAllIds: string[]) => {
    persistConfig((prev) => {
      const order = prev.categoryOrder.length > 0 ? [...prev.categoryOrder] : [...currentAllIds]
      for (const id of currentAllIds) {
        if (!order.includes(id)) order.push(id)
      }

      const index = order.indexOf(categoryId)
      if (index === -1) return prev

      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= order.length) return prev

      const [removed] = order.splice(index, 1)
      if (removed !== undefined) {
        order.splice(targetIndex, 0, removed)
      }

      return { ...prev, categoryOrder: order, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 14.1 拖拽定向重排分类次序
  const reorderCategory = useCallback((
    sourceId: string,
    targetId: string,
    position: 'before' | 'after' = 'before',
    currentAllIds: string[] = []
  ) => {
    persistConfig((prev) => {
      const nextOrder = reorderCategoryToTarget(
        prev.categoryOrder,
        sourceId,
        targetId,
        position,
        currentAllIds
      )
      return { ...prev, categoryOrder: nextOrder, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 15. 分类内站点置顶切换
  const togglePinSiteInCategory = useCallback((categoryId: string, siteId: string) => {
    persistConfig((prev) => {
      const updatedMap = togglePinnedSiteInCategory(prev.pinnedSiteIdsByCategory, categoryId, siteId)
      return { ...prev, pinnedSiteIdsByCategory: updatedMap, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 16. 重置分类排序与显隐
  const resetCategoryLayout = useCallback(() => {
    persistConfig((prev) => ({
      ...prev,
      categoryOrder: [],
      pinnedCategoryIds: [],
      hiddenCategoryIds: [],
      pinnedSiteIdsByCategory: {},
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // 16.1 智能自适应热度半衰期推荐排序开关
  const toggleAdaptiveRanking = useCallback(() => {
    persistConfig((prev) => ({
      ...prev,
      enableAdaptiveRanking: !prev.enableAdaptiveRanking,
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // 17. 添加自定义专属分类
  const addCustomCategory = useCallback((title: string, icon?: string) => {
    if (!title.trim()) return
    const newCat: CustomCategory = {
      id: `custom_cat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: title.trim(),
      icon: icon || 'FolderHeart',
      items: [],
      createdAt: Date.now(),
    }
    persistConfig((prev) => ({
      ...prev,
      customCategories: [newCat, ...prev.customCategories],
      updatedAt: Date.now(),
    }))
    return newCat.id
  }, [persistConfig])

  // 18. 删除自定义分类
  const deleteCustomCategory = useCallback((categoryId: string) => {
    persistConfig((prev) => ({
      ...prev,
      customCategories: prev.customCategories.filter((c) => c.id !== categoryId),
      pinnedCategoryIds: prev.pinnedCategoryIds.filter((id) => id !== categoryId),
      hiddenCategoryIds: prev.hiddenCategoryIds.filter((id) => id !== categoryId),
      categoryOrder: prev.categoryOrder.filter((id) => id !== categoryId),
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // 19. 添加站点到自建专属分类
  const addSiteToCustomCategory = useCallback((categoryId: string, site: CustomCategoryItem) => {
    persistConfig((prev) => {
      const nextCats = prev.customCategories.map((cat) => {
        if (cat.id !== categoryId) return cat
        if (cat.items.some((i) => i.id === site.id || i.href === site.href)) return cat
        return {
          ...cat,
          items: [site, ...cat.items],
        }
      })
      return { ...prev, customCategories: nextCats, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 20. 从自建分类移除站点
  const removeSiteFromCustomCategory = useCallback((categoryId: string, siteId: string) => {
    persistConfig((prev) => {
      const nextCats = prev.customCategories.map((cat) => {
        if (cat.id !== categoryId) return cat
        return {
          ...cat,
          items: cat.items.filter((i) => i.id !== siteId),
        }
      })
      return { ...prev, customCategories: nextCats, updatedAt: Date.now() }
    })
  }, [persistConfig])

  // 21. 一键应用预设情境模版
  const applyDIYPreset = useCallback((presetId: string, setDensityCallback?: (density: string) => void) => {
    const target = BUILTIN_DIY_PRESETS.find((p: DIYPreset) => p.id === presetId)
    if (!target) return false

    persistConfig((prev) => ({
      ...prev,
      viewMode: target.config.viewMode,
      cardDisplayMode: target.config.cardDisplayMode,
      canvasBackground: target.config.canvasBackground,
      heroDeckCollapsed: target.config.heroDeckCollapsed,
      heroDeckWidgets: target.config.heroDeckWidgets,
      updatedAt: Date.now(),
    }))

    if (setDensityCallback) {
      setDensityCallback(target.config.density)
    }
    return true
  }, [persistConfig])

  // 22. 导出配置 JSON
  const exportDIYConfig = useCallback(() => {
    return JSON.stringify(config, null, 2)
  }, [config])

  // 23. 导入并清洗配置 JSON
  const importDIYConfig = useCallback((jsonString: string) => {
    try {
      const parsed = JSON.parse(jsonString)
      const res = validateAndCleanDIYConfig(parsed)
      if (!res.valid || !res.config) {
        return { ok: false, message: res.error || '无效的配置格式' }
      }
      persistConfig(() => ({ ...res.config, updatedAt: Date.now() }))
      return { ok: true, message: '配置已成功导入并生效！' }
    } catch (e: any) {
      return { ok: false, message: `JSON 解析失败: ${e.message || '格式错误'}` }
    }
  }, [persistConfig])

  // 24. 重置全量配置
  const resetDIYConfig = useCallback(() => {
    persistConfig(() => ({ ...DEFAULT_CONFIG, updatedAt: Date.now() }))
  }, [persistConfig])

  // 25. 导出并使用主密码加密 DIY 全量配置 (零知识 E2EE)
  const exportEncryptedDIYConfig = useCallback(async (passphrase: string): Promise<string> => {
    const payload = await encryptGenericPayload(config, passphrase, 'navhub_home_diy_config_v3')
    return JSON.stringify(payload, null, 2)
  }, [config])

  // 26. 解密并应用 DIY 全量配置 (零知识 E2EE)
  const importEncryptedDIYConfig = useCallback(async (encryptedJsonStr: string, passphrase: string) => {
    try {
      const parsed = JSON.parse(encryptedJsonStr)
      if (!parsed.cipherTextBase64 || !parsed.ivHex || !parsed.saltHex) {
        return { ok: false, message: '无效的零知识金库密文包格式' }
      }
      const decrypted = await decryptGenericPayload<HomeDIYConfig>(parsed, passphrase)
      const res = validateAndCleanDIYConfig(decrypted)
      if (!res.valid || !res.config) {
        return { ok: false, message: res.error || '解密数据校验失败' }
      }
      persistConfig(() => ({ ...res.config, updatedAt: Date.now() }))
      return { ok: true, message: '🎉 零知识金库验证成功，排版与专属配置已全量还原！' }
    } catch (e: any) {
      return { ok: false, message: e.message || '解密失败：主密码不匹配或密文已被篡改' }
    }
  }, [persistConfig])

  // 24. E2EE 云端金库同步：上传密文到中枢云端
  const syncToCloudVault = useCallback(async (passphrase: string): Promise<{ success: boolean; version?: number; error?: string }> => {
    if (!passphrase || passphrase.length < 6) {
      return { success: false, error: '主密码长度至少需 6 位' }
    }
    const encrypted = await exportEncryptedDIYConfig(passphrase)
    if (!encrypted) {
      return { success: false, error: '本地配置加密失败' }
    }
    const identity = getIdentity()
    if (!identity) {
      return { success: false, error: '无法获取用户身份标识' }
    }
    const res = await saveCloudVault(identity, encrypted)
    if (!res.ok) {
      return { success: false, error: '中枢云端金库同步失败，请检查网络或后端服务' }
    }
    return { success: true, version: res.version }
  }, [exportEncryptedDIYConfig])

  // 25. E2EE 云端金库同步：从云端拉取并解密
  const syncFromCloudVault = useCallback(async (passphrase: string): Promise<{ success: boolean; error?: string; updatedAt?: number }> => {
    if (!passphrase) {
      return { success: false, error: '请输入解密主密码' }
    }
    const identity = getIdentity()
    if (!identity) {
      return { success: false, error: '无法获取用户身份标识' }
    }
    const cloudRecord = await fetchCloudVault(identity)
    if (!cloudRecord || !cloudRecord.payload) {
      return { success: false, error: '云端暂未查询到该身份的备份金库' }
    }
    const res = await importEncryptedDIYConfig(cloudRecord.payload, passphrase)
    if (!res.ok) {
      return { success: false, error: res.message || '云端金库解密校验失败' }
    }
    return { success: true, updatedAt: cloudRecord.updatedAt }
  }, [importEncryptedDIYConfig])

  // 26. 查询云端金库元信息（版本与更新时间）
  const checkCloudVaultStatus = useCallback(async (): Promise<{ hasCloudVault: boolean; updatedAt?: number; version?: number }> => {
    const identity = getIdentity()
    if (!identity) return { hasCloudVault: false }
    const cloudRecord = await fetchCloudVault(identity)
    if (!cloudRecord || !cloudRecord.payload) {
      return { hasCloudVault: false }
    }
    return { hasCloudVault: true, updatedAt: cloudRecord.updatedAt, version: cloudRecord.version }
  }, [])

  // 27. 清空云端金库
  const clearCloudVault = useCallback(async (): Promise<boolean> => {
    const identity = getIdentity()
    if (!identity) return false
    return await deleteCloudVault(identity)
  }, [])

  const setIsEditingLayout = useCallback((next: boolean) => {
    setHomeDiyEditingLayout(next)
  }, [])

  /** 编排模式开关：工具栏与导航区读同一份状态，拖拽手柄才会真的出现 */
  const toggleEditingLayout = useCallback(() => {
    setHomeDiyEditingLayout(!getHomeDiySnapshot().isEditingLayout)
  }, [])

  // 28. 撤销 (Undo) / 重做 (Redo)：栈在共享状态里，谁按 Ctrl+Z 撤的都是同一条历史
  const canUndo = history.past.length > 0
  const canRedo = history.future.length > 0

  const undo = useCallback(() => {
    const result = undoHomeDiy()
    if (result) publishToOtherTabs(result)
  }, [publishToOtherTabs])

  const redo = useCallback(() => {
    const result = redoHomeDiy()
    if (result) publishToOtherTabs(result)
  }, [publishToOtherTabs])

  // 30. 全局快捷键监听 (编排模式下支持 Ctrl+Z / Cmd+Z 撤销, Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y 重做)
  useEffect(() => {
    if (!isEditingLayout) return
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
      const metaOrCtrl = isMac ? e.metaKey : e.ctrlKey
      if (!metaOrCtrl) return

      // 避免在输入框/文本域中拦截原生撤销
      const activeEl = document.activeElement
      const isInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      if (isInput) return

      if (e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault()
          redo()
        } else {
          e.preventDefault()
          undo()
        }
      } else if (e.key.toLowerCase() === 'y' && !isMac) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditingLayout, undo, redo])

  // 31. 分类手风琴折叠展开操作
  const toggleCollapseCategory = useCallback((categoryId: string) => {
    persistConfig((prev) => {
      const next = toggleCollapsedCategoryPure(prev.collapsedCategoryIds || [], categoryId)
      return { ...prev, collapsedCategoryIds: next, updatedAt: Date.now() }
    })
  }, [persistConfig])

  const collapseAllCategories = useCallback((allCategoryIds: string[]) => {
    persistConfig((prev) => ({
      ...prev,
      collapsedCategoryIds: collapseAllCategoriesPure(allCategoryIds),
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  const expandAllCategories = useCallback(() => {
    persistConfig((prev) => ({
      ...prev,
      collapsedCategoryIds: expandAllCategoriesPure(),
      updatedAt: Date.now(),
    }))
  }, [persistConfig])


  // 跨分类重归类卡片 (Cross-Category Reclassification)
  const reclassifySite = useCallback((siteId: string, targetCategoryId: string) => {
    persistConfig((prev) => ({
      ...prev,
      siteCategoryOverrides: { ...prev.siteCategoryOverrides, [siteId]: targetCategoryId },
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  const resetSiteCategoryOverrides = useCallback(() => {
    persistConfig((prev) => ({
      ...prev,
      siteCategoryOverrides: {},
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // 自定义壁纸与毛玻璃美学调节
  // 安全：入口即校验，非法直接置空（由 diy-presets 的白名单口径决定，避免脏数据入库）
  const setCustomWallpaper = useCallback((url: string) => {
    persistConfig((prev) => {
      const raw = (url || '').trim().slice(0, 2048)
      let next = ''
      try {
        // 动态 import 会增加包体，直接用轻量正则（与 diy-presets 同口径）
        if (/^(https?:\/\/[^'"()\s]+|\/[^'"()\s]*|data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/i.test(raw)) next = raw
      } catch { next = '' }
      return { ...prev, customWallpaperUrl: next, updatedAt: Date.now() };
    });
  }, [persistConfig]);

  const setAestheticSliders = useCallback((blur: number, opacity: number) => {
    persistConfig((prev) => ({
      ...prev,
      glassmorphismBlur: Math.min(30, Math.max(0, blur)),
      cardOpacity: Math.min(1.0, Math.max(0.2, opacity)),
      updatedAt: Date.now(),
    }))
  }, [persistConfig])

  // URL Hash 免登预设分享。编码逻辑在 lib/diy-share-link.ts：失败会带上原因，
  // 不再像以前那样返回空串让调用方静默吞掉。
  const exportPresetToUrlHash = useCallback((): ShareLinkOutcome => {
    if (typeof window === 'undefined') {
      return { ok: false, reason: '当前页面还没有准备好，稍后再试' }
    }
    return encodeShareLink(
      {
        v: config.version,
        vm: config.viewMode,
        cdm: config.cardDisplayMode,
        bg: config.canvasBackground,
        ac: config.accentColor,
        co: config.categoryOrder,
        pco: config.pinnedCategoryIds,
        hco: config.hiddenCategoryIds,
        sco: config.siteCategoryOverrides,
        wp: config.customWallpaperUrl,
        gb: config.glassmorphismBlur,
        co_op: config.cardOpacity,
      },
      { origin: window.location.origin, pathname: window.location.pathname },
    )
  }, [config]);

  // 注：以前这里还有一个 importPresetFromUrlHash，从没被调用过
  // （唯一来源是 home-diy-toolbar 的解构，那边只用 exportPresetToUrlHash），
  // 而且匹配条件比真正生效的 applyHomeDiyShareHash() 更宽（includes vs startsWith），
  // 已删除：免登导入只保留上面那一条实现。

  return {
    config,
    reclassifySite,
    resetSiteCategoryOverrides,
    setCustomWallpaper,
    setAestheticSliders,
    exportPresetToUrlHash,
    siteCategoryOverrides: config.siteCategoryOverrides || {},
    customWallpaperUrl: config.customWallpaperUrl || '',
    glassmorphismBlur: config.glassmorphismBlur ?? 12,
    cardOpacity: config.cardOpacity ?? 0.9,

    mounted,
    viewMode: config.viewMode,
    cardDisplayMode: config.cardDisplayMode,
    canvasBackground: config.canvasBackground,
    accentColor: config.accentColor,
    isHeroDeckCollapsed: config.heroDeckCollapsed,
    heroDeckWidgets: config.heroDeckWidgets,
    categoryOrder: config.categoryOrder,
    pinnedCategoryIds: config.pinnedCategoryIds,
    hiddenCategoryIds: config.hiddenCategoryIds,
    collapsedCategoryIds: config.collapsedCategoryIds || [],
    pinnedSiteIdsByCategory: config.pinnedSiteIdsByCategory,
    customCategories: config.customCategories,
    isEditingLayout,
    setIsEditingLayout,
    toggleEditingLayout,
    /** 非 null = 上次落盘失败（改动已生效但刷新会丢）：界面必须显示出来 */
    storageWarning,
    dismissStorageWarning: dismissHomeDiyStorageWarning,
    canUndo,
    canRedo,
    undo,
    redo,
    toggleCollapseCategory,
    collapseAllCategories,
    expandAllCategories,
    setViewMode,
    setCardDisplayMode,
    setCanvasBackground,
    setAccentColor,
    toggleHeroDeckCollapsed,
    setHeroDeckWidgets,
    togglePinCategory,
    toggleHideCategory,
    unhideCategory,
    unhideAllCategories,
    moveCategory,
    reorderCategory,
    togglePinSiteInCategory,
    resetCategoryLayout,
    addCustomCategory,
    deleteCustomCategory,
    addSiteToCustomCategory,
    removeSiteFromCustomCategory,
    isAdaptiveRankingEnabled: Boolean(config.enableAdaptiveRanking),
    toggleAdaptiveRanking,
    applyDIYPreset,
    exportDIYConfig,
    importDIYConfig,
    exportEncryptedDIYConfig,
    importEncryptedDIYConfig,
    syncToCloudVault,
    syncFromCloudVault,
    checkCloudVaultStatus,
    clearCloudVault,
    resetDIYConfig,
  }
}
