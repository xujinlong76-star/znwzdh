/**
 * 「今日重温」——把被遗忘的收藏带回来。
 *
 * 数据现实（2026-11-12 审阅结论，写死在这里免得后人误读）：
 *
 *   - 收藏本体（LocalFavorite）只有 `createdAt`（收藏时间），没有「上次打开」；
 *     「打开」信号来自两处本机记录：① `lastOpenedAt`（本轮新增：从重温入口
 *     打开收藏时由 useFavorites.recordOpened 写下，纯本机、不进云端同步）；
 *     ② 离线最近访问（lib/offline-recent，最多 50 条，且只在 ⌘K 里记过）。
 *   - 所以「没打开」永远是「本机没记录到打开」，不是「用户真的没打开」——
 *     直接点卡片打开是不会被记下来的。文案必须按这个口径写（见 describeStale），
 *     绝不能把一条收藏说成「你 200 天没看过它」。
 *   - /brief 是服务端渲染的中枢缓存页，看不到本机收藏：重温只能是客户端岛
 *     （BriefWatch 的同款做法），绝不能把用户收藏塞进 SSR。
 *
 * 本文件只放纯函数：`now` 一律由调用方传入（可测、不依赖真实时钟）。
 */

/** 超过这么多天没有「记录到的打开」，就进入「好久没打开」。 */
export const STALE_THRESHOLD_DAYS = 90
/** /brief 每日重温只露这么多条：轻推，不是清单。 */
export const RESURFACE_DAILY_LIMIT = 3

export const DAY_MS = 24 * 60 * 60 * 1000

export interface ResurfaceFavoriteLike {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  /**
   * 备注 / 标签 / 所属收藏夹：重温本身不用它们，但 toResurfaced 用
   * ...fav 原样带上，归档入口才能把它们一起存进归档柜、恢复时原样带回——
   * 否则归档会静默洗掉这三样（只剩站名链接的空壳）。
   */
  note?: string
  tags?: string[]
  folderId?: string | null
  createdAt: number
  /** 从重温入口打开时写下的本机时间戳（没有 = 从未从重温入口打开过） */
  lastOpenedAt?: number
}

export interface ResurfaceVisitLike {
  id: string
  visitedAt: number
}

export interface ResurfacedFavorite extends ResurfaceFavoriteLike {
  /** 解析出的上次打开时间；null = 两处记录里都没有（只剩收藏时间可参考） */
  lastOpenedAtResolved: number | null
  /** 距上次记录到的打开（或收藏当天）的天数（向下取整，不小于 0） */
  daysSinceOpen: number
}

/** 最近访问按 siteId 折成「最新一次」：调用方传原始列表，这里只做合并。 */
export function latestVisitsById(visits: ResurfaceVisitLike[]): Map<string, number> {
  const byId = new Map<string, number>()
  for (const v of visits) {
    if (typeof v.visitedAt !== 'number' || !Number.isFinite(v.visitedAt)) continue
    const prev = byId.get(v.id)
    if (prev === undefined || v.visitedAt > prev) byId.set(v.id, v.visitedAt)
  }
  return byId
}

/**
 * 一条收藏「上次被记录到的打开」：lastOpenedAt 与最近访问取较新者。
 * 晚于 now 的时间戳（时钟回拨 / 脏数据）一律忽略，不让未来时间把收藏洗成「刚打开过」。
 */
export function resolveLastOpened(
  fav: ResurfaceFavoriteLike,
  visitsById: Map<string, number>,
  now: number,
): number | null {
  const candidates: number[] = []
  if (typeof fav.lastOpenedAt === 'number' && Number.isFinite(fav.lastOpenedAt) && fav.lastOpenedAt <= now) {
    candidates.push(fav.lastOpenedAt)
  }
  const visit = visitsById.get(fav.siteId)
  if (visit !== undefined && visit <= now) candidates.push(visit)
  if (candidates.length === 0) return null
  return Math.max(...candidates)
}

/** 距上次记录到的打开的天数；从未记录到打开时按「收藏当天」算。 */
export function daysSinceOpen(fav: ResurfaceFavoriteLike, visitsById: Map<string, number>, now: number): number {
  const last = resolveLastOpened(fav, visitsById, now)
  const anchor = last ?? fav.createdAt
  return Math.max(0, Math.floor((now - anchor) / DAY_MS))
}

/**  stale 判定：严格大于阈值——正好 90 天不算「好久」，第 91 天才算。 */
export function isStale(
  fav: ResurfaceFavoriteLike,
  visitsById: Map<string, number>,
  now: number,
  thresholdDays: number = STALE_THRESHOLD_DAYS,
): boolean {
  return daysSinceOpen(fav, visitsById, now) > thresholdDays
}

/** 卡片上的旧徽标：只说天数，不渲染「你忘了它」之类的指责。 */
export function staleBadgeLabel(days: number): string {
  return `好久没打开 · ${days}天`
}

/**
 * 一条收藏的「旧」说明：诚实口径。
 * 从未记录到打开 → 只说「收藏 N 天了，还没从这里重温过」；
 * 打开过 → 「上次打开是 N 天前」。都不声称用户真的没看过。
 */
export function describeStale(fav: ResurfaceFavoriteLike, visitsById: Map<string, number>, now: number): string {
  const days = daysSinceOpen(fav, visitsById, now)
  const last = resolveLastOpened(fav, visitsById, now)
  if (last === null) return `收藏 ${days} 天了，还没从这里重温过`
  return `上次打开是 ${days} 天前`
}

/**
 * 已选出的条目（ResurfacedFavorite 自带解析好的天数与上次打开）直接取文案：
 * 不许在渲染层拿空访问表重算——那会把「靠最近访问才不算太旧」的条目
 * 又算回「按收藏时间算」的错误天数。
 */
export function describeResurfaced(item: ResurfacedFavorite): string {
  if (item.lastOpenedAtResolved === null) return `收藏 ${item.daysSinceOpen} 天了，还没从这里重温过`
  return `上次打开是 ${item.daysSinceOpen} 天前`
}

function toResurfaced(
  fav: ResurfaceFavoriteLike,
  visitsById: Map<string, number>,
  now: number,
): ResurfacedFavorite {
  return {
    ...fav,
    lastOpenedAtResolved: resolveLastOpened(fav, visitsById, now),
    daysSinceOpen: daysSinceOpen(fav, visitsById, now),
  }
}

/**
 * 全部「好久没打开」的收藏：先去重（同 siteId 只留最久没打开的那一条），
 * 再按「最久没打开」排前面；并列时先收藏的排前面，最后按 siteId 兜底，
 * 保证同一份输入永远得到同一份输出。
 */
export function selectStaleFavorites(
  favorites: ResurfaceFavoriteLike[],
  visits: ResurfaceVisitLike[],
  now: number,
  thresholdDays: number = STALE_THRESHOLD_DAYS,
): ResurfacedFavorite[] {
  const visitsById = latestVisitsById(visits)
  const bySite = new Map<string, ResurfacedFavorite>()
  for (const fav of favorites) {
    if (!fav || typeof fav.siteId !== 'string' || fav.siteId === '') continue
    const item = toResurfaced(fav, visitsById, now)
    if (item.daysSinceOpen <= thresholdDays) continue
    const prev = bySite.get(fav.siteId)
    if (!prev || item.daysSinceOpen > prev.daysSinceOpen || (item.daysSinceOpen === prev.daysSinceOpen && item.createdAt < prev.createdAt)) {
      bySite.set(fav.siteId, item)
    }
  }
  return [...bySite.values()].sort((a, b) => {
    if (b.daysSinceOpen !== a.daysSinceOpen) return b.daysSinceOpen - a.daysSinceOpen
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0
  })
}

/** 每日重温：同一份排序，只取前 limit 条（默认 3 条）。 */
export function selectDailyResurface(
  favorites: ResurfaceFavoriteLike[],
  visits: ResurfaceVisitLike[],
  now: number,
  limit: number = RESURFACE_DAILY_LIMIT,
): ResurfacedFavorite[] {
  return selectStaleFavorites(favorites, visits, now).slice(0, Math.max(0, limit))
}
