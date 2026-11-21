/**
 * 把 Outbox 变更适配成后端批量同步接口（2026-11-21）。
 *
 * 复用既有通道 `syncFavoritesBatch()` → POST /api/me/favorites/sync，
 * 不新造端点。该接口返回 { ok, applied, version, items, folders }，
 * items 里含**墓碑**（deletedAt 非空表示云端已删），可直接用于冲突检测。
 *
 * ## 错误分类映射
 *
 * 后端错误码要翻译成 SyncErrorKind，否则引擎无法判断"该不该自动重试"：
 *   401/403       → auth_expired（重新登录，不重试）
 *   500+ / 网络   → server_5xx / network_timeout（退避重试）
 *   413/507       → quota_exceeded（导出快照）
 *   423/密钥问题  → e2ee_locked
 */
import {
  syncFavoritesBatch,
  type FavoriteSyncOp,
  type HubFavoritesSyncPayload,
} from './navhub-api'
import type { OutboxMutation, SyncConflictItem, SyncErrorKind } from './favorites-sync'
import type { PushResult } from './favorites-sync-engine'

/** 把一条 Outbox 变更翻译成后端 op */
export function toFavoriteSyncOp(m: OutboxMutation): FavoriteSyncOp | null {
  if (m.op === 'delete') {
    return { op: 'remove', siteId: m.itemId, at: m.updatedAtMs }
  }
  const p = (m.payload ?? {}) as { folderId?: string | null; note?: string | null; tags?: string[] | null }
  // changedFields 决定用 add（全量覆盖）还是 update（只写指定字段）
  const isUpdateOnly =
    m.baseRevision > 0 &&
    m.changedFields.some((f) => f === 'folderId' || f === 'note' || f === 'tags') &&
    !m.changedFields.includes('title') &&
    !m.changedFields.includes('url')
  if (isUpdateOnly) {
    return {
      op: 'update',
      siteId: m.itemId,
      folderId: p.folderId,
      note: p.note,
      tags: p.tags,
      at: m.updatedAtMs,
    }
  }
  return {
    op: 'add',
    siteId: m.itemId,
    folderId: p.folderId ?? null,
    note: p.note ?? null,
    tags: p.tags ?? null,
    at: m.updatedAtMs,
  }
}

/** HTTP 状态 / 错误信息 → SyncErrorKind */
export function classifySyncError(status: number | null, message?: string): SyncErrorKind {
  const msg = String(message ?? '').toLowerCase()
  if (status === 401 || status === 403) return 'auth_expired'
  if (status === 413 || status === 507) return 'quota_exceeded'
  if (msg.includes('key') || msg.includes('vault') || msg.includes('decrypt')) return 'e2ee_locked'
  if (status !== null && status >= 500) return 'server_5xx'
  return 'network_timeout'
}

export interface FavoritesPushDeps {
  /** 上次成功同步的云端 version（since 参数） */
  getSince: () => number;
  /** 同步成功后回写 version */
  setSince: (v: number) => void;
  /** 把云端返回的 items 落到本地（含墓碑删除） */
  applyRemote: (payload: HubFavoritesSyncPayload) => Promise<void> | void;
}

/**
 * 构造供同步引擎使用的 push()。
 *
 * 成功后：回写 since、把远端增量应用到本地（含墓碑）、
 * 并从返回的 items 里识别「编辑 vs 删除」类冲突。
 */
export function createFavoritesPush(deps: FavoritesPushDeps) {
  return async (mutations: OutboxMutation[]): Promise<PushResult> => {
    const ops: FavoriteSyncOp[] = []
    for (const m of mutations) {
      const op = toFavoriteSyncOp(m)
      if (op) ops.push(op)
    }
    if (ops.length === 0) return { ok: true }

    // 用对象包装而非 let 变量：TS 对「闭包里赋值的 let」会做控制流窄化，
    // 在 await 之后读到的是 never（编译器认为它没被赋值过）。
    const failureRef: { kind: SyncErrorKind | null } = { kind: null }
    const payload = await syncFavoritesBatch(ops, deps.getSince(), (err) => {
      // degrade() 把失败吞成 null，这里捕获原因用于分型
      const status = (err as { status?: number })?.status ?? null
      const message = (err as { message?: string })?.message
      failureRef.kind = classifySyncError(status, message)
    })

    if (!payload) {
      return { ok: false, errorKind: failureRef.kind ?? 'network_timeout' }
    }

    // 先应用远端（含墓碑删除），再回报成功
    await deps.applyRemote(payload)
    if (typeof payload.version === 'number') deps.setSince(payload.version)

    // 冲突检测：本地刚推的条目，若云端返回墓碑且本地是编辑 → edit_vs_delete
    const conflicts: SyncConflictItem[] = []
    const bySite = new Map(payload.items.map((it) => [it.siteId, it]))
    for (const m of mutations) {
      const remote = bySite.get(m.itemId)
      if (!remote) continue
      const remoteDeleted = remote.deletedAt != null
      if (remoteDeleted && m.op === 'upsert') {
        conflicts.push({
          conflictId: 'ec-' + m.itemId,
          itemId: m.itemId,
          itemTitle: String((m.payload as { title?: string })?.title ?? m.itemId),
          conflictType: 'edit_vs_delete',
          divergedFields: ['deleted'],
          baseSnapshot: null,
          localSnapshot: (m.payload ?? null) as Record<string, unknown> | null,
          remoteSnapshot: null,
          localUpdatedAtMs: m.updatedAtMs,
          remoteUpdatedAtMs: Number(remote.updatedAt ?? Date.now()),
          remoteRevision: Number(payload.version ?? 0),
        });
      }
    }

    return { ok: true, ...(conflicts.length > 0 ? { conflicts } : {}) }
  };
}
