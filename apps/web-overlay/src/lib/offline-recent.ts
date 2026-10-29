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
/**
 * 点击证据出箱（run100）：与「最近访问」快照**分轨**。
 *
 * 为什么要分轨：快照按 id 去重合并、只存导航最小字段（见文件头），语义是「展示」；
 * 证据流要逐条保留（同站连点三次就是三条），且携带查询词——两者生命周期与隐私含义都不同。
 * 版本 1→2 只新增 store，`recent-visits` 原样保留（升级失败也不会读到空列表：
 * openDb 对每个 store 都做 contains 判断）。
 */
const DB_VERSION = 2
const OUTBOX_STORE = 'click-outbox'
const OUTBOX_LS_KEY = 'navhub:click-outbox:v1'
export const CLICK_OUTBOX_LIMIT = 50

export interface ClickOutboxEntry {
  /** 幂等键（≤64，字符集受限）：服务端据此拒绝重复计数 */
  eventId: string
  body: Record<string, unknown>
  /** 入队时刻（毫秒），只用于淘汰最旧，不作为事件时间 */
  queuedAt: number
  /**
   * 匿名身份（`X-Navhub-Anon-Id` 的值）。
   *
   * 必须随条目一起存：重放时丢了它，这条点击在中枢侧就落成无主数据，
   * 既进不了画像也无法按身份清理——那比不上报更糟。
   * 它本来就是本机 localStorage 里的设备匿名 id，不是新增的隐私面。
   */
  identity?: string
}

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
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          db.createObjectStore(OUTBOX_STORE, { keyPath: 'eventId' })
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

/**
 * 清空本机端侧数据：快照 + 待上报出箱一起清。
 *
 * 为什么要一起清（run100）：这条函数是用户「忘记我的访问记录」与 /me/data 删除动作
 * 唯一的端侧入口。只清快照会留下一个洞——出箱里还躺着带查询词的点击证据，
 * 用户以为删干净了，回到线上又会被送出（数据主权的「说了就要做到」）。
 */
export async function clearOfflineVisits(): Promise<void> {
  memoryFallback = []
  memoryOutbox = []
  writeToLs([])
  writeOutboxToLs([])
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([STORE, OUTBOX_STORE], 'readwrite')
      tx.objectStore(STORE).clear()
      tx.objectStore(OUTBOX_STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
  db.close()
}

/* --------------------- 点击证据出箱（run100 新增轨） --------------------- */

let memoryOutbox: ClickOutboxEntry[] = []

function readOutboxFromLs(): ClickOutboxEntry[] {
  try {
    const raw = localStorage.getItem(OUTBOX_LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ClickOutboxEntry[]).slice(0, CLICK_OUTBOX_LIMIT) : []
  } catch {
    return []
  }
}

function writeOutboxToLs(list: ClickOutboxEntry[]): boolean {
  try {
    localStorage.setItem(OUTBOX_LS_KEY, JSON.stringify(list.slice(0, CLICK_OUTBOX_LIMIT)))
    return true
  } catch {
    return false
  }
}

/**
 * 纯函数：把一次待上报并入出箱。
 *
 * 返回**新→旧**且长度有界的列表：超限时丢的是最旧，不是最新——
 * 刚产生的那条如果因为队列满而被静默丢掉，用户看到的正是「我明明点了却没计数」。
 * 同 eventId 覆盖（重放/重试不该占两个格子）。
 */
export function mergeOutbox(
  list: ClickOutboxEntry[],
  entry: ClickOutboxEntry,
  limit = CLICK_OUTBOX_LIMIT,
): ClickOutboxEntry[] {
  const cap = Math.max(1, limit)
  const rest = list
    .filter((e) => e.eventId !== entry.eventId)
    .sort((a, b) => b.queuedAt - a.queuedAt)
  return [entry, ...rest].slice(0, cap)
}

/** IDB 全量行（不分页）：容量收敛要知道总数，按 limit 读会把「是否超限」读成「没超限」 */
function outboxRows(db: IDBDatabase): Promise<ClickOutboxEntry[]> {
  return new Promise<ClickOutboxEntry[]>((resolve) => {
    try {
      const tx = db.transaction(OUTBOX_STORE, 'readonly')
      const all = tx.objectStore(OUTBOX_STORE).getAll()
      all.onsuccess = () => resolve((all.result as ClickOutboxEntry[]) ?? [])
      all.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

/** 入队一次未送达的点击证据（幂等键已存在于 body 里） */
export async function enqueueClickReport(entry: ClickOutboxEntry): Promise<void> {
  const db = await openDb()
  if (db) {
    try {
      const current = await outboxRows(db)
      const merged = mergeOutbox(current, entry)
      await new Promise<void>((resolve) => {
        const tx = db.transaction(OUTBOX_STORE, 'readwrite')
        const store = tx.objectStore(OUTBOX_STORE)
        store.put(entry)
        const kept = new Set(merged.map((e) => e.eventId))
        // 只删被容量挤出的旧条目，不用 clear()：并发写入的另一条证据不该被这次入队带走
        for (const e of current) if (!kept.has(e.eventId)) store.delete(e.eventId)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
      db.close()
      return
    } catch {
      db.close()
      // 落到 localStorage 分支
    }
  }
  const merged = mergeOutbox(readOutboxFromLs(), entry)
  if (!writeOutboxToLs(merged)) memoryOutbox = merged
}

/** 读取待上报队列（旧→新，发送按此顺序，保持因果） */
export async function readClickOutbox(limit = 20): Promise<ClickOutboxEntry[]> {
  const cap = Math.max(1, Math.min(limit, CLICK_OUTBOX_LIMIT))
  const db = await openDb()
  let rows: ClickOutboxEntry[] = []
  if (db) {
    rows = await outboxRows(db)
    db.close()
  }
  if (rows.length === 0) rows = readOutboxFromLs()
  if (rows.length === 0) rows = memoryOutbox
  return rows.sort((a, b) => a.queuedAt - b.queuedAt).slice(0, cap)
}

/** 发送成功后按幂等键移除（绝不整表清空：未确认的条目要留下一次重试） */
export async function removeClickReports(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return
  const doomed = new Set(eventIds)
  const db = await openDb()
  if (db) {
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(OUTBOX_STORE, 'readwrite')
        const store = tx.objectStore(OUTBOX_STORE)
        for (const id of doomed) store.delete(id)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
      db.close()
    } catch {
      db.close()
    }
  }
  writeOutboxToLs(readOutboxFromLs().filter((e) => !doomed.has(e.eventId)))
  memoryOutbox = memoryOutbox.filter((e) => !doomed.has(e.eventId))
}
