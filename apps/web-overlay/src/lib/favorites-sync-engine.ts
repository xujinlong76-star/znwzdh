/**
 * 收藏同步引擎（2026-11-21）。
 *
 * 把 Outbox 持久化、错误分型、退避重试、冲突检测串成一个可观察的状态源。
 * 所有 UI（Header 徽标 / 卡片微点 / 冲突抽屉）只订阅这里产出的
 * SyncEngineSnapshot，状态严格单向流转，不会出现 UI 撕裂。
 *
 * ## 关键时序
 *
 * - 编辑后 1.5s 合并窗口（EDIT_DEBOUNCE_MS）才触发推送，避免每次键盘输入都发请求
 * - 推送超过 300ms（SYNCING_VISIBLE_DELAY_MS）才切到 syncing 态，避免极速同步闪徽标
 * - 失败后按 2s/6s/18s 退避，第 3 次仍失败才转 error 态
 * - 离线时**不发请求**，监听 online 事件后延迟 1s 静默冲刷
 */
import {
  EDIT_DEBOUNCE_MS,
  SYNCING_VISIBLE_DELAY_MS,
  canAutoRetry,
  deriveBadgeState,
  pendingItemCount,
  retryDelayMs,
  type ConflictResolution,
  type OutboxMutation,
  type SyncBadgeState,
  type SyncConflictItem,
  type SyncEngineSnapshot,
  type SyncErrorKind,
} from './favorites-sync'
import {
  appendMutation,
  readConflicts,
  readLastSyncedAt,
  readOutbox,
  removeMutations,
  writeConflicts,
  writeLastSyncedAt,
} from './favorites-sync-outbox'

/** 推送结果：由调用方注入，便于测试与解耦 fetch 细节 */
export interface PushResult {
  ok: boolean;
  /** 失败时的错误分类 */
  errorKind?: SyncErrorKind;
  /** 服务端检测到的冲突（若服务端做了三方判定） */
  conflicts?: SyncConflictItem[];
}

export interface SyncEngineOptions {
  /** 是否已登录。匿名态永不推送 */
  isAuthed: () => boolean;
  /** 把一批变更推到云端 */
  push: (mutations: OutboxMutation[]) => Promise<PushResult>;
  /** 状态变化回调（UI 订阅入口） */
  onChange?: (snapshot: SyncEngineSnapshot) => void;
}

export interface FavoritesSyncEngine {
  /** 排队一次本机变更（立即返回，不等云端） */
  enqueue: (mutation: Omit<OutboxMutation, 'mutationId' | 'retryCount'>) => Promise<void>;
  /** 手动触发同步（用户点"立即同步/重试"） */
  flush: () => Promise<void>;
  /** 裁决一条冲突 */
  resolve: (conflictId: string, resolution: ConflictResolution) => Promise<void>;
  /** 当前快照 */
  snapshot: () => SyncEngineSnapshot;
  /** 启动/停止事件监听 */
  start: () => void;
  stop: () => void;
}

let mutationSeq = 0
function nextMutationId(): string {
  mutationSeq += 1
  // 时间戳 + 序号 + 随机后缀：同毫秒多次调用也不会撞
  return `m-${Date.now().toString(36)}-${mutationSeq}-${Math.random().toString(36).slice(2, 8)}`
}

export function createFavoritesSyncEngine(opts: SyncEngineOptions): FavoritesSyncEngine {
  let outbox: OutboxMutation[] = []
  let conflicts: SyncConflictItem[] = []
  let lastSyncedAtMs: number | null = null
  let isSyncing = false
  let error: SyncEngineSnapshot['error'] | undefined
  let retryCount = 0
  let nextRetryAtMs: number | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let syncingVisibleTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let onlineTimer: ReturnType<typeof setTimeout> | null = null
  let started = false

  const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine)

  function buildSnapshot(): SyncEngineSnapshot {
    const pendingCount = pendingItemCount(outbox)
    const badgeState: SyncBadgeState = deriveBadgeState({
      isAuthed: opts.isAuthed(),
      isOnline: isOnline(),
      pendingCount,
      conflictCount: conflicts.length,
      isSyncing,
      error: error ?? null,
    })
    return {
      badgeState,
      isOnline: isOnline(),
      pendingCount,
      dirtyItemIds: new Set(outbox.map((m) => m.itemId)),
      conflictItemIds: new Set(conflicts.map((c) => c.itemId)),
      conflicts: [...conflicts],
      lastSyncedAtMs,
      nextRetryAtMs,
      ...(error ? { error } : {}),
    }
  }

  function emit() {
    opts.onChange?.(buildSnapshot())
  }

  /** 清理所有定时器，避免 unmount 后回调继续跑 */
  function clearTimers() {
    for (const t of [debounceTimer, syncingVisibleTimer, retryTimer, onlineTimer]) {
      if (t) clearTimeout(t)
    }
    debounceTimer = syncingVisibleTimer = retryTimer = onlineTimer = null
  }

  /**
   * 执行一次推送。
   *
   * 三条纪律：
   *  1. 离线不发请求（避免无谓的失败与错误态闪烁）
   *  2. 匿名不推送（本地-only 是合法终态，不是错误）
   *  3. syncing 态延迟 300ms 才亮，避免极速同步闪徽标
   */
  async function runFlush(): Promise<void> {
    if (outbox.length === 0) return
    if (!opts.isAuthed()) return
    if (!isOnline()) {
      // 离线：保持 local_saved，不标红、不重试
      return
    }
    if (isSyncing) return

    isSyncing = true
    // 300ms 后才让 UI 看到 syncing：极快的同步不该闪一下
    syncingVisibleTimer = setTimeout(() => {
      syncingVisibleTimer = null
      emit()
    }, SYNCING_VISIBLE_DELAY_MS)

    const batch = outbox.slice(0, 100)
    try {
      const result = await opts.push(batch)
      if (result.ok) {
        await removeMutations(batch.map((m) => m.mutationId))
        outbox = outbox.filter((m) => !batch.some((b) => b.mutationId === m.mutationId))
        if (result.conflicts && result.conflicts.length > 0) {
          // 按 conflictId 去重：批次重推时同一冲突会被服务端再报一次，
          // 直接 concat 会让抽屉里出现重复卡片、计数也虚高。
          const seen = new Set(conflicts.map((c) => c.conflictId))
          const fresh = result.conflicts.filter((c) => !seen.has(c.conflictId))
          if (fresh.length > 0) {
            conflicts = [...conflicts, ...fresh]
            await writeConflicts(conflicts)
          }
        }
        lastSyncedAtMs = Date.now()
        await writeLastSyncedAt(lastSyncedAtMs)
        error = undefined
        retryCount = 0
        nextRetryAtMs = null
      } else {
        handlePushFailure(result.errorKind ?? 'server_5xx')
      }
    } catch {
      handlePushFailure('network_timeout')
    } finally {
      isSyncing = false
      if (syncingVisibleTimer) {
        clearTimeout(syncingVisibleTimer)
        syncingVisibleTimer = null
      }
      emit()
      // 队列还有剩余就继续推（分批）
      if (outbox.length > 0 && !error && isOnline()) {
        void runFlush()
      }
    }
  }

  /**
   * 失败处理：按类型决定要不要自动重试。
   *
   * 网络与服务端抖动 → 退避重试（2s/6s/18s），期间保持 local_saved；
   * 鉴权/密钥/配额 → 立即转 error，不重试（重试只会刷错误）。
   */
  function handlePushFailure(kind: SyncErrorKind): void {
    retryCount += 1
    const autoRetry = canAutoRetry(kind)
    const delay = autoRetry ? retryDelayMs(retryCount - 1) : null

    if (delay !== null) {
      // 还有重试机会：保持"待同步"外观，不标红
      nextRetryAtMs = Date.now() + delay
      retryTimer = setTimeout(() => {
        retryTimer = null
        nextRetryAtMs = null
        void runFlush()
      }, delay)
      // 前两次失败不暴露 error（避免闪红），让徽标停在 local_saved
      error = undefined
      return
    }

    // 重试耗尽或不可重试：转 error
    nextRetryAtMs = null
    error = {
      kind,
      message: kind,
      canAutoRetry: autoRetry,
    }
  }

  /** 防抖调度：编辑后 1.5s 合并成一次推送 */
  function scheduleFlush(): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void runFlush()
    }, EDIT_DEBOUNCE_MS)
  }

  async function init(): Promise<void> {
    outbox = await readOutbox()
    conflicts = await readConflicts()
    lastSyncedAtMs = await readLastSyncedAt()
    emit()
  }
  void init()

  const onOnline = () => {
    // 重连后延迟 1s 静默冲刷（等网络真正稳定）
    if (onlineTimer) clearTimeout(onlineTimer)
    onlineTimer = setTimeout(() => {
      onlineTimer = null
      retryCount = 0
      error = undefined
      void runFlush()
    }, 1000)
    emit()
  }
  const onOffline = () => emit()

  return {
    async enqueue(mutation) {
      const full: OutboxMutation = {
        ...mutation,
        mutationId: nextMutationId(),
        retryCount: 0,
      }
      // 关键：先落盘再返回——这就是"本机写入即成功"
      await appendMutation(full)
      outbox = await readOutbox()
      emit()
      scheduleFlush()
    },

    async flush() {
      retryCount = 0
      error = undefined
      await runFlush()
    },

    async resolve(conflictId, resolution) {
      const conflict = conflicts.find((c) => c.conflictId === conflictId)
      if (!conflict) return
      if (resolution === 'keep_local') {
        // 用本机快照重新排队（覆盖云端）
        await this.enqueue({
          itemId: conflict.itemId,
          op: 'upsert',
          baseRevision: conflict.remoteRevision,
          changedFields: conflict.divergedFields,
          payload: conflict.localSnapshot ?? undefined,
          updatedAtMs: Date.now(),
        })
      } else if (resolution === 'use_remote') {
        // 放弃本机改动：移除该条目在队列里的所有变更
        await removeMutations(outbox.filter((m) => m.itemId === conflict.itemId).map((m) => m.mutationId))
        outbox = outbox.filter((m) => m.itemId !== conflict.itemId)
      } else {
        // keep_both：云端原条目保留，本机改动另存为新条目
        const copyId = conflict.itemId + '__local_copy'
        await this.enqueue({
          itemId: copyId,
          op: 'upsert',
          baseRevision: 0,
          changedFields: conflict.divergedFields,
          payload: conflict.localSnapshot ?? undefined,
          updatedAtMs: Date.now(),
        })
      }
      conflicts = conflicts.filter((c) => c.conflictId !== conflictId)
      await writeConflicts(conflicts)
      emit()
    },

    snapshot: buildSnapshot,

    start() {
      if (started) return
      started = true
      if (typeof window !== 'undefined') {
        window.addEventListener('online', onOnline)
        window.addEventListener('offline', onOffline)
      }
    },

    stop() {
      started = false
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline)
        window.removeEventListener('offline', onOffline)
      }
      clearTimers()
    },
  }
}
