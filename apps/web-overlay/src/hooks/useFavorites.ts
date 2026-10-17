'use client'

/**
 * 收藏夹 v1：localStorage 优先，不依赖登录。
 *
 * 演进路径（Phase 2 已就绪的服务端）：登录后把本地收藏合并到云端
 * （POST /api/favorites），之后以云端为准、本地只作离线缓存。
 * 合并策略：按 siteId 取并集，createdAt 新者胜。
 */

import { useCallback, useEffect, useState } from 'react'
import { addFavorite, listFavorites, removeFavorite, type HubFavorite } from '@/lib/navhub-api'
import { describeDegrade } from '@/lib/degrade'
import { getIdentity } from '@/lib/identity'

const KEY = 'navhub.favorites.v1'

export interface LocalFavorite {
  siteId: string
  title: string
  href: string
  icon?: string
  description?: string
  note?: string
  createdAt: number
}

function loadLocal(): LocalFavorite[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
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
  isFavorite: (siteId: string) => boolean
  toggle: (site: Omit<LocalFavorite, 'createdAt'>) => Promise<boolean>
  remove: (siteId: string) => void
  clear: () => void
  exportJson: () => string
  importJson: (json: string) => { ok: boolean; imported: number; error?: string }
}

export function useFavorites(): FavoritesApi {
  const [items, setItems] = useState<LocalFavorite[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const refresh = () => setItems(loadLocal())
    refresh()
    setReady(true)

    window.addEventListener('navhub_workbench_updated', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('navhub_workbench_updated', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const persist = useCallback((next: LocalFavorite[]) => {
    setItems(next)
    saveLocal(next)
  }, [])

  const isFavorite = useCallback((siteId: string) => items.some((i) => i.siteId === siteId), [items])

  /** 切换收藏状态，返回切换后是否已收藏 */
  const toggle = useCallback(async (site: Omit<LocalFavorite, 'createdAt'>): Promise<boolean> => {
    const existed = items.some((i) => i.siteId === site.siteId)
    const next = existed
      ? items.filter((i) => i.siteId !== site.siteId)
      : [{ ...site, createdAt: Date.now() }, ...items]
    persist(next)

    // 异步尝试同步到云端（失败不影响本地态——离线优先）
    const identity = getIdentity()
    if (identity) {
      if (existed) await removeFavorite(identity, site.siteId)
      else await addFavorite(identity, site.siteId)
    }
    return !existed
  }, [items, persist])

  const remove = useCallback((siteId: string) => {
    persist(items.filter((i) => i.siteId !== siteId))
    const identity = getIdentity()
    if (identity) void removeFavorite(identity, siteId)
  }, [items, persist])

  const clear = useCallback(() => persist([]), [persist])

  const exportJson = useCallback(() => JSON.stringify({ version: 1, items }, null, 2), [items])

  const importJson = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json)
      const incoming: LocalFavorite[] = Array.isArray(parsed) ? parsed : parsed?.items
      if (!Array.isArray(incoming)) return { ok: false, imported: 0, error: '格式不正确' }
      const valid = incoming.filter((i) => i && typeof i.siteId === 'string' && typeof i.href === 'string')
      const merged = [...valid]
      for (const ex of items) {
        if (!merged.some((i) => i.siteId === ex.siteId)) merged.push(ex)
      }
      persist(merged)
      return { ok: true, imported: valid.length }
    } catch (err) {
      return { ok: false, imported: 0, error: err instanceof Error ? err.message : '解析失败' }
    }
  }, [items, persist])

  return { items, ready, isFavorite, toggle, remove, clear, exportJson, importJson }
}

/**
 * 登录后调用一次：把本地收藏合并到云端（并集，createdAt 新者胜）。
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
  /** 失败原因（可直接渲染）；ok 时为 undefined */
  error?: string
  /** 是否值得给用户一个「重试」 */
  retryable: boolean
}

export async function syncFavoritesToCloud(): Promise<CloudSyncResult> {
  const local = loadLocal()
  const identity = getIdentity()
  if (!identity) {
    return {
      ok: false,
      localCount: local.length,
      pushed: 0,
      cloud: null,
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
    error: failure.message,
    retryable: failure.retryable,
  }
}
