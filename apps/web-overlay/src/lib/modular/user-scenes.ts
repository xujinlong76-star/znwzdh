/**
 * 我的场景（UserScene）——用户个人的首页呈现状态打包。
 *
 * 与公开策展场景包（/api/scenes、SCENE_PACKS、growth.ts 的 scenes 字段）
 * 完全无关：那三处是只读内容策展，这里是「置顶 + 主题 + DIY 布局」
 * 三件套的一次打包。命名上一律叫「我的场景」，代码侧 UserScene /
 * user-scenes，存储键 navhub_user_scenes_v1。
 *
 * 存储：本地 localStorage 单键，整份 UserScenesDoc 一份 JSON，避免
 * 「场景列表」与「当前场景」两个键漂移。v1 不跨设备、不上服务端。
 *
 * 本模块是纯函数 + 存储读写，不依赖 React、不认识 hook；测试注入
 * 假 storage 即可。布局字段的校验复用 validateAndCleanDIYConfig。
 */
import { validateAndCleanDIYConfig } from './diy-presets'
import type { HomeDIYConfig } from './home-diy-storage'
import { backupCorruptPayload } from './workspace-storage'
import { THEME_ACCENTS } from '@/lib/plugins/plugin-manifest'
import type { ActiveThemeConfig } from '@/lib/plugins/theme-runtime'

export const USER_SCENES_KEY = 'navhub_user_scenes_v1'
/** 场景数量上限：8 个以内下拉一屏放得下，不用搜索 */
export const MAX_USER_SCENES = 8
/** 场景名称长度上限（字） */
export const MAX_SCENE_NAME_LENGTH = 20

export type UserSceneMode = 'light' | 'dark' | 'system'
export type UserSceneWorkspaceFilter = 'all' | 'dev' | 'design' | 'ai' | 'efficiency'

export const USER_SCENE_WORKSPACE_FILTERS: readonly UserSceneWorkspaceFilter[] = [
  'all',
  'dev',
  'design',
  'ai',
  'efficiency',
]

/** 场景的主题：两层都要存，缺一不可，否则「换主题」只换一半 */
export interface UserSceneTheme {
  /** 插件皮肤 slug；null = 系统默认（不套皮肤） */
  skinSlug: string | null
  /** 皮肤显示名（toast 点名用；应用时以 fetchPluginDetail 的名字为准） */
  skinName?: string | null
  /** 明暗模式；null = 不动用户当前模式（只换皮肤不换明暗） */
  mode: UserSceneMode | null
}

/**
 * 单个用户场景：一份记录自包含。
 * layout 是整份 HomeDIYConfig 的内嵌快照（不是 diySnapshotId 引用，
 * 引用会随快照删除断链）；布局改了场景不跟变，用「用当前状态更新
 * 此场景」显式同步。
 */
export interface UserScene {
  id: string
  name: string
  icon?: string
  /** 扁平有序的置顶站点 id 列表；应用时同时写坞 + 派生分类内置顶 */
  pinnedSiteIds: string[]
  theme: UserSceneTheme
  layout: HomeDIYConfig
  /** 切换时是否同时切首页工作区筛选；null/缺失 = 不动 */
  workspaceFilter?: UserSceneWorkspaceFilter | null
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
}

/** 切换前自动备份：只留最近一份（内存 + doc 各一份，见 scene-apply） */
export interface LastSwitchBackup {
  diyConfig: HomeDIYConfig
  theme: ActiveThemeConfig | null
  /** 切换前的明暗模式（next-themes 的 theme 值） */
  mode: string | null
  /** 切换前的 activeSceneId */
  activeSceneId: string | null
  createdAt: number
}

/** 整份场景存储：一份 JSON，避免双键漂移 */
export interface UserScenesDoc {
  version: 1
  scenes: UserScene[]
  /** 当前生效场景 id；null = 未启用任何场景（自由状态） */
  activeSceneId: string | null
  /** 默认场景 id；null = 未设默认（默认不在启动时自动应用） */
  defaultSceneId: string | null
  lastSwitchBackup?: LastSwitchBackup | null
  updatedAt: number
}

export interface UserSceneStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

const SAFE_ID_RE = /^[A-Za-z0-9_\-:.]{1,128}$/
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && !UNSAFE_KEYS.has(id) && SAFE_ID_RE.test(id)
}

export function newUserSceneId(now = Date.now()): string {
  return `scene_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function emptyUserScenesDoc(now = Date.now()): UserScenesDoc {
  return { version: 1, scenes: [], activeSceneId: null, defaultSceneId: null, updatedAt: now }
}

/** 场景名：去首尾空格，1–20 字；超长截断并在 notes 里记一笔 */
export function normalizeSceneName(raw: unknown): { name: string; truncated: boolean } {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (name.length <= MAX_SCENE_NAME_LENGTH) return { name, truncated: false }
  return { name: name.slice(0, MAX_SCENE_NAME_LENGTH), truncated: true }
}

function cleanSceneTheme(raw: unknown): UserSceneTheme {
  const t = (raw ?? {}) as Record<string, unknown>
  const skinSlug = typeof t.skinSlug === 'string' && t.skinSlug.trim() ? t.skinSlug.trim() : null
  const skinName = typeof t.skinName === 'string' && t.skinName.trim() ? t.skinName.trim() : null
  const mode =
    t.mode === 'light' || t.mode === 'dark' || t.mode === 'system' ? (t.mode as UserSceneMode) : null
  return { skinSlug, skinName, mode }
}

function cleanWorkspaceFilter(raw: unknown): UserSceneWorkspaceFilter | null {
  return typeof raw === 'string' &&
    (USER_SCENE_WORKSPACE_FILTERS as readonly string[]).includes(raw)
    ? (raw as UserSceneWorkspaceFilter)
    : null
}

/**
 * 清洗一份场景记录：非法字段丢弃并记台账；名字空了 / layout 校验
 * 不通过的整条丢弃（返回 null，调用方计数）。
 */
export function cleanUserScene(
  raw: unknown,
  notes: string[],
): UserScene | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const s = raw as Record<string, unknown>
  if (!isSafeId(s.id)) return null
  const { name, truncated } = normalizeSceneName(s.name)
  if (!name) return null
  if (truncated) notes.push(`场景「${name}」名称超长，已截断到 ${MAX_SCENE_NAME_LENGTH} 字`)
  const layoutCheck = validateAndCleanDIYConfig(s.layout)
  if (!layoutCheck.valid || !layoutCheck.config) {
    notes.push(`场景「${name}」的布局数据已损坏，已丢弃该场景`)
    return null
  }
  const pinnedRaw = Array.isArray(s.pinnedSiteIds) ? s.pinnedSiteIds : []
  const pinnedSiteIds: string[] = []
  let droppedPins = 0
  for (const id of pinnedRaw) {
    if (isSafeId(id) && !pinnedSiteIds.includes(id)) pinnedSiteIds.push(id)
    else droppedPins += 1
  }
  if (droppedPins > 0) notes.push(`场景「${name}」：${droppedPins} 个置顶站点 id 非法或重复，已丢弃`)
  const createdAt = typeof s.createdAt === 'number' ? s.createdAt : Date.now()
  const updatedAt = typeof s.updatedAt === 'number' ? s.updatedAt : createdAt
  const scene: UserScene = {
    id: s.id as string,
    name,
    icon: typeof s.icon === 'string' && s.icon.trim() ? s.icon.trim().slice(0, 8) : undefined,
    pinnedSiteIds,
    theme: cleanSceneTheme(s.theme),
    layout: layoutCheck.config as HomeDIYConfig,
    workspaceFilter: cleanWorkspaceFilter(s.workspaceFilter),
    createdAt,
    updatedAt,
  }
  if (typeof s.lastUsedAt === 'number') scene.lastUsedAt = s.lastUsedAt
  return scene
}

/**
 * 清洗切换前备份：diyConfig 走 validateAndCleanDIYConfig（非法整份
 * 丢弃并记台账，与场景 layout 同口径）；主题/明暗按类型校验，非法
 * 字段丢弃（皮肤 slug 非法则整份皮肤丢弃——没 slug 的皮肤无法还原）。
 * 备份缺失（null/undefined）是正常态，返回 null 且不记台账。
 */
export function cleanLastSwitchBackup(raw: unknown, notes: string[]): LastSwitchBackup | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const b = raw as Record<string, unknown>
  const layoutCheck = validateAndCleanDIYConfig(b.diyConfig)
  if (!layoutCheck.valid || !layoutCheck.config) {
    notes.push('切换前备份的布局数据已损坏，已丢弃该备份')
    return null
  }
  let theme: ActiveThemeConfig | null = null
  if (b.theme !== null && b.theme !== undefined) {
    theme = cleanBackupTheme(b.theme, notes)
  }
  return {
    diyConfig: layoutCheck.config as HomeDIYConfig,
    theme,
    mode: typeof b.mode === 'string' ? b.mode : null,
    activeSceneId:
      typeof b.activeSceneId === 'string' && isSafeId(b.activeSceneId) ? b.activeSceneId : null,
    createdAt: typeof b.createdAt === 'number' ? b.createdAt : Date.now(),
  }
}

function cleanBackupTheme(raw: unknown, notes: string[]): ActiveThemeConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    notes.push('切换前备份的皮肤数据已损坏，已丢弃皮肤部分')
    return null
  }
  const t = raw as Record<string, unknown>
  if (typeof t.slug !== 'string' || !t.slug.trim()) {
    notes.push('切换前备份的皮肤数据已损坏，已丢弃皮肤部分')
    return null
  }
  const tokens =
    t.tokens && typeof t.tokens === 'object' && !Array.isArray(t.tokens)
      ? (Object.fromEntries(
          Object.entries(t.tokens as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        ) as Record<string, string>)
      : undefined
  const accent =
    typeof t.accent === 'string' && (THEME_ACCENTS as readonly string[]).includes(t.accent)
      ? (t.accent as ActiveThemeConfig['accent'])
      : undefined
  return {
    slug: t.slug.trim(),
    name: typeof t.name === 'string' && t.name.trim() ? t.name.trim() : t.slug.trim(),
    tokens,
    accent,
    appliedAt: typeof t.appliedAt === 'number' ? t.appliedAt : Date.now(),
  }
}

/** 清洗整份 doc：损坏 JSON 由 loadUserScenes 单独处理，这里只做结构清洗 */
export function cleanUserScenesDoc(raw: unknown): {
  doc: UserScenesDoc
  dropped: number
  notes: string[]
} {
  const notes: string[] = []
  let dropped = 0
  const now = Date.now()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { doc: emptyUserScenesDoc(now), dropped: 1, notes: ['场景数据不是合法对象，已按空场景列表处理'] }
  }
  const r = raw as Record<string, unknown>
  const list = Array.isArray(r.scenes) ? r.scenes : []
  const scenes: UserScene[] = []
  const seenIds = new Set<string>()
  for (const entry of list) {
    const cleaned = cleanUserScene(entry, notes)
    if (!cleaned) {
      dropped += 1
      continue
    }
    if (seenIds.has(cleaned.id)) {
      dropped += 1
      notes.push(`场景「${cleaned.name}」id 重复，已丢弃重复项`)
      continue
    }
    seenIds.add(cleaned.id)
    scenes.push(cleaned)
  }
  const over = scenes.length - MAX_USER_SCENES
  if (over > 0) {
    scenes.splice(MAX_USER_SCENES)
    dropped += over
    notes.push(`场景超出 ${MAX_USER_SCENES} 个上限，已只保留前 ${MAX_USER_SCENES} 个`)
  }
  const activeSceneId =
    typeof r.activeSceneId === 'string' && seenIds.has(r.activeSceneId) ? r.activeSceneId : null
  const defaultSceneId =
    typeof r.defaultSceneId === 'string' && seenIds.has(r.defaultSceneId) ? r.defaultSceneId : null
  return {
    doc: {
      version: 1,
      scenes,
      activeSceneId,
      defaultSceneId,
      lastSwitchBackup: cleanLastSwitchBackup(r.lastSwitchBackup, notes),
      updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
    },
    dropped,
    notes,
  }
}

export interface LoadUserScenesResult {
  doc: UserScenesDoc
  /** 损坏 JSON：原始串已备份，返回空 doc，不抛 */
  corrupt: boolean
  backupKey: string | null
  dropped: number
  notes: string[]
  /** 上次切换未完成：切换开始前置的旗标在本次加载时被消费 */
  incompleteSwitch: boolean
}

/**
 * 切换未完成旗标：持久化在 localStorage，与场景 doc 分键存放——
 * doc 本身损坏也不影响旗标读写。切换开始前置、成功（或已回滚到切换
 * 前状态）后清除；页面在切换中途关闭时旗标留下来，下次加载凭它标注
 * 「上次切换未完成」并清掉 activeSceneId。
 */
export const INCOMPLETE_SWITCH_KEY = 'navhub_user_scenes_incomplete_switch_v1'

export interface IncompleteSwitchFlag {
  sceneId: string
  startedAt: number
}

/** 切换开始前置旗标（performSceneSwitch / 管理对话框的回落切换共用） */
export function markSceneSwitchStarted(storage: UserSceneStorage, sceneId: string): boolean {
  try {
    storage.setItem(
      INCOMPLETE_SWITCH_KEY,
      JSON.stringify({ sceneId, startedAt: Date.now() }),
    )
    return true
  } catch {
    return false
  }
}

/** 切换成功（或已回滚到切换前状态）后清除旗标 */
export function clearSceneSwitchFlag(storage: UserSceneStorage): void {
  try {
    storage.removeItem?.(INCOMPLETE_SWITCH_KEY)
  } catch {
    // 旗标清不掉不阻断切换：下次加载会再标注一次，不丢数据
  }
}

/** 读旗标：损坏内容当无旗标，不抛 */
export function readIncompleteSwitchFlag(storage: UserSceneStorage): IncompleteSwitchFlag | null {
  let raw: string | null = null
  try {
    raw = storage.getItem(INCOMPLETE_SWITCH_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.sceneId !== 'string') return null
    return {
      sceneId: parsed.sceneId,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
    }
  } catch {
    return null
  }
}

/** 读场景 doc：损坏 JSON → 备份原始串 + 返回空 doc，不抛 */
export function loadUserScenes(storage: UserSceneStorage): LoadUserScenesResult {
  let raw: string | null = null
  try {
    raw = storage.getItem(USER_SCENES_KEY)
  } catch {
    return { doc: emptyUserScenesDoc(), corrupt: false, backupKey: null, dropped: 0, notes: [], incompleteSwitch: false }
  }
  if (!raw) return { doc: emptyUserScenesDoc(), corrupt: false, backupKey: null, dropped: 0, notes: [], incompleteSwitch: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const backupKey = backupCorruptPayload(USER_SCENES_KEY, raw, Date.now(), storage)
    return {
      doc: emptyUserScenesDoc(),
      corrupt: true,
      backupKey,
      dropped: 1,
      notes: ['场景数据读不出来，已备份原始数据并按空场景列表处理'],
      incompleteSwitch: false,
    }
  }
  const cleaned = cleanUserScenesDoc(parsed)
  const flag = readIncompleteSwitchFlag(storage)
  if (!flag) {
    return { doc: cleaned.doc, corrupt: false, backupKey: null, dropped: cleaned.dropped, notes: cleaned.notes, incompleteSwitch: false }
  }
  // 旗标只消费一次：本次加载标注后即清除，否则每次刷新都重复标注
  clearSceneSwitchFlag(storage)
  const notes = [...cleaned.notes, '上次切换未完成，已恢复切换前状态']
  const doc =
    cleaned.doc.activeSceneId !== null
      ? { ...cleaned.doc, activeSceneId: null, updatedAt: Date.now() }
      : cleaned.doc
  return { doc, corrupt: false, backupKey: null, dropped: cleaned.dropped, notes, incompleteSwitch: true }
}

/** 写场景 doc：写不进去（配额满/隐私模式）返回 false，调用方如实提示 */
export function saveUserScenes(storage: UserSceneStorage, doc: UserScenesDoc): boolean {
  try {
    storage.setItem(USER_SCENES_KEY, JSON.stringify({ ...doc, updatedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

/** 当前状态快照：调用方从 useHomeDIY / getActiveTheme / useTheme 现取 */
export interface CurrentSceneState {
  pinnedSiteIds: string[]
  theme: UserSceneTheme
  layout: HomeDIYConfig
  workspaceFilter?: UserSceneWorkspaceFilter | null
}

export interface CreateSceneResult {
  ok: boolean
  doc?: UserScenesDoc
  scene?: UserScene
  reason?: string
  duplicateName?: boolean
}

function duplicateName(doc: UserScenesDoc, name: string, exceptId?: string): boolean {
  return doc.scenes.some((s) => s.name === name && s.id !== exceptId)
}

/** 新建场景：上限 8 个到顶拒绝；重名允许但 duplicateName=true 提醒调用方 toast */
export function createUserScene(
  doc: UserScenesDoc,
  input: { name: string; state: CurrentSceneState; icon?: string },
): CreateSceneResult {
  if (doc.scenes.length >= MAX_USER_SCENES) {
    return { ok: false, reason: `场景已满（${MAX_USER_SCENES} 个），请先删除不用的场景` }
  }
  const { name, truncated } = normalizeSceneName(input.name)
  if (!name) return { ok: false, reason: '场景名称不能为空' }
  const layoutCheck = validateAndCleanDIYConfig(input.state.layout)
  if (!layoutCheck.valid || !layoutCheck.config) {
    return { ok: false, reason: '当前布局数据异常，无法存为场景' }
  }
  const now = Date.now()
  const scene: UserScene = {
    id: newUserSceneId(now),
    name,
    icon: input.icon?.trim() ? input.icon.trim().slice(0, 8) : undefined,
    pinnedSiteIds: [...new Set(input.state.pinnedSiteIds.filter(isSafeId))],
    theme: { ...input.state.theme },
    layout: layoutCheck.config as HomeDIYConfig,
    workspaceFilter: input.state.workspaceFilter ?? null,
    createdAt: now,
    updatedAt: now,
  }
  const next: UserScenesDoc = { ...doc, scenes: [...doc.scenes, scene], updatedAt: now }
  return {
    ok: true,
    doc: next,
    scene,
    duplicateName: duplicateName(doc, name),
    reason: truncated ? `名称超长，已截断到 ${MAX_SCENE_NAME_LENGTH} 字` : undefined,
  }
}

/** 「一键存为场景」默认名：第一个未被占用的「场景 N」 */
export function defaultSceneName(doc: UserScenesDoc): string {
  const used = new Set(doc.scenes.map((s) => s.name))
  for (let n = doc.scenes.length + 1; ; n += 1) {
    const name = `场景 ${n}`
    if (!used.has(name)) return name
  }
}

export interface UpdateSceneResult {
  ok: boolean
  doc?: UserScenesDoc
  reason?: string
}

/**
 * 「用当前状态更新此场景」：重新捕获三件套覆盖该场景。布局改了场景
 * 不跟变——这是有意为之，不是 bug；只有这个动作让场景跟上。
 */
export function updateSceneFromCurrent(
  doc: UserScenesDoc,
  sceneId: string,
  state: CurrentSceneState,
): UpdateSceneResult {
  const scene = doc.scenes.find((s) => s.id === sceneId)
  if (!scene) return { ok: false, reason: '找不到这个场景' }
  const layoutCheck = validateAndCleanDIYConfig(state.layout)
  if (!layoutCheck.valid || !layoutCheck.config) {
    return { ok: false, reason: '当前布局数据异常，无法更新场景' }
  }
  const next: UserScenesDoc = {
    ...doc,
    scenes: doc.scenes.map((s) =>
      s.id === sceneId
        ? {
            ...s,
            pinnedSiteIds: [...new Set(state.pinnedSiteIds.filter(isSafeId))],
            theme: { ...state.theme },
            layout: layoutCheck.config as HomeDIYConfig,
            workspaceFilter: state.workspaceFilter ?? null,
            updatedAt: Date.now(),
          }
        : s,
    ),
    updatedAt: Date.now(),
  }
  return { ok: true, doc: next }
}

export function renameUserScene(
  doc: UserScenesDoc,
  sceneId: string,
  newName: string,
): UpdateSceneResult & { duplicateName?: boolean } {
  const { name, truncated } = normalizeSceneName(newName)
  if (!name) return { ok: false, reason: '场景名称不能为空' }
  if (!doc.scenes.some((s) => s.id === sceneId)) return { ok: false, reason: '找不到这个场景' }
  const next: UserScenesDoc = {
    ...doc,
    scenes: doc.scenes.map((s) => (s.id === sceneId ? { ...s, name, updatedAt: Date.now() } : s)),
    updatedAt: Date.now(),
  }
  return {
    ok: true,
    doc: next,
    duplicateName: duplicateName(doc, name, sceneId),
    reason: truncated ? `名称超长，已截断到 ${MAX_SCENE_NAME_LENGTH} 字` : undefined,
  }
}

export interface DeleteSceneResult {
  ok: boolean
  doc?: UserScenesDoc
  /** 被删的是不是当时生效的场景（调用方据此走回落链） */
  wasActive?: boolean
  wasDefault?: boolean
  reason?: string
}

/**
 * 删除场景：只删场景记录，不删布局与置顶。连带清理 activeSceneId /
 * defaultSceneId（指向被删场景时清 null）。绝不回落到 DEFAULT_CONFIG，
 * 回落链由调用方（scene-apply 的 deleteActiveSceneFallback）执行。
 */
export function deleteUserScene(doc: UserScenesDoc, sceneId: string): DeleteSceneResult {
  const scene = doc.scenes.find((s) => s.id === sceneId)
  if (!scene) return { ok: false, reason: '找不到这个场景' }
  const next: UserScenesDoc = {
    ...doc,
    scenes: doc.scenes.filter((s) => s.id !== sceneId),
    activeSceneId: doc.activeSceneId === sceneId ? null : doc.activeSceneId,
    defaultSceneId: doc.defaultSceneId === sceneId ? null : doc.defaultSceneId,
    updatedAt: Date.now(),
  }
  return {
    ok: true,
    doc: next,
    wasActive: doc.activeSceneId === sceneId,
    wasDefault: doc.defaultSceneId === sceneId,
  }
}

export function setDefaultUserScene(doc: UserScenesDoc, sceneId: string | null): UpdateSceneResult {
  if (sceneId !== null && !doc.scenes.some((s) => s.id === sceneId)) {
    return { ok: false, reason: '找不到这个场景' }
  }
  return { ok: true, doc: { ...doc, defaultSceneId: sceneId, updatedAt: Date.now() } }
}

export function markSceneUsed(doc: UserScenesDoc, sceneId: string): UserScenesDoc {
  const now = Date.now()
  return {
    ...doc,
    activeSceneId: sceneId,
    scenes: doc.scenes.map((s) => (s.id === sceneId ? { ...s, lastUsedAt: now } : s)),
    updatedAt: now,
  }
}

/* ------------------------------------------------------------------ *
 * 置顶派生：扁平列表 → 坞直写 + 分类内置顶映射
 * ------------------------------------------------------------------ */

export interface SceneSiteEntry {
  id: string
  title: string
  /** 站点所属分类 id；缺失时只进坞，不进分类内置顶 */
  categoryId?: string | null
}

export interface DerivePinnedResult {
  /** 速览坞直写（场景列表原序去重后） */
  dockIds: string[]
  /** 分类内置顶映射（按场景列表顺序分组） */
  byCategory: Record<string, string[]>
  /** 被剪掉的已删 id（能解析站名报站名，否则只报数量） */
  removed: Array<{ id: string; title?: string }>
}

/**
 * 场景只存扁平列表；应用时现算两处写入。站点改分类 / 自定义分类
 * 都以调用方传入的 siteIndex 为准；已删 id 剪掉并计数，不静默、不阻断。
 */
export function derivePinnedSites(
  pinnedSiteIds: string[],
  siteIndex: Map<string, SceneSiteEntry>,
): DerivePinnedResult {
  const dockIds: string[] = []
  const byCategory: Record<string, string[]> = {}
  const removed: Array<{ id: string; title?: string }> = []
  const seen = new Set<string>()
  for (const id of pinnedSiteIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const entry = siteIndex.get(id)
    if (!entry) {
      removed.push({ id })
      continue
    }
    dockIds.push(id)
    if (entry.categoryId) {
      if (!byCategory[entry.categoryId]) byCategory[entry.categoryId] = []
      byCategory[entry.categoryId].push(id)
    }
  }
  return { dockIds, byCategory, removed }
}

/** 场景布局校验（切换预检第 1 步）：invalid → 中止，什么都不改 */
export function validateSceneLayout(layout: unknown): {
  valid: boolean
  config?: HomeDIYConfig
  dropped: number
  notes: string[]
} {
  const check = validateAndCleanDIYConfig(layout)
  return {
    valid: check.valid && !!check.config,
    config: check.config as HomeDIYConfig | undefined,
    dropped: check.dropped,
    notes: check.notes,
  }
}

/** 浏览器侧存储：拿不到 localStorage（隐私模式/SSR）返回 null */
export function browserUserSceneStorage(): UserSceneStorage | null {
  if (typeof window === 'undefined') return null
  try {
    const ls = window.localStorage
    return {
      getItem: (k) => ls.getItem(k),
      setItem: (k, v) => ls.setItem(k, v),
      removeItem: (k) => ls.removeItem(k),
    }
  } catch {
    return null
  }
}

/** 场景 doc 变更事件：SceneSwitcher / 管理对话框 / ⌘K 共用一份刷新信号 */
export const USER_SCENES_CHANGED_EVENT = 'navhub:user-scenes-changed'

export function broadcastUserScenesChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(USER_SCENES_CHANGED_EVENT))
}

/**
 * 启动自检：activeSceneId 指向不存在的场景 → 清 null。
 *
 * 注意：这里只比对 id 是否存在，不做三件套全值比对——切后用户手动改
 * 布局/置顶是合法行为，全值比对会误清；页面在切换中途关闭的情形由
 * incomplete-switch 旗标覆盖（切换开始前置、成功后清除、加载时检查，
 * 见 markSceneSwitchStarted / loadUserScenes）。
 */
export function reconcileActiveSceneId(doc: UserScenesDoc): {
  doc: UserScenesDoc
  cleared: boolean
} {
  if (doc.activeSceneId === null) return { doc, cleared: false }
  if (doc.scenes.some((s) => s.id === doc.activeSceneId)) return { doc, cleared: false }
  return { doc: { ...doc, activeSceneId: null, updatedAt: Date.now() }, cleared: true }
}
