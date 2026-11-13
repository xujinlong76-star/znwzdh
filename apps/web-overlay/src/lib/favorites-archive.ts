/**
 * 收藏归档：本机私有的一只「冷藏柜」。
 *
 * 「归档」≠「删除」：归档是把收藏从活跃列表拿掉、留一份可恢复的副本；
 * 删除是不留副本。归档只保存在本机（localStorage），不参与云端同步——
 * 云端收藏是事实源，归档是本机整理动作；归档后下一次同步会把云端对应
 * 条目也删掉（走 remove 的同一条路），恢复时再由 importJson 重新推上去。
 *
 * 纯函数（parse / 归档 / 取出）与存储读写分开：规则可以直接钉进测试。
 */

/** 归档列表的存储键。独立键，不与收藏本体混在一起（坏了只丢归档，不丢收藏）。 */
export const ARCHIVED_FAVORITES_KEY = 'navhub.favorites.archived.v1'

export interface ArchivedFavoriteItem {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  /** 备注：归档不能把它洗掉，恢复时要原样带回收藏 */
  note?: string
  /** 标签：同上，恢复时原样带回 */
  tags?: string[]
  /** 所属收藏夹 id：同上，恢复时原样带回（null = 未分夹） */
  folderId?: string | null
  createdAt: number
  /** 归档时刻（毫秒）：恢复列表按它倒序排 */
  archivedAt: number
}

export interface ArchivableFavoriteLike {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  note?: string
  tags?: string[]
  folderId?: string | null
  createdAt: number
}

function isArchivedItem(value: unknown): value is ArchivedFavoriteItem {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.siteId === 'string' &&
    v.siteId !== '' &&
    typeof v.title === 'string' &&
    typeof v.href === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.archivedAt === 'number'
  )
}

/** 解析归档原始字符串：坏 JSON / 结构不对一律按空列表（归档丢了可重建，绝不抛）。 */
export function parseArchived(raw: string | null | undefined): ArchivedFavoriteItem[] {
  if (raw === null || raw === undefined || raw === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<string>()
  const items: ArchivedFavoriteItem[] = []
  for (const entry of parsed) {
    if (!isArchivedItem(entry) || seen.has(entry.siteId)) continue
    seen.add(entry.siteId)
    // 备注 / 标签 / 收藏夹：只认形状对的值，脏数据丢字段不丢整条
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
      createdAt: entry.createdAt,
      archivedAt: entry.archivedAt,
    })
  }
  return items
}

export function serializeArchived(items: ArchivedFavoriteItem[]): string {
  return JSON.stringify(items)
}

/** 归档一条：已归档过的同站只刷新 archivedAt，不重复占位；新归档的放最前。 */
export function archiveItems(
  list: ArchivedFavoriteItem[],
  fav: ArchivableFavoriteLike,
  now: number,
): ArchivedFavoriteItem[] {
  const item: ArchivedFavoriteItem = {
    siteId: fav.siteId,
    title: fav.title,
    href: fav.href,
    icon: fav.icon,
    description: fav.description,
    note: fav.note,
    tags: fav.tags,
    folderId: fav.folderId,
    createdAt: fav.createdAt,
    archivedAt: now,
  }
  const rest = list.filter((i) => i.siteId !== fav.siteId)
  return [item, ...rest]
}

/** 取出一条：返回剩下的列表与被取出的条目（没有则 restored 为 null）。 */
export function unarchiveItems(
  list: ArchivedFavoriteItem[],
  siteId: string,
): { items: ArchivedFavoriteItem[]; restored: ArchivedFavoriteItem | null } {
  const restored = list.find((i) => i.siteId === siteId) ?? null
  if (!restored) return { items: list, restored: null }
  return { items: list.filter((i) => i.siteId !== siteId), restored }
}

/** 读本机归档列表（服务端渲染 / 存储不可用时按空列表，不抛）。 */
export function readArchivedFavorites(): ArchivedFavoriteItem[] {
  try {
    if (typeof window === 'undefined') return []
    return parseArchived(window.localStorage.getItem(ARCHIVED_FAVORITES_KEY))
  } catch {
    return []
  }
}

/** 写本机归档列表：写不进去返回 false（调用方据此提示，不静默丢归档）。 */
export function writeArchivedFavorites(items: ArchivedFavoriteItem[]): boolean {
  try {
    if (typeof window === 'undefined') return false
    window.localStorage.setItem(ARCHIVED_FAVORITES_KEY, serializeArchived(items))
    return true
  } catch {
    return false
  }
}
