/**
 * 收藏回收站（第 2 层：30 天持久快照）。
 *
 * 与归档柜（lib/favorites-archive.ts）同模式、另起一键：归档是「冷藏」，
 * 回收站是「删除的后悔药」，不要把两个列表混成一个。
 *
 *  - 本地键 navhub.favorites.trash.v1，{ items, folders }；
 *  - 云端回收站就是 favorites.deleted_at 墓碑（不新增表），恢复 = add 复活；
 *  - 删除与写回收站同一次 persist 语义内完成：先改 navhub.favorites.v1，
 *    persist 成功后再把快照推进回收站键；写回收站失败（配额满）时删除仍执行，
 *    但要把失败报出来（调用方经 trashError / 事件露出），且该条只能靠
 *    云端墓碑恢复——文案需诚实；
 *  - 损坏处理与收藏本体同口径：坏 JSON 按空列表并隔离到
 *    navhub.favorites.trash.v1.corrupt.<ts>，绝不因此拦收藏写入。
 */

import { corruptKeyFor } from './favorites-storage'

/** 回收站的存储键。独立键，不与收藏本体混在一起（坏了只丢回收站，不丢收藏）。 */
export const FAVORITES_TRASH_STORAGE_KEY = 'navhub.favorites.trash.v1'

/** 保留期：30 天（D6：到期物理清理 v1 不做——这里只剪本地视图，不删云端墓碑） */
export const FAVORITES_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** 上限 500 条（D5）：超了最旧的先被剪掉 */
export const FAVORITES_TRASH_MAX_ITEMS = 500

export type TrashSource = 'single' | 'batch' | 'clear' | 'stale' | 'archive'

/** 回收站里的收藏：LocalFavorite 全字段 + 删除时刻/批次/来源 + 删除前原位 */
export interface TrashedFavorite {
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
  quickPrefix?: string
  templateUrl?: string
  triageStatus?: 'inbox' | 'read' | 'permanent'
  triageAt?: number
  /** 删除时刻（毫秒） */
  deletedAt: number
  /** 同一批删除共享 batchId */
  batchId: string
  source: TrashSource
  /** 删除前在收藏列表里的下标：恢复要插回原位，不能只 unshift */
  index?: number
  /** 原收藏夹名（恢复页展示用；夹子本身可能已不在） */
  folderName?: string | null
}

/** 回收站里的收藏夹：删夹时把夹 + 成员 siteId 列表一起快照 */
export interface TrashedFolder {
  id: string
  name: string
  sort: number
  createdAt: number
  deletedAt: number
  batchId: string
  memberSiteIds: string[]
}

export interface FavoritesTrashState {
  items: TrashedFavorite[]
  folders: TrashedFolder[]
}

export const EMPTY_TRASH_STATE: FavoritesTrashState = { items: [], folders: [] }

export function trashExpiresAt(deletedAt: number): number {
  return deletedAt + FAVORITES_TRASH_RETENTION_MS
}

/** 剩余天数文案："还剩 12 天" / "今天到期" / "已过期" */
export function formatTrashRemaining(deletedAt: number, now: number = Date.now()): string {
  const msLeft = trashExpiresAt(deletedAt) - now
  if (msLeft <= 0) return '已过期'
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000))
  if (daysLeft <= 1) return '今天到期'
  return `还剩 ${daysLeft} 天`
}

function isTrashedItem(value: unknown): value is TrashedFavorite {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.siteId === 'string' &&
    v.siteId !== '' &&
    typeof v.title === 'string' &&
    typeof v.href === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.deletedAt === 'number' &&
    typeof v.batchId === 'string'
  )
}

function isTrashedFolder(value: unknown): value is TrashedFolder {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    v.id !== '' &&
    typeof v.name === 'string' &&
    typeof v.deletedAt === 'number' &&
    typeof v.batchId === 'string' &&
    Array.isArray(v.memberSiteIds)
  )
}

function normalizeTrashedItem(entry: TrashedFavorite): TrashedFavorite {
  const tags = Array.isArray(entry.tags)
    ? entry.tags.filter((t): t is string => typeof t === 'string')
    : []
  return {
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
    lastOpenedAt: typeof entry.lastOpenedAt === 'number' ? entry.lastOpenedAt : undefined,
    quickPrefix: typeof entry.quickPrefix === 'string' ? entry.quickPrefix : undefined,
    templateUrl: typeof entry.templateUrl === 'string' ? entry.templateUrl : undefined,
    // 分流字段必须透传：经回收站恢复的 inbox/read 收藏要回到原状态；
    // 丢了它们，恢复时 resolveTriageStatus 会按祖父规则落为 permanent，
    // 24 小时待读状态就悄悄没了。非法值按缺字段处理（undefined → permanent）。
    triageStatus:
      entry.triageStatus === 'inbox' ||
      entry.triageStatus === 'read' ||
      entry.triageStatus === 'permanent'
        ? entry.triageStatus
        : undefined,
    triageAt: typeof entry.triageAt === 'number' ? entry.triageAt : undefined,
    deletedAt: entry.deletedAt,
    batchId: entry.batchId,
    source:
      entry.source === 'single' ||
      entry.source === 'batch' ||
      entry.source === 'clear' ||
      entry.source === 'stale' ||
      entry.source === 'archive'
        ? entry.source
        : 'single',
    index: typeof entry.index === 'number' ? entry.index : undefined,
    folderName: typeof entry.folderName === 'string' ? entry.folderName : undefined,
  }
}

/**
 * 解析回收站原始字符串：坏 JSON / 结构不对一律按空列表（绝不抛）。
 * 损坏隔离由调用方（readTrash 的坏 JSON 分支）另行处理，这里只做纯解析。
 */
export function parseTrash(raw: string | null | undefined): FavoritesTrashState {
  if (raw === null || raw === undefined || raw === '') return { items: [], folders: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { items: [], folders: [] }
  }
  // 旧形状兼容：纯数组 = 只有 items 的回收站
  if (Array.isArray(parsed)) {
    const items: TrashedFavorite[] = []
    const seen = new Set<string>()
    for (const entry of parsed) {
      if (!isTrashedItem(entry) || seen.has(entry.siteId)) continue
      seen.add(entry.siteId)
      items.push(normalizeTrashedItem(entry))
    }
    return { items, folders: [] }
  }
  if (!parsed || typeof parsed !== 'object') return { items: [], folders: [] }
  const rawState = parsed as { items?: unknown; folders?: unknown }
  const items: TrashedFavorite[] = []
  const seen = new Set<string>()
  if (Array.isArray(rawState.items)) {
    for (const entry of rawState.items) {
      if (!isTrashedItem(entry) || seen.has(entry.siteId)) continue
      seen.add(entry.siteId)
      items.push(normalizeTrashedItem(entry))
    }
  }
  const folders: TrashedFolder[] = []
  if (Array.isArray(rawState.folders)) {
    for (const entry of rawState.folders) {
      if (!isTrashedFolder(entry)) continue
      folders.push({
        id: entry.id,
        name: entry.name,
        sort: typeof entry.sort === 'number' ? entry.sort : 0,
        createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0,
        deletedAt: entry.deletedAt,
        batchId: entry.batchId,
        memberSiteIds: entry.memberSiteIds.filter((s): s is string => typeof s === 'string'),
      })
    }
  }
  return { items, folders }
}

export function serializeTrash(state: FavoritesTrashState): string {
  return JSON.stringify(state)
}

/**
 * 把一批收藏推进回收站：同站只留最新一份（刷新 deletedAt），新删的放最前。
 * 超 FAVORITES_TRASH_MAX_ITEMS 时最旧的先被剪掉。
 */
export function addToTrash(
  state: FavoritesTrashState,
  items: Array<Omit<TrashedFavorite, 'deletedAt' | 'batchId' | 'source'> & { source?: TrashSource }>,
  batchId: string,
  now: number = Date.now(),
  source: TrashSource = 'single',
): FavoritesTrashState {
  const next: TrashedFavorite[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.siteId)) continue
    seen.add(item.siteId)
    next.push(normalizeTrashedItem({ ...item, deletedAt: now, batchId, source: item.source ?? source }))
  }
  const rest = state.items.filter((i) => !seen.has(i.siteId))
  const merged = [...next, ...rest]
  return {
    items: merged.slice(0, FAVORITES_TRASH_MAX_ITEMS),
    folders: state.folders,
  }
}

/** 把一个收藏夹推进回收站（删夹时快照夹 + 成员列表） */
export function addFolderToTrash(
  state: FavoritesTrashState,
  folder: Omit<TrashedFolder, 'deletedAt' | 'batchId'>,
  batchId: string,
  now: number = Date.now(),
): FavoritesTrashState {
  const next: TrashedFolder = { ...folder, deletedAt: now, batchId }
  return {
    items: state.items,
    folders: [next, ...state.folders.filter((f) => f.id !== folder.id)],
  }
}

/** 取出一条：返回剩下的状态与被取出的条目（没有则 restored 为 null） */
export function removeFromTrash(
  state: FavoritesTrashState,
  siteId: string,
): { state: FavoritesTrashState; restored: TrashedFavorite | null } {
  const restored = state.items.find((i) => i.siteId === siteId) ?? null
  if (!restored) return { state, restored: null }
  return {
    state: { items: state.items.filter((i) => i.siteId !== siteId), folders: state.folders },
    restored,
  }
}

/** 取出一个夹子快照 */
export function removeFolderFromTrash(
  state: FavoritesTrashState,
  folderId: string,
): { state: FavoritesTrashState; restored: TrashedFolder | null } {
  const restored = state.folders.find((f) => f.id === folderId) ?? null
  if (!restored) return { state, restored: null }
  return {
    state: { items: state.items, folders: state.folders.filter((f) => f.id !== folderId) },
    restored,
  }
}

/**
 * 剪掉过期条目（恰好 30 天 = 过期：deletedAt + 30d <= now 即剪）。
 * 只剪本地视图；云端墓碑的物理清理 v1 不做（D6，需 Ryan 明确点头）。
 */
export function pruneExpiredTrash(
  state: FavoritesTrashState,
  now: number = Date.now(),
): FavoritesTrashState {
  return {
    items: state.items.filter((i) => trashExpiresAt(i.deletedAt) > now),
    folders: state.folders.filter((f) => trashExpiresAt(f.deletedAt) > now),
  }
}

/**
 * 按原位插回：把 [{item, index}] 插回列表（index 是删除前下标）。
 *  - 已在列表里的 siteId 跳过（幂等：重复恢复不插重）；
 *  - index 越界钳制到末尾；
 *  - 多条按 index 升序插，恢复后顺序与删除前一致。
 */
export function insertRestoredFavorites<T extends { siteId: string }>(
  current: T[],
  removed: Array<{ item: T; index: number }>,
): T[] {
  const present = new Set(current.map((i) => i.siteId))
  const next = [...current]
  const sorted = [...removed]
    .filter((r) => !present.has(r.item.siteId))
    .sort((a, b) => a.index - b.index)
  for (const { item, index } of sorted) {
    const at = Math.max(0, Math.min(index, next.length))
    next.splice(at, 0, item)
    present.add(item.siteId)
  }
  return next
}

/** 读本机回收站（SSR / 存储不可用时按空列表，不抛；坏 JSON 隔离到 .corrupt 键） */
export function readTrash(): FavoritesTrashState {
  try {
    if (typeof window === 'undefined') return { items: [], folders: [] }
    const raw = window.localStorage.getItem(FAVORITES_TRASH_STORAGE_KEY)
    if (raw !== null && raw !== '') {
      try {
        JSON.parse(raw)
      } catch {
        // 坏 JSON：按空列表 + 隔离原文，绝不因此拦收藏写入
        try {
          window.localStorage.setItem(corruptKeyFor(FAVORITES_TRASH_STORAGE_KEY, Date.now()), raw)
        } catch {
          // 隔离写不进去也不拦：回收站本身已按空处理
        }
      }
    }
    return parseTrash(raw)
  } catch {
    return { items: [], folders: [] }
  }
}

/** 写本机回收站：写不进去返回 false（调用方据此提示，不静默丢快照） */
export function writeTrash(state: FavoritesTrashState): boolean {
  try {
    if (typeof window === 'undefined') return false
    window.localStorage.setItem(FAVORITES_TRASH_STORAGE_KEY, serializeTrash(state))
    dispatchTrashUpdated()
    return true
  } catch {
    return false
  }
}

/** 回收站有变化时通知订阅它的页面（收藏页角标、回收站页）刷新 */
export function dispatchTrashUpdated(): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('navhub_trash_updated'))
  } catch {
    // 事件派发失败不阻断写入本身
  }
}
