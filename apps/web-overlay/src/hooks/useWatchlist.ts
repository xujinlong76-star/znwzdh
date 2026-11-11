'use client'

/**
 * 追剧清单：localStorage 优先，不依赖登录（与收藏同一套本地纪律）。
 *
 * 登录后把本地清单合并到云端（POST /api/me/watchlist/sync，与收藏同步
 * 同一套 M1 协议：只推脏条目 + since 增量 + 墓碑），之后以云端为准、
 * 本地只作离线缓存。匿名身份（含未登录自动生成的 anon 身份）不调批量
 * 端点——追剧清单没有逐条旧端点，匿名就是纯本机，界面如实标注。
 *
 * 本地读写的损坏纪律与收藏完全一致：复用 favorites-storage 的解析器，
 * 「读不出来」时拒绝覆盖并把原因交回界面，绝不把坏数据伪装成空清单后照写。
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  syncWatchlistBatch,
  type HubWatchSyncPayload,
  type WatchSyncOp,
} from '@/lib/navhub-api'
import { describeDegrade } from '@/lib/degrade'
import { recordGrowthEvent } from '@/lib/growth'
import { getIdentity } from '@/lib/identity'
import {
  corruptKeyFor,
  parseFavorites,
} from '@/lib/favorites-storage'
import {
  WATCHLIST_STORAGE_KEY,
  applyWatchDelta,
  dramaKeyFor,
  localDateKey,
  mergeCloudWatchlist,
  sanitizeWatchEntry,
  type WatchCadence,
  type WatchEntry,
  type WatchPlatformRef,
  type WatchPriority,
} from '@/lib/watchlist'

const KEY = WATCHLIST_STORAGE_KEY

export interface WatchlistApi {
  entries: WatchEntry[]
  ready: boolean
  /** 非 null = 本地存储读不出来：所有写入被拒，界面必须把原因显示出来 */
  storageBlocked: string | null
  isWatching: (key: string) => boolean
  findByPlatformAndTitle: (platformSiteId: string, title: string) => WatchEntry | undefined
  add: (
    platform: WatchPlatformRef,
    draft: { title: string; episode?: number; cadence?: WatchCadence; priority?: WatchPriority },
  ) => WatchEntry | null
  /** 改进度：episode 增大时记一次成长经验（复用成长系统的既有递减口径）；改小只当纠错，不记 */
  setEpisode: (key: string, episode: number) => boolean
  update: (
    key: string,
    patch: Partial<Pick<WatchEntry, 'priority' | 'cadence' | 'remind' | 'dismissedOn'>>,
  ) => boolean
  /** 今天已经看过更新：关掉今天的待看提醒（只关当天，不动节奏与开关） */
  dismissToday: (key: string) => boolean
  remove: (key: string) => void
  /** 登录同步成功后用云端合并结果整体替换本地（云端是事实源，避免删除被本地缓存复活） */
  replaceAll: (items: WatchEntry[]) => boolean
  resetLocal: () => { backedUp: boolean }
}

/* ---------------------------- 本地读写 ---------------------------- */

function loadLocal(): { items: WatchEntry[]; blocked: string | null } {
  if (typeof window === 'undefined') return { items: [], blocked: null }
  let raw: string | null
  try {
    raw = window.localStorage.getItem(KEY)
  } catch {
    return {
      items: [],
      blocked: '浏览器不允许读写本地存储（隐私模式或权限被拒），本次追剧改动无法保存。',
    }
  }
  // 解析器与收藏共用：null/空串才是真空；有数据读不出来 = corrupt，调用方拒绝覆盖
  const { items, corrupt } = parseFavorites<unknown>(raw)
  if (corrupt) {
    return {
      items: [],
      blocked:
        '本地追剧清单读不出来（可能写入中断，或被其他程序改写）。为避免覆盖掉原数据，已暂停保存追剧改动 —— 原数据仍在浏览器里，可以先备份再重置。',
    }
  }
  // 逐条收敛：坏一条丢一条，不能拖垮整份清单
  const clean: WatchEntry[] = []
  for (const item of items) {
    const entry = sanitizeWatchEntry(item)
    if (entry && !clean.some((e) => e.key === entry.key)) clean.push(entry)
  }
  return { items: clean, blocked: null }
}

function saveLocal(items: WatchEntry[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    // 存储满 / 隐私模式：内存态仍然有效，刷新丢失
  }
}

/* ---------------------------- 模块级共享状态 ---------------------------- */

type WatchlistSnapshot = { items: WatchEntry[]; blocked: string | null }

let sharedEntries: WatchEntry[] = []
let sharedBlocked: string | null = null
let watchlistSnapshot: WatchlistSnapshot = { items: sharedEntries, blocked: sharedBlocked }
let watchlistInitialized = false
const watchlistListeners = new Set<() => void>()

function applyLocalEntries(next: { items: WatchEntry[]; blocked: string | null }) {
  sharedEntries = next.items
  sharedBlocked = next.blocked
  watchlistSnapshot = { items: next.items, blocked: next.blocked }
  for (const listener of watchlistListeners) listener()
}

function subscribeWatchlist(listener: () => void): () => void {
  watchlistListeners.add(listener)
  return () => {
    watchlistListeners.delete(listener)
  }
}

function getWatchlistSnapshot(): WatchlistSnapshot {
  return watchlistSnapshot
}

export function useWatchlist(): WatchlistApi {
  const snap = useSyncExternalStore(subscribeWatchlist, getWatchlistSnapshot, getWatchlistSnapshot)
  const { items, blocked: storageBlocked } = snap
  const [ready, setReady] = useState(() => watchlistInitialized)

  useEffect(() => {
    if (!watchlistInitialized) {
      watchlistInitialized = true
      applyLocalEntries(loadLocal())
    }
    setReady(true)
    const refresh = () => applyLocalEntries(loadLocal())
    window.addEventListener('navhub_workbench_updated', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('navhub_workbench_updated', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const persist = useCallback(
    (next: WatchEntry[]) => {
      if (storageBlocked) return false
      applyLocalEntries({ items: next, blocked: storageBlocked })
      saveLocal(next)
      return true
    },
    [storageBlocked],
  )

  const isWatching = useCallback((key: string) => items.some((e) => e.key === key), [items])

  const findByPlatformAndTitle = useCallback(
    (platformSiteId: string, title: string) =>
      items.find((e) => e.key === dramaKeyFor(platformSiteId, title)),
    [items],
  )

  const add = useCallback<WatchlistApi['add']>(
    (platform, draft) => {
      const title = draft.title.trim()
      if (!title) return null
      const key = dramaKeyFor(platform.siteId, title)
      const current = sharedEntries
      const existed = current.find((e) => e.key === key)
      const now = Date.now()
      if (existed) {
        // 同一部剧重复加入 = 更新它的标注（节奏/优先级/进度），不生成第二条
        const next: WatchEntry = {
          ...existed,
          episode: draft.episode !== undefined ? Math.max(0, Math.trunc(draft.episode)) : existed.episode,
          cadence: draft.cadence ?? existed.cadence,
          priority: draft.priority ?? existed.priority,
          updatedAt: now,
        }
        if (!persist(current.map((e) => (e.key === key ? next : e)))) return null
        markDirty([key])
        return next
      }
      const entry: WatchEntry = {
        key,
        title,
        platformSiteId: platform.siteId,
        platformTitle: platform.title,
        playUrl: platform.href,
        icon: platform.icon,
        episode: Math.max(0, Math.trunc(draft.episode ?? 0)),
        priority: draft.priority ?? 'normal',
        cadence: draft.cadence ?? { kind: 'unknown' },
        remind: true,
        lastProgressAt: now,
        createdAt: now,
        updatedAt: now,
      }
      if (!persist([entry, ...current])) return null
      markDirty([key])
      return entry
    },
    [persist],
  )

  const setEpisode = useCallback(
    (key: string, episode: number) => {
      const current = sharedEntries
      const target = current.find((e) => e.key === key)
      if (!target) return false
      const nextEpisode = Math.min(Math.max(Math.trunc(episode) || 0, 0), 100_000)
      if (nextEpisode === target.episode) return true
      const now = Date.now()
      const next: WatchEntry = { ...target, episode: nextEpisode, lastProgressAt: now, updatedAt: now }
      if (!persist(current.map((e) => (e.key === key ? next : e)))) return false
      // 只有「往前追」才算用了一次追剧功能；往回改是纠错，不给经验也不扣
      if (nextEpisode > target.episode) recordGrowthEvent('watchlist_progress')
      markDirty([key])
      return true
    },
    [persist],
  )

  const update = useCallback<WatchlistApi['update']>(
    (key, patch) => {
      const current = sharedEntries
      if (!current.some((e) => e.key === key)) return false
      const next = current.map((e) => (e.key === key ? { ...e, ...patch, updatedAt: Date.now() } : e))
      const ok = persist(next)
      if (ok) markDirty([key])
      return ok
    },
    [persist],
  )

  const dismissToday = useCallback(
    (key: string) => update(key, { dismissedOn: localDateKey(Date.now()) }),
    [update],
  )

  const remove = useCallback(
    (key: string) => {
      if (!persist(sharedEntries.filter((e) => e.key !== key))) return
      // 本地已删：key 留在脏集合里、已不在本地列表，同步时生成 remove op 让云端也删
      markDirty([key])
    },
    [persist],
  )

  const replaceAll = useCallback(
    (next: WatchEntry[]) => {
      // 入参来自云端同步结果：本地整体已被云端版本取代，没有待确认的变更——
      // 清空脏标记，否则下次同步会把刚确认的内容原样推回去
      const ok = persist(next)
      if (ok) clearDirty()
      return ok
    },
    [persist],
  )

  const resetLocal = useCallback((): { backedUp: boolean } => {
    let backedUp = false
    try {
      const raw = window.localStorage.getItem(KEY)
      if (raw) {
        const backupKey = corruptKeyFor(KEY, Date.now())
        window.localStorage.setItem(backupKey, raw)
        backedUp = window.localStorage.getItem(backupKey) === raw
      } else {
        backedUp = true
      }
    } catch {
      backedUp = false
    }
    try {
      const identity = getIdentity()
      if (identity) window.localStorage.removeItem(SYNC_CURSOR_PREFIX + identity)
    } catch {
      // 清不掉游标不阻断重置；下次成功同步时会被新版本覆盖
    }
    applyLocalEntries({ items: [], blocked: null })
    saveLocal([])
    clearDirty()
    return { backedUp }
  }, [])

  return {
    entries: items,
    ready,
    storageBlocked,
    isWatching,
    findByPlatformAndTitle,
    add,
    setEpisode,
    update,
    dismissToday,
    remove,
    replaceAll,
    resetLocal,
  }
}

/* ------------------------------ 云端同步 ------------------------------ */

const SYNC_CURSOR_PREFIX = 'navhub.watchlist.sync.v1.'
const SYNC_STATUS_KEY = 'navhub.watchlist.sync.last'
const DIRTY_KEY = 'navhub.watchlist.dirty.v1'

export interface WatchlistSyncStatus {
  at: number
  ok: boolean
  pushed: number
  remoteRemoved: number
  error?: string
}

function writeSyncStatus(status: WatchlistSyncStatus): void {
  try {
    window.localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(status))
  } catch {
    // 写不进状态只是少一行提示，不影响同步本身
  }
}

export function readWatchlistSyncStatus(): WatchlistSyncStatus | null {
  try {
    const raw = window.localStorage.getItem(SYNC_STATUS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WatchlistSyncStatus>
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

/** 脏标记：本地变更过、云端还没确认的 key 集合（与收藏同一条纪律） */
let memoryDirty: Set<string> | null = null

function readDirty(): Set<string> {
  if (memoryDirty) return memoryDirty
  let keys: string[] = []
  try {
    const raw = window.localStorage.getItem(DIRTY_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) keys = parsed.filter((x): x is string => typeof x === 'string')
    }
  } catch {
    keys = []
  }
  memoryDirty = new Set(keys)
  return memoryDirty
}

function writeDirty(keys: Set<string>): void {
  memoryDirty = new Set(keys)
  try {
    window.localStorage.setItem(DIRTY_KEY, JSON.stringify([...memoryDirty]))
  } catch {
    // 配额满 / 隐私模式：内存态仍然生效，刷新后标记丢失——代价是下次多推几条，不会推错
  }
}

function dirtyKeyEverWritten(): boolean {
  try {
    return window.localStorage.getItem(DIRTY_KEY) !== null
  } catch {
    return true
  }
}

function markDirty(keys: string[]): void {
  if (keys.length === 0) return
  const next = readDirty()
  for (const key of keys) next.add(key)
  writeDirty(next)
}

function clearDirty(): void {
  writeDirty(new Set<string>())
}

function readSyncCursor(identity: string): number {
  try {
    const n = Number(window.localStorage.getItem(SYNC_CURSOR_PREFIX + identity))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
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

async function syncBatchWithRetry(
  ops: WatchSyncOp[],
  since: number,
  onFail: (error: unknown) => void,
): Promise<HubWatchSyncPayload | null> {
  let retryable = false
  const mark = (error: unknown) => {
    onFail(error)
    retryable = describeDegrade(error, '云端追剧清单').retryable
  }
  const first = await syncWatchlistBatch(ops, since, mark)
  if (first) return first
  for (const delay of [300, 900]) {
    if (!retryable) return null
    await new Promise((resolve) => setTimeout(resolve, delay))
    const retried = await syncWatchlistBatch(ops, since, mark)
    if (retried) return retried
  }
  return null
}

export interface WatchlistCloudSyncResult {
  ok: boolean
  localCount: number
  pushed: number
  /** 已算好的「本地应变成什么」；失败时为 null（不许落库）。页面用它整体替换本地 */
  nextItems: WatchEntry[] | null
  remoteRemoved: number
  error?: string
  retryable: boolean
}

/**
 * 登录后调用一次：只推脏条目，再拉回云端增量/全集，成员集合最终以云端为准
 * （与 syncFavoritesToCloud 同构）。匿名身份直接返回未登录结果——本机就是事实源。
 */
export async function syncWatchlistToCloud(): Promise<WatchlistCloudSyncResult> {
  const { items: local, blocked } = loadLocal()
  const identity = getIdentity()
  if (blocked) {
    return { ok: false, localCount: 0, pushed: 0, nextItems: null, remoteRemoved: 0, error: blocked, retryable: false }
  }
  if (!identity || identity.startsWith('anon-')) {
    return {
      ok: false,
      localCount: local.length,
      pushed: 0,
      nextItems: null,
      remoteRemoved: 0,
      error: '未登录：追剧清单只保存在本机浏览器',
      retryable: false,
    }
  }

  const failure: { message?: string; retryable: boolean } = { retryable: true }
  const onFail = (error: unknown) => {
    const notice = describeDegrade(error, '云端追剧清单')
    failure.message = notice.message
    failure.retryable = notice.retryable
    if ((error as { status?: number } | null)?.status === 401) {
      failure.message = '登录已过期，请重新登录后同步追剧清单'
      failure.retryable = true
    }
  }

  const since = readSyncCursor(identity)
  // 一次性迁移（与收藏同理）：脏键从未写过且本地非空 → 本次按全量推一次，
  // 否则 since=0 的云端覆盖会把「云端没有的本地条目」从本地删掉且永远推不上去
  if (local.length > 0 && !dirtyKeyEverWritten()) {
    markDirty(local.map((e) => e.key))
  }
  const dirty = readDirty()
  const ops: WatchSyncOp[] = []
  for (const entry of local) {
    if (!dirty.has(entry.key)) continue
    ops.push({
      op: 'add',
      key: entry.key,
      title: entry.title,
      platformSiteId: entry.platformSiteId,
      platformTitle: entry.platformTitle,
      playUrl: entry.playUrl,
      icon: entry.icon ?? null,
      episode: entry.episode,
      priority: entry.priority,
      cadence: entry.cadence,
      remind: entry.remind,
      dismissedOn: entry.dismissedOn ?? null,
      lastProgressAt: entry.lastProgressAt,
      createdAt: entry.createdAt,
      at: entry.updatedAt,
    })
  }
  for (const key of dirty) {
    if (local.some((e) => e.key === key)) continue
    ops.push({ op: 'remove', key, at: Date.now() })
  }

  const OP_BATCH = 500
  const chunks: WatchSyncOp[][] = []
  for (let i = 0; i < ops.length; i += OP_BATCH) chunks.push(ops.slice(i, i + OP_BATCH))

  let version = since
  let aggregated: HubWatchSyncPayload['items'] = []
  for (const chunk of chunks) {
    const result = await syncBatchWithRetry(chunk, since, onFail)
    if (!result) {
      writeSyncStatus({ at: Date.now(), ok: false, pushed: 0, remoteRemoved: 0, error: failure.message })
      return { ok: false, localCount: local.length, pushed: 0, nextItems: null, remoteRemoved: 0, error: failure.message, retryable: failure.retryable }
    }
    version = Math.max(version, result.version)
    aggregated.push(...result.items)
  }
  if (chunks.length === 0) {
    const pulled = await syncBatchWithRetry([], since, onFail)
    if (!pulled) {
      writeSyncStatus({ at: Date.now(), ok: false, pushed: 0, remoteRemoved: 0, error: failure.message })
      return { ok: false, localCount: local.length, pushed: 0, nextItems: null, remoteRemoved: 0, error: failure.message, retryable: failure.retryable }
    }
    aggregated = pulled.items
    version = pulled.version
  }

  writeSyncCursor(identity, version)
  const alive = aggregated.filter((item) => item.deletedAt == null)
  const remoteRemoved = aggregated.length - alive.length
  const nextItems = since === 0 ? mergeCloudWatchlist(local, alive) : applyWatchDelta(local, aggregated)
  clearDirty()
  writeSyncStatus({ at: Date.now(), ok: true, pushed: ops.length, remoteRemoved })
  return { ok: true, localCount: local.length, pushed: ops.length, nextItems, remoteRemoved, retryable: false }
}
