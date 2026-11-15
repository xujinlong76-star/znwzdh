/**
 * 全局撤销栈（第 1 层：8 秒内存撤销）。
 *
 * 钉死：
 *  - 空栈 pop 返回 undefined；push 后 peek 是栈顶；
 *  - 超 UNDO_STACK_MAX 丢最旧；
 *  - 同 kind 8 秒内合并（计数累加、倒计时重置、undo 先新后旧全恢复），
 *    不同 kind 不合并；超 8 秒不合并；
 *  - remove(id) 只清指定条；clear() 清空；过期条 pop/peek 时先剪掉。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  UNDO_STACK_MAX,
  UNDO_WINDOW_MS,
  UndoStack,
  __resetGlobalUndoForTests,
  composeUndoClosures,
  describeMergedUndoLabel,
  extendGlobalUndoExpiry,
  isMergeableKind,
  mergeUndoEntries,
  peekGlobalUndo,
  popGlobalUndo,
  pushGlobalUndo,
  type UndoEntry,
} from '@/lib/undo-stack'

const HERE = dirname(fileURLToPath(import.meta.url))

function entry(overrides: Partial<UndoEntry> & { kind: UndoEntry['kind'] }): UndoEntry {
  const now = overrides.createdAt ?? Date.now()
  return {
    id: overrides.id ?? 'e-' + Math.random().toString(36).slice(2, 8),
    batchId: overrides.batchId ?? 'b-1',
    label: overrides.label ?? '已删除「X」',
    createdAt: now,
    expiresAt: now + UNDO_WINDOW_MS,
    count: overrides.count ?? 1,
    undo: overrides.undo ?? (async () => ({ ok: true })),
    ...overrides,
  }
}

describe('UndoStack：基本读写', () => {
  it('空栈 pop 返回 undefined，peek 也是 undefined', () => {
    const stack = new UndoStack()
    expect(stack.pop()).toBeUndefined()
    expect(stack.peek()).toBeUndefined()
    expect(stack.size).toBe(0)
  })

  it('push 后 peek 是栈顶，pop 按后进先出', () => {
    const stack = new UndoStack()
    const now = Date.now()
    const first = entry({ kind: 'favorite.remove', id: 'first', createdAt: now })
    const second = entry({ kind: 'folder.delete', id: 'second', createdAt: now + 1 })
    stack.push(first)
    stack.push(second)
    expect(stack.peek()?.id).toBe('second')
    expect(stack.pop()?.id).toBe('second')
    expect(stack.pop()?.id).toBe('first')
    expect(stack.size).toBe(0)
  })

  it('超 UNDO_STACK_MAX 丢最旧', () => {
    // 默认上限就是 UNDO_STACK_MAX（收藏类逆操作含全量快照，50 太占内存）
    expect(UNDO_STACK_MAX).toBe(20)
    const stack = new UndoStack(3)
    for (let i = 0; i < 5; i++) {
      stack.push(
        entry({ kind: 'folder.rename', id: 'r' + i, createdAt: 1_000_000 + i * 100_000 }),
      )
    }
    expect(stack.size).toBe(3)
    expect(stack.snapshot().map((e) => e.id)).toEqual(['r4', 'r3', 'r2'])
  })

  it('remove(id) 只清指定条，clear() 清空', () => {
    const stack = new UndoStack()
    const now = Date.now()
    stack.push(entry({ kind: 'folder.delete', id: 'a', createdAt: now }))
    stack.push(entry({ kind: 'folder.rename', id: 'b', createdAt: now + 1 }))
    expect(stack.remove('a')).toBe(true)
    expect(stack.remove('a')).toBe(false)
    expect(stack.size).toBe(1)
    expect(stack.peek()?.id).toBe('b')
    stack.clear()
    expect(stack.size).toBe(0)
  })

  it('过期条 pop/peek 时先剪掉（条消失 = 撤销失效，D1）', () => {
    const stack = new UndoStack()
    stack.push(entry({ kind: 'favorite.remove', id: 'old', createdAt: 1_000_000 }))
    // 8000ms 窗口已过：peek 不到，pop 也不到
    expect(stack.peek(1_000_000 + UNDO_WINDOW_MS + 1)).toBeUndefined()
    expect(stack.pop(1_000_000 + UNDO_WINDOW_MS + 1)).toBeUndefined()
    expect(stack.size).toBe(0)
  })
})

describe('mergeUndoEntries：8 秒内同 kind 合并', () => {
  it('同 kind 8 秒内合并：计数累加、倒计时重置回 8 秒', () => {
    const prev = entry({ kind: 'favorite.remove', createdAt: 1_000_000, count: 1 })
    const next = entry({ kind: 'favorite.remove', createdAt: 1_000_000 + 3000, count: 2 })
    const merged = mergeUndoEntries(prev, next)
    expect(merged).not.toBeNull()
    expect(merged!.count).toBe(3)
    expect(merged!.createdAt).toBe(1_000_000 + 3000)
    expect(merged!.expiresAt).toBe(1_000_000 + 3000 + UNDO_WINDOW_MS)
    // 合并后仍用 prev 的 id（同一条目延续）
    expect(merged!.id).toBe(prev.id)
  })

  it('不同 kind 不合并', () => {
    const prev = entry({ kind: 'favorite.remove', createdAt: 1_000_000 })
    const next = entry({ kind: 'favorite.move-folder', createdAt: 1_000_001 })
    expect(mergeUndoEntries(prev, next)).toBeNull()
  })

  it('超 8 秒不合并', () => {
    const prev = entry({ kind: 'favorite.remove', createdAt: 1_000_000 })
    const next = entry({ kind: 'favorite.remove', createdAt: 1_000_000 + UNDO_WINDOW_MS + 1 })
    expect(mergeUndoEntries(prev, next)).toBeNull()
  })

  it('不可合并的 kind（改名/删夹）即使 8 秒内也不合并', () => {
    const prev = entry({ kind: 'folder.rename', createdAt: 1_000_000 })
    const next = entry({ kind: 'folder.rename', createdAt: 1_000_001 })
    expect(mergeUndoEntries(prev, next)).toBeNull()
    const prevDelete = entry({ kind: 'folder.delete', createdAt: 1_000_000 })
    const nextDelete = entry({ kind: 'folder.delete', createdAt: 1_000_001 })
    expect(mergeUndoEntries(prevDelete, nextDelete)).toBeNull()
  })

  it('push 时合并：文案变"已删除 N 条收藏"，undo 先新后旧全恢复', async () => {
    const stack = new UndoStack()
    const restored: string[] = []
    const first = entry({
      kind: 'favorite.remove',
      id: 'first',
      label: '已删除「A」',
      createdAt: 1_000_000,
      undo: async () => {
        restored.push('A')
        return { ok: true }
      },
    })
    const second = entry({
      kind: 'favorite.remove',
      id: 'second',
      label: '已删除「B」',
      createdAt: 1_000_100,
      undo: async () => {
        restored.push('B')
        return { ok: true }
      },
    })
    stack.push(first)
    const merged = stack.push(second)
    expect(stack.size).toBe(1)
    expect(merged.label).toBe('已删除 2 条收藏')
    expect(merged.count).toBe(2)
    // 倒计时重置：expiresAt 取最新一条的
    expect(merged.expiresAt).toBe(1_000_100 + UNDO_WINDOW_MS)
    const result = await merged.undo()
    expect(result.ok).toBe(true)
    // 先恢复新操作、再恢复旧操作（原位 index 才对得上）
    expect(restored).toEqual(['B', 'A'])
  })

  it('push 时不同 kind 不合并：新条压栈顶，旧条仍在栈里', () => {
    const stack = new UndoStack()
    const now = Date.now()
    stack.push(entry({ kind: 'favorite.remove', id: 'del', createdAt: now }))
    stack.push(entry({ kind: 'favorite.move-folder', id: 'move', createdAt: now + 100 }))
    expect(stack.size).toBe(2)
    expect(stack.peek()?.id).toBe('move')
    expect(stack.pop()?.id).toBe('move')
    // 撤完新操作，下一条 Ctrl+Z 撤旧操作
    expect(stack.pop()?.id).toBe('del')
  })
})

describe('composeUndoClosures：先新后旧，两步都 ok 才算 ok', () => {
  it('两步都成功 → ok，顺序先新后旧', async () => {
    const order: string[] = []
    const composed = composeUndoClosures(
      async () => {
        order.push('new')
        return { ok: true }
      },
      async () => {
        order.push('old')
        return { ok: true }
      },
    )
    expect(await composed()).toEqual({ ok: true, message: undefined })
    expect(order).toEqual(['new', 'old'])
  })

  it('一步失败 → ok=false，失败信息拼在一起', async () => {
    const composed = composeUndoClosures(
      async () => ({ ok: false, message: '新操作恢复失败' }),
      async () => ({ ok: true }),
    )
    const result = await composed()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('新操作恢复失败')
  })
})

describe('describeMergedUndoLabel：合并文案', () => {
  it('单条删带标题，多条只显示计数', () => {
    expect(describeMergedUndoLabel('favorite.remove', 1, '我的站')).toBe('已删除「我的站」')
    expect(describeMergedUndoLabel('favorite.remove', 3)).toBe('已删除 3 条收藏')
    expect(describeMergedUndoLabel('favorite.remove-batch', 5)).toBe('已删除 5 条收藏')
  })

  it('移夹合并后带目标夹名', () => {
    expect(describeMergedUndoLabel('favorite.move-folder', 3, undefined, '工作')).toBe(
      '已将 3 条收藏移至「工作」',
    )
    expect(describeMergedUndoLabel('favorite.move-folder', 2)).toBe('已移动 2 条收藏')
  })
})

describe('11b 新 kind：home.batch-add / home.batch-remove / home.batch-pin', () => {
  const HOME_KINDS = ['home.batch-add', 'home.batch-remove', 'home.batch-pin'] as const

  it('三个新 kind 存在且都不进 MERGEABLE_KINDS', () => {
    for (const kind of HOME_KINDS) {
      expect(isMergeableKind(kind)).toBe(false)
    }
  })

  it('连续两批同 kind 不合并：各自独立一条，UndoBar 只显示栈顶', () => {
    for (const kind of HOME_KINDS) {
      const prev = entry({ kind, createdAt: 1_000_000, count: 2 })
      const next = entry({ kind, createdAt: 1_000_100, count: 3 })
      expect(mergeUndoEntries(prev, next)).toBeNull()
    }
    const stack = new UndoStack()
    const now = Date.now()
    stack.push(entry({ kind: 'home.batch-add', id: 'batch-1', createdAt: now, count: 2 }))
    stack.push(entry({ kind: 'home.batch-add', id: 'batch-2', createdAt: now + 100, count: 3 }))
    expect(stack.size).toBe(2)
    expect(stack.peek(now + 100)?.id).toBe('batch-2')
    expect(stack.pop(now + 100)?.id).toBe('batch-2')
    expect(stack.pop(now + 100)?.id).toBe('batch-1')
  })

  it('8 秒过期后 peekGlobalUndo() 为 null（条消失 = 撤销失效）', () => {
    __resetGlobalUndoForTests()
    pushGlobalUndo(entry({ kind: 'home.batch-remove', id: 'expired', createdAt: 2_000_000 }))
    expect(peekGlobalUndo(2_000_000 + UNDO_WINDOW_MS - 1)?.id).toBe('expired')
    expect(peekGlobalUndo(2_000_000 + UNDO_WINDOW_MS + 1)).toBeNull()
    expect(popGlobalUndo(2_000_000 + UNDO_WINDOW_MS + 1)).toBeUndefined()
  })

  it('栈深上限仍是 20：连续 21 批只留最新 20 条', () => {
    expect(UNDO_STACK_MAX).toBe(20)
    const stack = new UndoStack()
    for (let i = 0; i < 21; i++) {
      stack.push(
        entry({ kind: 'home.batch-remove', id: 'h' + i, createdAt: 3_000_000 + i * 100_000 }),
      )
    }
    expect(stack.size).toBe(20)
    // 最旧一条（h0）被丢，最新一条在栈顶
    expect(stack.snapshot().map((e) => e.id)).toEqual(
      Array.from({ length: 20 }, (_, k) => 'h' + (20 - k)),
    )
  })

  it('describeMergedUndoLabel 不被误调：新 kind 只走通用兜底文案', () => {
    for (const kind of HOME_KINDS) {
      expect(describeMergedUndoLabel(kind, 3)).toBe('已撤销 3 项操作')
    }
  })
})

describe('extendTopExpiry：暂停顺延真实 deadline（B2）', () => {
  it('暂停 8 秒以上后撤销仍成功：原 deadline 已过，顺延后 peek/pop 仍拿到条目', async () => {
    const stack = new UndoStack()
    let undone = false
    // 条目在 T 建、原 deadline T+8000；T+2000 时暂停，剩下 6000ms
    stack.push(
      entry({
        kind: 'favorite.remove',
        id: 'paused',
        createdAt: 1_000_000,
        undo: async () => {
          undone = true
          return { ok: true }
        },
      }),
    )
    const pausedAt = 1_002_000
    const remaining = 1_008_000 - pausedAt
    expect(remaining).toBe(6000)
    // 对照：不顺延的话，原 deadline（1008000）一过 peek 就拿不到（且被剪掉）
    const control = new UndoStack()
    control.push(entry({ kind: 'favorite.remove', id: 'control', createdAt: 1_000_000 }))
    expect(control.peek(1_012_000)).toBeUndefined()
    expect(control.size).toBe(0)
    // 恢复时按暂停时剩下的时间顺延：deadline 变为 12000 + 6000
    expect(stack.extendTopExpiry(remaining, 1_012_000)).toBe(true)
    expect(stack.peek(1_012_000)?.id).toBe('paused')
    expect(stack.peek(1_012_000)?.expiresAt).toBe(1_018_000)
    const result = await stack.pop(1_012_000)!.undo()
    expect(result.ok).toBe(true)
    expect(undone).toBe(true)
  })

  it('空栈顺延返回 false；expectedId 对不上不顺延、不改 deadline', () => {
    const stack = new UndoStack()
    expect(stack.extendTopExpiry(6000, 1_000_000)).toBe(false)
    stack.push(entry({ kind: 'favorite.remove', id: 'a', createdAt: 1_000_000 }))
    expect(stack.extendTopExpiry(6000, 1_001_000, 'other-id')).toBe(false)
    expect(stack.peek(1_001_000)?.expiresAt).toBe(1_008_000)
    expect(stack.extendTopExpiry(6000, 1_001_000, 'a')).toBe(true)
    expect(stack.peek(1_001_000)?.expiresAt).toBe(1_007_000)
  })

  it('全局单例：暂停中超 8 秒后顺延，peek 不再为 null、Ctrl+Z 的 pop 能撤', async () => {
    __resetGlobalUndoForTests()
    let undone = false
    pushGlobalUndo(
      entry({
        kind: 'favorite.remove',
        id: 'global-paused',
        createdAt: 5_000_000,
        undo: async () => {
          undone = true
          return { ok: true }
        },
      }),
    )
    // 不顺延的对照：原 deadline（5008000）一过就 peek 不到
    expect(peekGlobalUndo(5_009_000)).toBeNull()
    // 重新入栈，暂停 10 秒后按剩余 6000ms 顺延
    __resetGlobalUndoForTests()
    pushGlobalUndo(
      entry({
        kind: 'favorite.remove',
        id: 'global-paused',
        createdAt: 5_000_000,
        undo: async () => {
          undone = true
          return { ok: true }
        },
      }),
    )
    expect(extendGlobalUndoExpiry(6000, 5_012_000, 'global-paused')).toBe(true)
    expect(peekGlobalUndo(5_012_000)?.id).toBe('global-paused')
    const popped = popGlobalUndo(5_012_000)
    expect(popped?.id).toBe('global-paused')
    expect((await popped!.undo()).ok).toBe(true)
    expect(undone).toBe(true)
  })

  it('UndoBar 接线：暂停记剩余时间、恢复时顺延真实 deadline（不只停显示）', () => {
    const barSrc = readFileSync(resolve(HERE, '..', 'src/components/undo-bar.tsx'), 'utf8')
    // 暂停开始记下剩余时间与栈顶 id，恢复时按剩余时间顺延
    expect(barSrc).toContain('pausedRemainingRef')
    expect(barSrc).toContain('pausedTopIdRef')
    expect(barSrc).toContain('extendGlobalUndoExpiry(remaining')
    // 暂停期间每跳也顺延一次（暂停中按 Ctrl+Z 不被过期放行）
    expect(barSrc).toContain('extendGlobalUndoExpiry(remaining, Date.now(), topId ?? undefined)')
    // 切后台同样走暂停/恢复，不是只在 interval 里跳过递减
    expect(barSrc).toContain("document.visibilityState === 'hidden'")
    expect(barSrc).toContain('hiddenPausedRef')
  })
})
