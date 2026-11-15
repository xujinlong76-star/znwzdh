/**
 * 全局撤销栈（第 1 层：8 秒内存撤销）。
 *
 * 分层原则：8 秒条是「内存撤销」，30 天回收站（lib/favorites-trash）是
 * 「持久快照」，不要混成一层。栈只活在当前标签页会话里，刷新即失；
 * 持久恢复走回收站，不走这里。
 *
 * 纯函数 + 轻量类，可单元测试。条目里的 undo 闭包只活在内存栈里，
 * 不序列化、不进 localStorage。
 */

/** 撤销条显示窗口：8 秒，条消失 = 撤销失效（D1，文案诚实） */
export const UNDO_WINDOW_MS = 8000

/** 栈深上限：收藏类逆操作含全量快照，50 太占内存 */
export const UNDO_STACK_MAX = 20

export type UndoableKind =
  | 'favorite.remove'
  | 'favorite.remove-batch'
  | 'favorite.move-folder'
  | 'favorite.update-meta'
  | 'favorite.import-batch'
  | 'folder.delete'
  | 'folder.rename'
  | 'folder.move'
  | 'diy.config'
  | 'feature-mask.remove'
  | 'home.batch-add'
  | 'home.batch-remove'
  | 'home.batch-pin'

export interface UndoEntry {
  id: string
  /** 同一批操作共享 batchId */
  batchId: string
  kind: UndoableKind
  /** 条上显示的人话，如 "已删除「XX」等 3 条收藏" */
  label: string
  /** 副标题缺省时用这句通用文案 */
  sublabel?: string
  createdAt: number
  /** createdAt + 8000，仅控制撤销条显示 */
  expiresAt: number
  /** 闭包只活在内存栈 */
  undo: () => Promise<{ ok: boolean; message?: string }>
  /** 仅 diy.config 有；收藏类 v1 不提供 redo */
  redo?: () => Promise<{ ok: boolean; message?: string }>
  trashRef?: { batchId: string; count: number }
  /** 合并后的条数（如 "已删除 3 条收藏" 里的 3），单条为 1 */
  count?: number
  /**
   * 合并文案用的细节：move-folder 时是目标夹名。
   * 合并后取最新一条的 detail（批量移夹全去同一目标夹）。
   */
  detail?: string
}

export const UNDO_SUBLABEL = '8 秒内可撤销 · Ctrl+Z 也可以 · 回收站保留 30 天'

function newId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  return 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
}

export function newUndoId(): string {
  return newId()
}

export function newUndoBatchId(): string {
  return newId()
}

/** 可合并的 kind：同 kind、8 秒内连续发生才合并成一条 */
const MERGEABLE_KINDS: ReadonlySet<UndoableKind> = new Set([
  'favorite.remove',
  'favorite.remove-batch',
  'favorite.move-folder',
])

export function isMergeableKind(kind: UndoableKind): boolean {
  return MERGEABLE_KINDS.has(kind)
}

/**
 * 合并两条撤销条目（同 kind 且 next.createdAt - prev.createdAt <= 8000）。
 * 不可合并返回 null。合并时：
 *  - 计数累加（count 相加，缺省按 1 计）；
 *  - label 由调用方在合并后按新计数重写——这里只拼出"已删除 N 条收藏"类
 *    通用文案的计数部分太冒险：label 模板因 kind 而异，所以返回的条目
 *    保留 prev.label，调用方（UndoStack.push）负责按 kind + count 重算；
 *  - 倒计时重置：createdAt/expiresAt 取 next 的；
 *  - undo 取 next 的（它恢复最新一次操作的全量快照；调用方在构造 next
 *    的 undo 时必须把 prev 的快照也包进去，见 useFavorites 的合并约定）。
 */
export function mergeUndoEntries(prev: UndoEntry, next: UndoEntry): UndoEntry | null {
  if (prev.kind !== next.kind) return null
  if (!isMergeableKind(prev.kind)) return null
  if (next.createdAt - prev.createdAt > UNDO_WINDOW_MS) return null
  const count = (prev.count ?? 1) + (next.count ?? 1)
  return {
    ...next,
    id: prev.id,
    batchId: prev.batchId,
    createdAt: next.createdAt,
    expiresAt: next.createdAt + UNDO_WINDOW_MS,
    count,
  }
}

/** 按 kind + count 重算合并后的主文案（label 模板集中在这里，不散落各处） */
export function describeMergedUndoLabel(
  kind: UndoableKind,
  count: number,
  title?: string,
  detail?: string,
): string {
  if (kind === 'favorite.remove' || kind === 'favorite.remove-batch') {
    if (count <= 1 && title) return `已删除「${title}」`
    return `已删除 ${count} 条收藏`
  }
  if (kind === 'favorite.move-folder') {
    if (detail) return `已将 ${count} 条收藏移至「${detail}」`
    return `已移动 ${count} 条收藏`
  }
  if (kind === 'favorite.import-batch') {
    return `已导入 ${count} 条收藏`
  }
  return `已撤销 ${count} 项操作`
}

/**
 * 把两条 undo 闭包拼成一条：执行顺序是先新后旧。
 *
 * 注意：这个顺序对最终恢复位置没有影响——insertRestoredFavorites
 * 本来就按原位 index 升序插回、且对「已在列表里」的条目幂等跳过，
 * 所以无论先新后旧还是先旧后新，恢复后的列表顺序都一样。
 * 先新后旧只是沿用「撤销按操作逆序执行」的惯例：新操作的快照是在
 * 旧操作已删的状态下记的，按逆序恢复时每一步的中间状态都与删除时
 * 对称，调试时更容易对上。两步都 ok 才算 ok，失败信息拼在一起。
 */
export function composeUndoClosures(
  newer: UndoEntry['undo'],
  older: UndoEntry['undo'],
): UndoEntry['undo'] {
  return async () => {
    const first = await newer()
    const second = await older()
    const ok = first.ok && second.ok
    const message = [first.message, second.message].filter(Boolean).join('；') || undefined
    return { ok, message }
  }
}

export class UndoStack {
  private entries: UndoEntry[] = []

  constructor(private readonly maxDepth: number = UNDO_STACK_MAX) {}

  get size(): number {
    return this.entries.length
  }

  /**
   * 入栈。同 kind、8 秒内连续发生则合并（计数累加、倒计时重置）；
   * 不同 kind 不合并，新条目压在栈顶，旧条目仍留在栈里。
   * 超 UNDO_STACK_MAX 丢最旧。
   */
  push(entry: UndoEntry): UndoEntry {
    const top = this.entries[this.entries.length - 1]
    if (top) {
      const merged = mergeUndoEntries(top, entry)
      if (merged) {
        const count = merged.count ?? 1
        // 合并恢复 = 先恢复新操作、再恢复旧操作（见 composeUndoClosures）；
        // trashRef 计数累加，detail 取最新一条（批量移夹的目标夹）。
        const trashCount = (top.trashRef?.count ?? 0) + (entry.trashRef?.count ?? 0)
        const finalEntry: UndoEntry = {
          ...merged,
          label: describeMergedUndoLabel(merged.kind, count, undefined, merged.detail),
          undo: composeUndoClosures(entry.undo, top.undo),
          trashRef:
            trashCount > 0
              ? { batchId: top.trashRef?.batchId ?? entry.trashRef?.batchId ?? top.batchId, count: trashCount }
              : undefined,
        }
        this.entries[this.entries.length - 1] = finalEntry
        return finalEntry
      }
    }
    this.entries.push(entry)
    while (this.entries.length > this.maxDepth) this.entries.shift()
    return entry
  }

  /** Ctrl+Z 取栈顶；空返回 undefined。过期条目先剪掉（条消失 = 撤销失效）。 */
  pop(now: number = Date.now()): UndoEntry | undefined {
    this.pruneExpired(now)
    return this.entries.pop()
  }

  peek(now: number = Date.now()): UndoEntry | undefined {
    this.pruneExpired(now)
    return this.entries[this.entries.length - 1]
  }

  remove(id: string): boolean {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.id !== id)
    return this.entries.length !== before
  }

  clear(): void {
    this.entries = []
  }

  /** 剪掉已过 8 秒窗口的条目（条消失 = 撤销失效，D1） */
  pruneExpired(now: number = Date.now()): number {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.expiresAt > now)
    return before - this.entries.length
  }

  /**
   * 暂停顺延：把栈顶条目的 expiresAt 重设为 now + remainingMs。
   *
   * 撤销条暂停（悬停/聚焦/切后台）时只停显示倒计时是不够的——过期
   * 判定按 wall-clock 的 expiresAt 走，暂停 8 秒后条还在、栈里却已
   * 过期，点「撤销」只能拿到「没有可撤销的操作」。暂停的真实语义是
   * 「累计可见时间」：暂停开始记下剩余时间，恢复时按剩余时间重设
   * 栈顶 deadline；暂停期间每跳也可以调一次，让 deadline 始终停在
   * now + 剩余时间，这样暂停中按 Ctrl+Z 也不会因过期被放行。
   *
   * 刻意不剪枝：暂停期间 deadline 可能已经过了 wall-clock，顺延就是
   * 要把它救回来；剪枝只发生在 pop/peek/pruneExpired 的正常路径。
   * expectedId 传了就只顺延 id 对得上的栈顶（暂停中又进了新条时，
   * 旧条的剩余时间绝不能套到新条头上）。空栈 / id 对不上返回 false。
   */
  extendTopExpiry(
    remainingMs: number,
    now: number = Date.now(),
    expectedId?: string,
  ): boolean {
    const top = this.entries[this.entries.length - 1]
    if (!top) return false
    if (expectedId !== undefined && top.id !== expectedId) return false
    top.expiresAt = now + Math.max(0, remainingMs)
    return true
  }

  /** 仅供测试/调试：当前栈顶起的全部条目（新 → 旧） */
  snapshot(): UndoEntry[] {
    return [...this.entries].reverse()
  }
}

/* ------------------------- 全局单例（撤销条 / Ctrl+Z 共用） ------------------------- */

const globalStack = new UndoStack()

type UndoListener = () => void
const undoListeners = new Set<UndoListener>()

function emitUndoChange(): void {
  for (const listener of undoListeners) listener()
}

export function subscribeGlobalUndo(listener: UndoListener): () => void {
  undoListeners.add(listener)
  return () => {
    undoListeners.delete(listener)
  }
}

/** 撤销条与各写入点共用的唯一入栈口（合并 + 通知订阅者） */
export function pushGlobalUndo(entry: UndoEntry): UndoEntry {
  const pushed = globalStack.push(entry)
  emitUndoChange()
  return pushed
}

/** Ctrl+Z 的取栈口：取栈顶并通知订阅者（条随之消失） */
export function popGlobalUndo(now: number = Date.now()): UndoEntry | undefined {
  const entry = globalStack.pop(now)
  if (entry) emitUndoChange()
  return entry
}

/** 撤销条当前应显示的栈顶（过期已剪）；null = 无条可显示 */
export function peekGlobalUndo(now: number = Date.now()): UndoEntry | null {
  return globalStack.peek(now) ?? null
}

/** 栈里是否还有可撤销的操作（条上副标题"还有 N 个可撤销的操作"用） */
export function globalUndoDepth(now: number = Date.now()): number {
  globalStack.pruneExpired(now)
  return globalStack.size
}

/** 关掉/过期一条：只清指定条（Esc 关条不撤销，D1：该条随即失效） */
export function dismissGlobalUndo(id: string): boolean {
  const removed = globalStack.remove(id)
  if (removed) emitUndoChange()
  return removed
}

/** 剪掉过期条并通知（撤销条的计时器每 100ms 调一次） */
export function pruneGlobalUndo(now: number = Date.now()): number {
  const pruned = globalStack.pruneExpired(now)
  if (pruned > 0) emitUndoChange()
  return pruned
}

/**
 * 全局栈顶顺延（UndoBar 暂停恢复时用）：把栈顶 expiresAt 重设为
 * now + remainingMs。刻意不通知订阅者——显示倒计时由 UndoBar 自己的
 * remainingMs 状态驱动，顺延只改真实 deadline，不改显示。
 */
export function extendGlobalUndoExpiry(
  remainingMs: number,
  now: number = Date.now(),
  expectedId?: string,
): boolean {
  return globalStack.extendTopExpiry(remainingMs, now, expectedId)
}

export function clearGlobalUndo(): void {
  globalStack.clear()
  emitUndoChange()
}

/** 仅供测试隔离：清空单例（生产代码不要调用） */
export function __resetGlobalUndoForTests(): void {
  globalStack.clear()
  undoListeners.clear()
}
