/**
 * 离线壳快照组合（Batch 3 第 8 项 P0 · B2/B3）。
 *
 * 只读组合已有三库，不建新库、不合并三库：
 *   - 最近访问：lib/offline-recent.ts（IndexedDB navhub-offline，50 条）
 *   - 收藏：localStorage navhub.favorites.v1（经 lib/favorites-storage.ts 解析）
 *   - 稍后再看（仅元数据）：lib/offline-video-cache.ts
 *   - 续播：lib/video-playback-storage.ts（localStorage，30 条）
 *
 * 诚实口径：这里的「稍后再看」只有标题等元数据，视频本身不在本机，
 * 文案只许说「稍后再看 / 续播」，不许承诺下载完成或离线播放能力。
 * 收藏读失败（corrupt）时返回空 + 标 corrupt: true，绝不把坏数据当空收藏写回——
 * 本模块只读不写，调用方看到 corrupt 必须只展示、不覆盖。
 */

import { FAVORITES_STORAGE_KEY, parseFavorites } from './favorites-storage'
import {
  OFFLINE_RECENT_LIMIT,
  readOfflineVisits,
  clearOfflineVisits,
  type RecentVisit,
} from './offline-recent'
import {
  clearOfflineCache,
  listOfflineVideos,
} from './offline-video-cache'
import { getPlaybackHistory, type PlaybackHistoryItem } from './video-playback-storage'
import type { NavigationSubItem } from '@/types/navigation'

/** Service Worker 离线壳的缓存名，与 public/sw.js 的 CACHE 保持一致 */
export const OFFLINE_SHELL_CACHE = 'navhub-v6'

/**
 * 离线壳路由白名单（与 public/sw.js 的 SHELL 里的 HTML 页一致）。
 * 不进：`/search`（无本地数据会给用户「能搜」的错觉）、`/me/*` 子页（只留 `/me`）、
 * `/api/*`、`/pub/*` 等动态路由。
 */
export const OFFLINE_SHELL_ROUTES = [
  '/',
 '/offline', '/favorites', '/me', '/algorithms', '/videos', '/scenes', '/hot', '/tags',
] as const

/** 稍后再看淘汰上限，与最近访问的 50 条对齐 */
export const WATCH_LATER_LIMIT = 50

/** /offline 页每个分区展示的条数，超了引导去 /favorites / /videos */
export const OFFLINE_SNAPSHOT_SECTION_LIMIT = 10

/**
 * /offline 标题过滤（Batch 3 第 8 项 P2）：只过滤本机快照的标题，
 * 不调 /api/search、不建全文索引。空查询不过滤；其余按去空格后
 * 的小写子串匹配（标题含查询串即命中）。
 */
export function matchesOfflineTitle(title: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return title.toLowerCase().includes(q)
}

/** 收藏在快照里的最小形态（LocalFavorite 的结构子集，不依赖 hooks 层） */
export interface OfflineSnapshotFavorite {
  siteId: string
  title: string
  href: string
  icon?: string
  createdAt: number
}

export interface OfflineSnapshotFavorites {
  items: OfflineSnapshotFavorite[]
  /** 存储里有数据但读不出来：调用方只展示、不覆盖 */
  corrupt: boolean
}

export interface OfflineSnapshot {
  recent: RecentVisit[]
  favorites: OfflineSnapshotFavorites
  offlineVideos: NavigationSubItem[]
  resume: PlaybackHistoryItem[]
}

/** 纯函数：该路径是否在离线壳白名单内（末尾斜杠归一，根路径除外） */
export function isShellRoute(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return (OFFLINE_SHELL_ROUTES as readonly string[]).includes(normalized)
}

/** 纯函数：最近访问按 visitedAt 新→旧排序并截断（复用已有的 50 上限） */
export function sortRecentVisits(list: RecentVisit[], limit = OFFLINE_RECENT_LIMIT): RecentVisit[] {
  return [...list].sort((a, b) => b.visitedAt - a.visitedAt).slice(0, Math.max(1, limit))
}

/** 稍后再看条目参与淘汰所需的最小字段：保存时刻 */
export interface WatchLaterEntry {
  downloadedAt: number
}

/**
 * 纯函数：稍后再看淘汰——按 downloadedAt 新→旧排序并截断到上限，
 * 超限时丢的是最旧，不是最新。
 */
export function trimWatchLater<T extends WatchLaterEntry>(items: T[], limit = WATCH_LATER_LIMIT): T[] {
  return [...items].sort((a, b) => b.downloadedAt - a.downloadedAt).slice(0, Math.max(1, limit))
}

/** 纯函数：续播按 lastWatchedAt 新→旧排序并截断 */
export function sortResumeByRecency(
  list: PlaybackHistoryItem[],
  limit = OFFLINE_SNAPSHOT_SECTION_LIMIT,
): PlaybackHistoryItem[] {
  return [...list].sort((a, b) => b.lastWatchedAt - a.lastWatchedAt).slice(0, Math.max(1, limit))
}

function getFavoritesStorage(): Pick<Storage, 'getItem'> | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  const g = globalThis as unknown as { localStorage?: Pick<Storage, 'getItem'> }
  return g.localStorage ?? null
}

/**
 * 读本机收藏：只读不写。
 * 存储读不到（隐私模式 / 权限被拒）时无法确认是否为空，按 corrupt 处理——
 * 把「未知」当成「没有收藏」再写回，才是会丢数据的那条路。
 */
export function readLocalFavorites(): OfflineSnapshotFavorites {
  const storage = getFavoritesStorage()
  if (!storage) return { items: [], corrupt: false }
  let raw: string | null
  try {
    raw = storage.getItem(FAVORITES_STORAGE_KEY)
  } catch {
    return { items: [], corrupt: true }
  }
  const { items, corrupt } = parseFavorites<OfflineSnapshotFavorite>(raw)
  return { items, corrupt }
}

/**
 * 读离线快照：四库各读各的，任一库失败只让该分区为空，不拖垮整份快照。
 * 永远不 reject（存储层本身已尽力而为，失败即空分区）。
 */
export async function readOfflineSnapshot(): Promise<OfflineSnapshot> {
  const [recent, offlineVideos, resume] = await Promise.all([
    readOfflineVisits(OFFLINE_RECENT_LIMIT).catch(() => [] as RecentVisit[]),
    listOfflineVideos().catch(() => [] as NavigationSubItem[]),
    Promise.resolve().then(() => getPlaybackHistory()).catch(() => [] as PlaybackHistoryItem[]),
  ])
  return {
    recent: sortRecentVisits(recent),
    favorites: readLocalFavorites(),
    offlineVideos,
    resume: sortResumeByRecency(resume),
  }
}

/** 读 SHELL 缓存条目数；CacheStorage 不可用时返回 null（读不出，不是 0 条） */
export async function countShellCacheEntries(): Promise<number | null> {
  try {
    if (typeof caches === 'undefined') return null
    const cache = await caches.open(OFFLINE_SHELL_CACHE)
    const keys = await cache.keys()
    return keys.length
  } catch {
    return null
  }
}

/* ------------------------- 一键清空离线数据（B3） ------------------------- */

export interface ClearOfflineShellStepResult {
  ok: boolean
  error?: string
}

export interface ClearOfflineShellResult {
  /** 稍后再看元数据缓存（clearOfflineCache） */
  videoCache: ClearOfflineShellStepResult
  /** 最近访问 + 点击出箱（clearOfflineVisits） */
  visits: ClearOfflineShellStepResult
  /** SHELL CacheStorage（caches.delete('navhub-v6')） */
  shellCache: ClearOfflineShellStepResult
  /** 重新注册 Service Worker（删缓存后重建离线壳） */
  reregistered: ClearOfflineShellStepResult
  /** 四处是否全部成功；任一失败即 false，调用方不许报「已清空」 */
  ok: boolean
}

export interface ClearOfflineShellDeps {
  clearVideoCache?: () => Promise<void>
  clearVisits?: () => Promise<void>
  deleteShellCache?: (name: string) => Promise<boolean>
  reregisterServiceWorker?: () => Promise<void>
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const defaultClearDeps: Required<ClearOfflineShellDeps> = {
  clearVideoCache: () => clearOfflineCache(),
  clearVisits: () => clearOfflineVisits(),
  deleteShellCache: async (name: string) => {
    if (typeof caches === 'undefined') return false
    return caches.delete(name)
  },
  reregisterServiceWorker: async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      throw new Error('Service Worker 不可用')
    }
    await navigator.serviceWorker.register('/sw.js')
  },
}

/**
 * 一键清空离线数据：顺序固定为
 *   1. clearOfflineCache()（稍后再看元数据）
 *   2. clearOfflineVisits()（最近访问 + 点击出箱）
 *   3. caches.delete('navhub-v6')（SHELL 缓存）
 *   4. 重新注册 Service Worker（重建离线壳）
 *
 * 失败语义：某步失败不阻断后续步骤（后面的仍要清），但结果 ok 为 false，
 * 调用方必须按失败步骤如实报，不许谎报「已清空」。
 * `caches.delete` 返回 false 只表示该缓存本来就不存在（三处已是空），
 * 不算失败；只有 reject 才算清缓存失败。
 */
export async function clearOfflineShellData(
  deps: ClearOfflineShellDeps = {},
): Promise<ClearOfflineShellResult> {
  const d = { ...defaultClearDeps, ...deps }
  const result: ClearOfflineShellResult = {
    videoCache: { ok: true },
    visits: { ok: true },
    shellCache: { ok: true },
    reregistered: { ok: true },
    ok: true,
  }
  try {
    await d.clearVideoCache()
  } catch (err) {
    result.videoCache = { ok: false, error: messageOf(err) }
  }
  try {
    await d.clearVisits()
  } catch (err) {
    result.visits = { ok: false, error: messageOf(err) }
  }
  try {
    await d.deleteShellCache(OFFLINE_SHELL_CACHE)
  } catch (err) {
    result.shellCache = { ok: false, error: messageOf(err) }
  }
  try {
    await d.reregisterServiceWorker()
  } catch (err) {
    result.reregistered = { ok: false, error: messageOf(err) }
  }
  result.ok =
    result.videoCache.ok && result.visits.ok && result.shellCache.ok && result.reregistered.ok
  return result
}
