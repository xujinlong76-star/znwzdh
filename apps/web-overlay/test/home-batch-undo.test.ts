/**
 * 首页批量操作接进撤销栈（11b）：全局栈 builder + 正式单元测试（Agent D1）。
 *
 * 覆盖施工文档 §6.1 / §6.2 / §6.3：
 *  - 收据构造：批量函数真调（renderToString 抓 useHomeDIY，与
 *    import-persist-failure.test.ts 同款做法——仓库无 hook 渲染器）；
 *  - 单提交：批量 N 站 = DIY 历史恰好多一条；300ms 内两批同 key 在全局栈
 *    各自独立（fake timers，R4）；
 *  - 逆操作纯函数：add 按 id 删、remove 按原位插回 + 已存在跳过、pin CAS、
 *    三者幂等；
 *  - 不推规则：四种 0 生效 / 写盘失败 builder 返回 null（§2.3）；
 *  - 新 kind（builder 侧）：连续两批不合并；
 *  - 逆操作不压 DIY 历史（决策 5 已撤销，见 lib/home-batch-undo.ts
 *    文件头）：全局撤销后 past 长度不变、编排态 Ctrl+Z 为 no-op（§5.3
 *    用例 2，先快后长幂等）、redo 仍可用（Ctrl+Shift+Z 重做批量操作）；
 *    普通提交的合并行为不变（回归，forceNewHistoryEntry 存储层行为
 *    由 Agent A 的测试覆盖，本文件不动它）；
 *  - R1 CAS 用例（§6.2，必须有）、remove 越位用例（§6.3，必须有）。
 *
 * 说明：
 *  - “一次 commitHomeDiyConfig”没有可 spy 的导出（模块函数直接 import，
 *    命名空间不可 spy），可观测等价物是 DIY 历史 past 恰好 +1——每次
 *    非合并提交 exactly 压一条 past，见 home-diy-store.test.ts 同款断言。
 *  - 写盘失败只覆盖同步可知的失败（拿不到 localStorage，result.ok 立即
 *    false）；防抖落盘在 300ms 后才真正 setItem，配额满以 storageWarning
 *    为准，与 add 侧同口径（见 home-diy-store.test.ts §3）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  DEFAULT_CONFIG,
  __resetHomeDiyForTests,
  commitHomeDiyConfig,
  getHomeDiySnapshot,
  redoHomeDiy,
  undoHomeDiy,
  useHomeDIY,
  type BatchAddReceipt,
  type BatchRemoveReceipt,
  type CustomCategory,
  type CustomCategoryItem,
  type HomeDIYConfig,
} from '@/lib/modular/use-home-diy'
import { STORAGE_KEY as BOARDS_STORAGE_KEY } from '@/lib/modular/layout-storage'
import {
  __getSharedFavoritesForTests,
  __resetFavoritesForTests,
  __setSharedFavoritesForTests,
  addFavoritesLocal,
  snapshotAndRemoveLocal,
  type LocalFavorite,
} from '@/hooks/useFavorites'
import { readTrash } from '@/lib/favorites-trash'
import {
  __resetGlobalUndoForTests,
  globalUndoDepth,
  isMergeableKind,
  popGlobalUndo,
  pushGlobalUndo,
  UNDO_SUBLABEL,
  UNDO_WINDOW_MS,
  UndoStack,
} from '@/lib/undo-stack'
import {
  buildHomeBatchAddUndoEntry,
  buildHomeBatchPinUndoEntry,
  buildHomeBatchRemoveUndoEntry,
  HOME_BATCH_UNDO_SUBLABEL,
} from '@/lib/home-batch-undo'
import { pinSiteToWorkbench, type BatchPinReceipt } from '@/lib/modular/workbench-bridge'

/* ------------------------------------------------------------------ *
 * 假的浏览器环境（favorites-undo.test.ts + home-diy-store.test.ts 同款）
 * ------------------------------------------------------------------ */

const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown }

let store: Record<string, string>

function installStorage(entries: Record<string, string> = {}): Record<string, string> {
  store = { ...entries }
  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v)
    },
    removeItem: (k: string) => {
      delete store[k]
    },
  }
  globals.localStorage = localStorage
  globals.window = {
    localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }
  return store
}

function uninstallBrowser(): void {
  delete globals.window
  delete globals.localStorage
}

/* ------------------------------------------------------------------ *
 * 搭状态
 * ------------------------------------------------------------------ */

function item(id: string, href: string, title = '站点 ' + id): CustomCategoryItem {
  return { id, title, href }
}

function cat(id: string, title: string, items: CustomCategoryItem[]): CustomCategory {
  return { id, title, icon: 'FolderHeart', items, createdAt: 1000 }
}

function seedConfig(cats: CustomCategory[]): HomeDIYConfig {
  return { ...DEFAULT_CONFIG, customCategories: cats }
}

function categoryItems(categoryId: string): CustomCategoryItem[] {
  return (
    getHomeDiySnapshot().config.customCategories.find((c) => c.id === categoryId)
      ?.items ?? []
  )
}

function historyDepth(): number {
  return getHomeDiySnapshot().history.past.length
}

function captureHomeDiyApi(): ReturnType<typeof useHomeDIY> {
  let api: ReturnType<typeof useHomeDIY> | null = null
  function Probe() {
    api = useHomeDIY()
    return null
  }
  renderToString(createElement(Probe))
  if (!api) throw new Error('hook did not run')
  return api
}

function fav(siteId: string, createdAt = 1000): LocalFavorite {
  return { siteId, title: '站点 ' + siteId, href: 'https://example.com/' + siteId, createdAt }
}

function pinReceipt(
  addedItems: LocalFavorite[],
  overrides: Partial<BatchPinReceipt> = {},
): BatchPinReceipt {
  return {
    addedSiteIds: addedItems.map((i) => i.siteId),
    addedItems,
    createdDockWidgetId: null,
    pinnedCount: addedItems.length,
    ...overrides,
  }
}

beforeEach(() => {
  installStorage()
  __resetHomeDiyForTests()
  __resetFavoritesForTests()
  __resetGlobalUndoForTests()
})

afterEach(() => {
  vi.useRealTimers()
  __resetHomeDiyForTests()
  __resetFavoritesForTests()
  __resetGlobalUndoForTests()
  uninstallBrowser()
})

/* ------------------------------------------------------------------ *
 * §6.1 收据构造（真调批量函数）
 * ------------------------------------------------------------------ */

describe('收据构造：add', () => {
  it('新建 id 收集正确、duplicate 不进收据、新站插到最前面', () => {
    __resetHomeDiyForTests(seedConfig([cat('c1', '我的分类', [item('x', 'https://example.com/x')])]))
    const api = captureHomeDiyApi()
    const receipt = api.addSitesToCustomCategory('c1', [
      { title: 'A', href: 'https://example.com/a' },
      { title: 'B', href: 'https://example.com/b' },
    ])
    expect(receipt.addedCount).toBe(2)
    expect(receipt.duplicateCount).toBe(0)
    expect(receipt.failedCount).toBe(0)
    expect(receipt.added).toHaveLength(2)
    expect(receipt.added.map((a) => a.href)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
    expect(new Set(receipt.added.map((a) => a.id)).size).toBe(2)
    // 新站逐个 unshift：后收录的在更前面，与原来逐站调单站版的最终顺序一致
    expect(categoryItems('c1').map((i) => i.id)).toEqual([
      receipt.added[1]!.id,
      receipt.added[0]!.id,
      'x',
    ])
  })

  it('同批内后出现的同 href 站被已收录的前一个挡住，计 duplicate', () => {
    __resetHomeDiyForTests(seedConfig([cat('c1', '我的分类', [])]))
    const api = captureHomeDiyApi()
    const receipt = api.addSitesToCustomCategory('c1', [
      { title: 'A', href: 'https://example.com/a' },
      { title: 'A2', href: 'https://example.com/a' },
    ])
    expect(receipt.addedCount).toBe(1)
    expect(receipt.duplicateCount).toBe(1)
    expect(categoryItems('c1')).toHaveLength(1)
  })

  it('全 duplicate 时 updater 返回同一引用：不压历史、不写盘', () => {
    const before = seedConfig([cat('c1', '我的分类', [item('x', 'https://example.com/x')])])
    __resetHomeDiyForTests(before)
    const configBefore = getHomeDiySnapshot().config
    const api = captureHomeDiyApi()
    const receipt = api.addSitesToCustomCategory('c1', [{ title: 'X', href: 'https://example.com/x' }])
    expect(receipt.addedCount).toBe(0)
    expect(receipt.duplicateCount).toBe(1)
    expect(receipt.failedCount).toBe(0)
    expect(historyDepth()).toBe(0)
    expect(getHomeDiySnapshot().config).toBe(configBefore)
  })

  it('写盘失败（拿不到 localStorage）时 added 清零、改计 failedCount', () => {
    __resetHomeDiyForTests(seedConfig([cat('c1', '我的分类', [])]))
    const api = captureHomeDiyApi()
    uninstallBrowser()
    const receipt = api.addSitesToCustomCategory('c1', [
      { title: 'A', href: 'https://example.com/a' },
      { title: 'B', href: 'https://example.com/b' },
    ])
    expect(receipt.added).toEqual([])
    expect(receipt.addedCount).toBe(0)
    expect(receipt.failedCount).toBe(2)
    installStorage()
  })
})

describe('收据构造：remove', () => {
  it('批量移除跨分类：原 index 记录正确（过滤前下标）、多分类分组正确', () => {
    __resetHomeDiyForTests(
      seedConfig([
        cat('c1', '分类一', [item('x', 'https://example.com/x'), item('y', 'https://example.com/y'), item('z', 'https://example.com/z')]),
        cat('c2', '分类二', [item('p', 'https://example.com/p'), item('q', 'https://example.com/q')]),
      ]),
    )
    const api = captureHomeDiyApi()
    const receipt = api.removeSitesFromCustomCategories(['y', 'q'])
    expect(receipt.removedCount).toBe(2)
    expect(receipt.failedCount).toBe(0)
    expect(receipt.removed).toEqual([
      { categoryId: 'c1', item: item('y', 'https://example.com/y'), index: 1 },
      { categoryId: 'c2', item: item('q', 'https://example.com/q'), index: 1 },
    ])
    expect(categoryItems('c1').map((i) => i.id)).toEqual(['x', 'z'])
    expect(categoryItems('c2').map((i) => i.id)).toEqual(['p'])
  })

  it('0 命中返回同一引用：不压历史、不写盘', () => {
    __resetHomeDiyForTests(seedConfig([cat('c1', '分类一', [item('x', 'https://example.com/x')])]))
    const configBefore = getHomeDiySnapshot().config
    const api = captureHomeDiyApi()
    const receipt = api.removeSitesFromCustomCategories(['nope'])
    expect(receipt).toEqual({ removed: [], removedCount: 0, failedCount: 0 })
    expect(historyDepth()).toBe(0)
    expect(getHomeDiySnapshot().config).toBe(configBefore)
  })

  it('写盘失败（拿不到 localStorage）时 removed 清零、改计 failedCount', () => {
    __resetHomeDiyForTests(
      seedConfig([cat('c1', '分类一', [item('x', 'https://example.com/x'), item('y', 'https://example.com/y')])]),
    )
    const api = captureHomeDiyApi()
    uninstallBrowser()
    const receipt = api.removeSitesFromCustomCategories(['y'])
    expect(receipt.removed).toEqual([])
    expect(receipt.removedCount).toBe(0)
    expect(receipt.failedCount).toBe(1)
    installStorage()
  })
})

describe('收据构造：pin', () => {
  it('addedSiteIds 只含新建、已存在的不计', () => {
    __setSharedFavoritesForTests([fav('a')])
    const res = addFavoritesLocal([fav('a'), fav('b')])
    expect(res).not.toBeNull()
    expect(res!.added.map((i) => i.siteId)).toEqual(['b'])
    expect(res!.skippedSiteIds).toEqual(['a'])
  })

  it('pinSiteToWorkbench：新建收据 + 已固定过再 pin 时 added 为空、pinnedCount 仍为 1', () => {
    const first = pinSiteToWorkbench({ siteId: 'a', title: 'A', href: 'https://example.com/a' })
    expect(first.ok).toBe(true)
    expect(first.receipt).not.toBeNull()
    expect(first.receipt!.addedSiteIds).toEqual(['a'])
    expect(first.receipt!.addedItems).toHaveLength(1)
    expect(first.receipt!.createdDockWidgetId).toBeNull()
    expect(first.receipt!.pinnedCount).toBe(1)

    const second = pinSiteToWorkbench({ siteId: 'a', title: 'A', href: 'https://example.com/a' })
    expect(second.ok).toBe(true)
    expect(second.receipt!.addedSiteIds).toEqual([])
    expect(second.receipt!.pinnedCount).toBe(1)
  })

  it('pinSiteToWorkbench：活跃看板没有 dock 时新建并捕获 createdDockWidgetId', () => {
    store[BOARDS_STORAGE_KEY] = JSON.stringify({
      boards: [{ id: 'b1', widgets: [] }],
      activeBoardId: 'b1',
    })
    const res = pinSiteToWorkbench({ siteId: 'a', title: 'A', href: 'https://example.com/a' })
    expect(res.ok).toBe(true)
    expect(res.receipt!.createdDockWidgetId).toMatch(/^widget-favorites-dock-/)
    const boards = JSON.parse(store[BOARDS_STORAGE_KEY]!) as {
      boards: Array<{ widgets: Array<{ id: string; type: string }> }>
    }
    expect(boards.boards[0]!.widgets.map((w) => w.type)).toContain('favorites-dock')
  })
})

/* ------------------------------------------------------------------ *
 * §6.1 单提交
 * ------------------------------------------------------------------ */

describe('单提交', () => {
  it('批量 N 站 = 一次 commitHomeDiyConfig（DIY 历史恰好多一条）', () => {
    vi.useFakeTimers()
    __resetHomeDiyForTests(seedConfig([cat('c1', '我的分类', [])]))
    const api = captureHomeDiyApi()
    api.addSitesToCustomCategory('c1', [
      { title: 'A', href: 'https://example.com/a' },
      { title: 'B', href: 'https://example.com/b' },
      { title: 'C', href: 'https://example.com/c' },
    ])
    expect(historyDepth()).toBe(1)

    // 两批之间推进 600ms：否则同 key 的两连改会按设计的 500ms 合并窗口
    // 并进同一条 DIY 历史，past 只能说明“非合并提交数”而不是 commit 次数。
    vi.advanceTimersByTime(600)
    api.removeSitesFromCustomCategories([
      categoryItems('c1')[0]!.id,
      categoryItems('c1')[1]!.id,
    ])
    expect(historyDepth()).toBe(2)
    vi.useRealTimers()
  })

  it('300ms 内两批同 key 在全局栈各自独立成条（fake timers，R4）', async () => {
    vi.useFakeTimers()
    __resetHomeDiyForTests(seedConfig([cat('c1', '我的分类', [])]))
    const api = captureHomeDiyApi()
    const r1 = api.addSitesToCustomCategory('c1', [{ title: 'A', href: 'https://example.com/a' }])
    vi.advanceTimersByTime(300)
    const r2 = api.addSitesToCustomCategory('c1', [{ title: 'B', href: 'https://example.com/b' }])
    const e1 = buildHomeBatchAddUndoEntry(r1)
    const e2 = buildHomeBatchAddUndoEntry(r2)
    expect(e1).not.toBeNull()
    expect(e2).not.toBeNull()
    expect(e1!.batchId).not.toBe(e2!.batchId)
    pushGlobalUndo(e1!)
    pushGlobalUndo(e2!)
    // 全局单例里两条都在，没被合并窗口吞掉（DIY 历史的 500ms 合并是另一层，
    // 不影响全局栈：两批各有各的 8 秒条，各撤各的）
    expect(globalUndoDepth()).toBe(2)
    const top = popGlobalUndo()
    expect(top?.id).toBe(e2!.id)
    await top!.undo()
    expect(categoryItems('c1').map((i) => i.title)).toEqual(['A'])
    const next = popGlobalUndo()
    expect(next?.id).toBe(e1!.id)
    await next!.undo()
    expect(categoryItems('c1')).toEqual([])
    vi.useRealTimers()
  })
})

/* ------------------------------------------------------------------ *
 * §6.1 逆操作纯函数：add
 * ------------------------------------------------------------------ */

describe('逆操作：add 按 id 删', () => {
  it('label/sublabel/count/detail 按 §2.1，窗口 8 秒', () => {
    const receipt: BatchAddReceipt = {
      categoryId: 'c1',
      categoryTitle: '我的分类',
      added: [
        { id: 'a1', href: 'https://example.com/a', title: 'A' },
        { id: 'b1', href: 'https://example.com/b', title: 'B' },
      ],
      addedCount: 2,
      duplicateCount: 0,
      failedCount: 0,
    }
    const entry = buildHomeBatchAddUndoEntry(receipt)
    expect(entry).not.toBeNull()
    expect(entry!.kind).toBe('home.batch-add')
    expect(entry!.label).toBe('已收录 2 个站点至「我的分类」')
    expect(entry!.sublabel).toBe(HOME_BATCH_UNDO_SUBLABEL)
    expect(entry!.count).toBe(2)
    expect(entry!.detail).toBe('我的分类')
    expect(entry!.expiresAt - entry!.createdAt).toBe(UNDO_WINDOW_MS)
  })

  it('同 href 不同 id 不误删', async () => {
    __resetHomeDiyForTests(seedConfig([cat('c1', '我的分类', [item('x', 'https://example.com/x')])]))
    const api = captureHomeDiyApi()
    const receipt = api.addSitesToCustomCategory('c1', [
      { title: 'A', href: 'https://example.com/a' },
      { title: 'B', href: 'https://example.com/b' },
    ])
    // 撤销前用户手动又加了一个同 href（不同 id）的站
    commitHomeDiyConfig((prev) => ({
      ...prev,
      customCategories: prev.customCategories.map((c) =>
        c.id === 'c1'
          ? { ...c, items: [item('manual', 'https://example.com/a', '手动加的 A'), ...c.items] }
          : c,
      ),
      updatedAt: Date.now(),
    }))
    const entry = buildHomeBatchAddUndoEntry(receipt)
    const result = await entry!.undo()
    expect(result.ok).toBe(true)
    expect(categoryItems('c1').map((i) => i.id)).toEqual(['manual', 'x'])
  })

  it('幂等：执行两次终态一致，第二次仍 ok', async () => {
    __resetHomeDiyForTests(seedConfig([cat('c1', '我的分类', [item('x', 'https://example.com/x')])]))
    const api = captureHomeDiyApi()
    const receipt = api.addSitesToCustomCategory('c1', [{ title: 'A', href: 'https://example.com/a' }])
    const entry = buildHomeBatchAddUndoEntry(receipt)
    expect((await entry!.undo()).ok).toBe(true)
    const afterFirst = categoryItems('c1').map((i) => i.id)
    expect((await entry!.undo()).ok).toBe(true)
    expect(categoryItems('c1').map((i) => i.id)).toEqual(afterFirst)
  })
})

/* ------------------------------------------------------------------ *
 * §6.1 逆操作纯函数：remove
 * ------------------------------------------------------------------ */

describe('逆操作：remove 按原位插回', () => {
  it('label/sublabel/count/detail 按 §2.1（多分类取第一个 + 等 M 个分类）', () => {
    __resetHomeDiyForTests(
      seedConfig([
        cat('c1', '分类一', [item('y', 'https://example.com/y')]),
        cat('c2', '分类二', [item('q', 'https://example.com/q')]),
      ]),
    )
    const receipt: BatchRemoveReceipt = {
      removed: [
        { categoryId: 'c1', item: item('y', 'https://example.com/y'), index: 0 },
        { categoryId: 'c2', item: item('q', 'https://example.com/q'), index: 0 },
      ],
      removedCount: 2,
      failedCount: 0,
    }
    const entry = buildHomeBatchRemoveUndoEntry(receipt)
    expect(entry).not.toBeNull()
    expect(entry!.kind).toBe('home.batch-remove')
    expect(entry!.label).toBe('已从专属分类移除 2 个站点')
    expect(entry!.sublabel).toBe(HOME_BATCH_UNDO_SUBLABEL)
    expect(entry!.count).toBe(2)
    expect(entry!.detail).toBe('分类一等 2 个分类')
  })

  it('无 intervening 插入时精确还原', async () => {
    __resetHomeDiyForTests(
      seedConfig([cat('c1', '分类一', [item('x', 'https://example.com/x'), item('y', 'https://example.com/y'), item('z', 'https://example.com/z')])]),
    )
    const api = captureHomeDiyApi()
    const receipt = api.removeSitesFromCustomCategories(['y'])
    const entry = buildHomeBatchRemoveUndoEntry(receipt)
    expect((await entry!.undo()).ok).toBe(true)
    expect(categoryItems('c1').map((i) => i.id)).toEqual(['x', 'y', 'z'])
  })

  it('已在列表里的条目跳过，不重复插回', async () => {
    __resetHomeDiyForTests(
      seedConfig([cat('c1', '分类一', [item('x', 'https://example.com/x'), item('y', 'https://example.com/y'), item('z', 'https://example.com/z')])]),
    )
    const api = captureHomeDiyApi()
    const receipt = api.removeSitesFromCustomCategories(['y'])
    // 撤销前用户手动把 Y 又加回来了（同 id）
    commitHomeDiyConfig((prev) => ({
      ...prev,
      customCategories: prev.customCategories.map((c) =>
        c.id === 'c1' ? { ...c, items: [...c.items, item('y', 'https://example.com/y')] } : c,
      ),
      updatedAt: Date.now(),
    }))
    const entry = buildHomeBatchRemoveUndoEntry(receipt)
    expect((await entry!.undo()).ok).toBe(true)
    expect(categoryItems('c1').map((i) => i.id)).toEqual(['x', 'z', 'y'])
  })

  it('多分类一次提交全部恢复', async () => {
    __resetHomeDiyForTests(
      seedConfig([
        cat('c1', '分类一', [item('x', 'https://example.com/x'), item('y', 'https://example.com/y')]),
        cat('c2', '分类二', [item('p', 'https://example.com/p'), item('q', 'https://example.com/q')]),
      ]),
    )
    const api = captureHomeDiyApi()
    const receipt = api.removeSitesFromCustomCategories(['y', 'q'])
    const entry = buildHomeBatchRemoveUndoEntry(receipt)
    expect((await entry!.undo()).ok).toBe(true)
    expect(categoryItems('c1').map((i) => i.id)).toEqual(['x', 'y'])
    expect(categoryItems('c2').map((i) => i.id)).toEqual(['p', 'q'])
  })

  it('目标分类被删：整批拒绝恢复，不自动重建分类', async () => {
    __resetHomeDiyForTests(
      seedConfig([cat('c1', '分类一', [item('x', 'https://example.com/x'), item('y', 'https://example.com/y')])]),
    )
    const api = captureHomeDiyApi()
    const receipt = api.removeSitesFromCustomCategories(['y'])
    api.deleteCustomCategory('c1')
    const entry = buildHomeBatchRemoveUndoEntry(receipt)
    const result = await entry!.undo()
    expect(result).toEqual({ ok: false, message: '分类已被删除，无法恢复这批站点' })
    expect(getHomeDiySnapshot().config.customCategories).toEqual([])
  })

  it('幂等：执行两次终态一致，第二次仍 ok', async () => {
    __resetHomeDiyForTests(
      seedConfig([cat('c1', '分类一', [item('x', 'https://example.com/x'), item('y', 'https://example.com/y')])]),
    )
    const api = captureHomeDiyApi()
    const receipt = api.removeSitesFromCustomCategories(['y'])
    const entry = buildHomeBatchRemoveUndoEntry(receipt)
    expect((await entry!.undo()).ok).toBe(true)
    const afterFirst = categoryItems('c1').map((i) => i.id)
    expect((await entry!.undo()).ok).toBe(true)
    expect(categoryItems('c1').map((i) => i.id)).toEqual(afterFirst)
  })
})

/* ------------------------------------------------------------------ *
 * §6.3 remove 快通道越位用例（决策 3 的容差锁定，必须有）
 * ------------------------------------------------------------------ */

describe('remove 越位用例（§6.3）', () => {
  it('撤销前有别的插入：集合完全一致、顺序至多差一位', async () => {
    __resetHomeDiyForTests(
      seedConfig([cat('c1', '分类一', [item('x', 'https://example.com/x'), item('y', 'https://example.com/y'), item('z', 'https://example.com/z')])]),
    )
    const api = captureHomeDiyApi()
    const receipt = api.removeSitesFromCustomCategories(['y'])
    // 8 秒内用户手动在 C 开头插入 W
    commitHomeDiyConfig((prev) => ({
      ...prev,
      customCategories: prev.customCategories.map((c) =>
        c.id === 'c1' ? { ...c, items: [item('w', 'https://example.com/w', 'W'), ...c.items] } : c,
      ),
      updatedAt: Date.now(),
    }))
    expect(categoryItems('c1').map((i) => i.id)).toEqual(['w', 'x', 'z'])
    const entry = buildHomeBatchRemoveUndoEntry(receipt)
    expect((await entry!.undo()).ok).toBe(true)
    const order = categoryItems('c1').map((i) => i.id)
    // 集合一个不少
    expect([...order].sort()).toEqual(['w', 'x', 'y', 'z'])
    // 顺序至多差一位：Y 插回原 index=1，要么 [W,Y,X,Z]，要么 [W,X,Y,Z]
    expect([
      ['w', 'y', 'x', 'z'],
      ['w', 'x', 'y', 'z'],
    ]).toContainEqual(order)
  })
})

/* ------------------------------------------------------------------ *
 * §6.1 逆操作纯函数：pin
 * ------------------------------------------------------------------ */

describe('逆操作：pin 按 siteId 删收藏（只删本次新建的）', () => {
  it('label/sublabel/count 按 §2.1：pin 用默认 UNDO_SUBLABEL', () => {
    const entry = buildHomeBatchPinUndoEntry(pinReceipt([fav('a'), fav('b')]))
    expect(entry).not.toBeNull()
    expect(entry!.kind).toBe('home.batch-pin')
    expect(entry!.label).toBe('已固定 2 个站点到工作台')
    expect(entry!.sublabel).toBe(UNDO_SUBLABEL)
    expect(entry!.count).toBe(2)
    expect(entry!.expiresAt - entry!.createdAt).toBe(UNDO_WINDOW_MS)
  })

  it('正常撤销：收藏条目消失、快照进回收站', async () => {
    __setSharedFavoritesForTests([fav('a'), fav('b')])
    const entry = buildHomeBatchPinUndoEntry(pinReceipt([fav('a'), fav('b')]))
    const result = await entry!.undo()
    expect(result).toEqual({ ok: true })
    expect(__getSharedFavoritesForTests()).toEqual([])
    expect(readTrash().items.map((i) => i.siteId).sort()).toEqual(['a', 'b'])
  })

  it('幂等：执行两次终态一致，第二次仍 ok', async () => {
    __setSharedFavoritesForTests([fav('a'), fav('b')])
    const entry = buildHomeBatchPinUndoEntry(pinReceipt([fav('a'), fav('b')]))
    expect((await entry!.undo()).ok).toBe(true)
    expect((await entry!.undo()).ok).toBe(true)
    expect(__getSharedFavoritesForTests()).toEqual([])
  })

  it('存储写不进去（sharedBlocked）时返回失败、收藏不动', async () => {
    __setSharedFavoritesForTests([fav('a'), fav('b')], 'blocked-for-test')
    const entry = buildHomeBatchPinUndoEntry(pinReceipt([fav('a'), fav('b')]))
    const result = await entry!.undo()
    expect(result).toEqual({ ok: false, message: '本机存储写不进去，撤销未完成' })
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['a', 'b'])
    expect(readTrash().items).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * §6.2 R1 CAS 误伤用例（必须有）
 * ------------------------------------------------------------------ */

describe('R1 CAS 误伤用例（§6.2）', () => {
  it('删后重 pin 同站：撤销须跳过新条目并提示“其中 1 个已变化，未动”、trash 里只有 B 没有 A', async () => {
    // 首页选中 A、B 两站 → P 固定（收据 createdAt 为 T0=1000）
    const a0 = fav('a', 1000)
    const b0 = fav('b', 1000)
    __setSharedFavoritesForTests([a0, b0])
    const receipt = pinReceipt([a0, b0])

    // 8 秒内用户在收藏页删了 A，又重新 pin A（新条目 createdAt T1=2000）
    const userDelete = snapshotAndRemoveLocal(['a'], 'single')
    expect(userDelete).not.toBeNull()
    expect(userDelete!.removed.map((r) => r.item.siteId)).toEqual(['a'])
    const rePinned = addFavoritesLocal([{ ...a0, createdAt: 2000 }])
    expect(rePinned).not.toBeNull()
    expect(rePinned!.added.map((i) => i.siteId)).toEqual(['a'])
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['a', 'b'])

    // Ctrl+Z 撤销批量 pin
    const entry = buildHomeBatchPinUndoEntry(receipt)
    const result = await entry!.undo()

    // 1. B 被删（终态与 pin 前一致）
    // 2. A 的新条目还在（CAS 跳过，未误删）
    expect(result.ok).toBe(true)
    expect(result.message).toContain('已取消固定 1 个站点')
    expect(result.message).toContain('其中 1 个已变化，未动')
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['a'])
    expect(__getSharedFavoritesForTests()[0]!.createdAt).toBe(2000)

    // 4. trash：撤销没给 A 写新快照——A 的快照仍是用户那次删除的 batchId，
    //    B 的快照是撤销这次写的（batchId 与用户删除的不同）。
    //    （addToTrash 同站只留最新一份，所以断言 batchId 而不是条数。）
    const trash = readTrash()
    const trashA = trash.items.find((i) => i.siteId === 'a')
    const trashB = trash.items.find((i) => i.siteId === 'b')
    expect(trashA).toBeDefined()
    expect(trashA!.batchId).toBe(userDelete!.batchId)
    expect(trashB).toBeDefined()
    expect(trashB!.batchId).not.toBe(userDelete!.batchId)
  })
})

/* ------------------------------------------------------------------ *
 * §6.1 不推规则（§2.3）
 * ------------------------------------------------------------------ */

describe('不推规则：0 生效 / 写盘失败 builder 返回 null', () => {
  it('add 全 duplicate → null', () => {
    __resetHomeDiyForTests(seedConfig([cat('c1', '我的分类', [item('x', 'https://example.com/x')])]))
    const api = captureHomeDiyApi()
    const receipt = api.addSitesToCustomCategory('c1', [{ title: 'X', href: 'https://example.com/x' }])
    expect(receipt.addedCount).toBe(0)
    expect(buildHomeBatchAddUndoEntry(receipt)).toBeNull()
  })

  it('remove 命中 0 → null', () => {
    __resetHomeDiyForTests(seedConfig([cat('c1', '分类一', [item('x', 'https://example.com/x')])]))
    const api = captureHomeDiyApi()
    const receipt = api.removeSitesFromCustomCategories(['nope'])
    expect(receipt.removedCount).toBe(0)
    expect(buildHomeBatchRemoveUndoEntry(receipt)).toBeNull()
  })

  it('pin 全是已固定过的站（addedSiteIds 为空，即使 pinnedCount > 0）→ null', () => {
    const receipt = pinReceipt([], { pinnedCount: 2 })
    expect(buildHomeBatchPinUndoEntry(receipt)).toBeNull()
  })

  it('写盘失败的 add 收据（failedCount > 0、addedCount = 0）→ null', () => {
    __resetHomeDiyForTests(seedConfig([cat('c1', '我的分类', [])]))
    const api = captureHomeDiyApi()
    uninstallBrowser()
    const receipt = api.addSitesToCustomCategory('c1', [
      { title: 'A', href: 'https://example.com/a' },
      { title: 'B', href: 'https://example.com/b' },
    ])
    installStorage()
    expect(receipt.failedCount).toBe(2)
    expect(buildHomeBatchAddUndoEntry(receipt)).toBeNull()
  })

  it('写盘失败的 remove 收据（failedCount > 0、removedCount = 0）→ null', () => {
    __resetHomeDiyForTests(
      seedConfig([cat('c1', '分类一', [item('x', 'https://example.com/x'), item('y', 'https://example.com/y')])]),
    )
    const api = captureHomeDiyApi()
    uninstallBrowser()
    const receipt = api.removeSitesFromCustomCategories(['y'])
    installStorage()
    expect(receipt.failedCount).toBe(1)
    expect(buildHomeBatchRemoveUndoEntry(receipt)).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * §6.1 新 kind（builder 侧）：连续两批不合并
 * ------------------------------------------------------------------ */

describe('新 kind（builder 侧）：连续两批不合并', () => {
  it.each([
    ['home.batch-add'],
    ['home.batch-remove'],
    ['home.batch-pin'],
  ] as const)('%s 不进 MERGEABLE_KINDS：两批各成一条', (kind) => {
    expect(isMergeableKind(kind)).toBe(false)
    const stack = new UndoStack()
    const now = Date.now()
    const mk = (id: string, createdAt: number) => ({
      id,
      batchId: 'b-' + id,
      kind,
      label: 'x',
      createdAt,
      expiresAt: createdAt + UNDO_WINDOW_MS,
      count: 1,
      undo: async () => ({ ok: true }),
    })
    stack.push(mk('first', now))
    stack.push(mk('second', now + 100))
    expect(stack.size).toBe(2)
    expect(stack.peek()?.id).toBe('second')
  })
})

/* ------------------------------------------------------------------ *
 * §6.1 逆操作不压 DIY 历史（决策 5 已撤销）+ 普通提交合并回归
 * ------------------------------------------------------------------ */

describe('逆操作不压 DIY 历史（决策 5 已撤销，R5 幂等）', () => {
  it('逆操作闭包不压 DIY 历史：执行全局撤销后 past 长度不变', async () => {
    // add 闭包
    __resetHomeDiyForTests(seedConfig([cat('c1', '我的分类', [item('x', 'https://example.com/x')])]))
    const api = captureHomeDiyApi()
    const receipt = api.addSitesToCustomCategory('c1', [{ title: 'A', href: 'https://example.com/a' }])
    expect(historyDepth()).toBe(1)
    const entry = buildHomeBatchAddUndoEntry(receipt)
    expect((await entry!.undo()).ok).toBe(true)
    expect(categoryItems('c1').map((i) => i.id)).toEqual(['x'])
    // 闭包用 { pushHistory: false }：全局撤销不留 DIY 历史记录
    expect(historyDepth()).toBe(1)

    // remove 闭包（同一条裁决，第二个调用点）
    __resetHomeDiyForTests(
      seedConfig([cat('c1', '分类一', [item('x', 'https://example.com/x'), item('y', 'https://example.com/y')])]),
    )
    const api2 = captureHomeDiyApi()
    const receipt2 = api2.removeSitesFromCustomCategories(['y'])
    expect(historyDepth()).toBe(1)
    const entry2 = buildHomeBatchRemoveUndoEntry(receipt2)
    expect((await entry2!.undo()).ok).toBe(true)
    expect(categoryItems('c1').map((i) => i.id)).toEqual(['x', 'y'])
    expect(historyDepth()).toBe(1)
  })

  it('全局撤销后编排态 Ctrl+Z 为 no-op（§5.3 用例 2，先快后长幂等）', async () => {
    __resetHomeDiyForTests(seedConfig([cat('c1', '我的分类', [item('x', 'https://example.com/x')])]))
    const api = captureHomeDiyApi()
    const receipt = api.addSitesToCustomCategory('c1', [{ title: 'A', href: 'https://example.com/a' }])
    const entry = buildHomeBatchAddUndoEntry(receipt)
    expect((await entry!.undo()).ok).toBe(true)
    expect(categoryItems('c1').map((i) => i.id)).toEqual(['x'])
    // 编排态 Ctrl+Z：弹出批量提交 H1，present 仍是批量前状态 S0，终态不变
    undoHomeDiy()
    expect(categoryItems('c1').map((i) => i.id)).toEqual(['x'])
    expect(historyDepth()).toBe(0)
  })

  it('redo 仍可用：编排态 Ctrl+Shift+Z 重做批量操作，批量站点回来', async () => {
    __resetHomeDiyForTests(seedConfig([cat('c1', '我的分类', [item('x', 'https://example.com/x')])]))
    const api = captureHomeDiyApi()
    const receipt = api.addSitesToCustomCategory('c1', [{ title: 'A', href: 'https://example.com/a' }])
    const entry = buildHomeBatchAddUndoEntry(receipt)
    expect((await entry!.undo()).ok).toBe(true)
    expect(categoryItems('c1').map((i) => i.id)).toEqual(['x'])
    // 先长路径撤销（弹出 H1，终态不变），再 redo：H1 仍在栈上，重做批量操作
    undoHomeDiy()
    expect(categoryItems('c1').map((i) => i.id)).toEqual(['x'])
    redoHomeDiy()
    expect(categoryItems('c1').map((i) => i.title)).toEqual(['A', '站点 x'])
  })

  it('普通提交的合并行为不变（回归）：500ms 内同字段两连改只压一条', () => {
    __resetHomeDiyForTests(seedConfig([]))
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'amber' }))
    commitHomeDiyConfig((prev) => ({ ...prev, accentColor: 'rose' }))
    expect(historyDepth()).toBe(1)
    expect(getHomeDiySnapshot().config.accentColor).toBe('rose')
  })
})
