import type { OutboxMutation, SyncConflictItem } from './favorites-sync'
import { compactOutbox, OUTBOX_MAX_ITEMS, OUTBOX_STORE } from './favorites-sync'

/**
 * 收藏同步 Outbox 的持久化层（2026-11-21）。
 *
 * ## 为什么 Outbox 要单独落在 IndexedDB
 *
 * 收藏本体在 localStorage（navhub.favorites.v1）——那是既有事实，不能动
 * （改了等于把老用户的收藏丢掉）。但 Outbox 是**高频追加、按条件清理**
 * 的队列，塞进同一个 localStorage 键会让每次收藏写入都序列化/反序列化
 * 整个列表，而且 5MB 配额很快就会撞满。
 *
 * 所以 Outbox 独立存 IndexedDB，与 offline-video-cache.ts 同一套降级策略
 * （IndexedDB → localStorage → 内存），保证任何环境下都不会因存储不可用
 * 而让收藏写入失败。
 *
 * ## Local-First 语义
 *
 * `appendMutation` 成功返回即代表"本机已存"——调用方不等待云端。
 * 即使 IndexedDB 不可用退回内存，本次会话内同步仍能继续；
 * 页面重开后内存队列丢失属可接受降级（收藏本体没丢）。
 */

const DB_NAME = 'navhub_favorites_sync_v1'
const META_STORE = 'sync_meta'
const LS_FALLBACK_KEY = 'navhub.favorites.outbox.v1'
const LS_CONFLICT_KEY = 'navhub.favorites.conflicts.v1'

/** 内存兜底：IndexedDB 与 localStorage 都不可用时的最后一层 */
let memoryOutbox: OutboxMutation[] = []
let memoryConflicts: SyncConflictItem[] = []
let memoryLastSyncedAt: number | null = null

function getIndexedDB(): IDBFactory | null {
  if (typeof window !== 'undefined' && window.indexedDB) return window.indexedDB
  return null
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  } catch {
    /* 隐私模式/禁用存储时访问会抛 */
  }
  return null
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const idb = getIndexedDB()
    if (!idb) return reject(new Error('IndexedDB unavailable'))
    const request = idb.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'mutationId' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function withStore<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode)
    const req = fn(transaction.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/* ==========================================================================
 * 读：整队列
 * ========================================================================== */

/** 读取全部待同步变更（已按 itemId 压缩，同条目多次编辑只留一条） */
export async function readOutbox(): Promise<OutboxMutation[]> {
  try {
    const db = await openDB()
    const all = await withStore<OutboxMutation[]>(db, OUTBOX_STORE, 'readonly', (store) => store.getAll())
    db.close()
    return compactOutbox(all ?? [])
  } catch {
    /* 降级：localStorage → 内存 */
  }
  const ls = getLocalStorage()
  if (ls) {
    try {
      const raw = ls.getItem(LS_FALLBACK_KEY)
      if (raw) return compactOutbox(JSON.parse(raw) as OutboxMutation[])
    } catch {
      /* 坏数据按空队列处理：宁可少同步，不可读到半截 JSON 后写坏 */
    }
  }
  return compactOutbox(memoryOutbox)
}

/* ==========================================================================
 * 写：追加一条变更（本机写入即成功）
 * ========================================================================== */

/**
 * 追加一条 Outbox 变更。
 *
 * **返回即代表本机已存**——调用方不要 await 云端。
 * 若同一 itemId 已有更早的变更，保留最早的 baseRevision（乐观锁基线）。
 */
export async function appendMutation(mutation: OutboxMutation): Promise<void> {
  try {
    const db = await openDB()
    // 先查同 itemId 的既有记录，合并 baseRevision
    const existing = await withStore<OutboxMutation[]>(db, OUTBOX_STORE, 'readonly', (store) => store.getAll())
    const prev = (existing ?? []).find((m) => m.itemId === mutation.itemId)
    const merged: OutboxMutation = prev
      ? {
          ...mutation,
          baseRevision: Math.min(prev.baseRevision, mutation.baseRevision),
          changedFields: [...new Set([...prev.changedFields, ...mutation.changedFields])],
        }
      : mutation
    // 先删同 itemId 的旧记录，避免队列里堆多条
    if (prev) {
      await withStore(db, OUTBOX_STORE, 'readwrite', (store) => store.delete(prev.mutationId))
    }
    await withStore(db, OUTBOX_STORE, 'readwrite', (store) => store.put(merged))
    db.close()
    return
  } catch {
    /* 降级 */
  }
  const ls = getLocalStorage()
  if (ls) {
    try {
      const raw = ls.getItem(LS_FALLBACK_KEY)
      const list = raw ? (JSON.parse(raw) as OutboxMutation[]) : []
      const prevIdx = list.findIndex((m) => m.itemId === mutation.itemId)
      if (prevIdx >= 0) {
        const prev = list[prevIdx]
        list[prevIdx] = {
          ...mutation,
          baseRevision: Math.min(prev.baseRevision, mutation.baseRevision),
          changedFields: [...new Set([...prev.changedFields, ...mutation.changedFields])],
        }
      } else {
        list.push(mutation)
      }
      ls.setItem(LS_FALLBACK_KEY, JSON.stringify(list.slice(-OUTBOX_MAX_ITEMS)))
      return
    } catch {
      /* 配额满等：落到内存 */
    }
  }
  memoryOutbox = compactOutbox([...memoryOutbox, mutation])
}

/** 移除已成功同步的变更（按 mutationId） */
export async function removeMutations(mutationIds: readonly string[]): Promise<void> {
  if (mutationIds.length === 0) return
  const ids = new Set(mutationIds)
  try {
    const db = await openDB()
    for (const id of ids) {
      await withStore(db, OUTBOX_STORE, 'readwrite', (store) => store.delete(id))
    }
    db.close()
    return
  } catch {
    /* 降级 */
  }
  const ls = getLocalStorage()
  if (ls) {
    try {
      const raw = ls.getItem(LS_FALLBACK_KEY)
      const list = raw ? (JSON.parse(raw) as OutboxMutation[]) : []
      ls.setItem(LS_FALLBACK_KEY, JSON.stringify(list.filter((m) => !ids.has(m.mutationId))))
      return
    } catch {
      /* 忽略 */
    }
  }
  memoryOutbox = memoryOutbox.filter((m) => !ids.has(m.mutationId))
}

/** 清空队列（仅在用户明确选择"放弃本机改动"时调用，绝不用于错误恢复） */
export async function clearOutbox(): Promise<void> {
  try {
    const db = await openDB()
    await withStore(db, OUTBOX_STORE, 'readwrite', (store) => store.clear())
    db.close()
    return
  } catch {
    /* 降级 */
  }
  getLocalStorage()?.removeItem(LS_FALLBACK_KEY)
  memoryOutbox = []
}

/* ==========================================================================
 * 冲突集合读写
 * ========================================================================== */

export async function readConflicts(): Promise<SyncConflictItem[]> {
  try {
    const db = await openDB()
    const row = await withStore<{ key: string; value: SyncConflictItem[] } | undefined>(
      db,
      META_STORE,
      'readonly',
      (store) => store.get('conflicts'),
    )
    db.close()
    return row?.value ?? []
  } catch {
    /* 降级 */
  }
  const ls = getLocalStorage()
  if (ls) {
    try {
      const raw = ls.getItem(LS_CONFLICT_KEY)
      if (raw) return JSON.parse(raw) as SyncConflictItem[]
    } catch {
      /* 坏数据按无冲突处理 */
    }
  }
  return memoryConflicts
}

export async function writeConflicts(conflicts: readonly SyncConflictItem[]): Promise<void> {
  const value = [...conflicts]
  try {
    const db = await openDB()
    await withStore(db, META_STORE, 'readwrite', (store) => store.put({ key: 'conflicts', value }))
    db.close()
    return
  } catch {
    /* 降级 */
  }
  const ls = getLocalStorage()
  if (ls) {
    try {
      ls.setItem(LS_CONFLICT_KEY, JSON.stringify(value))
      return
    } catch {
      /* 忽略 */
    }
  }
  memoryConflicts = value
}

/* ==========================================================================
 * 上次同步时刻
 * ========================================================================== */

export async function readLastSyncedAt(): Promise<number | null> {
  try {
    const db = await openDB()
    const row = await withStore<{ key: string; value: number } | undefined>(
      db,
      META_STORE,
      'readonly',
      (store) => store.get('lastSyncedAt'),
    )
    db.close()
    return row?.value ?? null
  } catch {
    /* 降级 */
  }
  return memoryLastSyncedAt
}

export async function writeLastSyncedAt(ms: number): Promise<void> {
  memoryLastSyncedAt = ms
  try {
    const db = await openDB()
    await withStore(db, META_STORE, 'readwrite', (store) => store.put({ key: 'lastSyncedAt', value: ms }))
    db.close()
    return
  } catch {
    /* 降级到内存即可，时间戳丢失不影响正确性 */
  }
}
