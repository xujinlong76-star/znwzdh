/**
 * 11b 集成测试（§6.4）：批量收录 / 移除 / 固定 → 非编排态 Ctrl+Z（模拟
 * `use-global-undo` 分发）→ 终态与 UndoBar；双路径二次撤销；存储写失败。
 *
 * 分发模拟：不挂真实 window 监听，直接调纯决策函数 `decideGlobalUndoKey`
 *（`diyCanUndo` 取 `getHomeDiySnapshot()` 的编排态 + 历史长度，
 * `favoritesHasUndo` 取 `peekGlobalUndo()`），再按 `useGlobalUndo` 的
 * 分支执行（`undo-favorites` → `popGlobalUndo()?.undo()`；
 * `undo-diy` → `undoHomeDiy()`）。mask 与画布分支在这些用例里恒为空，
 * 故 `maskHasTrash` / `canvasCanUndo` 传 false，并在注释里写明。
 *
 * 条目来源分两层（D1 的 builder 尚未落树时也能跑）：
 *   - 手工条目（`build*EntryLocal`）：逐字复现施工文档 §3.1–§3.3 的
 *     闭包语义，只验证分发 / 双路径 / 脏标记这些集成机器；
 *   - builder 条目：`it.skipIf(!builders)`，D1 的
 *     `lib/home-batch-undo.ts` 落树后自动启用，验证 builder 本体。
 * `builders` 用顶层 await 动态 import（缺文件时 catch 回 null，不让
 * 整个文件因 import 失败而跑不起来）。
 *
 * 已知偏离（写在用例注释里，见汇报）：
 *   1. 决策 5 已撤销（协调人裁决 2026-11-14）：逆操作闭包原用
 *      `{ pushHistory: true, forceNewHistoryEntry: true }`，D2 探针实测
 *      它与 §5.3(1)/R5/§6.4 冲突（全局撤销后编排态 Ctrl+Z 把批量操作
 *      重新应用）。现一律 `{ pushHistory: false }`：先快后长幂等，终态
 *      不变；redo 靠 DIY 栈上保留的批量提交 H1（编排态 Ctrl+Shift+Z）。
 *      本文件的手工条目与 §6.4 期望用例已按新语义改写；「当前行为」
 *      用例已删除，不留两个矛盾的用例。
 *   2. DIY 落盘是防抖异步的：`commitHomeDiyConfig` 的 `ok: true` 只表示
 *      「已接纳进内存并排队落盘」，`setItem` 抛错要到 flush 时才以
 *      `storageWarning` 显现——接线层在推条目当时无法凭 `result.ok`
 *      区分「写盘失败」与「0 命中」，§6.4 的「不推条目、toast 报失败」
 *      在 DIY 侧只能以 storageWarning 口径实现（待接线 agent 定）。
 *   3. `markDirty` 是模块私有函数：云端 remove op 的本地侧证据以
 *      `navhub.favorites.dirty.v1` 脏键内容断言；`getIdentity` 只在
 *      `syncFavoritesToCloud`（网络路径）里用，本文件不做真实网络请求，
 *      故不需要 mock 它。另注意 D1 在 builder 头注里记的一点：
 *      `snapshotAndRemoveLocal` 内部并不 `markDirty`，本文件断言到的脏
 *      标记来自 pin 时 `addFavoritesLocal` 内的 `markDirty`——8 秒内无
 *      同步介入时同步按「脏 ∩ 本地 = ∅ → remove op」派生；若 pin 与撤销
 *      之间已同步过，remove op 不会再派生（彻底修需导出 `markDirty` 或
 *      收进 `snapshotAndRemoveLocal` 内，那是 `useFavorites.ts` 的改动，
 *      不在本次授权内）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decideGlobalUndoKey, type GlobalUndoAction } from '@/hooks/use-global-undo'
import {
  __getSharedFavoritesForTests,
  __resetFavoritesForTests,
  __setSharedFavoritesForTests,
  snapshotAndRemoveLocal,
} from '@/hooks/useFavorites'
import { readTrash } from '@/lib/favorites-trash'
import { STORAGE_KEY as LAYOUT_STORAGE_KEY } from '@/lib/modular/layout-storage'
import {
  DEFAULT_CONFIG,
  STORAGE_KEY as DIY_STORAGE_KEY,
  __resetHomeDiyForTests,
  claimHomeDiyHistoryStep,
  commitHomeDiyConfig,
  flushHomeDiyDiskWrites,
  getHomeDiySnapshot,
  redoHomeDiy,
  setHomeDiyEditingLayout,
  undoHomeDiy,
  type HomeDIYConfig,
} from '@/lib/modular/home-diy-storage'
import type { BatchAddReceipt, BatchRemoveReceipt } from '@/lib/modular/use-home-diy'
import { pinSiteToWorkbench, type BatchPinReceipt } from '@/lib/modular/workbench-bridge'
import {
  UNDO_WINDOW_MS,
  __resetGlobalUndoForTests,
  newUndoBatchId,
  newUndoId,
  peekGlobalUndo,
  popGlobalUndo,
  pushGlobalUndo,
  type UndoEntry,
} from '@/lib/undo-stack'

/** D1 的 builder（`lib/home-batch-undo.ts`）：未落树时为 null，相关用例自动跳过。 */
type HomeBatchUndoBuilders = typeof import('@/lib/home-batch-undo')
const builders: HomeBatchUndoBuilders | null = await import('@/lib/home-batch-undo').catch(
  () => null,
)

const FAV_KEY = 'navhub.favorites.v1'
const DIRTY_KEY = 'navhub.favorites.dirty.v1'

/* ------------------------------------------------------------------ *
 * 假的浏览器环境（home-diy-store.test.ts 同款，另加 failWriteWith）
 * ------------------------------------------------------------------ */

interface FakeBrowser {
  get: (key: string) => string | null
  set: (key: string, value: string) => void
  failWriteWith: (err: unknown) => void
}

function installBrowser(initial: Record<string, string> = {}): FakeBrowser {
  const store = new Map<string, string>(Object.entries(initial))
  let writeError: unknown = null
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      if (writeError) throw writeError
      store.set(k, String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  }
  const window = {
    localStorage,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  ;(globalThis as unknown as { window: unknown; localStorage: unknown }).window = window
  ;(globalThis as unknown as { window: unknown; localStorage: unknown }).localStorage =
    localStorage
  return {
    get: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    set: (key: string, value: string) => {
      store.set(key, value)
    },
    failWriteWith: (err: unknown) => {
      writeError = err
    },
  }
}

function uninstallBrowser() {
  delete (globalThis as unknown as { window?: unknown }).window
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage
}

function boardsWithoutDock(): string {
  return JSON.stringify({
    boards: [{ id: 'b1', name: '默认', widgets: [] }],
    activeBoardId: 'b1',
  })
}

function seedConfig(): HomeDIYConfig {
  return {
    ...DEFAULT_CONFIG,
    customCategories: [
      {
        id: 'c1',
        title: '分类 C',
        items: [
          { id: 'x', title: 'X', href: 'https://x.example.com' },
          { id: 'y', title: 'Y', href: 'https://y.example.com' },
          { id: 'z', title: 'Z', href: 'https://z.example.com' },
        ],
        createdAt: 1000,
      },
    ],
  }
}

function catIds(categoryId = 'c1'): string[] {
  return (
    getHomeDiySnapshot()
      .config.customCategories.find((c) => c.id === categoryId)
      ?.items.map((i) => i.id) ?? []
  )
}

function favIds(): string[] {
  return __getSharedFavoritesForTests().map((i) => i.siteId)
}

function readDirty(browser: FakeBrowser): string[] {
  try {
    return JSON.parse(browser.get(DIRTY_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

let browser: FakeBrowser

beforeEach(() => {
  browser = installBrowser()
  __resetFavoritesForTests()
  __resetGlobalUndoForTests()
  __resetHomeDiyForTests(seedConfig())
  setHomeDiyEditingLayout(false)
})

afterEach(() => {
  flushHomeDiyDiskWrites()
  __resetFavoritesForTests()
  __resetGlobalUndoForTests()
  __resetHomeDiyForTests()
  setHomeDiyEditingLayout(false)
  uninstallBrowser()
})

/**
 * 模拟一次非编排态 / 编排态 Ctrl+Z：按 `useGlobalUndo` 的取数口径组装
 * `decideGlobalUndoKey` 的输入，再按分支执行。mask 回收站与画布历史
 * 在本文件用例里恒为空（`maskHasTrash` / `canvasCanUndo` 传 false）。
 */
async function pressCtrlZ(): Promise<{
  action: GlobalUndoAction
  undone: { ok: boolean; message?: string } | null
}> {
  const snap = getHomeDiySnapshot()
  const action = decideGlobalUndoKey({
    composing: false,
    typing: false,
    dialogOpen: false,
    diyClaimed: false,
    diyCanUndo: snap.isEditingLayout && snap.history.past.length > 0,
    canvasCanUndo: false,
    maskHasTrash: false,
    favoritesHasUndo: peekGlobalUndo() !== null,
    diyCanRedo: snap.history.future.length > 0,
    canvasCanRedo: false,
    shiftKey: false,
    isY: false,
    isZ: true,
    modifier: true,
    isMac: false,
  })
  if (action === 'undo-favorites') {
    const entry = popGlobalUndo()
    return { action, undone: entry ? await entry.undo() : null }
  }
  if (action === 'undo-diy') {
    // 真实监听里先认领（同一按键只撤一步）；测试里单调用方，认领结果不拦执行。
    claimHomeDiyHistoryStep()
    const res = undoHomeDiy()
    return { action, undone: res ? { ok: res.ok } : null }
  }
  return { action, undone: null }
}

/**
 * 模拟一次编排态 Ctrl+Shift+Z：与 pressCtrlZ 同口径组装
 * `decideGlobalUndoKey` 的输入（shiftKey: true），按 `redo-diy` 分支执行。
 * 真实监听里 redo 同样先认领，测试里单调用方，认领结果不拦执行。
 */
async function pressCtrlShiftZ(): Promise<{
  action: GlobalUndoAction
  redone: { ok: boolean } | null
}> {
  const snap = getHomeDiySnapshot()
  const action = decideGlobalUndoKey({
    composing: false,
    typing: false,
    dialogOpen: false,
    diyClaimed: false,
    diyCanUndo: snap.isEditingLayout && snap.history.past.length > 0,
    canvasCanUndo: false,
    maskHasTrash: false,
    favoritesHasUndo: peekGlobalUndo() !== null,
    diyCanRedo: snap.history.future.length > 0,
    canvasCanRedo: false,
    shiftKey: true,
    isY: false,
    isZ: true,
    modifier: true,
    isMac: false,
  })
  if (action === 'redo-diy') {
    claimHomeDiyHistoryStep()
    const res = redoHomeDiy()
    return { action, redone: res ? { ok: res.ok } : null }
  }
  return { action, redone: null }
}

/* ------------------------------------------------------------------ *
 * 手工条目：逐字复现施工文档 §3.1–§3.3 的闭包语义，仅验证分发 / 双路径 /
 * 脏标记这些集成机器；builder 本体的同款覆盖在下方 skipIf 用例里。
 * ------------------------------------------------------------------ */

function buildAddEntryLocal(receipt: BatchAddReceipt): UndoEntry {
  const addedIds = new Set(receipt.added.map((a) => a.id))
  const now = Date.now()
  return {
    id: newUndoId(),
    batchId: newUndoBatchId(),
    kind: 'home.batch-add',
    label: `已收录 ${receipt.addedCount} 个站点至「${receipt.categoryTitle}」`,
    sublabel: '8 秒内可撤销 · Ctrl+Z 也可以',
    count: receipt.addedCount,
    detail: receipt.categoryTitle,
    createdAt: now,
    expiresAt: now + UNDO_WINDOW_MS,
    undo: async () => {
      const res = commitHomeDiyConfig(
        (prev) => ({
          ...prev,
          customCategories: prev.customCategories.map((cat) =>
            cat.id === receipt.categoryId
              ? { ...cat, items: cat.items.filter((i) => !addedIds.has(i.id)) }
              : cat,
          ),
          updatedAt: Date.now(),
        }),
        { pushHistory: false },
      )
      return res.ok ? { ok: true } : { ok: false, message: '本机存储写不进去，撤销未完成' }
    },
  }
}

function buildRemoveEntryLocal(receipt: BatchRemoveReceipt): UndoEntry {
  const now = Date.now()
  return {
    id: newUndoId(),
    batchId: newUndoBatchId(),
    kind: 'home.batch-remove',
    label: `已从专属分类移除 ${receipt.removedCount} 个站点`,
    sublabel: '8 秒内可撤销 · Ctrl+Z 也可以',
    count: receipt.removedCount,
    detail: receipt.removed[0]?.categoryId,
    createdAt: now,
    expiresAt: now + UNDO_WINDOW_MS,
    undo: async () => {
      // 分类被删的降级（§3.2）：不自动重建分类，如实报失败。
      const current = getHomeDiySnapshot().config
      if (
        receipt.removed.some(
          (r) => !current.customCategories.some((c) => c.id === r.categoryId),
        )
      ) {
        return { ok: false, message: '分类已被删除，无法恢复这批站点' }
      }
      const res = commitHomeDiyConfig(
        (prev) => {
          const nextCats = prev.customCategories.map((cat) => {
            const mine = receipt.removed
              .filter((r) => r.categoryId === cat.id)
              .sort((a, b) => a.index - b.index)
            if (mine.length === 0) return cat
            const items = [...cat.items]
            for (const r of mine) {
              if (items.some((i) => i.id === r.item.id)) continue
              items.splice(Math.min(r.index, items.length), 0, r.item)
            }
            return { ...cat, items }
          })
          if (nextCats.every((c, i) => c === prev.customCategories[i])) return prev
          return { ...prev, customCategories: nextCats, updatedAt: Date.now() }
        },
        { pushHistory: false },
      )
      return res.ok ? { ok: true } : { ok: false, message: '本机存储写不进去，撤销未完成' }
    },
  }
}

function buildPinEntryLocal(receipt: BatchPinReceipt): UndoEntry {
  const expected = new Map(receipt.addedItems.map((i) => [i.siteId, i.createdAt]))
  const now = Date.now()
  // label / count 按本次新建数写死（与 D1 builder 同款；pinnedCount 可能含
  // 已固定过的站，那些站不在本条目的撤销范围内）。
  const count = receipt.addedSiteIds.length
  return {
    id: newUndoId(),
    batchId: newUndoBatchId(),
    kind: 'home.batch-pin',
    label: `已固定 ${count} 个站点到工作台`,
    count,
    createdAt: now,
    expiresAt: now + UNDO_WINDOW_MS,
    undo: async () => {
      // TrashSource 尚无 'pin-undo'（D1 定）；手工版用既有的 'batch'。
      const res = snapshotAndRemoveLocal(receipt.addedSiteIds, 'batch', {
        expectedCreatedAt: expected,
      })
      if (res === null) return { ok: false, message: '本机存储写不进去，撤销未完成' }
      if (res.skippedSiteIds.length > 0) {
        return {
          ok: true,
          message: `已取消固定 ${res.removed.length} 个站点，其中 ${res.skippedSiteIds.length} 个已变化，未动`,
        }
      }
      return { ok: true }
    },
  }
}

/** 单提交批量收录（模拟 `addSitesToCustomCategory` 的一次 commit + 收据）。 */
function batchAdd(
  sites: Array<{ id: string; title: string; href: string }>,
): BatchAddReceipt {
  commitHomeDiyConfig((prev) => ({
    ...prev,
    customCategories: prev.customCategories.map((cat) =>
      cat.id === 'c1' ? { ...cat, items: [...sites, ...cat.items] } : cat,
    ),
    updatedAt: Date.now(),
  }))
  return {
    categoryId: 'c1',
    categoryTitle: '分类 C',
    added: sites.map((s) => ({ id: s.id, href: s.href, title: s.title })),
    addedCount: sites.length,
    duplicateCount: 0,
    failedCount: 0,
  }
}

/** 单提交批量移除（模拟 `removeSitesFromCustomCategories` 的一次 commit + 收据）。 */
function batchRemove(siteIds: string[]): BatchRemoveReceipt {
  const removed: BatchRemoveReceipt['removed'] = []
  commitHomeDiyConfig((prev) => {
    const nextCats = prev.customCategories.map((cat) => {
      const kept: typeof cat.items = []
      cat.items.forEach((item, index) => {
        if (siteIds.includes(item.id)) removed.push({ categoryId: cat.id, item, index })
        else kept.push(item)
      })
      return kept.length === cat.items.length ? cat : { ...cat, items: kept }
    })
    if (removed.length === 0) return prev
    return { ...prev, customCategories: nextCats, updatedAt: Date.now() }
  })
  return { removed, removedCount: removed.length, failedCount: 0 }
}

describe('§6.4 批量收录 → Ctrl+Z', () => {
  it('非编排态 Ctrl+Z：分类恢复批量前状态，UndoBar 消失（手工条目，分发层）', async () => {
    expect(catIds()).toEqual(['x', 'y', 'z'])
    const receipt = batchAdd([
      { id: 'a', title: 'A', href: 'https://a.example.com' },
      { id: 'b', title: 'B', href: 'https://b.example.com' },
    ])
    expect(catIds()).toEqual(['a', 'b', 'x', 'y', 'z'])
    pushGlobalUndo(buildAddEntryLocal(receipt))
    expect(peekGlobalUndo()?.kind).toBe('home.batch-add')

    const pressed = await pressCtrlZ()
    expect(pressed.action).toBe('undo-favorites')
    expect(pressed.undone?.ok).toBe(true)
    expect(catIds()).toEqual(['x', 'y', 'z'])
    // UndoBar 消失：栈顶已无条目
    expect(peekGlobalUndo()).toBeNull()
    expect(popGlobalUndo()).toBeUndefined()
  })

  it.skipIf(!builders)(
    '同上，但条目由 D1 builder 构造（D1 落树后自动启用）',
    async () => {
      const receipt = batchAdd([
        { id: 'a', title: 'A', href: 'https://a.example.com' },
        { id: 'b', title: 'B', href: 'https://b.example.com' },
      ])
      const entry = builders!.buildHomeBatchAddUndoEntry(receipt)
      expect(entry).not.toBeNull()
      expect(entry!.kind).toBe('home.batch-add')
      expect(entry!.label).toContain('2')
      pushGlobalUndo(entry!)
      const pressed = await pressCtrlZ()
      expect(pressed.action).toBe('undo-favorites')
      expect(pressed.undone?.ok).toBe(true)
      expect(catIds()).toEqual(['x', 'y', 'z'])
      expect(peekGlobalUndo()).toBeNull()
    },
  )
})

describe('§6.4 双路径二次撤销（§5.3 / R5）', () => {
  it.skipIf(!builders)(
    '同上，但条目由 D1 builder 构造：闭包不压历史是 builder 本体的，不是手工条目的巧合',
    async () => {
      const receipt = batchAdd([
        { id: 'a', title: 'A', href: 'https://a.example.com' },
        { id: 'b', title: 'B', href: 'https://b.example.com' },
      ])
      const pastAfterBatch = getHomeDiySnapshot().history.past.length
      const entry = builders!.buildHomeBatchAddUndoEntry(receipt)
      expect(entry).not.toBeNull()
      pushGlobalUndo(entry!)
      const first = await pressCtrlZ()
      expect(first.action).toBe('undo-favorites')
      expect(catIds()).toEqual(['x', 'y', 'z'])
      // 闭包不压历史：past 与批量后相同
      expect(getHomeDiySnapshot().history.past.length).toBe(pastAfterBatch)
      setHomeDiyEditingLayout(true)
      const second = await pressCtrlZ()
      expect(second.action).toBe('undo-diy')
      // 先快后长幂等：终态不变
      expect(catIds()).toEqual(['x', 'y', 'z'])
    },
  )

  it('§6.4/R5 期望：先快后长终态不变（决策 5 已撤销，逆操作不压 DIY 历史）', async () => {
    const receipt = batchAdd([
      { id: 'a', title: 'A', href: 'https://a.example.com' },
      { id: 'b', title: 'B', href: 'https://b.example.com' },
    ])
    const pastAfterBatch = getHomeDiySnapshot().history.past.length
    pushGlobalUndo(buildAddEntryLocal(receipt))
    const first = await pressCtrlZ()
    expect(first.action).toBe('undo-favorites')
    expect(first.undone?.ok).toBe(true)
    expect(catIds()).toEqual(['x', 'y', 'z'])
    expect(peekGlobalUndo()).toBeNull()
    // 逆操作不压历史：past 与批量后相同
    expect(getHomeDiySnapshot().history.past.length).toBe(pastAfterBatch)

    // 再进编排态 Ctrl+Z：弹出批量提交 H1，终态仍是批量前状态（no-op）
    setHomeDiyEditingLayout(true)
    const second = await pressCtrlZ()
    expect(second.action).toBe('undo-diy')
    expect(catIds()).toEqual(['x', 'y', 'z'])
    // redo 仍可用：批量提交 H1 在 future 里，Ctrl+Shift+Z 重做批量操作
    const third = await pressCtrlShiftZ()
    expect(third.action).toBe('redo-diy')
    expect(third.redone?.ok).toBe(true)
    expect(catIds()).toEqual(['a', 'b', 'x', 'y', 'z'])
  })
})

describe('§6.4 批量移除 → Ctrl+Z', () => {
  it('原位插回，顺序与批量前一致（手工条目）', async () => {
    const receipt = batchRemove(['y'])
    expect(receipt.removedCount).toBe(1)
    expect(catIds()).toEqual(['x', 'z'])
    pushGlobalUndo(buildRemoveEntryLocal(receipt))
    const pressed = await pressCtrlZ()
    expect(pressed.action).toBe('undo-favorites')
    expect(pressed.undone?.ok).toBe(true)
    expect(catIds()).toEqual(['x', 'y', 'z'])
    expect(peekGlobalUndo()).toBeNull()
  })

  it('撤销前有别的插入：集合一致、顺序至多差一位（R3 / §6.3，手工条目）', async () => {
    const receipt = batchRemove(['y'])
    expect(catIds()).toEqual(['x', 'z'])
    // 8 秒内用户手动在分类开头插入 W
    commitHomeDiyConfig((prev) => ({
      ...prev,
      customCategories: prev.customCategories.map((cat) =>
        cat.id === 'c1'
          ? { ...cat, items: [{ id: 'w', title: 'W', href: 'https://w.example.com' }, ...cat.items] }
          : cat,
      ),
      updatedAt: Date.now(),
    }))
    expect(catIds()).toEqual(['w', 'x', 'z'])
    pushGlobalUndo(buildRemoveEntryLocal(receipt))
    const pressed = await pressCtrlZ()
    expect(pressed.undone?.ok).toBe(true)
    expect(new Set(catIds())).toEqual(new Set(['w', 'x', 'y', 'z']))
    expect([
      ['w', 'x', 'y', 'z'],
      ['w', 'y', 'x', 'z'],
    ]).toContainEqual(catIds())
    expect(peekGlobalUndo()).toBeNull()
  })

  it.skipIf(!builders)(
    '同上（无 intervening 插入），但条目由 D1 builder 构造（D1 落树后自动启用）',
    async () => {
      const receipt = batchRemove(['y'])
      const entry = builders!.buildHomeBatchRemoveUndoEntry(receipt)
      expect(entry).not.toBeNull()
      expect(entry!.kind).toBe('home.batch-remove')
      pushGlobalUndo(entry!)
      const pressed = await pressCtrlZ()
      expect(pressed.undone?.ok).toBe(true)
      expect(catIds()).toEqual(['x', 'y', 'z'])
      expect(peekGlobalUndo()).toBeNull()
    },
  )
})

describe('§6.4 批量固定 → Ctrl+Z', () => {
  it('收藏条目消失、dock 留下；脏标记含两站（云端 remove op 的本地侧证据，手工条目）', async () => {
    browser.set(LAYOUT_STORAGE_KEY, boardsWithoutDock())
    const r1 = pinSiteToWorkbench({ siteId: 's1', title: '站点 1', href: 'https://s1.example.com' })
    const r2 = pinSiteToWorkbench({ siteId: 's2', title: '站点 2', href: 'https://s2.example.com' })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(r1.receipt!.createdDockWidgetId).not.toBeNull()
    expect(r2.receipt!.createdDockWidgetId).toBeNull()
    expect(favIds()).toEqual(['s2', 's1'])
    const receipt: BatchPinReceipt = {
      addedSiteIds: [...r1.receipt!.addedSiteIds, ...r2.receipt!.addedSiteIds],
      addedItems: [...r1.receipt!.addedItems, ...r2.receipt!.addedItems],
      createdDockWidgetId: r1.receipt!.createdDockWidgetId,
      pinnedCount: 2,
    }
    pushGlobalUndo(buildPinEntryLocal(receipt))
    const pressed = await pressCtrlZ()
    expect(pressed.action).toBe('undo-favorites')
    expect(pressed.undone?.ok).toBe(true)
    // 收藏条目消失（只删本次新建的）
    expect(favIds()).toEqual([])
    // dock 留下（决策 1：撤销 pin 不拆 dock）
    const workspace = JSON.parse(browser.get(LAYOUT_STORAGE_KEY)!)
    expect(workspace.boards[0].widgets.map((w: any) => w.type)).toContain('favorites-dock')
    expect(workspace.boards[0].widgets[0].id).toBe(r1.receipt!.createdDockWidgetId)
    // markDirty 的本地侧证据：脏键含两站，下次同步派生 remove op。
    // markDirty 是模块私有函数，脏键是其唯一可观测写出；getIdentity 只在
    // syncFavoritesToCloud（网络路径）里用，本文件不做真实网络请求。
    // 注意：这组脏标记来自 pin 时 addFavoritesLocal 内的 markDirty，
    // undo 本身不补 markDirty——8 秒内无同步介入时成立（见文件头注释 3）。
    expect(readDirty(browser)).toEqual(expect.arrayContaining(['s1', 's2']))
    // 回收站里只有这两站的快照
    expect(readTrash().items.map((i) => i.siteId).sort()).toEqual(['s1', 's2'])
    expect(peekGlobalUndo()).toBeNull()
  })

  it.skipIf(!builders)(
    '同上，但条目由 D1 builder 构造（D1 落树后自动启用）',
    async () => {
      browser.set(LAYOUT_STORAGE_KEY, boardsWithoutDock())
      const r = pinSiteToWorkbench({ siteId: 's1', title: '站点 1', href: 'https://s1.example.com' })
      expect(r.ok).toBe(true)
      expect(r.receipt).not.toBeNull()
      const entry = builders!.buildHomeBatchPinUndoEntry(r.receipt!)
      expect(entry).not.toBeNull()
      expect(entry!.kind).toBe('home.batch-pin')
      pushGlobalUndo(entry!)
      const pressed = await pressCtrlZ()
      expect(pressed.undone?.ok).toBe(true)
      expect(favIds()).toEqual([])
      const workspace = JSON.parse(browser.get(LAYOUT_STORAGE_KEY)!)
      expect(workspace.boards[0].widgets.map((w: any) => w.type)).toContain('favorites-dock')
      expect(readDirty(browser)).toContain('s1')
      expect(peekGlobalUndo()).toBeNull()
    },
  )
})

describe('§6.4 存储写失败', () => {
  it('pin：setItem 抛错 → ok:false、receipt null、不推条目、字节不动', async () => {
    browser.failWriteWith(Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' }))
    const r = pinSiteToWorkbench({ siteId: 's1', title: '站点 1', href: 'https://s1.example.com' })
    expect(r.ok).toBe(false)
    expect(r.receipt).toBeNull()
    // 失败不推条目：全局栈里没有任何与这次 pin 相关的条目
    expect(peekGlobalUndo()).toBeNull()
    // 内存优先：persistLocalFavorites 先更新内存再落盘，saveLocal 抛错只让
    // 它返回 false——内存里已有 s1（刷新即失），这是 saveLocal 注释里写明
    // 的语义，不是「写成功」：ok:false + receipt null 才是调用方看到的失败。
    expect(favIds()).toEqual(['s1'])
    // 字节不动：收藏键一次也没落盘，刷新后读到的还是空（无残留）
    expect(browser.get(FAV_KEY)).toBeNull()
  })

  it('DIY：setItem 抛错 → 内存先生效、flush 后 storageWarning 非空、盘上仍是批量前（刷新后无残留）', async () => {
    browser.failWriteWith(Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' }))
    const receipt = batchAdd([{ id: 'a', title: 'A', href: 'https://a.example.com' }])
    expect(receipt.addedCount).toBe(1)
    // 内存先生效（落盘是防抖异步的，commit 当时只报「已接纳」）
    expect(catIds()).toEqual(['a', 'x', 'y', 'z'])
    flushHomeDiyDiskWrites()
    expect(getHomeDiySnapshot().storageWarning).not.toBeNull()
    // 盘上字节仍是批量前：这次提交从未落盘，刷新后读到的还是旧配置
    expect(browser.get(DIY_STORAGE_KEY)).toBeNull()
    // 注意：commit 当时 result.ok 为 true（只表示已接纳进内存），接线层
    // 在推条目当时无法凭它区分「写盘失败」与「0 命中」；§6.4 的「不推
    // 条目、toast 报失败」在 DIY 侧只能以 storageWarning 口径实现，
    // 待接线 agent 在文件 6 里定（见汇报）。
    expect(peekGlobalUndo()).toBeNull()
  })
})
