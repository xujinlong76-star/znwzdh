/**
 * 追剧清单的纯规则层：条目形状、节奏判定、提醒到期、云端合并。
 *
 * 与收藏划清界限（产品口径，文案与代码都守）：
 *  - 收藏 = 「存着」：一个站点存进收藏夹，日后想起来再去；
 *  - 追剧 = 「在追」：一部正在追的剧 + 看到第几集 + 更新节奏 + 到点提醒。
 * 所以条目的主键不是站点，而是「平台 + 剧名」：同一平台上可以同时追很多部剧。
 *
 * 诚实纪律（本功能的地基，不许绕）：
 *  - 站内**没有任何**短剧平台的排播数据源（已逐处核过：导航数据只有平台站、
 *    视频目录是 B 站教程）。所以「更新节奏」只能由用户按平台公示自己标注，
 *    我们只负责照着提醒；没标注（unknown）就永远只给「去看看有没有更新」
 *    的入口，绝不显示成「已更新」。
 *  - 节奏标注带出处语义：界面上写明是「按你标注的节奏」，不冒充平台官方消息。
 */

/** 本地存储键。改键 = 老用户的追剧清单凭空消失，不许改。 */
export const WATCHLIST_STORAGE_KEY = 'navhub.watchlist.v1'

export type WatchCadence =
  | { kind: 'daily' }
  | { kind: 'weekly'; weekdays: number[] }
  | { kind: 'finished' }
  | { kind: 'unknown' }

export type WatchPriority = 'high' | 'normal'

export interface WatchEntry {
  /** 同步键：`${platformSiteId}::${归一化剧名}` */
  key: string
  title: string
  platformSiteId: string
  platformTitle: string
  /** 官方播放页（平台站地址快照）；渲染时必须再过 safeHref */
  playUrl: string
  icon?: string
  /** 看到第几集（0 = 还没开始看），只由用户手动改 */
  episode: number
  priority: WatchPriority
  cadence: WatchCadence
  /** 逐剧提醒开关：关掉后不再进待看区，条目本身保留 */
  remind: boolean
  /** 已在某天手动关掉当天提醒的本地日期（YYYY-MM-DD） */
  dismissedOn?: string
  /** 最近一次改进度的时间戳 */
  lastProgressAt: number
  createdAt: number
  updatedAt: number
}

/** 从平台站卡加入追剧时需要的平台快照 */
export interface WatchPlatformRef {
  siteId: string
  title: string
  href: string
  icon?: string
}

export const WATCH_TITLE_MAX = 80
export const WATCH_EPISODE_MAX = 100_000

/** 剧名归一：去首尾空白、内部连续空白压成一个、转小写（英文剧名大小写不敏感） */
export function normalizeDramaTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function dramaKeyFor(platformSiteId: string, title: string): string {
  return `${platformSiteId}::${normalizeDramaTitle(title)}`
}

/** 节奏归一（客户端口径，与服务端 parseWatchCadence 一致）：非法形状收敛成 unknown */
export function normalizeWatchCadence(input: unknown): WatchCadence {
  if (!input || typeof input !== 'object') return { kind: 'unknown' }
  const kind = (input as { kind?: unknown }).kind
  if (kind === 'daily') return { kind: 'daily' }
  if (kind === 'finished') return { kind: 'finished' }
  if (kind === 'weekly') {
    const days = (input as { weekdays?: unknown }).weekdays
    if (Array.isArray(days)) {
      const weekdays = [...new Set(days.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort((a, b) => a - b)
      if (weekdays.length > 0) return { kind: 'weekly', weekdays }
    }
    return { kind: 'unknown' }
  }
  return { kind: 'unknown' }
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** 节奏的人话标签。unknown 必须直说「未标注」，不许包装成别的说法。 */
export function cadenceLabel(cadence: WatchCadence): string {
  switch (cadence.kind) {
    case 'daily':
      return '每天更新'
    case 'weekly':
      return `每周${cadence.weekdays.map((d) => WEEKDAY_LABELS[d]).join('、')}更新`
    case 'finished':
      return '已完结'
    case 'unknown':
      return '更新节奏未标注'
  }
}

/**
 * 更新数据的来源适配层：提醒判定只问「这部剧的节奏是什么」，不关心节奏从哪来，
 * 统一经这个 resolver 取值。当前唯一来源是用户标注（entry.cadence 本身）。
 * 将来若接入合规的短剧元数据数据源（标题/集数/更新状态），只需在这里改为
 * 「数据源优先、用户标注兜底」，判定、分区与存储口径都不用动。
 */
export function resolveEntryCadence(entry: WatchEntry): WatchCadence {
  return entry.cadence
}

/** 本地日期键（按用户所在时区）：提醒判定全程用它，不用 UTC，避免大半夜跨天误判 */
export function localDateKey(ts: number): string {
  const d = new Date(ts)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 某天是否落在节奏的更新日上。finished / unknown 永远不是——它们不产生「更新」断言。 */
export function isCadenceDay(cadence: WatchCadence, at: Date): boolean {
  if (cadence.kind === 'daily') return true
  if (cadence.kind === 'weekly') return cadence.weekdays.includes(at.getDay())
  return false
}

/**
 * 提醒是否到期（「到点提醒」的唯一判定，页面与测试共用）：
 *  1. 这部剧的提醒没被关掉；
 *  2. 节奏已知且今天是更新日；
 *  3. 今天还没改进度（改进度 = 今天已经看过新集了，不必再催）；
 *  4. 今天没被手动关掉（「今天已看」）。
 * 注意它只断言「按你标注的节奏，今天是更新日」，不断言平台真的更新了。
 */
export function isReminderDue(entry: WatchEntry, now: Date): boolean {
  if (!entry.remind) return false
  if (!isCadenceDay(resolveEntryCadence(entry), now)) return false
  const today = localDateKey(now.getTime())
  if (entry.dismissedOn === today) return false
  if (localDateKey(entry.lastProgressAt) >= today) return false
  if (localDateKey(entry.createdAt) > today) return false
  return true
}

export interface WatchlistPartitions {
  /** 到更新日、今天还没看：待看区（醒目提醒） */
  due: WatchEntry[]
  /** 节奏未标注：只给「去看看有没有更新」的诚实入口，不进待看区 */
  check: WatchEntry[]
  /** 其余在追（节奏已知、今天不是更新日，或提醒已关） */
  active: WatchEntry[]
  /** 已完结：留着补看，不提醒 */
  finished: WatchEntry[]
}

const priorityRank = (e: WatchEntry) => (e.priority === 'high' ? 0 : 1)

export function partitionWatchlist(entries: WatchEntry[], now: Date): WatchlistPartitions {
  const due: WatchEntry[] = []
  const check: WatchEntry[] = []
  const active: WatchEntry[] = []
  const finished: WatchEntry[] = []
  for (const entry of entries) {
    const cadence = resolveEntryCadence(entry)
    if (cadence.kind === 'finished') finished.push(entry)
    else if (isReminderDue(entry, now)) due.push(entry)
    else if (cadence.kind === 'unknown' && entry.remind) check.push(entry)
    else active.push(entry)
  }
  // 待看区：想先看的排前面，其次是越久没动的越靠前（最可能攒了新集）
  due.sort((a, b) => priorityRank(a) - priorityRank(b) || a.lastProgressAt - b.lastProgressAt)
  check.sort((a, b) => priorityRank(a) - priorityRank(b) || b.updatedAt - a.updatedAt)
  active.sort((a, b) => priorityRank(a) - priorityRank(b) || b.updatedAt - a.updatedAt)
  finished.sort((a, b) => b.updatedAt - a.updatedAt)
  return { due, check, active, finished }
}

/** 首页影院区「继续追」续看行每行最多露出的部数。 */
export const CONTINUE_WATCHING_LIMIT = 4

/**
 * 首页「继续追」续看行取行口径（与分类页横幅、简报页同源，都走 partitionWatchlist，
 * 不另立口径）：due（今日待看）优先、不足用 check（节奏未标注）补、再不足用
 * active 补，凑满 limit；finished（已完结）不进——完结的剧不叫「继续追」。
 * 空清单返回 []，调用方整行不渲染，不留占位。
 */
export function selectContinueWatching(
  entries: WatchEntry[],
  now: Date,
  limit = CONTINUE_WATCHING_LIMIT,
): WatchEntry[] {
  const { due, check, active } = partitionWatchlist(entries, now)
  return [...due, ...check, ...active].slice(0, Math.max(0, limit))
}

/**
 * 把一个不可信对象收敛成合法条目；形状不对就返回 null（丢弃，不猜）。
 * 本地存储与云端返回都过这一道——坏一条不能拖垮整份清单。
 */
export function sanitizeWatchEntry(raw: unknown): WatchEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, WATCH_TITLE_MAX) : ''
  const platformSiteId = typeof r.platformSiteId === 'string' ? r.platformSiteId : ''
  const playUrl = typeof r.playUrl === 'string' ? r.playUrl : ''
  if (!title || !platformSiteId || !playUrl) return null
  const key =
    typeof r.key === 'string' && r.key ? r.key : dramaKeyFor(platformSiteId, title)
  const episodeRaw = typeof r.episode === 'number' && Number.isFinite(r.episode) ? Math.trunc(r.episode) : 0
  const createdAt = typeof r.createdAt === 'number' && r.createdAt > 0 ? r.createdAt : Date.now()
  return {
    key,
    title,
    platformSiteId,
    platformTitle: typeof r.platformTitle === 'string' && r.platformTitle ? r.platformTitle : platformSiteId,
    playUrl,
    icon: typeof r.icon === 'string' && r.icon ? r.icon : undefined,
    episode: Math.min(Math.max(episodeRaw, 0), WATCH_EPISODE_MAX),
    priority: r.priority === 'high' ? 'high' : 'normal',
    cadence: normalizeWatchCadence(r.cadence),
    remind: r.remind !== false,
    dismissedOn: typeof r.dismissedOn === 'string' && r.dismissedOn ? r.dismissedOn : undefined,
    lastProgressAt:
      typeof r.lastProgressAt === 'number' && r.lastProgressAt > 0 ? r.lastProgressAt : createdAt,
    createdAt,
    updatedAt: typeof r.updatedAt === 'number' && r.updatedAt > 0 ? r.updatedAt : createdAt,
  }
}

/* ------------------------------ 云端合并 ------------------------------ */

/** 云端条目形状：与 WatchEntry 同字段 + 墓碑（服务端 WatchEntryRecord 的客户端视图） */
export type HubWatchEntry = WatchEntry & { deletedAt?: number | null }

/**
 * 全量合并（since=0）：**以云端成员集合为准**，与收藏 mergeCloudFavorites 同口径。
 * 本地独有的条目若没在本次同步里先推上去，就不该在合并后存活——否则另一台设备
 * 删掉的剧会被本机缓存复活。云端字段全量存储（含 icon），直接以云端为准。
 */
export function mergeCloudWatchlist(local: WatchEntry[], cloud: HubWatchEntry[]): WatchEntry[] {
  const localByKey = new Map(local.map((e) => [e.key, e]))
  const merged: WatchEntry[] = []
  for (const remote of cloud) {
    if (remote.deletedAt != null) continue
    const clean = sanitizeWatchEntry(remote)
    if (!clean) continue
    // createdAt 优先云端；云端缺失时用本地的（同一 key 的条目在两端应是同一条）
    const cached = localByKey.get(clean.key)
    merged.push(cached && !remote.createdAt ? { ...clean, createdAt: cached.createdAt } : clean)
  }
  return merged.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 增量应用（since>0）：只按 key upsert / 删墓碑，绝不整体替换——
 * 本地尚未推送的条目不在增量里，整体替换会把它们误删（与收藏 applyFavoriteDelta 同理）。
 */
export function applyWatchDelta(local: WatchEntry[], delta: HubWatchEntry[]): WatchEntry[] {
  const map = new Map(local.map((e) => [e.key, e]))
  const fresh: WatchEntry[] = []
  for (const remote of delta) {
    if (remote.deletedAt != null) {
      map.delete(remote.key)
      continue
    }
    const clean = sanitizeWatchEntry(remote)
    if (!clean) continue
    if (map.has(clean.key)) map.set(clean.key, clean)
    else fresh.push(clean)
  }
  return fresh.length > 0 ? [...fresh, ...map.values()] : [...map.values()]
}
