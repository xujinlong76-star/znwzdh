import { describe, expect, it } from 'vitest'
import {
  EDIT_DEBOUNCE_MS,
  LOCAL_COPY_SUFFIX,
  RETRY_BACKOFF_MS,
  SYNCING_VISIBLE_DELAY_MS,
  badgeLabel,
  badgeVisual,
  canAutoRetry,
  cardConflictRing,
  cardDotClass,
  cardSyncDot,
  compactOutbox,
  deriveBadgeState,
  describeSyncError,
  localCopyTitle,
  mergeThreeWay,
  pendingItemCount,
  recommendResolution,
  retryDelayMs,
  shouldWarnOnUnload,
  type OutboxMutation,
  type SyncEngineSnapshot,
} from '../src/lib/favorites-sync'

/**
 * Local-First 收藏同步状态机回归（2026-11-21）。
 *
 * 第一铁律：本机写入即成功，云端同步不阻塞。
 * 这些测试锁住三件事：
 *   1. 六态徽标的推导优先级（冲突 > 错误 > 同步中 > 待同步 > 已同步）
 *   2. 三方合并的分级（90% 静默，仅同字段分歧才要求人工裁决）
 *   3. 失败分型不误伤（离线绝不标红、401 绝不清空队列）
 */

describe('deriveBadgeState 六态优先级', () => {
  const base = { isAuthed: true, isOnline: true, pendingCount: 0, conflictCount: 0, isSyncing: false }

  it('匿名态永远是 local_only（不管队列里有什么）', () => {
    expect(deriveBadgeState({ ...base, isAuthed: false })).toBe('local_only')
    expect(
      deriveBadgeState({ ...base, isAuthed: false, pendingCount: 5, conflictCount: 2 }),
    ).toBe('local_only')
  })

  it('冲突优先于错误、同步中、待同步', () => {
    expect(
      deriveBadgeState({
        ...base,
        conflictCount: 2,
        pendingCount: 3,
        isSyncing: true,
        error: { kind: 'server_5xx', message: 'x', canAutoRetry: true },
      }),
    ).toBe('conflict')
  })

  it('错误优先于同步中与待同步', () => {
    expect(
      deriveBadgeState({
        ...base,
        isSyncing: true,
        pendingCount: 3,
        error: { kind: 'auth_expired', message: 'x', canAutoRetry: false },
      }),
    ).toBe('error')
  })

  it('同步中优先于待同步（正在传就别显示"待同步"）', () => {
    expect(deriveBadgeState({ ...base, isSyncing: true, pendingCount: 3 })).toBe('syncing')
  })

  it('有队列或离线 → local_saved', () => {
    expect(deriveBadgeState({ ...base, pendingCount: 1 })).toBe('local_saved')
    expect(deriveBadgeState({ ...base, isOnline: false })).toBe('local_saved')
  })

  it('一切就绪 → synced', () => {
    expect(deriveBadgeState(base)).toBe('synced')
  })
})

describe('badgeLabel 文案', () => {
  it('待同步带计数', () => {
    expect(badgeLabel('local_saved', 3)).toBe('本地已存 · 待同步 (3)')
  })
  it('零计数不显示括号（避免"待同步 (0)"噪音）', () => {
    expect(badgeLabel('local_saved', 0)).toBe('本地已存 · 待同步')
  })
  it('冲突带计数', () => {
    expect(badgeLabel('conflict', 0, 2)).toBe('2 项冲突待确认')
  })
  it('其余态固定文案', () => {
    expect(badgeLabel('local_only')).toBe('仅本机保存')
    expect(badgeLabel('syncing')).toBe('同步中...')
    expect(badgeLabel('synced')).toBe('已同步')
    expect(badgeLabel('error')).toBe('同步失败 · 重试')
  })
})

describe('badgeVisual 视觉规范', () => {
  it('稳态（synced / local_only）不高亮', () => {
    expect(badgeVisual('synced').emphatic).toBe(false)
    expect(badgeVisual('local_only').emphatic).toBe(false)
  })
  it('异常/冲突态提亮', () => {
    expect(badgeVisual('conflict').emphatic).toBe(true)
    expect(badgeVisual('error').emphatic).toBe(true)
  })
  it('conflict 用琥珀、error 用珊瑚红', () => {
    expect(badgeVisual('conflict').container).toContain('amber')
    expect(badgeVisual('error').container).toContain('rose')
  })
  it('local_saved 用蓝灰、syncing 用靛蓝', () => {
    expect(badgeVisual('local_saved').container).toContain('sky')
    expect(badgeVisual('syncing').container).toContain('indigo')
  })
})

describe('mergeThreeWay 三方合并（90% 静默）', () => {
  const baseItem = { title: 'A', url: 'https://a.com', folderId: 'f1', note: null, tags: ['x'], deleted: false }

  it('不同条目的增删 → 各自保留（集合层面，单条目视角即 clean）', () => {
    const local = { ...baseItem, title: 'A2' }
    expect(mergeThreeWay(baseItem, local, baseItem)).toEqual({ kind: 'clean', merged: local })
  })

  it('正交字段各改各的 → auto_merged（不打扰用户）', () => {
    const local = { ...baseItem, tags: ['y'] }
    const remote = { ...baseItem, folderId: 'f2' }
    const out = mergeThreeWay(baseItem, local, remote)
    expect(out.kind).toBe('auto_merged')
    if (out.kind === 'auto_merged') {
      expect(out.merged).toMatchObject({ tags: ['y'], folderId: 'f2' })
      expect(out.mergedFields.length).toBeGreaterThan(0)
    }
  })

  it('两边改成完全一样 → clean（静默消除）', () => {
    const same = { ...baseItem, title: 'Same' }
    expect(mergeThreeWay(baseItem, same, same)).toEqual({ kind: 'clean', merged: same })
  })

  it('同一字段分歧 → conflict（唯一需要人裁决的情况）', () => {
    const local = { ...baseItem, title: '本机标题' }
    const remote = { ...baseItem, title: '云端标题' }
    const out = mergeThreeWay(baseItem, local, remote)
    expect(out.kind).toBe('conflict')
    if (out.kind === 'conflict') {
      expect(out.divergedFields).toContain('title')
      expect(out.conflictType).toBe('field_divergence')
    }
  })

  it('一端编辑、另一端删除 → edit_vs_delete（绝不静默删掉编辑）', () => {
    const local = { ...baseItem, note: '离线写的重要批注' }
    const out = mergeThreeWay(baseItem, local, null)
    expect(out.kind).toBe('conflict')
    if (out.kind === 'conflict') expect(out.conflictType).toBe('edit_vs_delete')
  })

  it('本机没改、云端删了 → clean 删除（删除能正常传播）', () => {
    expect(mergeThreeWay(baseItem, baseItem, null)).toEqual({ kind: 'clean', merged: null })
  })

  it('两边都删 → clean', () => {
    expect(mergeThreeWay(baseItem, null, null)).toEqual({ kind: 'clean', merged: null })
  })
})

describe('recommendResolution', () => {
  it('edit_vs_delete 推荐 keep_both（绝不默认丢弃离线劳动）', () => {
    expect(recommendResolution({ conflictType: 'edit_vs_delete' })).toBe('keep_both')
  })
  it('字段分歧默认保留本机', () => {
    expect(recommendResolution({ conflictType: 'field_divergence' })).toBe('keep_local')
  })
})

describe('localCopyTitle', () => {
  it('追加本机副本后缀', () => {
    expect(localCopyTitle('我的收藏')).toBe('我的收藏' + LOCAL_COPY_SUFFIX)
  })
  it('已有后缀不重复追加', () => {
    const once = localCopyTitle('X')
    expect(localCopyTitle(once)).toBe(once)
  })
  it('空标题有兜底', () => {
    expect(localCopyTitle('')).toBe('未命名收藏' + LOCAL_COPY_SUFFIX)
  })
})

describe('错误分型（不统一报"同步失败"）', () => {
  it('离线绝不标红（回落为冷静待同步）', () => {
    const p = describeSyncError('network_timeout', false)
    expect(p.isRed).toBe(false)
    expect(p.headline).toContain('离线')
  })
  it('5xx 可自动重试且标红', () => {
    const p = describeSyncError('server_5xx', true)
    expect(p.isRed).toBe(true)
    expect(p.canAutoRetry).toBe(true)
  })
  it('401 明说本机修改安全保留，且要求重新登录', () => {
    const p = describeSyncError('auth_expired', true)
    expect(p.action).toBe('relogin')
    expect(p.dataSafe).toContain('安全保留')
    expect(p.canAutoRetry).toBe(false)
  })
  it('E2EE 锁定要求解锁金库', () => {
    expect(describeSyncError('e2ee_locked', true).action).toBe('unlock_vault')
  })
  it('配额超限给导出快照逃生舱', () => {
    expect(describeSyncError('quota_exceeded', true).action).toBe('export_snapshot')
  })
  it('每种错误都必须声明本机数据安全（Local-First 承诺）', () => {
    for (const k of ['network_timeout', 'server_5xx', 'auth_expired', 'e2ee_locked', 'quota_exceeded'] as const) {
      expect(describeSyncError(k, true).dataSafe).toBeTruthy()
    }
  })
})

describe('重试退避阶梯', () => {
  it('2s → 6s → 18s', () => {
    expect(RETRY_BACKOFF_MS).toEqual([2000, 6000, 18000])
    expect(retryDelayMs(0)).toBe(2000)
    expect(retryDelayMs(1)).toBe(6000)
    expect(retryDelayMs(2)).toBe(18000)
  })
  it('超出阶梯不再自动重试', () => {
    expect(retryDelayMs(3)).toBeNull()
  })
  it('鉴权/密钥类不可自动重试（重试只会刷错误）', () => {
    expect(canAutoRetry('auth_expired')).toBe(false)
    expect(canAutoRetry('e2ee_locked')).toBe(false)
    expect(canAutoRetry('server_5xx')).toBe(true)
  })
})

describe('Outbox 压缩', () => {
  const m = (id: string, itemId: string, fields: string[], rev: number, retry = 0): OutboxMutation => ({
    mutationId: id,
    itemId,
    op: 'upsert',
    baseRevision: rev,
    changedFields: fields as never,
    updatedAtMs: 0,
    retryCount: retry,
  })

  it('同条目多次编辑只保留一条，baseRevision 取最早的', () => {
    const out = compactOutbox([m('1', 'a', ['title'], 5), m('2', 'a', ['note'], 7)])
    expect(out).toHaveLength(1)
    expect(out[0].baseRevision).toBe(5)
  })

  it('合并 changedFields', () => {
    const out = compactOutbox([m('1', 'a', ['title'], 1), m('2', 'a', ['note'], 1)])
    expect(out[0].changedFields).toEqual(expect.arrayContaining(['title', 'note']))
  })

  it('retryCount 取较大者（避免合并后重试归零导致无限重试）', () => {
    const out = compactOutbox([m('1', 'a', ['title'], 1, 2), m('2', 'a', ['note'], 1, 0)])
    expect(out[0].retryCount).toBe(2)
  })

  it('不同条目各自保留', () => {
    expect(compactOutbox([m('1', 'a', ['title'], 1), m('2', 'b', ['title'], 1)])).toHaveLength(2)
  })

  it('待同步计数按条目去重', () => {
    expect(pendingItemCount([m('1', 'a', ['title'], 1), m('2', 'a', ['note'], 1), m('3', 'b', ['title'], 1)])).toBe(2)
  })
})

describe('卡片微点（与 Header 同源，防 UI 撕裂）', () => {
  const snap = {
    dirtyItemIds: new Set(['a', 'b']),
    conflictItemIds: new Set(['b']),
  } as Pick<SyncEngineSnapshot, 'dirtyItemIds' | 'conflictItemIds'>

  it('冲突优先于待同步', () => {
    expect(cardSyncDot(snap, 'b')).toBe('conflict')
  })
  it('仅待同步 → pending', () => {
    expect(cardSyncDot(snap, 'a')).toBe('pending')
  })
  it('干净条目无微点', () => {
    expect(cardSyncDot(snap, 'z')).toBe('none')
  })
  it('冲突卡片加琥珀细边框，其余无', () => {
    expect(cardConflictRing('conflict')).toContain('amber')
    expect(cardConflictRing('pending')).toBe('')
    expect(cardConflictRing('none')).toBe('')
  })
  it('微点样式区分两态', () => {
    expect(cardDotClass('conflict')).toContain('amber')
    expect(cardDotClass('pending')).toContain('sky')
  })
})

describe('离开拦截（Local-First 反模式守卫）', () => {
  it('同步中不拦截（IndexedDB 已提交，关页面数据安全）', () => {
    expect(shouldWarnOnUnload(false)).toBe(false)
  })
  it('仅有未确认的冲突裁决选择时才提醒', () => {
    expect(shouldWarnOnUnload(true)).toBe(true)
  })
})

describe('时序常量', () => {
  it('同步中视觉防抖 300ms', () => {
    expect(SYNCING_VISIBLE_DELAY_MS).toBe(300)
  })
  it('编辑合并窗口 1.5s', () => {
    expect(EDIT_DEBOUNCE_MS).toBe(1500)
  })
})
