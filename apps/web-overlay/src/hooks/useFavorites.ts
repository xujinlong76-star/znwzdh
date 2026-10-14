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
 * 登录后调用一次：把本地收藏合并到云端（并集，createdAt 新者胜），
 * 返回合并后的云端收藏列表。未登录 / 中枢不可用时返回 null。
 */
export async function syncFavoritesToCloud(): Promise<HubFavorite[] | null> {
  const identity = getIdentity()
  if (!identity) return null
  const local = loadLocal()
  for (const f of local) {
    await addFavorite(identity, f.siteId)
  }
  const cloud = await listFavorites(identity)
  return cloud.items
}
