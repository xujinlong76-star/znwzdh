/**
 * 已移出区：待读流转的「出口」，不是回收站，也不是归档柜。
 *
 * 「移出」≠「删除」≠「归档」：移出是待读分流的流转动作——待读箱/已读到期
 * 未处理，或用户手动移出——条目从活跃列表拿掉、留一份可恢复的副本；
 * 归档是用户主动冷藏（lib/favorites-archive.ts，另一只柜子、另一个键）；
 * 删除是不留副本。已移出区与归档柜分开两个区、两个键。
 *
 * 保留多久（v1 已定）：不自动清，无限期保留，直到用户显式点「清空已移出」
 * （二次确认，文案写明不可恢复）。真删除只发生两处：用户在已移出区逐条删
 * （确认框），或清空已移出（确认框）。
 *
 * 只保存在本机（localStorage），不参与云端同步——云端收藏是事实源，
 * 移出是本机整理动作；移出后下一次同步会把云端对应条目也删掉
 * （走 remove 的同一条路），恢复时再由 importJson 重新推上去。
 *
 * 纯函数（parse / 移入 / 取出）与存储读写分开：规则可以直接钉进测试。
 * 体例仿 lib/favorites-archive.ts。
 */

/** 已移出列表的存储键。独立键，不与收藏本体、归档柜混在一起。 */
export const SHELVED_FAVORITES_KEY = 'navhub.favorites.shelved.v1'

export interface ShelvedFavoriteItem {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  /** 备注：移出不能把它洗掉，恢复时要原样带回收藏 */
  note?: string
  /** 标签：同上，恢复时原样带回 */
  tags?: string[]
  /** 所属收藏夹 id：同上，恢复时原样带回（null = 未分夹） */
  folderId?: string | null
  /** 参数化快捷链接（v1 本地 only）：移出不能把它洗掉，恢复时原样带回 */
  quickPrefix?: string
  templateUrl?: string
  createdAt: number
  /** 移出时刻（毫秒）：已移出列表按它倒序排（新移入的在前） */
  movedOutAt: number
  /** 移出前所处的状态：只有待读箱 / 已读会进这里，永久库不走移出 */
  originStatus: 'inbox' | 'read'
  /** 移出前进入原状态的时间戳（有则保留，供恢复时参考） */
  originTriageAt?: number
}

export interface ShelvableFavoriteLike {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  note?: string
  tags?: string[]
  folderId?: string | null
  quickPrefix?: string
  templateUrl?: string
  createdAt: number
  triageAt?: number
}

function isShelvedItem(value: unknown): value is ShelvedFavoriteItem {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.siteId === 'string' &&
    v.siteId !== '' &&
    typeof v.title === 'string' &&
    typeof v.href === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.movedOutAt === 'number' &&
    (v.originStatus === 'inbox' || v.originStatus === 'read')
  )
}

/** 解析已移出原始字符串：坏 JSON / 结构不对一律按空列表（移出区丢了可重建，绝不抛）。 */
export function parseShelved(raw: string | null | undefined): ShelvedFavoriteItem[] {
  if (raw === null || raw === undefined || raw === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const items: ShelvedFavoriteItem[] = []
  for (const entry of parsed) {
    if (!isShelvedItem(entry) || seen.has(entry.siteId)) continue
    seen.add(entry.siteId)
    // 备注 / 标签 / 收藏夹 / 快捷链接：只认形状对的值，脏数据丢字段不丢整条
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((t): t is string => typeof t === 'string')
      : []
    items.push({
      siteId: entry.siteId,
      title: entry.title,
      href: entry.href,
      icon: typeof entry.icon === 'string' ? entry.icon : undefined,
      description: typeof entry.description === 'string' ? entry.description : undefined,
      note: typeof entry.note === 'string' ? entry.note : undefined,
      tags: tags.length > 0 ? tags : undefined,
      folderId:
        typeof entry.folderId === 'string' || entry.folderId === null ? entry.folderId : undefined,
      quickPrefix: typeof entry.quickPrefix === 'string' ? entry.quickPrefix : undefined,
      templateUrl: typeof entry.templateUrl === 'string' ? entry.templateUrl : undefined,
      createdAt: entry.createdAt,
      movedOutAt: entry.movedOutAt,
      originStatus: entry.originStatus,
      originTriageAt:
        typeof entry.originTriageAt === 'number' && Number.isFinite(entry.originTriageAt)
          ? entry.originTriageAt
          : undefined,
    })
  }
  return items
}

export function serializeShelved(items: ShelvedFavoriteItem[]): string {
  return JSON.stringify(items)
}

/** 移入一条：已移入过的同站只刷新 movedOutAt，不重复占位；新移入的放最前。 */
export function shelveItems(
  list: ShelvedFavoriteItem[],
  fav: ShelvableFavoriteLike,
  now: number,
  originStatus: 'inbox' | 'read',
  originTriageAt?: number,
): ShelvedFavoriteItem[] {
  const item: ShelvedFavoriteItem = {
    siteId: fav.siteId,
    title: fav.title,
    href: fav.href,
    icon: fav.icon,
    description: fav.description,
    note: fav.note,
    tags: fav.tags,
    folderId: fav.folderId,
    quickPrefix: fav.quickPrefix,
    templateUrl: fav.templateUrl,
    createdAt: fav.createdAt,
    movedOutAt: now,
    originStatus,
    originTriageAt:
      typeof originTriageAt === 'number' && Number.isFinite(originTriageAt) ? originTriageAt : undefined,
  }
  const rest = list.filter((i) => i.siteId !== fav.siteId)
  return [item, ...rest]
}

/** 取出一条：返回剩下的列表与被取出的条目（没有则 restored 为 null，列表原样返回）。 */
export function unshelveItems(
  list: ShelvedFavoriteItem[],
  siteId: string,
): { items: ShelvedFavoriteItem[]; restored: ShelvedFavoriteItem | null } {
  const restored = list.find((i) => i.siteId === siteId) ?? null
  if (!restored) return { items: list, restored: null }
  return { items: list.filter((i) => i.siteId !== siteId), restored }
}

/** 读本机已移出列表（服务端渲染 / 存储不可用时按空列表，不抛）。 */
export function readShelvedFavorites(): ShelvedFavoriteItem[] {
  try {
    if (typeof window === 'undefined') return []
    return parseShelved(window.localStorage.getItem(SHELVED_FAVORITES_KEY))
  } catch {
    return []
  }
}

/** 写本机已移出列表：写不进去返回 false（调用方据此提示，不静默丢移出记录）。 */
export function writeShelvedFavorites(items: ShelvedFavoriteItem[]): boolean {
  try {
    if (typeof window === 'undefined') return false
    window.localStorage.setItem(SHELVED_FAVORITES_KEY, serializeShelved(items))
    return true
  } catch {
    return false
  }
}
