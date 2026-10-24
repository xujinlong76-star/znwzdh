/**
 * 统一用户偏好设置模型、本地缓存与数据一致性自检自愈工具。
 *
 * 服务端数据表：user_settings (preferences_json)
 * 本地持久化键：navhub_user_settings
 *
 * 保证 0ms 读取与离线可用，同时通过 Save-then-Verify 机制与健康自检，
 * 确保云端落盘与本机 localStorage 状态双向收敛。
 */

import { FAVORITES_STORAGE_KEY, corruptKeyFor, parseFavorites } from './favorites-storage'
import { ANON_ID_STORAGE_KEY } from './identity-keys'
import { isAnonIdentity } from './hub-identity-guard'

export type SearchEngineId = 'internal' | 'google' | 'bing' | 'duckduckgo' | 'github' | 'perplexity'
export type CardDensityMode = 'comfortable' | 'compact' | 'minimal'
export type SpotlightShortcutMode = 'mod+k' | 'slash' | 'both'
export type HistoryRetentionDays = 30 | 90 | 180 | 365

export interface UserSettingsModel {
  personalizationEnabled: boolean
  favoriteSignalCutoff: number
  defaultSearchEngine: SearchEngineId
  openLinksInNewTab: boolean
  cardDensity: CardDensityMode
  speculativeZeroRttEnabled: boolean
  daypartSceneEnabled: boolean
  spotlightShortcut: SpotlightShortcutMode
  searchHistoryEnabled: boolean
  telemetryEnabled: boolean
  historyRetentionDays: HistoryRetentionDays
  /** 0 表示从未保存过；云端返回的 Overview.settings 契约要求该字段必填 */
  updatedAt: number
}

export type UserSettingsPatch = Partial<UserSettingsModel>

export interface DiagnosticCheckItem {
  id: string
  label: string
  status: 'ok' | 'repaired' | 'failed'
  detail: string
}

export const DEFAULT_USER_SETTINGS: UserSettingsModel = {
  personalizationEnabled: true,
  favoriteSignalCutoff: 0,
  defaultSearchEngine: 'internal',
  openLinksInNewTab: true,
  cardDensity: 'comfortable',
  speculativeZeroRttEnabled: true,
  daypartSceneEnabled: true,
  spotlightShortcut: 'both',
  searchHistoryEnabled: true,
  telemetryEnabled: true,
  historyRetentionDays: 180,
  updatedAt: 0,
}

export const SEARCH_ENGINE_OPTIONS = [
  { value: 'internal', label: '站内聚合搜索 (NavHub)' },
  { value: 'google', label: 'Google 谷歌' },
  { value: 'bing', label: 'Bing 必应' },
  { value: 'duckduckgo', label: 'DuckDuckGo 隐私检索' },
  { value: 'github', label: 'GitHub 源码检索' },
  { value: 'perplexity', label: 'Perplexity AI' },
] as const satisfies readonly { value: SearchEngineId; label: string }[]

/**
 * 名称必须与真实效果一致。这三档驱动的是 CSS `[data-density]` 的间距变量：
 * `compact` → dense（卡片更小、一屏更多）；`minimal` → spacious（留白更多、一屏更少）。
 * 原名「极简」会让人以为关掉装饰，实际是放大间距 —— 与 compact 的方向正好相反。
 */
export const CARD_DENSITY_OPTIONS = [
  { value: 'comfortable', label: '舒适 (默认)' },
  { value: 'compact', label: '紧凑密排 (一屏更多)' },
  { value: 'minimal', label: '宽松沉浸 (更多留白)' },
] as const

export const SPOTLIGHT_SHORTCUT_OPTIONS = [
  { value: 'both', label: '⌘/Ctrl + K 或 /' },
  { value: 'mod+k', label: '仅 ⌘/Ctrl + K' },
  { value: 'slash', label: '仅 / 斜杠键' },
] as const

export const RETENTION_DAY_OPTIONS = [
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 180, label: '180 天 (默认)' },
  { value: 365, label: '365 天 (1年)' },
] as const

const VALID_ENGINES = new Set<string>(SEARCH_ENGINE_OPTIONS.map((o) => o.value))
const VALID_DENSITIES = new Set<string>(CARD_DENSITY_OPTIONS.map((o) => o.value))
const VALID_SHORTCUTS = new Set<string>(SPOTLIGHT_SHORTCUT_OPTIONS.map((o) => o.value))
const VALID_RETENTIONS = new Set<number>(RETENTION_DAY_OPTIONS.map((o) => o.value))

/**
 * 偏好的存储键。
 * 界面（隔离区按基键对号）也要读它，所以导出去 —— 键名散落在三个文件里抄写，
 * 正是巡检读了一个没人写过的键、从此永远全绿的那个病根。
 */
export const USER_SETTINGS_STORAGE_KEY = 'navhub_user_settings'

const STORAGE_KEY = USER_SETTINGS_STORAGE_KEY

/**
 * 规范化任意用户设置输入，清洗不合法值并安全回退默认项。
 */
export function normalizeUserSettings(raw?: unknown): UserSettingsModel {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_USER_SETTINGS }
  }

  const s = raw as Record<string, unknown>

  const defaultSearchEngine: SearchEngineId =
    typeof s.defaultSearchEngine === 'string' && VALID_ENGINES.has(s.defaultSearchEngine)
      ? (s.defaultSearchEngine as SearchEngineId)
      : DEFAULT_USER_SETTINGS.defaultSearchEngine

  const cardDensity: CardDensityMode =
    typeof s.cardDensity === 'string' && VALID_DENSITIES.has(s.cardDensity)
      ? (s.cardDensity as CardDensityMode)
      : DEFAULT_USER_SETTINGS.cardDensity

  const spotlightShortcut: SpotlightShortcutMode =
    typeof s.spotlightShortcut === 'string' && VALID_SHORTCUTS.has(s.spotlightShortcut)
      ? (s.spotlightShortcut as SpotlightShortcutMode)
      : DEFAULT_USER_SETTINGS.spotlightShortcut

  const retentionNum = Number(s.historyRetentionDays)
  const historyRetentionDays: HistoryRetentionDays =
    VALID_RETENTIONS.has(retentionNum)
      ? (retentionNum as HistoryRetentionDays)
      : DEFAULT_USER_SETTINGS.historyRetentionDays

  return {
    personalizationEnabled:
      typeof s.personalizationEnabled === 'boolean'
        ? s.personalizationEnabled
        : DEFAULT_USER_SETTINGS.personalizationEnabled,
    favoriteSignalCutoff:
      typeof s.favoriteSignalCutoff === 'number' && Number.isFinite(s.favoriteSignalCutoff)
        ? Math.max(0, s.favoriteSignalCutoff)
        : DEFAULT_USER_SETTINGS.favoriteSignalCutoff,
    defaultSearchEngine,
    openLinksInNewTab:
      typeof s.openLinksInNewTab === 'boolean'
        ? s.openLinksInNewTab
        : DEFAULT_USER_SETTINGS.openLinksInNewTab,
    cardDensity,
    speculativeZeroRttEnabled:
      typeof s.speculativeZeroRttEnabled === 'boolean'
        ? s.speculativeZeroRttEnabled
        : DEFAULT_USER_SETTINGS.speculativeZeroRttEnabled,
    daypartSceneEnabled:
      typeof s.daypartSceneEnabled === 'boolean'
        ? s.daypartSceneEnabled
        : DEFAULT_USER_SETTINGS.daypartSceneEnabled,
    spotlightShortcut,
    searchHistoryEnabled:
      typeof s.searchHistoryEnabled === 'boolean'
        ? s.searchHistoryEnabled
        : DEFAULT_USER_SETTINGS.searchHistoryEnabled,
    telemetryEnabled:
      typeof s.telemetryEnabled === 'boolean'
        ? s.telemetryEnabled
        : DEFAULT_USER_SETTINGS.telemetryEnabled,
    historyRetentionDays,
    updatedAt:
      typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt)
        ? s.updatedAt
        : DEFAULT_USER_SETTINGS.updatedAt,
  }
}

/**
 * 站外引擎的真实检索地址。
 *
 * `satisfies` 写全 `Exclude<SearchEngineId, 'internal'>`：用户中心里每多一个引擎选项，
 * 这里不补一条就会编译失败 —— 避免出现「设置能选、点了没反应」的死项（那正是本轮
 * 要消灭的那类缺陷）。
 */
const EXTERNAL_SEARCH_ENGINES = {
  google: {
    short: 'Google',
    buildUrl: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  bing: {
    short: 'Bing',
    buildUrl: (q: string) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  },
  duckduckgo: {
    short: 'DuckDuckGo',
    buildUrl: (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  },
  github: {
    short: 'GitHub',
    buildUrl: (q: string) => `https://github.com/search?q=${encodeURIComponent(q)}`,
  },
  perplexity: {
    short: 'Perplexity',
    buildUrl: (q: string) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`,
  },
} satisfies Record<Exclude<SearchEngineId, 'internal'>, { short: string; buildUrl: (q: string) => string }>

/**
 * 用户选的默认引擎 → 站外检索 URL。
 * `internal` 返回 null：选「站内聚合」的人不应该被悄悄推给 Google，
 * 那等于把他的设置当成没发生过。
 */
export function externalSearchUrl(engine: SearchEngineId, query: string): string | null {
  const spec = externalEngineSpec(engine)
  if (!spec) return null
  const trimmed = query.trim()
  if (!trimmed) return null
  return spec.buildUrl(trimmed)
}

/** 按钮上那行字里的引擎名（与下拉框的双语长标签区分，同一个来源） */
export function externalSearchEngineName(engine: SearchEngineId): string | null {
  return externalEngineSpec(engine)?.short ?? null
}

/**
 * 查不到就不给出口，而不是抛异常。
 * 引擎 id 来自 localStorage：读写两端版本不一致（旧页面读到新档位写入的 id）时，
 * 类型上「不可能」的取值运行时真的会出现，而这条路径挂在一行零结果提示上 ——
 * 宁可退化成「没有站外直达」，也不能让整个检索面板崩掉。
 */
function externalEngineSpec(engine: SearchEngineId) {
  if (engine === 'internal') return null
  return EXTERNAL_SEARCH_ENGINES[engine as keyof typeof EXTERNAL_SEARCH_ENGINES] ?? null
}

/**
 * 读取当前浏览器本地存储的偏好设置（SSR 优雅降级返回默认值）。
 * `store` 只给自检/测试注入替身用，日常调用不传就走 window.localStorage。
 */
export function readLocalUserSettings(store?: ByteStore): UserSettingsModel {
  const kv = resolveStore(store)
  if (!kv) {
    return { ...DEFAULT_USER_SETTINGS }
  }
  try {
    const raw = kv.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_USER_SETTINGS }
    return normalizeUserSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_USER_SETTINGS }
  }
}

/**
 * 将偏好设置补丁或完整配置写入本地存储，并触发跨组件同步事件。
 */
export function writeLocalUserSettings(
  patchOrFull: UserSettingsPatch | UserSettingsModel,
  store?: ByteStore,
): UserSettingsModel {
  const kv = resolveStore(store)
  if (!kv) {
    return normalizeUserSettings(patchOrFull)
  }
  try {
    const current = readLocalUserSettings(kv)
    const merged = normalizeUserSettings({
      ...current,
      ...patchOrFull,
      updatedAt: Date.now(),
    })
    kv.setItem(STORAGE_KEY, JSON.stringify(merged))
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('navhub_settings_changed', { detail: merged }))
    }
    return merged
  } catch {
    return normalizeUserSettings(patchOrFull)
  }
}

/**
 * 校验补丁应用后的云端状态与本地写入状态一致性（Save-then-Verify 闭环）。
 */
export function verifySettingsConsistency(
  patch: UserSettingsPatch,
  cloudOrExpected: Partial<UserSettingsModel>,
  localWritten: UserSettingsModel,
): {
  verified: boolean
  mismatchedKeys: string[]
  repairedSettings: UserSettingsModel
} {
  const normalizedExpected = normalizeUserSettings({ ...localWritten, ...cloudOrExpected })
  const mismatchedKeys: string[] = []

  const patchKeys = Object.keys(patch) as Array<keyof UserSettingsModel>
  for (const k of patchKeys) {
    if (k === 'updatedAt') continue
    const expectedVal = normalizedExpected[k]
    const localVal = localWritten[k]
    if (expectedVal !== localVal) {
      mismatchedKeys.push(k)
    }
  }

  const verified = mismatchedKeys.length === 0
  const repairedSettings: UserSettingsModel = verified
    ? localWritten
    : normalizeUserSettings({ ...localWritten, ...normalizedExpected })

  return { verified, mismatchedKeys, repairedSettings }
}

/**
 * 只读写「字节」的最小存储接口 —— localStorage 的形状子集。
 * 抽出来的目的不是抽象，而是可测：巡检的「自愈」直接改用户数据，
 * 必须能在内存替身上把每条分支跑一遍，而不是只能用正则数源码。
 */
export interface ByteStore {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** 没注入替身时就用浏览器存储；服务端渲染期间两者都没有 → null（不改写、不假装检查过）。 */
function resolveStore(store?: ByteStore): ByteStore | null {
  if (store) return store
  return typeof window === 'undefined' ? null : window.localStorage
}

/**
 * 重建到底落住了没有 —— 得回读一次。
 * `writeLocalUserSettings` 为了「任何情况下都不抛」把 setItem 的失败咽掉了，
 * 自检若照抄它的返回值说「已重建/已修复」，就是在替存储层说谎。
 */
function settingsLanded(store: ByteStore, expected: UserSettingsModel): boolean {
  return readableSettingsEquals(store.getItem(STORAGE_KEY), expected)
}

/** 回读并与期望逐字段比对（比对 JSON 串即可，两边都出自同一个 normalize） */
function readableSettingsEquals(raw: string | null, expected: UserSettingsModel): boolean {
  if (!raw) return false
  try {
    return JSON.stringify(normalizeUserSettings(JSON.parse(raw))) === JSON.stringify(expected)
  } catch {
    return false
  }
}

/**
 * 把读不出来的原文整份留档，返回隔离键；留不住返回 null。
 *
 * 顺序是硬的：原文先保住，才允许改写主键；保不住（配额已满 / 隐私模式）
 * 就一个字节都不动。「自动修复」把用户数据清掉，比坏数据留在那儿更糟。
 */
function quarantineBytes(store: ByteStore, baseKey: string, raw: string): string | null {
  const existing = findQuarantineCopy(store, baseKey, raw)
  if (existing) return existing
  const backupKey = corruptKeyFor(baseKey, Date.now())
  try {
    store.setItem(backupKey, raw)
    // 写完立刻读回来比对：setItem 静默失败时不能谎报「已留档」
    return store.getItem(backupKey) === raw ? backupKey : null
  } catch {
    return null
  }
}

/**
 * 同一份坏数据被反复自检时不再重复留档。
 * localStorage 只有几 MB，而收藏原文可能很大 —— 每点一次「开始自检」就复制一份，
 * 等于把存储写满，然后把所有后续自愈都变成失败。
 */
function findQuarantineCopy(store: ByteStore, baseKey: string, raw: string): string | null {
  const prefix = `${baseKey}.corrupt.`
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (!key || !key.startsWith(prefix)) continue
      if (store.getItem(key) === raw) return key
    }
  } catch {
    return null
  }
  return null
}

export interface QuarantineCopy {
  key: string
  /** 原文来自主键（哪一份数据被隔离了） */
  baseKey: string
  /** 键名里的时间戳；解析不出来时为 null（界面写「时间未知」，不硬凑一个日期） */
  savedAt: number | null
  /** 原文字符数（不是字节：localStorage 按 UTF-16 计） */
  chars: number
  /** 收藏副本才有意义：这份原文是否还能解析成数组，能才允许一键恢复 */
  restorable: boolean
}

/** 自检留档的那些 `.corrupt.<时间戳>` 副本。 */
const QUARANTINE_BASE_KEYS = [FAVORITES_STORAGE_KEY, STORAGE_KEY]

/**
 * 列出本机隔离副本（按时间倒序，最新的在前）。
 * 留档若没有一个能看见、能下载、能恢复的入口，就等于把数据锁在控制台里 ——
 * 巡检文案承诺「可恢复」，就必须真有一个恢复的地方。
 */
export function listQuarantineCopies(store?: ByteStore): QuarantineCopy[] {
  const kv = resolveStore(store)
  if (!kv) return []
  const copies: QuarantineCopy[] = []
  try {
    for (let i = 0; i < kv.length; i += 1) {
      const key = kv.key(i)
      if (!key) continue
      const baseKey = QUARANTINE_BASE_KEYS.find((base) => key.startsWith(`${base}.corrupt.`))
      if (!baseKey) continue
      const raw = kv.getItem(key) ?? ''
      const stamp = Number(key.slice(baseKey.length + '.corrupt.'.length))
      copies.push({
        key,
        baseKey,
        savedAt: Number.isFinite(stamp) && stamp > 0 ? stamp : null,
        chars: raw.length,
        restorable:
          baseKey === FAVORITES_STORAGE_KEY && !parseFavorites<unknown>(raw).corrupt,
      })
    }
  } catch {
    return copies
  }
  return copies.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
}

/** 取回某一份隔离副本的原文（恢复收藏时用，读不到返回 null） */
export function readQuarantineBytes(key: string, store?: ByteStore): string | null {
  const kv = resolveStore(store)
  if (!kv || !QUARANTINE_BASE_KEYS.some((base) => key.startsWith(`${base}.corrupt.`))) {
    // 只允许取隔离键：不能借这个口读走任意存储内容
    return null
  }
  try {
    return kv.getItem(key)
  } catch {
    return null
  }
}

/**
 * 删除一份隔离副本（只有用户在「数据与隐私」里显式点删除才会走到这里，自检绝不自动删）。
 *
 * 同样要回读确认：隐私模式下 removeItem 会抛，配额或权限出问题时静默失败 ——
 * 界面若照着返回值说「已删除」，用户就永远不知道那份副本还占着他的存储。
 */
export function deleteQuarantineCopy(key: string, store?: ByteStore): boolean {
  const kv = resolveStore(store)
  if (!kv || !QUARANTINE_BASE_KEYS.some((base) => key.startsWith(`${base}.corrupt.`))) {
    return false
  }
  try {
    kv.removeItem(key)
    return kv.getItem(key) === null
  } catch {
    return false
  }
}

/**
 * 客户端存储与账户配置健康巡检（坏结构对齐 Schema、缺存储补默认、坏数据整份留档）。
 *
 * 「自愈」的边界：只重建**能从别处再长出来**的东西（偏好有云端副本，读不出来时
 * 回落到默认值也不影响功能）。收藏是用户唯一的本地资产，所以这一项只留档、
 * 不改写主键，把「备份后重置」的决定留给收藏面板（那里还会一并清同步游标）。
 */
export function runClientStorageDiagnostics(store?: ByteStore): {
  checks: DiagnosticCheckItem[]
  repairedCount: number
} {
  if (typeof window === 'undefined' && !store) {
    return { checks: [], repairedCount: 0 }
  }
  const kv = store ?? window.localStorage

  const checks: DiagnosticCheckItem[] = []
  let repairedCount = 0

  // 1. 检查偏好设置有效性
  try {
    const rawSettings = kv.getItem(STORAGE_KEY)
    if (!rawSettings) {
      const written = writeLocalUserSettings(DEFAULT_USER_SETTINGS, kv)
      const landed = settingsLanded(kv, written)
      checks.push({
        id: 'settings-init',
        label: '偏好设置存储完整性',
        status: landed ? 'repaired' : 'failed',
        detail: landed
          ? '本地偏好缺失，已自动初始化为标准默认值'
          : '本地偏好缺失，但默认值没能写进存储（配额已满或隐私模式）。界面会按默认档运行，本次设置改动不会留存。',
      })
      if (landed) repairedCount += 1
    } else {
      let parsed: unknown
      let unparsable = false
      try {
        parsed = JSON.parse(rawSettings)
      } catch {
        unparsable = true
      }
      if (unparsable) {
        // 只有「真的解析不出来」才重建。原来的写法是让整段 try 兜底，
        // 于是 setItem 抛出的配额错误也会掉进「数据损坏」分支，
        // 把一份还能正常读取的偏好直接覆盖成默认值。
        const backupKey = quarantineBytes(kv, STORAGE_KEY, rawSettings)
        if (!backupKey) {
          checks.push({
            id: 'settings-corrupt',
            label: '偏好设置解析校验',
            status: 'failed',
            detail: '本地偏好读不出来，而浏览器又不允许写入隔离副本（配额已满或隐私模式）。已停止自愈：原文一个字节都没动。',
          })
        } else {
          const written = writeLocalUserSettings(DEFAULT_USER_SETTINGS, kv)
          const rebuilt = settingsLanded(kv, written)
          checks.push({
            id: 'settings-corrupt',
            label: '偏好设置解析校验',
            status: rebuilt ? 'repaired' : 'failed',
            detail: rebuilt
              ? `本地偏好读不出来，已重建为默认值；原文已整份留档到 ${backupKey}，可在「数据与隐私」里对照找回。`
              : `本地偏好读不出来，原文已整份留档到 ${backupKey}，但重建没能在存储里落住（读取仍会回落到默认值）。`,
          })
          if (rebuilt) repairedCount += 1
        }
      } else {
        const normalized = normalizeUserSettings(parsed)
        const needsFix = JSON.stringify(parsed) !== JSON.stringify(normalized)
        if (needsFix) {
          const written = writeLocalUserSettings(normalized, kv)
          const landed = settingsLanded(kv, written)
          checks.push({
            id: 'settings-schema',
            label: '偏好设置结构核验',
            status: landed ? 'repaired' : 'failed',
            detail: landed
              ? '发现结构过时或不合法字段，已自动修复并对齐最新 Schema'
              : '发现结构过时或不合法字段，但修复没能在存储里落住（配额已满或隐私模式）；读取时会临时按最新 Schema 归一，不改写存储。',
          })
          if (landed) repairedCount += 1
        } else {
          checks.push({
            id: 'settings-schema',
            label: '偏好设置结构核验',
            status: 'ok',
            detail: '本地偏好与最新数据规范 100% 吻合',
          })
        }
      }
    }
  } catch {
    // 走到这里只剩「存储本身不能用」这一种情况：不能读写，也就什么都不改。
    checks.push({
      id: 'settings-unavailable',
      label: '偏好设置存储完整性',
      status: 'failed',
      detail: '浏览器不允许读写本地存储（隐私模式或权限被拒），本次没有检查偏好，也没有改动任何数据。',
    })
  }

  // 2. 检查本地收藏数据完整性
  //    键名必须与真实存储一致：这里原来读的是 'navhub_favorites'，而收藏一直写在
  //    FAVORITES_STORAGE_KEY（navhub.favorites.v1）—— 于是这一项永远报
  //    「尚未创建本地收藏记录」：坏数据看不见，看得见的地方又被写空。
  try {
    const rawFav = kv.getItem(FAVORITES_STORAGE_KEY)
    if (rawFav) {
      const { items, corrupt } = parseFavorites<unknown>(rawFav)
      if (corrupt) {
        // 只留档，不改写主键：收藏面板对坏数据的既定策略是「拒绝覆盖 + 由用户
        // 决定是备份后重置」（useFavorites.resetLocal 还会一并清同步游标）。
        // 自检若替他把集合清空，就是把「自动修复」变成静默丢收藏。
        const backupKey = quarantineBytes(kv, FAVORITES_STORAGE_KEY, rawFav)
        checks.push({
          id: 'fav-corrupt',
          label: '本地收藏数据完整性',
          status: 'failed',
          detail: backupKey
            ? `收藏数据读不出来（半截写入或被改写）。原文已整份留档到 ${backupKey}；收藏保存暂时停用，可在「收藏管理」里选择备份后重置。`
            : '收藏数据读不出来，而浏览器又不允许写入隔离副本（配额已满或隐私模式）。已停止自愈：原文一个字节都没动。',
        })
      } else {
        checks.push({
          id: 'fav-structure',
          label: '本地收藏数据完整性',
          status: 'ok',
          detail: `包含 ${items.length} 条收藏数据，结构完整正常`,
        })
      }
    } else {
      checks.push({
        id: 'fav-structure',
        label: '本地收藏数据完整性',
        status: 'ok',
        detail: '尚未创建本地收藏记录，待用户使用',
      })
    }
  } catch {
    checks.push({
      id: 'fav-unavailable',
      label: '本地收藏数据完整性',
      status: 'failed',
      detail: '浏览器不允许读取本地存储（隐私模式或权限被拒），本次没有检查收藏，也没有改动任何数据。',
    })
  }

  // 3. 检查匿名身份标识规范性
  //    同样先纠正键名：这里原来读 'navhub_anon_id'（没人写过这个键），于是无论
  //    本机匿名 id 是好是坏，这一项都固定报「正常就绪」。
  try {
    const rawAnon = kv.getItem(ANON_ID_STORAGE_KEY)
    if (rawAnon && rawAnon.trim().length > 0) {
      const wellFormed = isAnonIdentity(rawAnon)
      checks.push({
        id: 'anon-id',
        label: '匿名访问指纹完整性',
        status: wellFormed ? 'ok' : 'failed',
        detail: wellFormed
          ? `匿名标识格式正确 (${rawAnon.slice(0, 10)}…)，收藏与历史按此归属`
          : '本机匿名标识不是合法格式（应以 anon- 开头）。它决定云端把数据归属给谁，请去「数据与隐私」清理后重新生成。',
      })
    } else {
      checks.push({
        id: 'anon-id',
        label: '匿名访问指纹完整性',
        status: 'ok',
        detail: '本机还没有匿名指纹，首次访问时按需生成',
      })
    }
  } catch {
    checks.push({
      id: 'anon-id',
      label: '匿名访问指纹核验',
      status: 'failed',
      detail: '浏览器不允许读取本地存储（隐私模式或权限被拒），本次没有检查匿名指纹。',
    })
  }

  return { checks, repairedCount }
}
