'use client'

/**
 * 收藏夹 v1：localStorage 优先，不依赖登录。
 *
 * 演进路径（Phase 2 已就绪的服务端）：登录后把本地收藏合并到云端
 * （POST /api/favorites），之后以云端为准、本地只作离线缓存。
 * 合并策略：按 siteId 取并集，createdAt 新者胜。
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  addFavorite,
  listFavorites,
  removeFavorite,
  syncFavoritesBatch,
  type FavoriteSyncOp,
  type HubFavorite,
  type HubFavoriteFolder,
  type HubFavoriteSyncItem,
  type HubFavoritesSyncPayload,
} from '@/lib/navhub-api'
import { describeDegrade } from '@/lib/degrade'
import { mergeCloudFavorites } from '@/lib/favorites-merge'
import { getIdentity } from '@/lib/identity'
import {
  FAVORITES_STORAGE_KEY,
  corruptBackupKey,
  describeCorruptFavorites,
  parseFavorites,
} from '@/lib/favorites-storage'

const KEY = FAVORITES_STORAGE_KEY

export interface LocalFavorite {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  note?: string
  /** 标签（T22）：≤8 个、各 ≤24 字符（写入端截断归一）；undefined = 未打标签 */
  tags?: string[]
  /** 云端收藏夹 id（匿名/离线时为空，登录后由云端元数据合并） */
  folderId?: string | null
  createdAt: number
}

/**
 * 读本地收藏。**必须把「读不出来」和「没有数据」分开**：
 * 以前的 `catch { return [] }` 让「存储坏了」和「还没收藏过」看起来一模一样，
 * 紧接着任何一次写入就会把用户的收藏覆盖成一条新记录。
 */
function loadLocal(): { items: LocalFavorite[]; blocked: string | null } {
  if (typeof window === 'undefined') return { items: [], blocked: null }
  let raw: string | null
  try {
    raw = window.localStorage.getItem(KEY)
  } catch {
    // 连读都不让读（隐私模式 / 权限被拒）：同样不能拿空列表去覆盖，
    // 但要说清楚是「存储不可用」，而不是「数据损坏」
    return {
      items: [],
      blocked: '浏览器不允许读写本地存储（隐私模式或权限被拒），本次收藏改动无法保存。',
    }
  }
  const { items, corrupt } = parseFavorites<LocalFavorite>(raw)
  return { items, blocked: corrupt ? describeCorruptFavorites() : null }
}

function saveLocal(items: LocalFavorite[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    // 存储满 / 隐私模式：内存态仍然有效，刷新丢失
  }
}

export interface FavoritesApi {
  items: LocalFavorite[]
  ready: boolean
  /**
   * 非 null 时表示**存储读不出来**：此时所有写入都会被拒绝（原样保留坏数据，
   * 等着用户决定是备份重置还是另作处理）。界面必须把这句话显示出来，
   * 否则用户点收藏会「没反应」—— 那比原来的静默覆盖更让人困惑。
   */
  storageBlocked: string | null
  isFavorite: (siteId: string) => boolean
  toggle: (site: Omit<LocalFavorite, 'createdAt'>) => Promise<boolean>
  remove: (siteId: string) => void
  /** 收藏管理：更新本地缓存的文件夹/备注（云端写入由调用方 best-effort 处理） */
  updateMeta: (siteId: string, patch: { folderId?: string | null; note?: string | null; tags?: string[] | null }) => boolean
  /** 删除收藏夹后批量置空 folderId（一次持久化 + 一次脏标记，T16） */
  clearFolderForItems: (siteIds: string[]) => boolean
  /** 登录同步成功后用云端列表整体替换本地（云端是事实源，避免删除被本地缓存复活） */
  replaceAll: (items: LocalFavorite[]) => boolean
  clear: () => void
  /**
   * 用户显式重置：先把读不出来的原数据备份到隔离键，再写空列表。
   * 返回值说明备份到底成没成 —— 调用方要照着它措辞，不能一律说「已备份」
   * （配额满时原数据其实没留住，那句承诺会让用户以为还能找回）。
   */
  resetLocal: () => { backedUp: boolean }
  exportJson: () => string
  /**
   * `skippedInvalid`：被过滤掉的格式不完整条目数（缺 siteId/href）。
   * 调用方必须把它报出来——否则「已导入 N 条」会把静默丢弃说成完整成功。
   */
  importJson: (json: string) => { ok: boolean; imported: number; skippedInvalid: number; error?: string }
}

/* ---------------------------- 模块级共享状态 ---------------------------- */

type FavoritesSnapshot = { items: LocalFavorite[]; blocked: string | null }

let sharedFavorites: LocalFavorite[] = []
let sharedBlocked: string | null = null
let favoritesSnapshot: FavoritesSnapshot = { items: sharedFavorites, blocked: sharedBlocked }
let favoritesInitialized = false
const favoritesListeners = new Set<() => void>()

/**
 * 唯一写入口：更新模块状态并同步通知所有订阅实例。
 * snapshot 必须换新引用，useSyncExternalStore 才会判定为变更。
 */
function applyLocalFavorites(next: { items: LocalFavorite[]; blocked: string | null }) {
  sharedFavorites = next.items
  sharedBlocked = next.blocked
  favoritesSnapshot = { items: next.items, blocked: next.blocked }
  for (const listener of favoritesListeners) listener()
}

function subscribeFavorites(listener: () => void): () => void {
  favoritesListeners.add(listener)
  return () => {
    favoritesListeners.delete(listener)
  }
}

function getFavoritesSnapshot(): FavoritesSnapshot {
  return favoritesSnapshot
}

export function useFavorites(): FavoritesApi {
  /**
   * 模块级共享状态（useSyncExternalStore）。
   *
   * 为什么不再用每实例 useState：同文档内的 `storage` 事件不会触发（浏览器规范），
   * 而 `persist` 原先也不派发任何事件——收藏页里每张卡的 <FavoriteButton> 是
   * 独立实例，点星取消收藏后卡片不消失、筛选计数不同步，只能刷新页面。
   * 现在所有实例订阅同一份模块状态，任何一次写入都通知全体重渲染。
   */
  const snap = useSyncExternalStore(subscribeFavorites, getFavoritesSnapshot, getFavoritesSnapshot)
  const { items, blocked: storageBlocked } = snap
  const [ready, setReady] = useState(() => favoritesInitialized)

  useEffect(() => {
    if (!favoritesInitialized) {
      favoritesInitialized = true
      applyLocalFavorites(loadLocal())
    }
    setReady(true)
    const refresh = () => applyLocalFavorites(loadLocal())
    window.addEventListener('navhub_workbench_updated', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('navhub_workbench_updated', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const persist = useCallback(
    (next: LocalFavorite[]) => {
      // 读不出来就不写：宁可这次改动不生效，也不能覆盖掉用户原有的收藏
      if (storageBlocked) return false
      applyLocalFavorites({ items: next, blocked: storageBlocked })
      saveLocal(next)
      return true
    },
    [storageBlocked],
  )

  /** 用户显式重置：原数据先备份到 `.corrupt.<时间戳>`，再落到空列表 */
  const resetLocal = useCallback((): { backedUp: boolean } => {
    let backedUp = false
    try {
      const raw = window.localStorage.getItem(KEY)
      if (raw) {
        const backupKey = corruptBackupKey(Date.now())
        window.localStorage.setItem(backupKey, raw)
        // 回读比对：setItem 在配额满时会抛（或静默失败），只按“调用过了”就宣称已备份，
        // 就是替用户把一个找不回数据的决定说成安全的。
        backedUp = window.localStorage.getItem(backupKey) === raw
      } else {
        // 本来就没有原文（存储里是空的）：没什么可备份的，重置依然是安全的
        backedUp = true
      }
    } catch {
      backedUp = false
    }
    // 重置意味着本地记录被丢弃：游标也必须一起清，否则下次增量会从「旧水位」
    // 开始，被清空的那段云端数据永远拉不回来（重拉全量是幂等的）。
    try {
      const identity = getIdentity()
      if (identity) window.localStorage.removeItem(SYNC_CURSOR_PREFIX + identity)
    } catch {
      // 清不掉游标不阻断重置；下次成功同步时会被新版本覆盖
    }
    applyLocalFavorites({ items: [], blocked: null })
    saveLocal([])
    // 重置 = 本地记录整体丢弃：脏标记一起清（游标上面已经清了，下次同步重拉全量，
    // 拉回来的内容就是云端事实源，没有「待推」可言）
    clearDirty()
    return { backedUp }
  }, [])

  const isFavorite = useCallback((siteId: string) => items.some((i) => i.siteId === siteId), [items])

  /** 切换收藏状态，返回切换后是否已收藏 */
  const toggle = useCallback(async (site: Omit<LocalFavorite, 'createdAt'>): Promise<boolean> => {
    // 读共享状态（同步更新，包含本帧内已发生的写入），避免快速双击时两次都读到旧状态
    const current = sharedFavorites
    const existed = current.some((i) => i.siteId === site.siteId)
    const next = existed
      ? current.filter((i) => i.siteId !== site.siteId)
      : [{ ...site, createdAt: Date.now() }, ...current]
    // 写不进去就返回未改变的状态：调用方据此提示，界面不会出现「点了但没变化」
    if (!persist(next)) return existed

    // 新增与取消都是待推变更：新增在本地列表里（同步推 add），
    // 取消后已不在本地列表（同步推 remove）——同一条置脏路径覆盖两种 op
    markDirty([site.siteId])

    // 异步尝试同步到云端（失败不影响本地态——离线优先）
    const identity = getIdentity()
    if (identity) {
      if (existed) await removeFavorite(identity, site.siteId)
      else await addFavorite(identity, site.siteId)
    }
    return !existed
  }, [persist])

  const remove = useCallback((siteId: string) => {
    if (!persist(sharedFavorites.filter((i) => i.siteId !== siteId))) return
    // 本地已删：siteId 留在脏集合里、已不在本地列表，同步时生成 remove op 让云端也删
    markDirty([siteId])
    const identity = getIdentity()
    if (identity) void removeFavorite(identity, siteId)
  }, [persist])

  const updateMeta = useCallback((siteId: string, patch: { folderId?: string | null; note?: string | null; tags?: string[] | null }) => {
    const current = sharedFavorites
    if (!current.some((i) => i.siteId === siteId)) return false
    const next = current.map((i) => {
      if (i.siteId !== siteId) return i
      const merged: LocalFavorite = { ...i }
      if (patch.folderId !== undefined) merged.folderId = patch.folderId
      // note 允许显式传 null（清空备注），落盘统一成 undefined 保持旧数据形状；
      // ≤200 字是云端契约，超长在写入端就截断（输入框另有 maxLength 双保险）
      if (patch.note !== undefined) {
        const note = patch.note ?? undefined
        merged.note = note && note.length > 200 ? note.slice(0, 200) : note
      }
      // 标签（T22）：null = 清除；数组做与云端同口径的归一（≤8 个、各 ≤24 字符、去重）
      if (patch.tags !== undefined) {
        const tags = patch.tags ?? undefined
        if (!tags || tags.length === 0) {
          merged.tags = undefined
        } else {
          const seen = new Set<string>()
          for (const raw of tags) {
            if (typeof raw !== 'string') continue
            const tag = raw.trim().slice(0, 24)
            if (!tag) continue
            seen.add(tag)
            if (seen.size >= 8) break
          }
          merged.tags = seen.size > 0 ? [...seen] : undefined
        }
      }
      return merged
    })
    const ok = persist(next)
    // 文件夹 / 备注也是待推变更：页面会 best-effort 直连云端，失败时批量同步是兜底通道
    if (ok) markDirty([siteId])
    return ok
  }, [persist])

  /**
   * 删除收藏夹后批量置空 folderId（T16）：一次 persist + 一次脏标记，
   * 替代此前「逐条 updateMeta」的 N 次全量序列化（每次 persist 都把整份收藏
   * 重新写一遍 localStorage，条数多时是 O(N²) 字节写入）。
   */
  const clearFolderForItems = useCallback((siteIds: string[]): boolean => {
    const ids = new Set(siteIds)
    const next = sharedFavorites.map((i) => (ids.has(i.siteId) ? { ...i, folderId: null } : i))
    const ok = persist(next)
    if (ok && ids.size > 0) markDirty([...ids])
    return ok
  }, [persist])

  const replaceAll = useCallback((next: LocalFavorite[]) => {
    // replaceAll 的入参来自云端同步结果（或用户显式整体替换）：本地整体已被
    // 「云端版本」取代，不存在待云端确认的变更——清空全部脏标记，
    // 否则下次同步会把刚确认的内容原样推回去（LWW 虽会跳过，但 ops 白跑）
    const ok = persist(next)
    if (ok) clearDirty()
    return ok
  }, [persist])

  const clear = useCallback(() => {
    // 与 replaceAll 的区别：clear 是「收藏被清空」，云端也必须删掉。
    // 把当前所有 siteId 置脏——它们随即不在本地列表，同步时走 remove ops
    // （与 toggle 取消收藏同一条路径）。先取到列表再 persist，否则读到的是空数组。
    const siteIds = sharedFavorites.map((i) => i.siteId)
    // persist 成功才置脏：写不进说明本地没变，此时推 remove 会把云端收藏误删
    if (persist([])) markDirty(siteIds)
  }, [persist])

  const exportJson = useCallback(() => JSON.stringify({ version: 1, items: sharedFavorites }, null, 2), [])

  const importJson = useCallback((json: string) => {
    // 存储读不出来时导入同样是写入：先拦住，并把原因作为错误返回（页面会显示）
    if (storageBlocked) return { ok: false, imported: 0, skippedInvalid: 0, error: storageBlocked }
    try {
      const parsed = JSON.parse(json)
      const incoming: LocalFavorite[] = Array.isArray(parsed) ? parsed : parsed?.items
      if (!Array.isArray(incoming)) return { ok: false, imported: 0, skippedInvalid: 0, error: '格式不正确' }
      const accepted = incoming.filter((i) => i && typeof i.siteId === 'string' && typeof i.href === 'string')
      const skippedInvalid = incoming.length - accepted.length
      const valid = accepted
        // note 契约 ≤200 字（云端与服务端 zod 同口径）：导入文件可能带更长的
        // 历史备注，落库前截断，避免同步时才被服务端兜底截断造成两端不一致。
        // 显式标注返回类型：否则 map 出来的对象把 note 变成「必填的 string|undefined」，
        // 下面 merge 云端条目（note 可选）时就对不上类型了。
        // 标签（T22）：导入文件可能带超限标签，落库前归一（≤8 个、各 ≤24 字符）
        .map((i): LocalFavorite => {
          const note = typeof i.note === 'string' && i.note.length > 200 ? i.note.slice(0, 200) : i.note
          if (!Array.isArray(i.tags) || i.tags.length === 0) return { ...i, note, tags: undefined }
          const seen = new Set<string>()
          for (const raw of i.tags) {
            if (typeof raw !== 'string') continue
            const tag = raw.trim().slice(0, 24)
            if (!tag) continue
            seen.add(tag)
            if (seen.size >= 8) break
          }
          return { ...i, note, tags: seen.size > 0 ? [...seen] : undefined }
        })
      const merged = [...valid]
      for (const ex of sharedFavorites) {
        if (!merged.some((i) => i.siteId === ex.siteId)) merged.push(ex)
      }
      persist(merged)
      // 导入进来的条目都是待推变更：云端多半没有它们（换设备导入的场景），
      // 或本地这份是更新版——不进脏集合的话同步永远不会推
      markDirty(valid.map((i) => i.siteId))
      return { ok: true, imported: valid.length, skippedInvalid }
    } catch (err) {
      return { ok: false, imported: 0, skippedInvalid: 0, error: err instanceof Error ? err.message : '解析失败' }
    }
  }, [persist, storageBlocked])

  return { items, ready, storageBlocked, isFavorite, toggle, remove, updateMeta, clearFolderForItems, replaceAll, clear, resetLocal, exportJson, importJson }
}

/** 同步游标：仅记录「一次成功同步之后」的版本，失败时绝不推进 */
const SYNC_CURSOR_PREFIX = 'navhub.favorites.sync.v1.'

/** 最近一次同步结果（只写不删：用户能看到「上次同步是什么时候、成没成」） */
const SYNC_STATUS_KEY = 'navhub.favorites.sync.last'

export interface FavoritesSyncStatus {
  at: number
  ok: boolean
  pushed: number
  remoteRemoved: number
  error?: string
}

function writeSyncStatus(status: FavoritesSyncStatus): void {
  try {
    window.localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status))
  } catch {
    // 写不进状态只是少一行提示，不影响同步本身
  }
}

export function readSyncStatus(): FavoritesSyncStatus | null {
  try {
    const raw = window.localStorage.getItem(SYNC_STATUS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<FavoritesSyncStatus>
    return {
      at: Number(parsed.at) || 0,
      ok: Boolean(parsed.ok),
      pushed: Number(parsed.pushed) || 0,
      remoteRemoved: Number(parsed.remoteRemoved) || 0,
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
    }
  } catch {
    return null
  }
}

/**
 * 脏标记（M1 三期「只推脏条目」）：本地变更过、云端还没确认的 siteId 集合。
 *
 * 为什么需要它：批量同步早期把「本地全量」当 ops 重发，服务端 LWW 会跳过绝大多数
 * ——正确但不经济（收藏 500 条就是 500 个 ops/次）。现在只推脏集合：
 * 变更点（toggle / remove / updateMeta / importJson / clear）置脏，
 * 一次成功同步后全部确认（清脏），失败则保留（下次重试仍会推）。
 */
const DIRTY_KEY = 'navhub.favorites.dirty.v1'

/**
 * 内存里持一份脏集合，避免每次同步都读 localStorage。
 * 写入一定双写（内存 + 存储）；「重新挂载」（刷新页面 / 新标签页）时内存丢失，
 * 从 localStorage 恢复——只要标记还在，下次同步仍会推这些条目。
 */
let memoryDirty: Set<string> | null = null

/** 读脏集合：内存优先，未加载过才落 localStorage。读失败按空集合（下次多推几条，不影响正确性） */
function readDirty(): Set<string> {
  if (memoryDirty) return memoryDirty
  let ids: string[] = []
  try {
    const raw = window.localStorage.getItem(DIRTY_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string')
    }
  } catch {
    // 读不出（隐私模式 / 数据坏了）就当没有待推条目：最坏结果是下次同步少推几条，
    // 而「读失败」与「没有数据」的区分由收藏本体的 loadLocal 负责，这里不需要拦
    ids = []
  }
  memoryDirty = new Set(ids)
  return memoryDirty
}

/** 写脏集合：内存 + localStorage 双写。存储写不进只是下次多推几条，不影响正确性 */
function writeDirty(ids: Set<string>): void {
  memoryDirty = new Set(ids)
  try {
    window.localStorage.setItem(DIRTY_KEY, JSON.stringify([...memoryDirty]))
  } catch {
    // 配额满 / 隐私模式：内存态仍然生效（本次会话内的同步逻辑照常工作），
    // 刷新后标记丢失——代价是下次多推几条全量，不会推错
  }
}

/** 把一批 siteId 置脏（新增待推变更） */
/** 脏键是否曾被写过（一次性迁移判定：从未写过 = 机制上线前的存量本地收藏） */
function dirtyKeyEverWritten(): boolean {
  try {
    return window.localStorage.getItem(DIRTY_KEY) !== null
  } catch {
    // 读不到就当写过：不触发全量迁移（存储不可用时同步本来也走不远）
    return true
  }
}

function markDirty(siteIds: string[]): void {
  if (siteIds.length === 0) return
  const next = readDirty()
  for (const id of siteIds) next.add(id)
  writeDirty(next)
}

/**
 * 清除脏标记：不传 ids = 全部确认（一次成功同步后调用）；
 * 传 ids = 只确认这几条（当前没有调用方按条清，保留给将来的按条确认）。
 */
function clearDirty(ids?: string[]): void {
  const current = readDirty()
  if (!ids) {
    writeDirty(new Set<string>())
    return
  }
  if (ids.length === 0) return
  for (const id of ids) current.delete(id)
  writeDirty(current)
}

/** 批量同步有限重试：只对可重试错误退避（300ms / 900ms），404 之类不重试 */
async function syncBatchWithRetry(
  ops: FavoriteSyncOp[],
  since: number,
  onFail: (error: unknown) => void,
): Promise<HubFavoritesSyncPayload | null> {
  let retryable = false
  const mark = (error: unknown) => {
    onFail(error)
    retryable = describeDegrade(error, '云端收藏').retryable
  }
  const first = await syncFavoritesBatch(ops, since, mark)
  if (first) return first
  for (const delay of [300, 900]) {
    if (!retryable) return null
    await new Promise((resolve) => setTimeout(resolve, delay))
    const retried = await syncFavoritesBatch(ops, since, mark)
    if (retried) return retried
  }
  return null
}

function readSyncCursor(identity: string): number {
  try {
    const raw = window.localStorage.getItem(SYNC_CURSOR_PREFIX + identity)
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    // 读不到游标就按 0（全量）处理：宁可多拉一次全集，也不能跳过增量
    return 0
  }
}

function writeSyncCursor(identity: string, version: number): void {
  if (!(version > 0)) return
  try {
    window.localStorage.setItem(SYNC_CURSOR_PREFIX + identity, String(version))
  } catch {
    // 写不进游标不影响本次结果，只是下次仍走全量（全量是幂等的）
  }
}

/**
 * 增量应用（M1）：服务端返回「自 since 以来变化的行，含墓碑」。
 *
 * 与 mergeCloudFavorites 的关键差别：后者是「云端全集覆盖本地」，用在增量上
 * 会把本地尚未推送的条目误删。这里只按 siteId upsert / delete，绝不整体替换。
 * 落本地走白名单字段：墓碑行残留的 note/folderId 是删除前的旧值，不能写回。
 */
export function applyFavoriteDelta(
  local: LocalFavorite[],
  delta: HubFavoriteSyncItem[],
): LocalFavorite[] {
  const map = new Map(local.map((item) => [item.siteId, item]))
  const fresh: LocalFavorite[] = []
  for (const remote of delta) {
    if (remote.deletedAt != null) {
      map.delete(remote.siteId)
      continue
    }
    const cached = map.get(remote.siteId)
    const href = remote.site?.url ?? cached?.href ?? ''
    // 站点已被硬删除且本地也没有展示信息：无法渲染，跳过
    if (!href) continue
    const next: LocalFavorite = {
      ...(cached ?? { siteId: remote.siteId }),
      siteId: remote.siteId,
      title: remote.site?.title ?? cached?.title ?? remote.siteId,
      href,
      icon: cached?.icon,
      description: remote.site?.description ?? cached?.description,
      note: remote.note ?? undefined,
      tags: remote.tags ?? undefined,
      folderId: remote.folderId,
      createdAt: remote.createdAt || cached?.createdAt || Date.now(),
    }
    if (cached) map.set(remote.siteId, next)
    else fresh.push(next)
  }
  return fresh.length > 0 ? [...fresh, ...map.values()] : [...map.values()]
}

/**
 * 登录后调用一次：把本地**变更过、云端还没确认**的收藏推到云端（M1 三期起只推
 * 脏条目，不再重发全量），再拉回云端增量/全集。成员集合最终以云端为准——否则
 * 其它设备删掉的收藏会被本机缓存复活。
 *
 * 返回值刻意不是「数组或 null」——那让调用方无法区分两件事：
 *   - 云端**确实**没有收藏（空数组，正常）
 *   - 根本没同步成功（浏览器里的收藏还没上去，用户以为已经在云端了）
 * 旧实现两者都返回 `[]`/`null` 且**完全静默**，于是：
 *   1. 中枢不可达时仍会为**每一条**本地收藏各发一次请求，每次都要等满超时
 *      （收藏 30 个站 + 中枢已停 = 页面卡在「同步」状态十几分钟，毫无提示）；
 *   2. 用户换设备登录发现收藏全没了 —— 才意识到从没同步成功过。
 *
 * 因此这里：首条推送失败即中止（同一时刻的中枢故障是共因，继续推只是重复等待），
 * 并把「同步了几条 / 失败原因 / 值不值得重试」如实交回调用方。
 */
export interface CloudSyncResult {
  /** 整条链路没有出错 */
  ok: boolean
  /** 本机收藏条数 */
  localCount: number
  /** 本次实际提交到云端的 ops 数（M1 三期起只推脏条目：0 = 纯拉取） */
  pushed: number
  /** 合并后的云端收藏；**失败时为 null**（空数组表示云端确实没有收藏） */
  cloud: HubFavorite[] | null
  /** 云端收藏夹；失败时为 null（与 cloud 同生命周期，页面无需再发一次请求） */
  cloudFolders: HubFavoriteFolder[] | null
  /** 失败原因（可直接渲染）；ok 时为 undefined */
  error?: string
  /** 是否值得给用户一个「重试」 */
  retryable: boolean
  /**
   * 已算好的「本地应变成什么」。页面必须用它 replaceAll，而不是自己再跑一次
   * mergeCloudFavorites——增量场景下全量合并会把本地未推送的条目误删。
   * 失败时为 null（不许落库）。
   */
  nextItems: LocalFavorite[] | null
  /** 本次同步中被「另一台设备」删除的条数（墓碑），用于给用户可见提示 */
  remoteRemoved: number
}

export async function syncFavoritesToCloud(): Promise<CloudSyncResult> {
  const { items: local, blocked } = loadLocal()
  const identity = getIdentity()
  if (blocked) {
    // 读不出来时**不要**上报「本地 0 条」：那会让用户以为收藏本来就没有
    return {
      ok: false,
      localCount: 0,
      pushed: 0,
      cloud: null,
      cloudFolders: null,
      error: blocked,
      retryable: false,
      nextItems: null,
      remoteRemoved: 0,
    }
  }
  if (!identity) {
    return {
      ok: false,
      localCount: local.length,
      pushed: 0,
      cloud: null,
      cloudFolders: null,
      error: '未登录：收藏只保存在本机浏览器',
      retryable: false,
      nextItems: null,
      remoteRemoved: 0,
    }
  }

  const failure: { message?: string; retryable: boolean } = { retryable: true }
  const onFail = (error: unknown) => {
    const notice = describeDegrade(error, '云端收藏')
    failure.message = notice.message
    failure.retryable = notice.retryable
    // 批量端点走 BFF 会话：401 是「登录过期」，不是 API Token 问题
    if ((error as { status?: number } | null)?.status === 401) {
      failure.message = '登录已过期，请重新登录后同步收藏'
      failure.retryable = true
    }
  }

  // 登录用户走批量同步：一次请求提交 ops 并取回增量（含墓碑）。
  // 匿名用户保持旧的逐条端点——新端点只接受会话派生身份，匿名调它必然 401。
  if (!identity.startsWith('anon-')) {
    const since = readSyncCursor(identity)
    /**
     * 一次性迁移：脏键从未写过且本地非空 → 本次按全量推一次。
     * 否则 since=0 的全量合并会把「云端没有的本地条目」从本地删掉、
     * 且它们永远推不上去——匿名收藏转登录的主路径会静默丢数据。
     * 写过空数组（用户确实清过脏）不触发，避免每次同步都全量重发。
     */
    if (local.length > 0 && !dirtyKeyEverWritten()) {
      markDirty(local.map((f) => f.siteId))
    }
    /**
     * M1 三期：只推「本地变更过、云端还没确认」的条目（脏集合），
     * 不再把本地全量当 ops 重发（LWW 会跳过绝大多数——正确但不经济）。
     * ops 两类来源：
     *   1. 脏集合 ∩ 当前本地列表 → add。服务端 add 是 upsert（缺失则插入、
     *      存量则整行覆盖），不能用 update 替代——服务端对「缺失行上的 update」
     *      直接跳过，新增永远上不去；
     *   2. 脏集合里已不在本地列表的 siteId → remove（本地删掉的条目要推删除）。
     */
    const dirty = readDirty()
    const ops: FavoriteSyncOp[] = []
    for (const f of local) {
      if (!dirty.has(f.siteId)) continue
      ops.push({
        op: 'add',
        siteId: f.siteId,
        folderId: f.folderId ?? null,
        note: f.note && f.note.length > 200 ? f.note.slice(0, 200) : f.note ?? null,
        tags: f.tags ?? null,
        at: f.createdAt,
      })
    }
    for (const siteId of dirty) {
      if (local.some((f) => f.siteId === siteId)) continue
      ops.push({ op: 'remove', siteId, at: Date.now() })
    }
    /** 服务端单批 ops 上限 500；超出必须分片，否则 400 会让 >500 条收藏的账号永久同步失败 */
    const OP_BATCH = 500
    const chunks: FavoriteSyncOp[][] = []
    for (let i = 0; i < ops.length; i += OP_BATCH) chunks.push(ops.slice(i, i + OP_BATCH))

    let version = since
    let aggregated: HubFavoriteSyncItem[] = []
    let folders: HubFavoriteFolder[] = []

    // 所有分片都用同一个 since：这样每片的响应都覆盖「自游标以来的全部变化」，
    // 不会因为逐片推进游标而漏掉「at 早于新游标」的条目（拼接后按 siteId 去重）。
    for (const chunk of chunks) {
      const result = await syncBatchWithRetry(chunk, since, onFail)
      if (!result) {
        writeSyncStatus({ at: Date.now(), ok: false, pushed: 0, remoteRemoved: 0, error: failure.message })
        return {
          ok: false,
          localCount: local.length,
          pushed: 0,
          cloud: null,
          cloudFolders: null,
          error: failure.message,
          retryable: failure.retryable,
          nextItems: null,
          remoteRemoved: 0,
        }
      }
      version = Math.max(version, result.version)
      aggregated.push(...result.items)
      folders = result.folders
    }

    // 本机没有可推条目时仍需拉取：首拉（since=0）要全集，已有游标时要知道云端新增与墓碑
    if (chunks.length === 0) {
      const pulled = await syncBatchWithRetry([], since, onFail)
      if (!pulled) {
        writeSyncStatus({ at: Date.now(), ok: false, pushed: 0, remoteRemoved: 0, error: failure.message })
        return {
          ok: false,
          localCount: local.length,
          pushed: 0,
          cloud: null,
          cloudFolders: null,
          error: failure.message,
          retryable: failure.retryable,
          nextItems: null,
          remoteRemoved: 0,
        }
      }
      aggregated = pulled.items
      version = pulled.version
      folders = pulled.folders
    }

    // 游标只在全部请求成功后推进一次（失败时保持原值，重试仍覆盖这段区间，幂等）
    writeSyncCursor(identity, version)

    const alive = aggregated.filter((item) => item.deletedAt == null)
    const remoteRemoved = aggregated.length - alive.length
    // since=0 是全集，可以走「云端覆盖本地」；since>0 是增量，必须按行 upsert，
    // 否则本地尚未推送的条目会被整体替换误删。
    const nextItems =
      since === 0 ? mergeCloudFavorites(local, alive) : applyFavoriteDelta(local, aggregated)
    // 全部请求成功：本次脏条目已获云端确认，清空标记。
    // 失败路径（上面几处 return）故意不清——下次重试仍会推这些条目。
    clearDirty()
    writeSyncStatus({
      at: Date.now(),
      ok: true,
      pushed: ops.length,
      remoteRemoved,
    })
    return {
      ok: true,
      localCount: local.length,
      // pushed = 本次实际提交的 ops 数（0 = 纯拉取，什么都没有推）；
      // localCount 仍是本机条数，两者语义不同，别混
      pushed: ops.length,
      cloud: alive,
      cloudFolders: folders,
      retryable: false,
      nextItems,
      remoteRemoved,
    }
  }

  let pushed = 0
  for (const f of local) {
    const ok = await addFavorite(identity, f.siteId, onFail)
    // 首条就失败时继续推没有意义：同一次中枢故障会让每条都等满超时
    if (!ok) break
    pushed++
  }

  if (failure.message) {
    return {
      ok: false,
      localCount: local.length,
      pushed,
      cloud: null,
      cloudFolders: null,
      error: failure.message,
      retryable: failure.retryable,
      nextItems: null,
      remoteRemoved: 0,
    }
  }

  let cloudFailed = false
  const list = await listFavorites(identity, (error) => {
    cloudFailed = true
    onFail(error)
  })

  return {
    ok: !cloudFailed,
    localCount: local.length,
    pushed,
    cloud: cloudFailed ? null : list.items,
    cloudFolders: cloudFailed ? null : list.folders,
    error: failure.message,
    retryable: failure.retryable,
    nextItems: cloudFailed ? null : mergeCloudFavorites(local, list.items ?? []),
    // 匿名通道没有墓碑概念：云端不返回删除记录，本地合并也不会删任何条目
    remoteRemoved: 0,
  }
}
