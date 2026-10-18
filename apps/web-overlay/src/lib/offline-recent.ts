'use client'

/**
 * 离线「最近访问」快照（P2-3 第一块）。
 *
 * 场景：地铁 / 弱网 / 断网。Service Worker 已经保证离线能打开外壳，
 * 但用户真正想找的是「我常用的那几个站点」——它们的数据要能在本地查。
 *
 * 设计：
 *   - 存储 IndexedDB 优先（容量大、异步、不阻塞渲染）；
 *     不可用（隐私模式 / 旧浏览器）时降级 localStorage，再降级内存；
 *   - 容量 50 条，同 id 再次访问时移到最前并刷新时间；
 *   - **只存导航所需的最小字段**（id / 标题 / 链接 / 图标 / 时间），
 *     不存查询词、不存用户内容——这份数据要能随时整表清掉且不心疼；
 *   - 纯逻辑 `mergeRecentVisit` 单独导出并单测，存储层只做读写。
 */

export interface RecentVisit {
  id: string
  title: string
  href: string
  icon?: string | null
  visitedAt: number
}

export const OFFLINE_RECENT_LIMIT = 50
const DB_NAME = 'navhub-offline'
const STORE = 'recent-visits'
const LS_KEY = 'navhub:recent-offline:v1'

/** 纯函数：把一次访问并入列表（去重、置顶、截断） */
export function mergeRecentVisit(list: RecentVisit[], visit: RecentVisit, limit = OFFLINE_RECENT_LIMIT): RecentVisit[] {
  const rest = list.filter((v) => v.id !== visit.id)
  return [visit, ...rest].slice(0, Math.max(1, limit))
}

/* ------------------------------ 存储层 ------------------------------ */

let memoryFallback: RecentVisit[] = []

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase | null> {
  if (!idbAvailable()) return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function readFromLs(): RecentVisit[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RecentVisit[]).slice(0, OFFLINE_RECENT_LIMIT) : []
  } catch {
    return []
  }
}

function writeToLs(list: RecentVisit[]): boolean {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, OFFLINE_RECENT_LIMIT)))
    return true
  } catch {
    return false
  }
}

/** 记录一次访问（fire-and-forget，永不 reject） */
export function recordOfflineVisit(visit: Omit<RecentVisit, 'visitedAt'>): void {
  const entry: RecentVisit = { ...visit, visitedAt: Date.now() }
  void (async () => {
    const db = await openDb()
    if (db) {
      try {
        const current = await new Promise<RecentVisit[]>((resolve) => {
          const tx = db.transaction(STORE, 'readonly')
          const store = tx.objectStore(STORE)
          const all = store.getAll()
          all.onsuccess = () => resolve((all.result as RecentVisit[]) ?? [])
          all.onerror = () => resolve([])
        })
        const merged = mergeRecentVisit(current, entry)
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        store.clear()
        for (const v of merged) store.put(v)
        tx.oncomplete = () => db.close()
        tx.onerror = () => db.close()
        return
      } catch {
        db.close()
        // 落到 localStorage 分支
      }
    }
    const merged = mergeRecentVisit(readFromLs(), entry)
    if (!writeToLs(merged)) memoryFallback = merged
  })()
}

/** 读取最近访问（新→旧，最多 limit 条） */
export async function readOfflineVisits(limit = OFFLINE_RECENT_LIMIT): Promise<RecentVisit[]> {
  const db = await openDb()
  if (db) {
    const rows = await new Promise<RecentVisit[]>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly')
        const all = tx.objectStore(STORE).getAll()
        all.onsuccess = () => resolve((all.result as RecentVisit[]) ?? [])
        all.onerror = () => resolve([])
      } catch {
        resolve([])
      }
    })
    db.close()
    if (rows.length > 0) {
      return rows.sort((a, b) => b.visitedAt - a.visitedAt).slice(0, limit)
    }
    // IDB 空但 localStorage 可能有（降级写入过）：合并返回
    const ls = readFromLs()
    if (ls.length > 0) return ls.sort((a, b) => b.visitedAt - a.visitedAt).slice(0, limit)
    return []
  }
  const ls = readFromLs()
  if (ls.length > 0) return ls.sort((a, b) => b.visitedAt - a.visitedAt).slice(0, limit)
  return memoryFallback.slice(0, limit)
}

/** 清空（用户可在设置里「忘记我的访问记录」） */
export async function clearOfflineVisits(): Promise<void> {
  memoryFallback = []
  writeToLs([])
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
  db.close()
}
