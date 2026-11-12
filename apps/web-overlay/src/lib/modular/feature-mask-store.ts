/**
 * 不可变基础配置（Immutable Base）+ 用户差异掩码层（User Delta Masking）+ 时间轴回收站（Time-Machine Trash）
 *
 * 架构原则：
 * 1. 绝不直接修改或破坏底层 4,839 个站点 JSON 与默认组件树（Immutable Base）。
 * 2. 在本地（localStorage: `navhub_feature_mask_v1` + 轻量首屏防闪烁键 `nav_pruned_ids`）维护用户的增量裁剪掩码。
 * 3. 覆盖 4 层颗粒度模型：
 *    - L1_MODULE: 全局功能组件（视角条、Hero 横幅、极速启动展板、极速直达坞 Top 10、实时协同状态、站内目录、页脚生态入口）
 *    - L2_CATEGORY / L2_SUBCATEGORY: 18 个一级大类与 200+ 二级子分类
 *    - L3_SITE / L3_MICRO: 单个特定站点卡片、卡片内部微元素（简介文本、#标签栏、Space 速览角标、置顶/热度徽标）
 *    - L4_FEATURE: 交互与实验室特性（顶部操作提示条、键盘巡航、悬浮气泡提示、右下角 DIY 悬浮按钮）
 * 4. 防自锁死安全阀（Anti-Lockout Guardrail）：
 *    即使隐藏了右下角 DIY 按钮或顶栏入口，键盘快捷键 `Ctrl/Cmd + E` 与
 *    `Cmd/Ctrl + K` 搜索穿透召回始终保持最高优先级激活（裸按 E 已按
 *    WCAG 2.1.4 废止：单字符快捷键会与读屏软件冲突）。
 */

import { useSyncExternalStore, useCallback, useMemo } from 'react'

export type FeatureGranularityLevel =
  | 'L1_MODULE'
  | 'L2_CATEGORY'
  | 'L2_SUBCATEGORY'
  | 'L3_SITE'
  | 'L3_MICRO'
  | 'L4_FEATURE'

// 用户自由删减与恢复的核心状态契约
export interface TrashItem {
  id: string // 如 'mod:speed-dial' | 'cat:life' | 'sub:ai-audio' | 'site:40'
  level: FeatureGranularityLevel
  title: string // 用于在恢复中心展示人类可读的名称，如 "⚡ 极速直达坞 Top 10"
  parentTitle?: string // 如 "AI 工具 > AI 音频语音"
  deletedAt: number // 删除时间戳，支持按最近删除排序与一键 Ctrl+Z 撤销
  previousIndex?: number // 原有位置索引，确保恢复后回到原位而非末尾
}

export interface CardElementsMask {
  showDescription: boolean // 是否显示简介文本
  showTags: boolean // 是否显示 #标签
  showQuickLookBadge: boolean // 是否显示 Space 速览角标
  showPinnedBadge: boolean // 是否显示 📌 已置顶 / 自适应热度角标
}

export interface FeatureMaskState {
  hiddenModules: string[] // L1: ['mod:hero-header', 'mod:speed-dial', ...]
  hiddenCategories: string[] // L2: ['cat:shopping', ...]
  hiddenSubcategories: string[] // L2: ['sub:ai-audio', ...]
  hiddenSites: string[] // L3: ['site:1024', ...]
  hiddenFeatures: string[] // L4: ['feat:tooltips', 'feat:diy-fab', ...]
  cardElements: CardElementsMask // L3_MICRO
  trashBin: TrashItem[]
  bypassMaskTemporarily: boolean // 临时透视完整版（不丢失掩码配置）
}

export interface UserFeatureMaskStore extends FeatureMaskState {
  removeFeature: (item: Omit<TrashItem, 'deletedAt'> & { deletedAt?: number }) => void
  restoreFeature: (id: string) => TrashItem | null
  undoLastRemove: () => TrashItem | null
  restoreAll: () => void
  toggleCardElement: (key: keyof CardElementsMask, forceValue?: boolean) => void
  setCompactCapsuleMode: (enabled: boolean) => void
  setBypassMaskTemporarily: (bypass: boolean) => void
}

export const FEATURE_MASK_STORAGE_KEY = 'navhub_feature_mask_v1'
export const NAV_PRUNED_IDS_KEY = 'nav_pruned_ids'

export interface FeatureCatalogDefinition {
  id: string
  level: FeatureGranularityLevel
  title: string
  description: string
  parentTitle?: string
}

/**
 * L1 全局功能组件元数据目录（与首页实体模块一一对应）
 */
export const L1_MODULE_CATALOG: readonly FeatureCatalogDefinition[] = [
  {
    id: 'mod:workspace-bar',
    level: 'L1_MODULE',
    title: '次顶栏视角条（全部探索 ~ 自适应工作区）',
    description: '顶部角色工作台切换与快捷分类跳板条',
    parentTitle: 'L1 全局功能组件',
  },
  {
    id: 'mod:hero-header',
    level: 'L1_MODULE',
    title: 'Hero 标题横幅（山羊胡网址导航大全）',
    description: '首屏主标题、副标题与站点统计摘要横幅',
    parentTitle: 'L1 全局功能组件',
  },
  {
    id: 'mod:onboarding-card',
    level: 'L1_MODULE',
    title: '首屏快捷键与定制引导横幅',
    description: '新手操作引导与 DIY 排版快速入口横幅',
    parentTitle: 'L1 全局功能组件',
  },
  {
    id: 'mod:hero-deck',
    level: 'L1_MODULE',
    title: '极速启动展板（多引擎聚合搜索 / 时钟 / 收藏足迹）',
    description: '首屏 Bento 仪表盘，卸载后站点分类流直接置顶吸附',
    parentTitle: 'L1 全局功能组件',
  },
  {
    id: 'mod:speed-dial',
    level: 'L1_MODULE',
    title: '⚡ 极速直达坞 Top 10',
    description: '基于访问频次与手动固定的首屏 Top 10 极速启动条',
    parentTitle: 'L1 全局功能组件',
  },
  {
    id: 'mod:crdt-pill',
    level: 'L1_MODULE',
    title: '左下角 🟢 实时协同就绪状态栏',
    description: '侧边栏底部的本地优先 CRDT / E2EE 零知识同步状态指示器',
    parentTitle: 'L1 全局功能组件',
  },
  {
    id: 'mod:footer-directory',
    level: 'L1_MODULE',
    title: '底部站内目录（全部分类索引带）',
    description: '主内容区底部的全站分类快速索引胶囊带',
    parentTitle: 'L1 全局功能组件',
  },
  {
    id: 'mod:footer',
    level: 'L1_MODULE',
    title: '底部生态入口与页脚',
    description: '包含模块化工作台、插件市场等 14 个生态入口的全局页脚',
    parentTitle: 'L1 全局功能组件',
  },
] as const

/**
 * L3 卡片内部微元素目录
 */
export const L3_MICRO_CATALOG: readonly (FeatureCatalogDefinition & {
  elementKey: keyof CardElementsMask
})[] = [
  {
    id: 'micro:showDescription',
    elementKey: 'showDescription',
    level: 'L3_MICRO',
    title: '卡片简介文本',
    description: '显示站点两行摘要描述；与标签同时关闭时卡片坍缩为极简胶囊',
    parentTitle: 'L3 卡片内部微结构',
  },
  {
    id: 'micro:showTags',
    elementKey: 'showTags',
    level: 'L3_MICRO',
    title: '卡片 #标签栏',
    description: '显示卡片底部的分类特征标签（#开源、#官方文档等）',
    parentTitle: 'L3 卡片内部微结构',
  },
  {
    id: 'micro:showQuickLookBadge',
    elementKey: 'showQuickLookBadge',
    level: 'L3_MICRO',
    title: 'Space 速览徽标',
    description: '键盘聚焦时显示的「Space 速览」快捷提示角标',
    parentTitle: 'L3 卡片内部微结构',
  },
  {
    id: 'micro:showPinnedBadge',
    elementKey: 'showPinnedBadge',
    level: 'L3_MICRO',
    title: '📌 已置顶与热度徽标',
    description: '显示分类内置顶角标、GitHub Stars 与平替推荐徽标',
    parentTitle: 'L3 卡片内部微结构',
  },
] as const

/**
 * L4 交互与实验室特性目录
 */
export const L4_FEATURE_CATALOG: readonly FeatureCatalogDefinition[] = [
  {
    id: 'feat:keyboard-hint',
    level: 'L4_FEATURE',
    title: '顶部键盘操作说明辅助节点',
    description: '按空格打开速览等无障碍与快捷键辅助提示',
    parentTitle: 'L4 交互与实验室特性',
  },
  {
    id: 'feat:keyboard-nav',
    level: 'L4_FEATURE',
    title: '全局键盘巡航与 T 键微工具箱',
    description: '关闭后卸载非核心快捷键监听（防自锁死保护：Ctrl/Cmd+E 与 Cmd+K 永久保留）',
    parentTitle: 'L4 交互与实验室特性',
  },
  {
    id: 'feat:tooltips',
    level: 'L4_FEATURE',
    title: '卡片悬浮气泡提示（Tooltip）',
    description: '鼠标悬停在站点卡片上时弹出的完整描述气泡',
    parentTitle: 'L4 交互与实验室特性',
  },
  {
    id: 'feat:diy-fab',
    level: 'L4_FEATURE',
    title: '右下角 [DIY 排版工坊 Ctrl/⌘+E] 悬浮按钮',
    description: '隐藏右下角常驻悬浮按钮（仍可随时按 Ctrl/Cmd+E 呼出恢复中心）',
    parentTitle: 'L4 交互与实验室特性',
  },
] as const

export const DEFAULT_CARD_ELEMENTS: CardElementsMask = {
  showDescription: true,
  showTags: true,
  showQuickLookBadge: true,
  showPinnedBadge: true,
}

export const DEFAULT_FEATURE_MASK_STATE: FeatureMaskState = {
  hiddenModules: [],
  hiddenCategories: [],
  hiddenSubcategories: [],
  hiddenSites: [],
  hiddenFeatures: [],
  cardElements: { ...DEFAULT_CARD_ELEMENTS },
  trashBin: [],
  bypassMaskTemporarily: false,
}

/**
 * 规范化各层级的特征 ID，确保带前缀与不带前缀调用均可幂等对齐
 */
export function normalizeFeatureId(id: string, level?: FeatureGranularityLevel): string {
  const trimmed = String(id || '').trim()
  if (!trimmed) return ''
  if (
    trimmed.startsWith('mod:') ||
    trimmed.startsWith('cat:') ||
    trimmed.startsWith('sub:') ||
    trimmed.startsWith('site:') ||
    trimmed.startsWith('micro:') ||
    trimmed.startsWith('feat:')
  ) {
    return trimmed
  }
  switch (level) {
    case 'L1_MODULE':
      return `mod:${trimmed}`
    case 'L2_CATEGORY':
      return `cat:${trimmed}`
    case 'L2_SUBCATEGORY':
      return `sub:${trimmed}`
    case 'L3_SITE':
      return `site:${trimmed}`
    case 'L3_MICRO':
      return `micro:${trimmed}`
    case 'L4_FEATURE':
      return `feat:${trimmed}`
    default:
      return trimmed
  }
}

export function stripFeaturePrefix(id: string): string {
  return String(id || '').replace(/^(mod|cat|sub|site|micro|feat):/, '')
}

let currentState: FeatureMaskState = { ...DEFAULT_FEATURE_MASK_STATE }
let isInitialized = false
const listeners = new Set<() => void>()

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

/**
 * 同步轻量级 `nav_pruned_ids` 至 localStorage 与 `<html data-pruned="...">`，
 * 供首屏 Anti-FOUC 脚本与 CSS 属性选择器在 React 水合前提前隐藏已删减模块。
 */
function syncPrunedAttributeAndLightweightStorage(state: FeatureMaskState) {
  if (typeof window === 'undefined') return
  try {
    const prunedIds = state.bypassMaskTemporarily
      ? []
      : [
          ...state.hiddenModules,
          ...state.hiddenCategories,
          ...state.hiddenSubcategories,
          ...state.hiddenFeatures,
        ]
    window.localStorage.setItem(NAV_PRUNED_IDS_KEY, JSON.stringify(prunedIds))
    if (typeof document !== 'undefined' && document.documentElement) {
      if (prunedIds.length > 0) {
        document.documentElement.setAttribute('data-pruned', prunedIds.join(' '))
      } else {
        document.documentElement.removeAttribute('data-pruned')
      }
    }
  } catch {
    // 忽略隐私模式或配额限制错误
  }
}

function sanitizeLoadedState(raw: unknown): FeatureMaskState {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_FEATURE_MASK_STATE,
      cardElements: { ...DEFAULT_CARD_ELEMENTS },
    }
  }
  const obj = raw as Partial<FeatureMaskState>
  const toStrArr = (val: unknown, level?: FeatureGranularityLevel): string[] => {
    if (!Array.isArray(val)) return []
    const set = new Set<string>()
    for (const item of val) {
      if (typeof item === 'string' && item.trim()) {
        set.add(normalizeFeatureId(item, level))
      }
    }
    return Array.from(set)
  }

  // 显式标注类型：三元表达式的两个分支（Partial 的字段 / {}）会让 TS 推断成 {}，
  // 之后 ce.showDescription 就报「不存在于 {}」。这里按可选的卡片掩码收窄。
  const ce: Partial<CardElementsMask> =
    obj.cardElements && typeof obj.cardElements === 'object' ? obj.cardElements : {}
  const cardElements: CardElementsMask = {
    showDescription: typeof ce.showDescription === 'boolean' ? ce.showDescription : true,
    showTags: typeof ce.showTags === 'boolean' ? ce.showTags : true,
    showQuickLookBadge: typeof ce.showQuickLookBadge === 'boolean' ? ce.showQuickLookBadge : true,
    showPinnedBadge: typeof ce.showPinnedBadge === 'boolean' ? ce.showPinnedBadge : true,
  }

  const trashBin: TrashItem[] = Array.isArray(obj.trashBin)
    ? obj.trashBin
        .filter(
          (t): t is TrashItem =>
            Boolean(t) &&
            typeof t === 'object' &&
            typeof t.id === 'string' &&
            typeof t.level === 'string' &&
            typeof t.title === 'string' &&
            typeof t.deletedAt === 'number'
        )
        .map((t) => ({
          ...t,
          id: normalizeFeatureId(t.id, t.level),
        }))
        .sort((a, b) => b.deletedAt - a.deletedAt)
    : []

  return {
    hiddenModules: toStrArr(obj.hiddenModules, 'L1_MODULE'),
    hiddenCategories: toStrArr(obj.hiddenCategories, 'L2_CATEGORY'),
    hiddenSubcategories: toStrArr(obj.hiddenSubcategories, 'L2_SUBCATEGORY'),
    hiddenSites: toStrArr(obj.hiddenSites, 'L3_SITE'),
    hiddenFeatures: toStrArr(obj.hiddenFeatures, 'L4_FEATURE'),
    cardElements,
    trashBin,
    bypassMaskTemporarily: Boolean(obj.bypassMaskTemporarily),
  }
}

export function loadFeatureMaskState(): FeatureMaskState {
  if (typeof window === 'undefined') {
    return currentState
  }
  try {
    const raw = window.localStorage.getItem(FEATURE_MASK_STORAGE_KEY)
    if (!raw) {
      currentState = {
        ...DEFAULT_FEATURE_MASK_STATE,
        cardElements: { ...DEFAULT_CARD_ELEMENTS },
      }
    } else {
      currentState = sanitizeLoadedState(JSON.parse(raw))
    }
  } catch {
    currentState = {
      ...DEFAULT_FEATURE_MASK_STATE,
      cardElements: { ...DEFAULT_CARD_ELEMENTS },
    }
  }
  isInitialized = true
  syncPrunedAttributeAndLightweightStorage(currentState)
  return currentState
}

function persistState(next: FeatureMaskState) {
  currentState = next
  isInitialized = true
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(FEATURE_MASK_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // 忽略存储写入失败
    }
    syncPrunedAttributeAndLightweightStorage(next)
  }
  emitChange()
}

export function getFeatureMaskSnapshot(): FeatureMaskState {
  if (!isInitialized && typeof window !== 'undefined') {
    return loadFeatureMaskState()
  }
  return currentState
}

export function getServerFeatureMaskSnapshot(): FeatureMaskState {
  return DEFAULT_FEATURE_MASK_STATE
}

export function subscribeFeatureMask(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 原子操作：删减/隐藏任意层级的模块、分类、子分类、站点、微元素或交互特性，并推入时间轴回收站
 */
export function removeFeatureFromMask(
  item: Omit<TrashItem, 'deletedAt'> & { deletedAt?: number }
): TrashItem {
  const state = getFeatureMaskSnapshot()
  const normalizedId = normalizeFeatureId(item.id, item.level)
  const deletedAt = typeof item.deletedAt === 'number' ? item.deletedAt : Date.now()

  const trashEntry: TrashItem = {
    id: normalizedId,
    level: item.level,
    title: item.title,
    parentTitle: item.parentTitle,
    deletedAt,
    previousIndex: item.previousIndex,
  }

  let hiddenModules = state.hiddenModules
  let hiddenCategories = state.hiddenCategories
  let hiddenSubcategories = state.hiddenSubcategories
  let hiddenSites = state.hiddenSites
  let hiddenFeatures = state.hiddenFeatures
  let cardElements = state.cardElements

  switch (item.level) {
    case 'L1_MODULE':
      if (!hiddenModules.includes(normalizedId)) {
        hiddenModules = [...hiddenModules, normalizedId]
      }
      break
    case 'L2_CATEGORY':
      if (!hiddenCategories.includes(normalizedId)) {
        hiddenCategories = [...hiddenCategories, normalizedId]
      }
      break
    case 'L2_SUBCATEGORY':
      if (!hiddenSubcategories.includes(normalizedId)) {
        hiddenSubcategories = [...hiddenSubcategories, normalizedId]
      }
      break
    case 'L3_SITE':
      if (!hiddenSites.includes(normalizedId)) {
        hiddenSites = [...hiddenSites, normalizedId]
      }
      break
    case 'L3_MICRO': {
      const key = stripFeaturePrefix(normalizedId) as keyof CardElementsMask
      if (key in cardElements) {
        cardElements = { ...cardElements, [key]: false }
      }
      break
    }
    case 'L4_FEATURE':
      if (!hiddenFeatures.includes(normalizedId)) {
        hiddenFeatures = [...hiddenFeatures, normalizedId]
      }
      break
  }

  // 更新回收站栈（去重并置顶最新删除项）
  const nextTrash = [
    trashEntry,
    ...state.trashBin.filter((t) => t.id !== normalizedId),
  ].sort((a, b) => b.deletedAt - a.deletedAt)

  persistState({
    ...state,
    hiddenModules,
    hiddenCategories,
    hiddenSubcategories,
    hiddenSites,
    hiddenFeatures,
    cardElements,
    trashBin: nextTrash,
  })

  return trashEntry
}

/**
 * 原子操作：从时间轴回收站或全景矩阵中精确还原指定功能至原位
 */
export function restoreFeatureToMask(id: string): TrashItem | null {
  const state = getFeatureMaskSnapshot()
  const rawStripped = stripFeaturePrefix(id)
  const targetTrash =
    state.trashBin.find((t) => t.id === id || stripFeaturePrefix(t.id) === rawStripped) || null

  const matchId = (candidate: string) =>
    candidate === id || stripFeaturePrefix(candidate) === rawStripped

  const hiddenModules = state.hiddenModules.filter((x) => !matchId(x))
  const hiddenCategories = state.hiddenCategories.filter((x) => !matchId(x))
  const hiddenSubcategories = state.hiddenSubcategories.filter((x) => !matchId(x))
  const hiddenSites = state.hiddenSites.filter((x) => !matchId(x))
  const hiddenFeatures = state.hiddenFeatures.filter((x) => !matchId(x))

  let cardElements = state.cardElements
  if (id.startsWith('micro:') || rawStripped in cardElements) {
    const key = rawStripped as keyof CardElementsMask
    if (key in cardElements) {
      cardElements = { ...cardElements, [key]: true }
    }
  }

  const trashBin = state.trashBin.filter((t) => !matchId(t.id))

  persistState({
    ...state,
    hiddenModules,
    hiddenCategories,
    hiddenSubcategories,
    hiddenSites,
    hiddenFeatures,
    cardElements,
    trashBin,
  })

  return targetTrash
}

/**
 * 原子操作：撤销最近一次删减（Cmd/Ctrl + Z）
 */
export function undoLastFeatureRemove(): TrashItem | null {
  const state = getFeatureMaskSnapshot()
  if (state.trashBin.length === 0) return null
  const latest = state.trashBin[0]
  if (!latest) return null
  return restoreFeatureToMask(latest.id)
}

/**
 * 原子操作：一键无损恢复全站所有默认功能与卡片微元素
 */
export function restoreAllFeaturesToDefault(): void {
  persistState({
    ...DEFAULT_FEATURE_MASK_STATE,
    cardElements: { ...DEFAULT_CARD_ELEMENTS },
    trashBin: [],
    bypassMaskTemporarily: false,
  })
}

/**
 * 切换卡片内部微元素显隐，并同步记录到时间轴回收站
 */
export function toggleCardElementMask(
  key: keyof CardElementsMask,
  forceValue?: boolean
): void {
  const state = getFeatureMaskSnapshot()
  const nextVal = typeof forceValue === 'boolean' ? forceValue : !state.cardElements[key]
  const catalogMeta = L3_MICRO_CATALOG.find((c) => c.elementKey === key)
  const microId = `micro:${key}`

  if (!nextVal) {
    removeFeatureFromMask({
      id: microId,
      level: 'L3_MICRO',
      title: catalogMeta?.title || key,
      parentTitle: 'L3 卡片内部微结构',
    })
  } else {
    restoreFeatureToMask(microId)
  }
}

/**
 * 一键切换「精简胶囊模式」（同时隐藏或恢复所有卡片简介与 #标签栏）
 */
export function setCompactCapsuleCardMask(enabled: boolean): void {
  const state = getFeatureMaskSnapshot()
  if (enabled) {
    const now = Date.now()
    const descTrash: TrashItem = {
      id: 'micro:showDescription',
      level: 'L3_MICRO',
      title: '卡片简介文本',
      parentTitle: 'L3 卡片内部微结构',
      deletedAt: now,
    }
    const tagsTrash: TrashItem = {
      id: 'micro:showTags',
      level: 'L3_MICRO',
      title: '卡片 #标签栏',
      parentTitle: 'L3 卡片内部微结构',
      deletedAt: now + 1,
    }
    const filteredTrash = state.trashBin.filter(
      (t) => t.id !== 'micro:showDescription' && t.id !== 'micro:showTags'
    )
    persistState({
      ...state,
      cardElements: {
        ...state.cardElements,
        showDescription: false,
        showTags: false,
      },
      trashBin: [tagsTrash, descTrash, ...filteredTrash].sort((a, b) => b.deletedAt - a.deletedAt),
    })
  } else {
    persistState({
      ...state,
      cardElements: {
        ...state.cardElements,
        showDescription: true,
        showTags: true,
      },
      trashBin: state.trashBin.filter(
        (t) => t.id !== 'micro:showDescription' && t.id !== 'micro:showTags'
      ),
    })
  }
}

export function setBypassFeatureMaskTemporarily(bypass: boolean): void {
  const state = getFeatureMaskSnapshot()
  if (state.bypassMaskTemporarily === bypass) return
  persistState({
    ...state,
    bypassMaskTemporarily: bypass,
  })
}

/**
 * 与 useHomeDIY 的 hiddenCategoryIds 双向桥接：
 * 当用户在传统分类大纲里隐藏/恢复一级分类时，同步更新 FeatureMaskStore 与时间轴回收站
 */
export function syncHiddenCategoriesFromDIY(
  diyHiddenCategoryIds: string[],
  categoryTitleMap?: Record<string, string>
): void {
  const state = getFeatureMaskSnapshot()
  const targetNormalized = diyHiddenCategoryIds.map((id) => normalizeFeatureId(id, 'L2_CATEGORY'))
  const currentSet = new Set(state.hiddenCategories)
  const targetSet = new Set(targetNormalized)

  let changed = false
  if (currentSet.size !== targetSet.size) {
    changed = true
  } else {
    for (const item of targetSet) {
      if (!currentSet.has(item)) {
        changed = true
        break
      }
    }
  }
  if (!changed) return

  let nextTrash = [...state.trashBin]
  const now = Date.now()

  // 新增隐藏的一级分类推入回收站
  for (const rawId of diyHiddenCategoryIds) {
    const normId = normalizeFeatureId(rawId, 'L2_CATEGORY')
    if (!currentSet.has(normId)) {
      const humanTitle = categoryTitleMap?.[rawId] || rawId
      nextTrash = [
        {
          id: normId,
          level: 'L2_CATEGORY',
          title: `分类：${humanTitle}`,
          parentTitle: 'L2 一级大类',
          deletedAt: now,
        },
        ...nextTrash.filter((t) => t.id !== normId),
      ]
    }
  }

  // 已恢复显示的一级分类从回收站移除
  nextTrash = nextTrash
    .filter((t) => t.level !== 'L2_CATEGORY' || targetSet.has(t.id))
    .sort((a, b) => b.deletedAt - a.deletedAt)

  persistState({
    ...state,
    hiddenCategories: targetNormalized,
    trashBin: nextTrash,
  })
}

/**
 * 辅助查询器：O(1) 判断指定模块/分类/子分类/站点/特性是否处于被裁剪隐藏态
 */
export function isModulePruned(state: FeatureMaskState, moduleId: string): boolean {
  if (state.bypassMaskTemporarily) return false
  const norm = normalizeFeatureId(moduleId, 'L1_MODULE')
  return state.hiddenModules.includes(norm)
}

export function isCategoryPruned(state: FeatureMaskState, categoryId: string): boolean {
  if (state.bypassMaskTemporarily) return false
  const norm = normalizeFeatureId(categoryId, 'L2_CATEGORY')
  return state.hiddenCategories.includes(norm) || state.hiddenCategories.includes(categoryId)
}

export function isSubcategoryPruned(state: FeatureMaskState, subCategoryId: string): boolean {
  if (state.bypassMaskTemporarily) return false
  const norm = normalizeFeatureId(subCategoryId, 'L2_SUBCATEGORY')
  return state.hiddenSubcategories.includes(norm) || state.hiddenSubcategories.includes(subCategoryId)
}

export function isSitePruned(state: FeatureMaskState, siteId: string): boolean {
  if (state.bypassMaskTemporarily) return false
  const norm = normalizeFeatureId(siteId, 'L3_SITE')
  return state.hiddenSites.includes(norm) || state.hiddenSites.includes(siteId)
}

export function isFeaturePruned(state: FeatureMaskState, featureId: string): boolean {
  if (state.bypassMaskTemporarily) return false
  const norm = normalizeFeatureId(featureId, 'L4_FEATURE')
  return state.hiddenFeatures.includes(norm)
}

export interface PrunedSearchRecallResult {
  count: number
  matchedTrashItems: TrashItem[]
  matchedPrunedSiteIds: string[]
  titles: string[]
}

/**
 * 搜索框穿透召回（Search Penetration Recall）：
 * 扫描当前搜索关键词与返回命中结果，识别落在用户已删减分类/子分类/站点中的隐藏条目
 */
export function computePrunedSearchRecall(
  query: string,
  state: FeatureMaskState,
  searchHits?: Array<{
    siteId: string
    site?: { id: string; title: string; categoryId?: string | null } | null
  }>
): PrunedSearchRecallResult {
  const q = String(query || '').trim().toLowerCase()
  if (!q || state.bypassMaskTemporarily) {
    return { count: 0, matchedTrashItems: [], matchedPrunedSiteIds: [], titles: [] }
  }

  const matchedTrashItems = state.trashBin.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      (t.parentTitle && t.parentTitle.toLowerCase().includes(q)) ||
      stripFeaturePrefix(t.id).toLowerCase().includes(q)
  )

  const matchedPrunedSiteIds: string[] = []
  const extraTitles: string[] = []

  if (Array.isArray(searchHits)) {
    for (const hit of searchHits) {
      const siteId = hit.site?.id || hit.siteId
      const catId = hit.site?.categoryId || ''
      const sitePruned = isSitePruned(state, siteId)
      const catPruned = Boolean(catId && isCategoryPruned(state, catId))
      if (sitePruned || catPruned) {
        matchedPrunedSiteIds.push(siteId)
        if (hit.site?.title) {
          extraTitles.push(hit.site.title)
        }
      }
    }
  }

  const allTitles = Array.from(
    new Set([...matchedTrashItems.map((t) => t.title), ...extraTitles])
  )
  const totalCount = Math.max(
    allTitles.length,
    matchedTrashItems.length + matchedPrunedSiteIds.length
  )

  return {
    count: totalCount,
    matchedTrashItems,
    matchedPrunedSiteIds,
    titles: allTitles,
  }
}

/**
 * 测试专用：重置内存状态
 */
export function __resetFeatureMaskForTests(): void {
  currentState = {
    ...DEFAULT_FEATURE_MASK_STATE,
    cardElements: { ...DEFAULT_CARD_ELEMENTS },
    trashBin: [],
  }
  isInitialized = false
}

/**
 * React Hook：提供响应式 UserFeatureMaskStore 与便捷查询方法
 */
export function useFeatureMask() {
  const state = useSyncExternalStore(
    subscribeFeatureMask,
    getFeatureMaskSnapshot,
    getServerFeatureMaskSnapshot
  )

  const hiddenModuleSet = useMemo(() => new Set(state.hiddenModules), [state.hiddenModules])
  const hiddenCategorySet = useMemo(() => new Set(state.hiddenCategories), [state.hiddenCategories])
  const hiddenSubcategorySet = useMemo(
    () => new Set(state.hiddenSubcategories),
    [state.hiddenSubcategories]
  )
  const hiddenSiteSet = useMemo(() => new Set(state.hiddenSites), [state.hiddenSites])
  const hiddenFeatureSet = useMemo(() => new Set(state.hiddenFeatures), [state.hiddenFeatures])

  const isModuleHidden = useCallback(
    (id: string) => {
      if (state.bypassMaskTemporarily) return false
      return hiddenModuleSet.has(normalizeFeatureId(id, 'L1_MODULE'))
    },
    [state.bypassMaskTemporarily, hiddenModuleSet]
  )

  const isCategoryHidden = useCallback(
    (id: string) => {
      if (state.bypassMaskTemporarily) return false
      return hiddenCategorySet.has(normalizeFeatureId(id, 'L2_CATEGORY')) || hiddenCategorySet.has(id)
    },
    [state.bypassMaskTemporarily, hiddenCategorySet]
  )

  const isSubcategoryHidden = useCallback(
    (id: string) => {
      if (state.bypassMaskTemporarily) return false
      return (
        hiddenSubcategorySet.has(normalizeFeatureId(id, 'L2_SUBCATEGORY')) ||
        hiddenSubcategorySet.has(id)
      )
    },
    [state.bypassMaskTemporarily, hiddenSubcategorySet]
  )

  const isSiteHidden = useCallback(
    (id: string) => {
      if (state.bypassMaskTemporarily) return false
      return hiddenSiteSet.has(normalizeFeatureId(id, 'L3_SITE')) || hiddenSiteSet.has(id)
    },
    [state.bypassMaskTemporarily, hiddenSiteSet]
  )

  const isFeatureHidden = useCallback(
    (id: string) => {
      if (state.bypassMaskTemporarily) return false
      return hiddenFeatureSet.has(normalizeFeatureId(id, 'L4_FEATURE'))
    },
    [state.bypassMaskTemporarily, hiddenFeatureSet]
  )

  const effectiveCardElements: CardElementsMask = useMemo(
    () => (state.bypassMaskTemporarily ? DEFAULT_CARD_ELEMENTS : state.cardElements),
    [state.bypassMaskTemporarily, state.cardElements]
  )

  const totalPrunedCount = useMemo(() => {
    const microPruned = Object.values(state.cardElements).filter((v) => !v).length
    return (
      state.hiddenModules.length +
      state.hiddenCategories.length +
      state.hiddenSubcategories.length +
      state.hiddenSites.length +
      state.hiddenFeatures.length +
      microPruned
    )
  }, [
    state.hiddenModules.length,
    state.hiddenCategories.length,
    state.hiddenSubcategories.length,
    state.hiddenSites.length,
    state.hiddenFeatures.length,
    state.cardElements,
  ])

  return {
    ...state,
    effectiveCardElements,
    totalPrunedCount,
    isModuleHidden,
    isCategoryHidden,
    isSubcategoryHidden,
    isSiteHidden,
    isFeatureHidden,
    removeFeature: removeFeatureFromMask,
    restoreFeature: restoreFeatureToMask,
    undoLastRemove: undoLastFeatureRemove,
    restoreAll: restoreAllFeaturesToDefault,
    toggleCardElement: toggleCardElementMask,
    setCompactCapsuleMode: setCompactCapsuleCardMask,
    setBypassMaskTemporarily: setBypassFeatureMaskTemporarily,
  }
}
