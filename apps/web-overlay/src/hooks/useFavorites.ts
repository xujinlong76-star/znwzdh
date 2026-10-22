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
  updateMeta: (siteId: string, patch: { folderId?: string | null; note?: string | null }) => boolean
  /** 登录同步成功后用云端列表整体替换本地（云端是事实源，避免删除被本地缓存复活） */
  replaceAll: (items: LocalFavorite[]) => boolean
  clear: () => void
  /** 用户显式重置：先把读不出来的原数据备份到旁边，再写空列表 */
  resetLocal: () => void
  exportJson: () => string
  importJson: (json: string) => { ok: boolean; imported: number; error?: string }
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
  const resetLocal = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(KEY)
      if (raw) window.localStorage.setItem(corruptBackupKey(Date.now()), raw)
    } catch (err) {
      // 备份写不进去（配额满）也要继续重置，但把这件事说出来，别让它静默
      console.warn('收藏原数据备份失败；重置后原数据可能无法找回', err)
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
    const identity = getIdentity()
    if (identity) void removeFavorite(identity, siteId)
  }, [persist])

  const updateMeta = useCallback((siteId: string, patch: { folderId?: string | null; note?: string | null }) => {
    const current = sharedFavorites
    if (!current.some((i) => i.siteId === siteId)) return false
    const next = current.map((i) => {
      if (i.siteId !== siteId) return i
      const merged: LocalFavorite = { ...i }
      if (patch.folderId !== undefined) merged.folderId = patch.folderId
      // note 允许显式传 null（清空备注），落盘统一成 undefined 保持旧数据形状
      if (patch.note !== undefined) merged.note = patch.note ?? undefined
      return merged
    })
    return persist(next)
  }, [persist])

  const replaceAll = useCallback((next: LocalFavorite[]) => persist(next), [persist])

  const clear = useCallback(() => {
    persist([])
  }, [persist])

  const exportJson = useCallback(() => JSON.stringify({ version: 1, items: sharedFavorites }, null, 2), [])

  const importJson = useCallback((json: string) => {
    // 存储读不出来时导入同样是写入：先拦住，并把原因作为错误返回（页面会显示）
    if (storageBlocked) return { ok: false, imported: 0, error: storageBlocked }
    try {
      const parsed = JSON.parse(json)
      const incoming: LocalFavorite[] = Array.isArray(parsed) ? parsed : parsed?.items
      if (!Array.isArray(incoming)) return { ok: false, imported: 0, error: '格式不正确' }
      const valid = incoming.filter((i) => i && typeof i.siteId === 'string' && typeof i.href === 'string')
      const merged = [...valid]
      for (const ex of sharedFavorites) {
        if (!merged.some((i) => i.siteId === ex.siteId)) merged.push(ex)
      }
      persist(merged)
      return { ok: true, imported: valid.length }
    } catch (err) {
      return { ok: false, imported: 0, error: err instanceof Error ? err.message : '解析失败' }
    }
  }, [persist, storageBlocked])

  return { items, ready, storageBlocked, isFavorite, toggle, remove, updateMeta, replaceAll, clear, resetLocal, exportJson, importJson }
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
      folderId: remote.folderId,
      createdAt: remote.createdAt || cached?.createdAt || Date.now(),
    }
    if (cached) map.set(remote.siteId, next)
    else fresh.push(next)
  }
  return fresh.length > 0 ? [...fresh, ...map.values()] : [...map.values()]
}

/**
 * 登录后调用一次：先把本地收藏推到云端（仅用于首次迁移/离线期间新增的条目），
 * 再拉回云端全集。成员集合最终以云端为准——否则其它设备删掉的收藏会被本机缓存复活。
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
  /** 本次成功推到云端的条数 */
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
    /** 服务端单批 ops 上限 500；超出必须分片，否则 400 会让 >500 条收藏的账号永久同步失败 */
    const OP_BATCH = 500
    const chunks: LocalFavorite[][] = []
    for (let i = 0; i < local.length; i += OP_BATCH) chunks.push(local.slice(i, i + OP_BATCH))

    const opsOf = (list: LocalFavorite[]): FavoriteSyncOp[] =>
      list.map((f) => ({
        op: 'add',
        siteId: f.siteId,
        folderId: f.folderId ?? null,
        note: f.note ?? null,
        at: f.createdAt,
      }))

    let version = since
    let aggregated: HubFavoriteSyncItem[] = []
    let folders: HubFavoriteFolder[] = []

    // 所有分片都用同一个 since：这样每片的响应都覆盖「自游标以来的全部变化」，
    // 不会因为逐片推进游标而漏掉「at 早于新游标」的条目（拼接后按 siteId 去重）。
    for (const chunk of chunks) {
      const result = await syncBatchWithRetry(opsOf(chunk), since, onFail)
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
    writeSyncStatus({
      at: Date.now(),
      ok: true,
      pushed: local.length,
      remoteRemoved,
    })
    return {
      ok: true,
      localCount: local.length,
      // 批量路径下「本机条数」即本次提交的 op 数（契约：反映有多少条待推数据）
      pushed: local.length,
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
