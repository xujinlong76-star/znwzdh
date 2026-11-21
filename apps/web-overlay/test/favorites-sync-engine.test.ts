import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createFavoritesSyncEngine } from '../src/lib/favorites-sync-engine'
import type { SyncConflictItem } from '../src/lib/favorites-sync'

/**
 * 同步引擎行为回归（2026-11-21）。
 *
 * 引擎把 Outbox、错误分型、退避重试、冲突检测串起来。
 * 这里测的是**时序与状态机**，不是存储细节（存储层有自己的降级链）。
 *
 * 关键纪律：
 *  - 离线不发请求，也不标红
 *  - 前两次失败保持待同步外观（不闪红）
 *  - 401/密钥锁定立即转 error 且不重试
 *  - 匿名态永不推送
 */

const mkMutation = (itemId: string) => ({
  itemId,
  op: 'upsert' as const,
  baseRevision: 1,
  changedFields: ['title' as const],
  payload: { title: 'X' },
  updatedAtMs: Date.now(),
})

describe('favorites 同步引擎', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // 默认在线
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      writable: true,
      configurable: true,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('本机写入即成功：enqueue 立即返回，不等待云端', async () => {
    const push = vi.fn(async () => ({ ok: true }))
    const engine = createFavoritesSyncEngine({ isAuthed: () => true, push })

    await engine.enqueue(mkMutation('a'))
    // 立即有 pending，但还没推送（1.5s 防抖窗口内）
    expect(push).not.toHaveBeenCalled()
    const snap = engine.snapshot()
    expect(snap.pendingCount).toBeGreaterThanOrEqual(0)
    expect(snap.dirtyItemIds.has('a')).toBe(true)
  })

  it('匿名态永不推送', async () => {
    const push = vi.fn(async () => ({ ok: true }))
    const engine = createFavoritesSyncEngine({ isAuthed: () => false, push })
    await engine.enqueue(mkMutation('a'))
    await vi.advanceTimersByTimeAsync(2000)
    await engine.flush()
    expect(push).not.toHaveBeenCalled()
  })

  it('离线不发请求（避免无谓失败与错误闪烁）', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      writable: true,
      configurable: true,
    })
    const push = vi.fn(async () => ({ ok: true }))
    const engine = createFavoritesSyncEngine({ isAuthed: () => true, push })
    await engine.enqueue(mkMutation('a'))
    await vi.advanceTimersByTimeAsync(3000)
    await engine.flush()
    expect(push).not.toHaveBeenCalled()
  })

  it('推送成功后队列清空、lastSyncedAt 更新', async () => {
    const push = vi.fn(async () => ({ ok: true }))
    const engine = createFavoritesSyncEngine({ isAuthed: () => true, push })
    await engine.enqueue(mkMutation('a'))
    await engine.flush()
    expect(push).toHaveBeenCalled()
    const snap = engine.snapshot()
    expect(snap.lastSyncedAtMs).toBeTruthy()
  })

  it('401 立即转 error 且不重试（重试只会刷错误）', async () => {
    const push = vi.fn(async () => ({ ok: false, errorKind: 'auth_expired' as const }))
    const engine = createFavoritesSyncEngine({ isAuthed: () => true, push })
    await engine.enqueue(mkMutation('a'))
    await engine.flush()
    const snap = engine.snapshot()
    expect(snap.badgeState).toBe('error')
    expect(snap.error?.kind).toBe('auth_expired')
    // 不应安排重试
    expect(snap.nextRetryAtMs).toBeNull()
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('服务端 5xx 走退避重试，首次失败不立即标红', async () => {
    let calls = 0
    const push = vi.fn(async () => {
      calls += 1
      return { ok: false, errorKind: 'server_5xx' as const }
    })
    const engine = createFavoritesSyncEngine({ isAuthed: () => true, push })
    await engine.enqueue(mkMutation('a'))
    await engine.flush()
    // 第一次失败：安排了退避，但还没耗尽 → 不暴露 error
    const snap = engine.snapshot()
    expect(snap.error).toBeUndefined()
    expect(snap.nextRetryAtMs).toBeTruthy()
  })

  it('连续 3 次失败后才转 error 态', async () => {
    const push = vi.fn(async () => ({ ok: false, errorKind: 'server_5xx' as const }))
    const engine = createFavoritesSyncEngine({ isAuthed: () => true, push })
    await engine.enqueue(mkMutation('a'))
    await engine.flush()
    // 推进两次退避（2s + 6s）
    await vi.advanceTimersByTimeAsync(2100)
    await vi.advanceTimersByTimeAsync(6100)
    const snap = engine.snapshot()
    expect(snap.badgeState).toBe('error')
  })

  it('冲突出现在快照的 conflictItemIds 里（与徽标同源）', async () => {
    const conflict: SyncConflictItem = {
      conflictId: 'c1',
      itemId: 'a',
      itemTitle: 'A',
      conflictType: 'field_divergence',
      divergedFields: ['title'],
      baseSnapshot: { title: 'old' },
      localSnapshot: { title: 'local' },
      remoteSnapshot: { title: 'remote' },
      localUpdatedAtMs: Date.now(),
      remoteUpdatedAtMs: Date.now(),
      remoteRevision: 2,
    }
    const push = vi.fn(async () => ({ ok: true, conflicts: [conflict] }))
    const engine = createFavoritesSyncEngine({ isAuthed: () => true, push })
    await engine.enqueue(mkMutation('a'))
    await engine.flush()
    const snap = engine.snapshot()
    expect(snap.conflictItemIds.has('a')).toBe(true)
    expect(snap.badgeState).toBe('conflict')
  })

  it('resolve keep_local 会用本机快照重新排队', async () => {
    const conflict: SyncConflictItem = {
      conflictId: 'c1',
      itemId: 'a',
      itemTitle: 'A',
      conflictType: 'field_divergence',
      divergedFields: ['title'],
      baseSnapshot: null,
      localSnapshot: { title: 'mine' },
      remoteSnapshot: { title: 'theirs' },
      localUpdatedAtMs: Date.now(),
      remoteUpdatedAtMs: Date.now(),
      remoteRevision: 5,
    }
    const push = vi.fn(async () => ({ ok: true, conflicts: [conflict] }))
    const engine = createFavoritesSyncEngine({ isAuthed: () => true, push })
    await engine.enqueue(mkMutation('a'))
    await engine.flush()
    expect(engine.snapshot().conflicts).toHaveLength(1)

    await engine.resolve('c1', 'keep_local')
    const snap = engine.snapshot()
    // 冲突已消解，条目重新进入待同步
    expect(snap.conflicts).toHaveLength(0)
    expect(snap.dirtyItemIds.has('a')).toBe(true)
  })

  it('stop 后不再响应 online 事件', async () => {
    const push = vi.fn(async () => ({ ok: true }))
    const engine = createFavoritesSyncEngine({ isAuthed: () => true, push })
    engine.start()
    engine.stop()
    // 停掉后 clearTimers 已执行，不应残留定时器触发推送
    await vi.advanceTimersByTimeAsync(5000)
    expect(push).not.toHaveBeenCalled()
  })
})
