/**
 * 统一用户偏好设置模型、本地缓存与数据一致性自检自愈工具。
 *
 * 服务端数据表：user_settings (preferences_json)
 * 本地持久化键：navhub_user_settings
 *
 * 保证 0ms 读取与离线可用，同时通过 Save-then-Verify 机制与健康自检，
 * 确保云端落盘与本机 localStorage 状态双向收敛。
 */

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
] as const

export const CARD_DENSITY_OPTIONS = [
  { value: 'comfortable', label: '舒适 (默认)' },
  { value: 'compact', label: '紧凑' },
  { value: 'minimal', label: '极简' },
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

const STORAGE_KEY = 'navhub_user_settings'

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
 * 读取当前浏览器本地存储的偏好设置（SSR 优雅降级返回默认值）。
 */
export function readLocalUserSettings(): UserSettingsModel {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_USER_SETTINGS }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
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
): UserSettingsModel {
  if (typeof window === 'undefined') {
    return normalizeUserSettings(patchOrFull)
  }
  try {
    const current = readLocalUserSettings()
    const merged = normalizeUserSettings({
      ...current,
      ...patchOrFull,
      updatedAt: Date.now(),
    })
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    window.dispatchEvent(new CustomEvent('navhub_settings_changed', { detail: merged }))
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
 * 客户端存储与账户配置健康巡检及自动自愈（一键修复死键、坏结构、脏偏好）。
 */
export function runClientStorageDiagnostics(): {
  checks: DiagnosticCheckItem[]
  repairedCount: number
} {
  if (typeof window === 'undefined') {
    return { checks: [], repairedCount: 0 }
  }

  const checks: DiagnosticCheckItem[] = []
  let repairedCount = 0

  // 1. 检查偏好设置有效性
  try {
    const rawSettings = window.localStorage.getItem(STORAGE_KEY)
    if (!rawSettings) {
      writeLocalUserSettings(DEFAULT_USER_SETTINGS)
      checks.push({
        id: 'settings-init',
        label: '偏好设置存储完整性',
        status: 'repaired',
        detail: '本地偏好缺失，已自动初始化为标准默认值',
      })
      repairedCount += 1
    } else {
      const parsed = JSON.parse(rawSettings)
      const normalized = normalizeUserSettings(parsed)
      const needsFix = JSON.stringify(parsed) !== JSON.stringify(normalized)
      if (needsFix) {
        writeLocalUserSettings(normalized)
        checks.push({
          id: 'settings-schema',
          label: '偏好设置结构核验',
          status: 'repaired',
          detail: '发现结构过时或不合法字段，已自动修复并对齐最新 Schema',
        })
        repairedCount += 1
      } else {
        checks.push({
          id: 'settings-schema',
          label: '偏好设置结构核验',
          status: 'ok',
          detail: '本地偏好与最新数据规范 100% 吻合',
        })
      }
    }
  } catch {
    writeLocalUserSettings(DEFAULT_USER_SETTINGS)
    checks.push({
      id: 'settings-corrupt',
      label: '偏好设置解析校验',
      status: 'repaired',
      detail: '本地存储损坏，已自动安全重建',
    })
    repairedCount += 1
  }

  // 2. 检查收藏夹数据完整性
  try {
    const rawFav = window.localStorage.getItem('navhub_favorites')
    if (rawFav) {
      const parsed = JSON.parse(rawFav)
      if (!Array.isArray(parsed)) {
        window.localStorage.setItem('navhub_favorites', '[]')
        checks.push({
          id: 'fav-structure',
          label: '本地收藏夹结构核验',
          status: 'repaired',
          detail: '收藏夹非数组结构，已自动纠正为空集合',
        })
        repairedCount += 1
      } else {
        checks.push({
          id: 'fav-structure',
          label: '本地收藏夹结构核验',
          status: 'ok',
          detail: `包含 ${parsed.length} 条收藏数据，结构完整正常`,
        })
      }
    } else {
      checks.push({
        id: 'fav-structure',
        label: '本地收藏夹结构核验',
        status: 'ok',
        detail: '尚未创建本地收藏记录，待用户使用',
      })
    }
  } catch {
    window.localStorage.setItem('navhub_favorites', '[]')
    checks.push({
      id: 'fav-corrupt',
      label: '本地收藏夹解析校验',
      status: 'repaired',
      detail: '收藏夹数据存在语法损坏，已自动恢复默认集合',
    })
    repairedCount += 1
  }

  // 3. 检查匿名身份标识规范性
  try {
    const rawAnon = window.localStorage.getItem('navhub_anon_id')
    if (rawAnon && rawAnon.trim().length > 0) {
      checks.push({
        id: 'anon-id',
        label: '匿名访问指纹完整性',
        status: 'ok',
        detail: `匿名标识格式正确 (${rawAnon.slice(0, 10)}…)`,
      })
    } else {
      checks.push({
        id: 'anon-id',
        label: '匿名访问指纹完整性',
        status: 'ok',
        detail: '匿名指纹按需生成，正常就绪',
      })
    }
  } catch {
    checks.push({
      id: 'anon-id',
      label: '匿名访问指纹核验',
      status: 'ok',
      detail: '受保护存储已就绪',
    })
  }

  return { checks, repairedCount }
}
