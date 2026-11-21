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
import { recordGrowthEvent } from '@/lib/growth-lazy'
import { getIdentity } from '@/lib/identity'
import { recordWatchProgress } from '@/lib/watch-progress-log'
import {
  corruptKeyFor,
  parseFavorites,
} from '@/lib/favorites-storage'
import {
  WATCHLIST_STORAGE_KEY,
  applyWatchDelta,
  asPremiereDate,
  dramaKeyFor,
  dramaReservedKeyFor,
  localDateKey,
  mergeCloudWatchlist,
  normalizeDramaTitle,
  RESERVED_PLATFORM_TITLE,
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
  /** 按归一化剧名找条目（不分平台）：日历预约按钮据此判断“已预约/已在追” */
  findByTitle: (title: string) => WatchEntry | undefined
  add: (
    platform: WatchPlatformRef,
    draft: { title: string; episode?: number; cadence?: WatchCadence; priority?: WatchPriority },
  ) => WatchEntry | null
  /**
   * 预约态加入（U-377）：开播日历上的剧没有平台信息，键为
   * reserved::归一化剧名，不指向平台入口。同一剧名（归一后）已在清单
   * 里（无论预约态还是在追）直接返回既有条目，不生成第二条。
   * 反方向（先预约、后平台加入）由 add 的归一化剧名回查兜底：查到预约
   * 条目就地升级为平台条目，同样不生成第二条。
   */
  addReserved: (title: string, premiereDate?: string | null) => WatchEntry | null
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
/* 水合完成标志：localStorage 快照只在水合完成后才生效。
 * 首渲必须与服务端完全一致（ready=false、entries=[]）。`useEffect` 在选择性
 * 水合中途就会执行，若直接在这里把快照翻上来，`useSyncExternalStore` 会触发
 * 同步重渲染，撞上尚未水合的节点 → Hydration failed（见 evolution-round
 * 2026-11-16-0128-b-hydration）。翻转只能发生在水合结束后的普通重渲染里，
 * 故用 setTimeout 0 推迟到下一个宏任务；`storage` 等外部刷新在标志位立起前
 * 同样不许翻快照。 */
let watchlistHydrated = false
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

/** 服务端快照恒为空：水合渲染必须用它，绝不能读已翻转的模块快照。
 * 布局（mobile-nav）比页面先水合，它的 effect/定时器可能在页面水合前就把
 * 模块快照翻上来；若水合渲染读到翻转后的快照，会与服务端 HTML 对不上 →
 * Hydration failed。getServerSnapshot 与 getSnapshot 分开后，水合渲染恒用
 * 空快照（与服务端一致），水合完成 React 再按 getSnapshot 重渲染一次。 */
const EMPTY_SNAPSHOT: WatchlistSnapshot = { items: [], blocked: null }

function getWatchlistServerSnapshot(): WatchlistSnapshot {
  return EMPTY_SNAPSHOT
}

export function useWatchlist(): WatchlistApi {
  const snap = useSyncExternalStore(subscribeWatchlist, getWatchlistSnapshot, getWatchlistServerSnapshot)
  const { items, blocked: storageBlocked } = snap
  // 首渲 ready 恒为 false：布局先水合时 watchlistInitialized 可能已被翻成 true，
  // 若直接用它作初值，空态分支会在水合渲染里凭空出现。水合完成后才允许为 true
  //（SPA 内再次挂载时水合早已完成，可直接为 true，不必等一轮定时器）。
  const [ready, setReady] = useState(() => watchlistInitialized && watchlistHydrated)

  useEffect(() => {
    let cancelled = false
    // 水合完成后再读 localStorage：effect 本身在水合中途就会执行，直接翻快照
    // 会触发同步重渲染并撞上未水合节点（Hydration failed）。setTimeout 0 把
    // 翻转推迟到水合结束后的普通重渲染里；卸载后取消，避免幽灵写入。
    const timer = window.setTimeout(() => {
      if (cancelled) return
      if (!watchlistInitialized) {
        watchlistInitialized = true
        applyLocalEntries(loadLocal())
      }
      watchlistHydrated = true
      setReady(true)
    }, 0)
    const refresh = () => {
      if (!watchlistHydrated) return
      applyLocalEntries(loadLocal())
    }
    window.addEventListener('navhub_workbench_updated', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
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

  const findByTitle = useCallback(
    (title: string) => {
      const normalized = normalizeDramaTitle(title)
      if (!normalized) return undefined
      return items.find((e) => normalizeDramaTitle(e.title) === normalized)
    },
    [items],
  )

  const addReserved = useCallback<WatchlistApi['addReserved']>(
    (title, premiereDate) => {
      const cleanTitle = title.trim()
      if (!cleanTitle) return null
      const key = dramaReservedKeyFor(cleanTitle)
      const current = sharedEntries
      // 同一剧名已在清单（预约态或在追）= 不再占第二位；开播日有新值时补上
      const existed = current.find(
        (e) => e.key === key || normalizeDramaTitle(e.title) === normalizeDramaTitle(cleanTitle),
      )
      const now = Date.now()
      const premiere = asPremiereDate(premiereDate)
      if (existed) {
        if (premiere && existed.premiereDate !== premiere) {
          const next: WatchEntry = { ...existed, premiereDate: premiere, updatedAt: now }
          if (!persist(current.map((e) => (e.key === existed.key ? next : e)))) return null
          markDirty([existed.key])
          return next
        }
        return existed
      }
      const entry: WatchEntry = {
        key,
        title: cleanTitle,
        platformSiteId: '',
        platformTitle: RESERVED_PLATFORM_TITLE,
        playUrl: '',
        episode: 0,
        priority: 'normal',
        cadence: { kind: 'unknown' },
        remind: true,
        lastProgressAt: now,
        createdAt: now,
        updatedAt: now,
        premiereDate: premiere,
      }
      if (!persist([entry, ...current])) return null
      markDirty([key])
      return entry
    },
    [persist],
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
      // U-377 返工：先预约、后平台加入——预约条目的键是 reserved::归一化剧名，
      // 与平台键恒不相等，上面按平台键查不到。此时再按归一化剧名回查一次：
      // 查到既有预约条目就就地升级为平台条目（换键、补平台字段，保留开播日
      // 与已有进度），不生成第二条。只认预约态：同一剧名在另一平台的在追
      // 条目是合法的多平台并存，不参与升级。
      const reserved = current.find((e) => e.key === dramaReservedKeyFor(title))
      if (reserved) {
        const next: WatchEntry = {
          ...reserved,
          key,
          platformSiteId: platform.siteId,
          platformTitle: platform.title,
          playUrl: platform.href,
          icon: platform.icon,
          episode: draft.episode !== undefined ? Math.max(0, Math.trunc(draft.episode)) : reserved.episode,
          cadence: draft.cadence ?? reserved.cadence,
          priority: draft.priority ?? reserved.priority,
          updatedAt: now,
        }
        if (!persist(current.map((e) => (e.key === reserved.key ? next : e)))) return null
        // 新键与旧 reserved:: 键都进脏集合：旧键必须显式标记——预约与升级
        // 之间若发生过一次成功同步，脏集合已被清空（syncWatchlistToCloud
        // 成功后 clearDirty），只标新键会让旧键拿不到 remove op，云端预约
        // 占位在新设备全量拉取时复活。下次同步按「本地已无此键」对旧键生成
        // remove op，云端预约占位随之清除，不残留。
        markDirty([key, reserved.key])
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
      // 新剧入清单：记一次追剧进度信号并标 newDrama（沉淀/核心任务口径与单纯推进进度区分）
      recordGrowthEvent('watchlist_progress', { newDrama: true })
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
      // 本周看了几集的本地日志：只记正向增量，往回改不记；写不动时静默失败。
      recordWatchProgress(key, target.episode, nextEpisode, now)
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
    findByTitle,
    add,
    addReserved,
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
