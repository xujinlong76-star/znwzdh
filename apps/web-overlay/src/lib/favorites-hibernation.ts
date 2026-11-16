/**
 * 冬眠收藏：长期没打开的收藏自动沉到底部折叠区，不删除、随时能翻出来。
 *
 * 和邻居功能的区别（审方案时定死，别再混起来）：
 *
 *   - 待读分流（lib/favorites-triage）：新收藏 24 小时决定期，到期「移出」活跃
 *     列表进已移出区；冬眠不移出任何东西，条目一直在列表里，只是沉下去。
 *   - 重温（lib/resurface）：90 天没打开的轻推（每日 3 条 + /favorites/stale）；
 *     冬眠是同一锚点上更长的一档（默认 180 天），管的是列表浏览顺序，不是提醒。
 *   - 归档（lib/favorites-archive）：用户手动冷藏，移出活跃列表；冬眠不移出。
 *   - 删除 / 回收站：冬眠永远不删，红线。
 *
 * 数据现实（与 resurface 同一口径，见 resurface.ts 文件头）：
 *
 *   - 收藏本体只有 createdAt，没有「上次打开」；「打开」信号来自三处记录：
 *     ① lastOpenedAt（由 recordOpened 写下，调用点与 resurface 同口径：
 *     /favorites 主列表卡片、重温 / 待读 / ⌘K / 搜索入口；另一台设备上的
 *     打开不记）；② 离线最近访问（lib/offline-recent，
 *     最多 50 条，只在 ⌘K 里记过）；③ 云端 visits（GET /api/me/visits，
 *     调用方在 lib/resurface-visits 里与本机合并后传入）——**只对登录用户**，
 *     匿名用户仍只有 ①②。
 *   - 所以「冬眠」的口径按登录态分流：登录用户是「按本机 + 云端记录算，
 *     超过阈值没记录到打开」；匿名用户永远是「按本机记录算，超过阈值没记录到
 *     打开」，不是「用户真的没看过」。文案必须按这个口径写（见
 *     describeHibernation 的 isLoggedIn 参数），绝不能说「你 N 天没看过它」，
 *     也绝不能向匿名用户声称跨设备准确。
 *   - 锚点直接复用 resurface 的 resolveLastOpened / daysSinceOpen，不另起一套
 *     算法——两套算法分叉后，同一条收藏会在重温页和冬眠区算出两个天数。
 *
 * 判定（缺字段一律不冬眠，祖父规则）：
 *
 *   - 开关关了 → 全不冬眠；待读箱 / 已读（triageStatus 非 permanent）不参与——
 *     它们有自己的到期流转，冬眠不插手；手动冬眠只认 permanent。
 *   - 自动冬眠：daysSinceOpen 严格大于阈值（正好 180 天不冬眠，第 181 天才冬眠，
 *     与 resurface 的 90 天口径一致）；阈值改了，已有条目的冬眠状态跟着变，
 *     不另存 dueAt / hibernatedAt。
 *   - 手动冬眠：用户点「冬眠」进本机集合（独立键，不进云端同步模型——
 *     服务端 settingsPatchSchema 不认识这类键，混进模型会被 normalize 洗掉，
 *     与 triage 偏好独立键同一理由），粘性保留，直到用户点「唤醒」。
 *     唤醒 = 移出手动集合 + recordOpened（打开即唤醒，天数归零，自动脱离冬眠）。
 *
 * 本文件只放纯函数 + 偏好 / 手动集合的存储读写：`now` 一律由调用方传入
 * （可测、不依赖真实时钟），仿 resurface.ts / favorites-triage.ts 体例。
 */

import { daysSinceOpen, latestVisitsById, resolveLastOpened } from './resurface'
import { resolveTriageStatus } from './favorites-triage'

export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000

/** 冬眠阈值默认值（天）：比重温的 90 天长一档，避免同一批条目同时是「重温」又是「冬眠」。 */
export const DEFAULT_HIBERNATION_THRESHOLD_DAYS = 180

/** 冬眠区展开后最多渲染这么多条：再多就让用户用搜索找，避免上千个 DOM 同时进场。 */
export const HIBERNATION_RENDER_LIMIT = 100

export type HibernationThresholdDays = 90 | 180 | 365

export const HIBERNATION_THRESHOLD_DAY_OPTIONS = [
  { value: 90, label: '90 天' },
  { value: 180, label: '180 天（默认）' },
  { value: 365, label: '1 年' },
] as const satisfies readonly { value: HibernationThresholdDays; label: string }[]

const VALID_THRESHOLD_DAYS = new Set<number>(HIBERNATION_THRESHOLD_DAY_OPTIONS.map((o) => o.value))

export interface HibernationSettings {
  /** 关掉后不分区：全部收藏按原来顺序显示，已手动冬眠的也不沉下去 */
  enabled: boolean
  thresholdDays: HibernationThresholdDays
}

export const DEFAULT_HIBERNATION_SETTINGS: HibernationSettings = {
  enabled: true,
  thresholdDays: DEFAULT_HIBERNATION_THRESHOLD_DAYS,
}

/** 冬眠偏好的存储键。独立键，不与用户设置模型混在一起（见文件头注释）。 */
export const HIBERNATION_SETTINGS_KEY = 'navhub.hibernation.settings.v1'

/** 手动冬眠集合的存储键。独立键，不与收藏本体、归档柜、已移出区混在一起。 */
export const MANUAL_HIBERNATED_KEY = 'navhub.favorites.hibernated.v1'

/** 手动冬眠事件：写盘后广播，订阅方回读存储刷新（仿已移出区的 navhub_shelved_updated）。 */
export const HIBERNATION_UPDATED_EVENT = 'navhub_hibernation_updated'

export interface HibernatableFavoriteLike {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  note?: string
  tags?: string[]
  folderId?: string | null
  createdAt: number
  lastOpenedAt?: number
  triageStatus?: string
  triageAt?: number
}

export interface HibernationVisitLike {
  id: string
  visitedAt: number
}

export interface ManualHibernatedItem {
  siteId: string
  /** 手动冬眠时刻（毫秒）：仅作展示 / 排序参考，不参与自动判定 */
  hibernatedAt: number
}

/** 归一任意输入的冬眠偏好：非法档位回落默认，不抛。 */
export function normalizeHibernationSettings(raw?: unknown): HibernationSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_HIBERNATION_SETTINGS }
  }
  const s = raw as Record<string, unknown>
  const daysNum = Number(s.thresholdDays)
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : DEFAULT_HIBERNATION_SETTINGS.enabled,
    thresholdDays: VALID_THRESHOLD_DAYS.has(daysNum)
      ? (daysNum as HibernationThresholdDays)
      : DEFAULT_HIBERNATION_SETTINGS.thresholdDays,
  }
}

/** 读本机冬眠偏好（SSR / 存储不可用时返回默认值，不抛）。 */
export function readHibernationSettings(): HibernationSettings {
  try {
    if (typeof window === 'undefined') return { ...DEFAULT_HIBERNATION_SETTINGS }
    const raw = window.localStorage.getItem(HIBERNATION_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_HIBERNATION_SETTINGS }
    return normalizeHibernationSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_HIBERNATION_SETTINGS }
  }
}

/**
 * 写本机冬眠偏好（只改传了的键，其余保留），并广播变更。
 * 写不进去返回归一后的值但不派事件：调用方据此知道「本次改动没留存」。
 */
export function writeHibernationSettings(patch: Partial<HibernationSettings>): HibernationSettings {
  const next = normalizeHibernationSettings({ ...readHibernationSettings(), ...patch })
  try {
    if (typeof window === 'undefined') return next
    window.localStorage.setItem(HIBERNATION_SETTINGS_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent('navhub_hibernation_settings_changed', { detail: next }))
  } catch {
    return next
  }
  return next
}

function isManualHibernatedItem(value: unknown): value is ManualHibernatedItem {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.siteId === 'string' &&
    v.siteId !== '' &&
    typeof v.hibernatedAt === 'number' &&
    Number.isFinite(v.hibernatedAt)
  )
}

/** 解析手动冬眠集合原始字符串：坏 JSON / 结构不对一律按空集合（冬眠丢了可重建，绝不抛）。 */
export function parseManualHibernated(raw: string | null | undefined): ManualHibernatedItem[] {
  if (raw === null || raw === undefined || raw === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const items: ManualHibernatedItem[] = []
  for (const entry of parsed) {
    if (!isManualHibernatedItem(entry) || seen.has(entry.siteId)) continue
    seen.add(entry.siteId)
    items.push({ siteId: entry.siteId, hibernatedAt: entry.hibernatedAt })
  }
  return items
}

export function serializeManualHibernated(items: ManualHibernatedItem[]): string {
  return JSON.stringify(items)
}

/** 读本机手动冬眠集合（服务端渲染 / 存储不可用时按空集合，不抛）。 */
export function readManualHibernated(): ManualHibernatedItem[] {
  try {
    if (typeof window === 'undefined') return []
    return parseManualHibernated(window.localStorage.getItem(MANUAL_HIBERNATED_KEY))
  } catch {
    return []
  }
}

/** 手动冬眠集合写盘：写不进去返回 false（调用方据此提示，不静默丢冬眠记录）。 */
export function writeManualHibernated(items: ManualHibernatedItem[]): boolean {
  try {
    if (typeof window === 'undefined') return false
    window.localStorage.setItem(MANUAL_HIBERNATED_KEY, serializeManualHibernated(items))
    window.dispatchEvent(new Event(HIBERNATION_UPDATED_EVENT))
    return true
  } catch {
    return false
  }
}

/** 手动冬眠一条：已冬眠过的同站只刷新 hibernatedAt，不重复占位；新冬眠的放最前。 */
export function addManualHibernated(
  list: ManualHibernatedItem[],
  siteId: string,
  now: number,
): ManualHibernatedItem[] {
  const rest = list.filter((i) => i.siteId !== siteId)
  return [{ siteId, hibernatedAt: now }, ...rest]
}

/** 唤醒一条：返回剩下的集合与是否真的移掉了一条（没有则原样返回）。 */
export function removeManualHibernated(
  list: ManualHibernatedItem[],
  siteId: string,
): { items: ManualHibernatedItem[]; removed: boolean } {
  if (!list.some((i) => i.siteId === siteId)) return { items: list, removed: false }
  return { items: list.filter((i) => i.siteId !== siteId), removed: true }
}

/** 手动冬眠集合转 siteId 快查集。 */
export function manualHibernatedSet(list: ManualHibernatedItem[]): Set<string> {
  return new Set(list.map((i) => i.siteId))
}

/**
 * 一条收藏是否冬眠（纯判定，不读存储；visitsById 由调用方用 latestVisitsById 算好）。
 *
 * 顺序：开关关 → 不冬眠；待读箱 / 已读 → 不冬眠（有自己的流转）；
 * 手动冬眠 → 冬眠；否则按本机记录的天数严格大于阈值才冬眠。
 * 未来时间戳（时钟回拨 / 脏数据）由 resolveLastOpened / daysSinceOpen 兜底，
 * 不会在这里把收藏洗成「刚打开过」或「冬眠」。
 */
export function isHibernating(
  fav: HibernatableFavoriteLike,
  visitsById: Map<string, number>,
  settings: HibernationSettings,
  manual: Set<string>,
  now: number,
): boolean {
  if (!settings.enabled) return false
  if (!fav || typeof fav.siteId !== 'string' || fav.siteId === '') return false
  // 只看永久库：待读箱 / 已读里的收藏还没决定去留，不进冬眠。
  if (resolveTriageStatus(fav, now) !== 'permanent') return false
  if (manual.has(fav.siteId)) return true
  return daysSinceOpen(fav, visitsById, now) > settings.thresholdDays
}

/**
 * 一条收藏冬眠的原因：'manual' | 'auto' | null（没冬眠）。
 * 徽标与说明文案用它区分措辞——手动冬眠不说天数，自动冬眠只说本机记录。
 */
export function hibernationReason(
  fav: HibernatableFavoriteLike,
  visitsById: Map<string, number>,
  settings: HibernationSettings,
  manual: Set<string>,
  now: number,
): 'manual' | 'auto' | null {
  if (!isHibernating(fav, visitsById, settings, manual, now)) return null
  return manual.has(fav.siteId) ? 'manual' : 'auto'
}

/** 卡片上的冬眠徽标：手动只写「冬眠中」，自动写「冬眠中 · N天」（N 按本机记录算）。 */
export function hibernationBadgeLabel(
  reason: 'manual' | 'auto' | null,
  daysSince: number | null,
): string {
  if (reason === null) return ''
  if (reason === 'manual') return '冬眠中'
  return `冬眠中 · ${Math.max(0, daysSince ?? 0)}天`
}

/**
 * 一条收藏的冬眠说明（诚实口径，与 resurface.describeStale 同款，按登录态分流）：
 * 手动 → 「你手动把它冬眠了，打开一次就能唤醒」；
 * 自动 → 匿名：「收藏 N 天了，本机没记录到打开」/「上次打开是 N 天前（按本机记录算），已冬眠」；
 * 登录：「收藏 N 天了，没记录到打开」/「上次打开是 N 天前，已冬眠」（本机 + 云端口径）；
 * 没冬眠 → 空串。
 * 都不声称用户真的没看过它。isLoggedIn 默认 false：旧调用方不传即匿名口径，行为不变。
 */
export function describeHibernation(
  fav: HibernatableFavoriteLike,
  visitsById: Map<string, number>,
  settings: HibernationSettings,
  manual: Set<string>,
  now: number,
  isLoggedIn = false,
): string {
  const reason = hibernationReason(fav, visitsById, settings, manual, now)
  if (reason === 'manual') return '你手动把它冬眠了，打开一次就能唤醒'
  if (reason === 'auto') {
    const days = daysSinceOpen(fav, visitsById, now)
    const last = resolveLastOpened(fav, visitsById, now)
    if (last === null) return isLoggedIn ? `收藏 ${days} 天了，没记录到打开` : `收藏 ${days} 天了，本机没记录到打开`
    return isLoggedIn ? `上次打开是 ${days} 天前，已冬眠` : `上次打开是 ${days} 天前（按本机记录算），已冬眠`
  }
  return ''
}

/**
 * 分区（纯函数，now 注入；除调用方写盘外无副作用）。
 *
 * 同 siteId 去重（只留第一条，顺序不变）；awake 保持原顺序，hibernating
 * 按「最久没记录到打开」排前面（并列时先收藏的排前面，最后按 siteId 兜底，
 * 同一份输入永远得到同一份输出——与 selectStaleFavorites 同款排序纪律）。
 * 开关关时全进 awake（同一引用、hibernating 为空）：调用方据此知道「没分区」。
 */
export function partitionFavorites<T extends HibernatableFavoriteLike>(
  items: T[],
  visits: HibernationVisitLike[],
  settings: HibernationSettings,
  manualList: ManualHibernatedItem[],
  now: number,
): { awake: T[]; hibernating: T[] } {
  const visitsById = latestVisitsById(visits)
  const manual = manualHibernatedSet(manualList)
  const awake: T[] = []
  const hibernating: T[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (!item || typeof item.siteId !== 'string' || item.siteId === '') continue
    if (seen.has(item.siteId)) continue
    seen.add(item.siteId)
    if (isHibernating(item, visitsById, settings, manual, now)) hibernating.push(item)
    else awake.push(item)
  }
  hibernating.sort((a, b) => {
    const daysA = daysSinceOpen(a, visitsById, now)
    const daysB = daysSinceOpen(b, visitsById, now)
    if (daysB !== daysA) return daysB - daysA
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0
  })
  return { awake, hibernating }
}

/** 冬眠区标题：只写条数，不渲染「你忘了它们」之类的指责。 */
export function hibernationSectionTitle(count: number): string {
  return `冬眠收藏 · ${count} 条`
}
