'use client'

/**
 * 收藏夹 v1：localStorage 优先，不依赖登录。
 *
 * 演进路径（Phase 2 已就绪的服务端）：登录后把本地收藏合并到云端
 * （POST /api/favorites），之后以云端为准、本地只作离线缓存。
 * 合并策略：按 siteId 取并集，createdAt 新者胜。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { addFavorite, listFavorites, removeFavorite, type HubFavorite, type HubFavoriteFolder } from '@/lib/navhub-api'
import { describeDegrade } from '@/lib/degrade'
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

export function useFavorites(): FavoritesApi {
  const [items, setItems] = useState<LocalFavorite[]>([])
  const [ready, setReady] = useState(false)
  const [storageBlocked, setStorageBlocked] = useState<string | null>(null)
  /**
   * 同步镜像最新收藏。
   *
   * `setItems` 要到下一次渲染才更新闭包里的 `items`；同一渲染帧内连续点击两次
   * 收藏时，两个 `toggle` 都会读到旧的 `items`，各自认为「尚未收藏」并插入一条，
   * 结果收藏夹里出现重复项。所有读写都先经过这个 ref，第二次点击就能看到
   * 第一次写入的结果（函数式更新也解决不了「异步云端同步需要知道最终状态」）。
   */
  const itemsRef = useRef<LocalFavorite[]>([])

  useEffect(() => {
    const refresh = () => {
      const loaded = loadLocal()
      itemsRef.current = loaded.items
      setItems(loaded.items)
      setStorageBlocked(loaded.blocked)
    }
    refresh()
    setReady(true)

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
      itemsRef.current = next
      setItems(next)
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
    itemsRef.current = []
    setItems([])
    setStorageBlocked(null)
    saveLocal([])
  }, [])

  const isFavorite = useCallback((siteId: string) => items.some((i) => i.siteId === siteId), [items])

  /** 切换收藏状态，返回切换后是否已收藏 */
  const toggle = useCallback(async (site: Omit<LocalFavorite, 'createdAt'>): Promise<boolean> => {
    // 用 ref 读取「包含本次同步写入」的最新列表，避免快速双击时两次都读到旧状态
    const current = itemsRef.current
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
    if (!persist(itemsRef.current.filter((i) => i.siteId !== siteId))) return
    const identity = getIdentity()
    if (identity) void removeFavorite(identity, siteId)
  }, [persist])

  const updateMeta = useCallback((siteId: string, patch: { folderId?: string | null; note?: string | null }) => {
    const current = itemsRef.current
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

  const exportJson = useCallback(() => JSON.stringify({ version: 1, items: itemsRef.current }, null, 2), [])

  const importJson = useCallback((json: string) => {
    // 存储读不出来时导入同样是写入：先拦住，并把原因作为错误返回（页面会显示）
    if (storageBlocked) return { ok: false, imported: 0, error: storageBlocked }
    try {
      const parsed = JSON.parse(json)
      const incoming: LocalFavorite[] = Array.isArray(parsed) ? parsed : parsed?.items
      if (!Array.isArray(incoming)) return { ok: false, imported: 0, error: '格式不正确' }
      const valid = incoming.filter((i) => i && typeof i.siteId === 'string' && typeof i.href === 'string')
      const merged = [...valid]
      for (const ex of itemsRef.current) {
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
    }
  }

  const failure: { message?: string; retryable: boolean } = { retryable: true }
  const onFail = (error: unknown) => {
    const notice = describeDegrade(error, '云端收藏')
    failure.message = notice.message
    failure.retryable = notice.retryable
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
  }
}
