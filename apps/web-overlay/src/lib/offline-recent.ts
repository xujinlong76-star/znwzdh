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
 *   - 容量 50 条，同 id 再次访问时移到最前、刷新时间并累计次数
 *     （`count`，旧数据缺失时按 1 计）——「最近」之外还要有「频次」，
 *     速览坞才能把真正每天点的站浮上来，而不是只看最后一次点开；
 *   - 同次点击另写一份 `{ count, lastVisitedAt }` 到
 *     `navhub_visit_counts_v1`，供 DIY「智能自适应调优」计分
 *     （`computeSmartAutoTune` 读该键；此前全仓无写入，是死信号）；
 *     清记录时该键随快照一起清，不留「删了还记得」的尾巴；
 *   - **只存导航所需的最小字段**（id / 标题 / 链接 / 图标 / 时间 / 次数），
 *     不存查询词、不存用户内容——这份数据要能随时整表清掉且不心疼；
 *   - 纯逻辑 `mergeRecentVisit` / `topFrequentVisits` 单独导出并单测，存储层只做读写。
 */

export interface RecentVisit {
  id: string
  title: string
  href: string
  icon?: string | null
  visitedAt: number
  /** 本机累计点击次数。旧数据缺失时按 1 计，不做迁移。 */
  count?: number
}

export const OFFLINE_RECENT_LIMIT = 50
const DB_NAME = 'navhub-offline'
const STORE = 'recent-visits'
const LS_KEY = 'navhub:recent-offline:v1'

/**
 * DIY「智能自适应调优」读的访问频次键（`computeSmartAutoTune` 的 visitStats）。
 *
 * 形状 `{ [siteId]: { count, lastVisitedAt } }`，与 `diy-presets.ts` 的
 * `Record<string, { count: number; lastVisitedAt?: number }>` 对齐。
 * 此前全仓只有 `use-home-diy.ts` 一处读、没有任何写入，调优里的频次分
 * 恒为 0；现在由 `recordOfflineVisit` 每次点击同步累加（唯一写入口，
 * 卡片 / 搜索 / spotlight 三路点击都走它）。
 */
export const VISIT_COUNTS_KEY = 'navhub_visit_counts_v1'

/** 同步累加一次点击计数（永不抛错；存储不可用即跳过，不阻断主流程）。 */
export function bumpVisitCount(siteId: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    let stats: Record<string, { count: number; lastVisitedAt?: number }> = {}
    try {
      const raw = localStorage.getItem(VISIT_COUNTS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stats = parsed
      }
    } catch {
      stats = {}
    }
    const prev = stats[siteId]
    stats[siteId] = { count: (prev?.count ?? 0) + 1, lastVisitedAt: Date.now() }
    localStorage.setItem(VISIT_COUNTS_KEY, JSON.stringify(stats))
  } catch {
    // 计数写失败不阻断主流程：快照仍在，调优降级为空
  }
}
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

/** 纯函数：把一次访问并入列表（去重、置顶、累计次数、截断） */
export function mergeRecentVisit(list: RecentVisit[], visit: RecentVisit, limit = OFFLINE_RECENT_LIMIT): RecentVisit[] {
  const existing = list.find((v) => v.id === visit.id)
  // 旧数据无 count 字段时按 1 起计：首次记 1，之后每次 +1
  const mergedVisit: RecentVisit = { ...visit, count: existing ? (existing.count ?? 1) + 1 : 1 }
  const rest = list.filter((v) => v.id !== visit.id)
  return [mergedVisit, ...rest].slice(0, Math.max(1, limit))
}

export const MRU_MIN_USES_FOR_BOOST = 3

const DAY_MS = 86400000
/**
 * 7 天内的时间分表（下标 0..6，对应 7 天前..当天）。
 *
 * 方案 §3.2 写死：`fib = [5, 8, 13, 21, 34, 55, 89]`，7 天内取
 * `fib[7 - daysAgo]`（当天 89、7 天前 5）。7 元表只有下标 0..6，
 * 因此 daysAgo 在这一支里按 1..7 取：ceil 取整下「当天内」算出
 * 的 daysAgo 是 0 或 1，两者都按「当天」取 fib[6]=89（visitedAt
 * 恰好等于 now 的边界也一样，不取 fib[7] 越界）。
 */
const MRU_FIB_BONUS = [5, 8, 13, 21, 34, 55, 89]

/**
 * MRU 分（抄 Wox `calculateMRUScore`，三项相加；纯函数，可单测）。
 *
 *   score = log(count) * 15 + fibBonus + min(count / 建库天数 * 10, 50)
 *
 * - 次数分：`Math.log(count) * 15`（自然对数；count=1 时为 0）。
 *   count 缺失按 1 计（与 `topFrequentVisits` 的 `(count ?? 1)` 同口径），
 *   非法 count（0 / 负数）钳到 1，不让 `log(0)` 拖出 -Infinity。
 * - 时间分：`daysAgo = ceil((now - visitedAt) / 86400000)`，未来时间戳
 *   （时钟 skew）钳到 0，按当天计；7 天内取 `fib[7 - daysAgo]`，
 *   7–30 天统一 +3，>30 天 +0。
 * - 频率分：`min(count / 建库天数 * 10, 50)`，封顶 50。建库天数 =
 *   `max(1, ceil((now - 最早一条 visit 的 visitedAt) / 86400000))`，
 *   由调用方以 `earliestVisitedAt` 传入（`topFrequentVisits` 取全表
 *   最早一条）；单条调用不传时默认以本条 visit 自身为建库起点
 *   （即单条列表的建库天数）。空列表没有可打分的 visit，频率分
 *   无从谈起——`topFrequentVisits([])` 直接返回 []。
 *
 * `now` 由调用方传入（默认 `Date.now()`），便于单测固定时间。
 */
export function mruScore(visit: RecentVisit, now: number = Date.now(), earliestVisitedAt: number = visit.visitedAt): number {
  const count = Math.max(1, visit.count ?? 1)
  const daysAgo = Math.max(0, Math.ceil((now - visit.visitedAt) / DAY_MS))
  const fibBonus = daysAgo <= 7 ? MRU_FIB_BONUS[7 - Math.max(1, daysAgo)]! : daysAgo <= 30 ? 3 : 0
  const libraryDays = Math.max(1, Math.ceil((now - earliestVisitedAt) / DAY_MS))
  const frequency = Math.min((count / libraryDays) * 10, 50)
  return Math.log(count) * 15 + fibBonus + frequency
}

/**
 * 纯函数：按「常用」排序（`mruScore` 降序，分数相同（差值 < 1e-9）时按最近访问降序），取前 limit 条。
 *
 * 速览坞用它挑「最近常用」位：只按时间取前 3 条会把「昨天连点 10 次的站」
 * 排在「刚才误点一次的站」之后。缺 count 的旧数据按 1 计，不丢弃。
 * 同一调用内只取一次 `now`（不多次取时，避免排序中途时间跳变）；
 * 建库起点取全表最早一条的 `visitedAt`，与 `mruScore` 的频率分同口径。
 */
export function topFrequentVisits(list: RecentVisit[], limit = 6): RecentVisit[] {
  const cap = Math.max(0, limit)
  if (list.length === 0) return []
  const now = Date.now()
  const earliestVisitedAt = Math.min(...list.map((v) => v.visitedAt))
  return [...list]
    .sort((a, b) => {
      const scoreDiff = mruScore(b, now, earliestVisitedAt) - mruScore(a, now, earliestVisitedAt)
      if (Math.abs(scoreDiff) >= 1e-9) return scoreDiff
      return b.visitedAt - a.visitedAt
    })
    .slice(0, cap)
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
  // 频次键与快照同次写：调优的计分终于能读到真实点击
  bumpVisitCount(visit.id)
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
  // 频次键随快照一起清：用户点了「忘记」之后，调优也不该还记得
  try {
    localStorage.removeItem(VISIT_COUNTS_KEY)
  } catch {
    // 存储不可用时无键可清
  }
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
