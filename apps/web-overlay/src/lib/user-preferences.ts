/**
 * 用户偏好的唯一读取入口。
 *
 * 为什么需要这一层（真实缺陷）：`UserSettingsModel` 的 openLinksInNewTab / cardDensity /
 * spotlightShortcut / speculativeZeroRttEnabled / daypartSceneEnabled 五项，改造前在全仓
 * **没有任何行为消费者** —— 只有 settings-panel 写盘、me-view 显示「已开启 / 已关闭」。
 * 用户关掉「自动记录搜索历史」这类开关后行为照旧，等于界面对他撒了谎。
 * 这一层把偏好接到真实消费点上，并提供 SSR 安全的读取方式。
 *
 * 三条约束：
 * 1. 服务端渲染只能看到默认值（localStorage 在 server 上不存在），挂载后经订阅更新，
 *    否则首页会因「服务端 HTML 与首帧不一致」被判水合不匹配。
 * 2. 变更源有三条，都要接上：本页其它组件写盘后的 `navhub_settings_changed`、
 *    其它标签页写同一键时浏览器才派发的 `storage`、以及本层自己的 `updateUserPreferences`。
 * 3. 组件侧优先用「返回原始值」的选择器 hook：`useSyncExternalStore` 用 Object.is 比较，
 *    值没变就不重渲染 —— 首页上千张卡片不会因别人切了遥测开关而集体重渲染。
 * 4. 本模块顶部 import 了 `useSyncExternalStore`，因此**服务端模块一律不许 import 它**
 *    （Next 会直接判「把依赖 React hook 的模块导进了 RSC」并让整站 500）。
 *    纯判据与映射表放 content-density.ts / user-settings.ts，两边都从这里再导出。
 */

import { useSyncExternalStore } from 'react'

import {
  DEFAULT_USER_SETTINGS,
  USER_SETTINGS_STORAGE_KEY,
  readLocalUserSettings,
  writeLocalUserSettings,
  type CardDensityMode,
  type SpotlightShortcutMode,
  type UserSettingsModel,
  type UserSettingsPatch,
} from './user-settings'
import {
  cardDensityOf,
  contentDensityOf,
  isContentDensity,
  type ContentDensity,
} from './content-density'

/**
 * 密度映射本体在 `content-density.ts`（不含 React）：`app/layout.tsx` 是服务端组件，
 * 只能 import 纯模块。这里原样再导出，组件侧的既有 import 路径不用动。
 */
export {
  CARD_DENSITY_TO_CONTENT,
  DEFAULT_CONTENT_DENSITY,
  cardDensityOf,
  contentDensityOf,
  isContentDensity,
  type ContentDensity,
} from './content-density'

export type ExternalLinkTarget = '_blank' | '_self'

const SERVER_SNAPSHOT: UserSettingsModel = { ...DEFAULT_USER_SETTINGS }

let snapshot: UserSettingsModel = SERVER_SNAPSHOT
const listeners = new Set<() => void>()
let sourceBound = false

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function setSnapshot(next: UserSettingsModel): void {
  if (next === snapshot) return
  snapshot = next
  emit()
}

/**
 * 老版 DensityToggle 把密度写在独立键 `navhub_content_density` 上。
 * 现在密度只认偏好里的 `cardDensity`，但直接丢掉旧键等于把老用户的排版悄悄改回默认。
 * 因此：从未保存过偏好（`updatedAt === 0`）时把旧键当作初值读进来，一旦用户真的保存过
 * 就以偏好为准。这里刻意不写盘 —— 写 `writeLocalUserSettings` 会顺手打上 updatedAt，
 * 那会让「从没设置过」的设备失去跟随站点配置的默认行为。
 */
function withLegacyDensity(model: UserSettingsModel): UserSettingsModel {
  if (typeof window === 'undefined' || model.updatedAt) return model
  const legacy = window.localStorage.getItem('navhub_content_density')
  if (!isContentDensity(legacy)) return model
  return { ...model, cardDensity: cardDensityOf(legacy) }
}

function readSnapshot(): UserSettingsModel {
  return withLegacyDensity(readLocalUserSettings())
}

function bindOnce(): void {
  if (sourceBound || typeof window === 'undefined') return
  sourceBound = true
  snapshot = readSnapshot()
  // 三条变更源一律「回读存储」而不是相信事件负载：写盘可能只成功了一半
  // （配额满、隐私模式），以存储为准才不会把半截状态固化进快照。
  window.addEventListener('navhub_settings_changed', () => setSnapshot(readSnapshot()))
  window.addEventListener('storage', (event) => {
    if (event.key && event.key !== USER_SETTINGS_STORAGE_KEY) return
    setSnapshot(readSnapshot())
  })
}

function subscribe(listener: () => void): () => void {
  bindOnce()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useUserPreferences(): UserSettingsModel {
  return useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT)
}

/**
 * 只订阅单个偏好项。首页上千张卡片如果都订阅整包 model，
 * 用户切任意一个开关就会集体重渲染；原始值在 Object.is 下天然稳定。
 */
export function useUserPreference<K extends keyof UserSettingsModel>(
  key: K,
): UserSettingsModel[K] {
  return useSyncExternalStore(
    subscribe,
    () => snapshot[key],
    () => DEFAULT_USER_SETTINGS[key],
  )
}

/** 给非组件代码（命令式跳转、事件回调）用的同步读取 */
export function readUserPreferences(): UserSettingsModel {
  if (typeof window === 'undefined') return SERVER_SNAPSHOT
  return readSnapshot()
}

/**
 * 写本地偏好。`writeLocalUserSettings` 已经广播 `navhub_settings_changed`，
 * 这里仍显式落一次快照：写盘可能因隐私模式 / 配额满而抛错，那种情况下它只回
 * normalized 结果不派事件，不补这一步就会出现「用户点了但界面不动」。
 */
export function updateUserPreferences(patch: UserSettingsPatch): UserSettingsModel {
  setSnapshot(writeLocalUserSettings(patch))
  return snapshot
}

/* ------------------------------------------------------------------ *
 * 打开方式：站点配置是默认值，用户开关是最终决定
 * ------------------------------------------------------------------ */

/**
 * `updatedAt === 0` 表示这台设备（云端也没有记录）从未保存过偏好，
 * 此时跟随后台站点配置，保住既有部署（管理员显式设成 `_self` 的站内导航）的行为不变。
 */
export function resolveExternalLinkTarget(
  prefs: UserSettingsModel,
  adminLinkTarget?: string | null,
): ExternalLinkTarget {
  const admin: ExternalLinkTarget = adminLinkTarget === '_self' ? '_self' : '_blank'
  if (!prefs.updatedAt) return admin
  return prefs.openLinksInNewTab ? '_blank' : '_self'
}

export function useExternalLinkTarget(adminLinkTarget?: string | null): ExternalLinkTarget {
  return useSyncExternalStore(
    subscribe,
    () => resolveExternalLinkTarget(snapshot, adminLinkTarget),
    () => resolveExternalLinkTarget(SERVER_SNAPSHOT, adminLinkTarget),
  )
}

/* ------------------------------------------------------------------ *
 * 卡片密度：映射表在 content-density.ts（RSC 也要能读），这里只留订阅 hook
 * ------------------------------------------------------------------ */

export function useContentDensity(): ContentDensity {
  return useSyncExternalStore(
    subscribe,
    () => contentDensityOf(snapshot.cardDensity),
    () => contentDensityOf(DEFAULT_USER_SETTINGS.cardDensity),
  )
}

/* ------------------------------------------------------------------ *
 * 呼出快捷键：四个入口共用同一判据，别再各写一份
 * ------------------------------------------------------------------ */

const EDITABLE_TAGS = new Set(['input', 'textarea', 'select'])

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.tagName !== 'string') return false
  if (EDITABLE_TAGS.has(element.tagName.toLowerCase())) return true
  return element.isContentEditable === true
}

/**
 * 「/」在输入框里是正文，只有从非输入态按下才算呼出；
 * ⌘/Ctrl+K 不受此限制（组合键不会与打字冲突）。
 */
export function spotlightHotkeyMatches(event: KeyboardEvent, mode: SpotlightShortcutMode): boolean {
  const key = typeof event.key === 'string' ? event.key : ''
  const modK = (event.metaKey || event.ctrlKey) && key.toLowerCase() === 'k'
  const slash = key === '/' && !isEditableTarget(event.target)
  if (modK) return mode === 'mod+k' || mode === 'both'
  if (slash) return mode === 'slash' || mode === 'both'
  return false
}

export function useSpotlightShortcutMode(): SpotlightShortcutMode {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.spotlightShortcut,
    () => DEFAULT_USER_SETTINGS.spotlightShortcut,
  )
}

/** 界面上那枚按键提示：必须与实际生效的呼出键逐字一致，否则又是界面在说假话 */
export function spotlightHotkeyHint(mode: SpotlightShortcutMode, modKey = '⌘'): string {
  // ⌘ 直接连写（mac 惯例），Ctrl 要带加号，否则 Windows 上显示成没人这么写的「CtrlK」
  const combo = modKey === '⌘' ? '⌘K' : `${modKey}+K`
  if (mode === 'slash') return '/'
  if (mode === 'mod+k') return combo
  return `${combo} 或 /`
}
