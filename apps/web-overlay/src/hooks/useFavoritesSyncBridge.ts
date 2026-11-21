'use client'
/**
 * 收藏变化 → 同步引擎桥接（2026-11-21）。
 *
 * ## 为什么用"快照差异"而不是改 useFavorites
 *
 * useFavorites.ts 有 1800+ 行，内部有共享状态、脏标记、撤销栈、回收站、
 * 待读分流等多套机制，且正被并发修改。直接在里面插 enqueue() 调用点
 * 既容易漏（toggle/remove/updateMeta/restoreFavorites 都是入口），
 * 也会把 Local-First 的写入语义和同步语义耦合死。
 *
 * 这里改为**纯观察**：对比前后两次 items 快照，算出增/删/改，
 * 再交给引擎入队。不侵入写入路径，任何新增的写入方法自动被覆盖。
 *
 * ## 局限（明确写出来）
 *
 * 差异检测无法区分"同值重写"与"没改"，所以 updateMeta 把 note 改成
 * 相同值时不会产生 op——这恰好是想要的行为（幂等，不刷无意义请求）。
 */
import { useEffect, useRef } from 'react'
import type { ConflictFieldKey, OutboxMutation } from '@/lib/favorites-sync'
import type { LocalFavorite } from '@/hooks/useFavorites'
import type { FavoritesSyncEngine } from '@/lib/favorites-sync-engine'

/** 参与同步比较的字段（与 FavoriteSyncOp 支持的字段对齐） */
const SYNCED_FIELDS: readonly ConflictFieldKey[] = ['folderId', 'note', 'tags']

function sameTags(a?: string[], b?: string[]): boolean {
  const x = a ?? []
  const y = b ?? []
  if (x.length !== y.length) return false
  return x.every((v, i) => v === y[i])
}

/** 比较两份快照，产出 Outbox 变更（不含 mutationId/retryCount） */
export function diffFavoritesToMutations(
  prev: readonly LocalFavorite[],
  next: readonly LocalFavorite[],
  now: number = Date.now(),
): Array<Omit<OutboxMutation, 'mutationId' | 'retryCount'>> {
  const prevMap = new Map(prev.map((f) => [f.siteId, f]))
  const nextMap = new Map(next.map((f) => [f.siteId, f]))
  const out: Array<Omit<OutboxMutation, 'mutationId' | 'retryCount'>> = []

  // 新增
  for (const [id, item] of nextMap) {
    if (prevMap.has(id)) continue
    out.push({
      itemId: id,
      op: 'upsert',
      baseRevision: 0,
      changedFields: ['title', 'url', ...SYNCED_FIELDS],
      payload: {
        title: item.title,
        url: item.href,
        folderId: item.folderId ?? null,
        note: item.note ?? null,
        tags: item.tags ?? null,
      },
      updatedAtMs: now,
    });
  }

  // 删除
  for (const id of prevMap.keys()) {
    if (nextMap.has(id)) continue
    out.push({ itemId: id, op: 'delete', baseRevision: 0, changedFields: ['deleted'], updatedAtMs: now });
  }

  // 字段变更
  for (const [id, item] of nextMap) {
    const before = prevMap.get(id)
    if (!before) continue
    const changed: ConflictFieldKey[] = []
    if ((before.folderId ?? null) !== (item.folderId ?? null)) changed.push('folderId')
    if ((before.note ?? null) !== (item.note ?? null)) changed.push('note')
    if (!sameTags(before.tags, item.tags)) changed.push('tags')
    if (changed.length === 0) continue
    out.push({
      itemId: id,
      op: 'upsert',
      baseRevision: 0,
      changedFields: changed,
      payload: {
        title: item.title,
        url: item.href,
        folderId: item.folderId ?? null,
        note: item.note ?? null,
        tags: item.tags ?? null,
      },
      updatedAtMs: now,
    });
  }

  return out
}

/**
 * 观察 items 变化并入队。
 *
 * 首次渲染只记录基线、不产生 op——否则页面一打开就会把整份收藏
 * 当"新增"全推一遍。
 */
export function useFavoritesSyncBridge(
  items: readonly LocalFavorite[],
  engine: FavoritesSyncEngine | null,
  enabled: boolean,
): void {
  const prevRef = useRef<readonly LocalFavorite[] | null>(null)

  useEffect(() => {
    if (!enabled || !engine) return
    if (prevRef.current === null) {
      prevRef.current = items
      return
    }
    const mutations = diffFavoritesToMutations(prevRef.current, items)
    prevRef.current = items
    for (const m of mutations) void engine.enqueue(m)
  }, [items, engine, enabled])
}
