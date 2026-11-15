/**
 * 收藏撤销（useFavorites 级集成）。
 *
 * 仓库没有 hook 渲染器（无 testing-library/jsdom），集成用例走模块级
 * 真源 + 源码守卫，与 favorites-sync.test.ts 同款做法：
 *  - 删除/恢复的真逻辑（snapshotAndRemoveLocal / buildRemoveUndoEntry /
 *    restoreRemovedFavorites / applyMetaUpdate）直接调模块函数断言；
 *  - hook 回调的接线（toggle/remove/clear/updateMeta 推栈、replaceAll
 *    不经过撤销路径、storageBlocked 拦住删除与撤销）用源码守卫钉死。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  __getSharedFavoritesForTests,
  __resetFavoritesForTests,
  __setSharedFavoritesForTests,
  applyMetaUpdate,
  buildRemoveUndoEntry,
  clearFavoritesLocal,
  readRestoreAtOverrides,
  restoreRemovedFavorites,
  snapshotAndRemoveLocal,
  type LocalFavorite,
} from '@/hooks/useFavorites'
import { __resetGlobalUndoForTests, peekGlobalUndo, popGlobalUndo, pushGlobalUndo } from '@/lib/undo-stack'
import { readTrash } from '@/lib/favorites-trash'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const DIRTY_KEY = 'navhub.favorites.dirty.v1'

/** fake localStorage + window（与 favorites-sync.test.ts 同款） */
function installStorage(entries: Record<string, string> = {}): Record<string, string> {
  const store: Record<string, string> = { ...entries }
  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v)
    },
    removeItem: (k: string) => {
      delete store[k]
    },
  }
  const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown }
  globals.localStorage = localStorage
  globals.window = {
    localStorage,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }
  return store
}

function fav(siteId: string, overrides: Partial<LocalFavorite> = {}): LocalFavorite {
  return {
    siteId,
    title: '站点 ' + siteId,
    href: 'https://example.com/' + siteId,
    note: '备注 ' + siteId,
    tags: ['t1', 't2'],
    folderId: 'folder-1',
    createdAt: 1000,
    lastOpenedAt: 1500,
    ...overrides,
  }
}

let store: Record<string, string>

beforeEach(() => {
  store = installStorage()
  __resetFavoritesForTests()
  __resetGlobalUndoForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown }
  delete globals.window
  delete globals.localStorage
})

function seedFive(): LocalFavorite[] {
  const items = [fav('a'), fav('b'), fav('c'), fav('d'), fav('e')]
  __setSharedFavoritesForTests(items)
  return items
}

function readDirty(): string[] {
  try {
    return JSON.parse(store[DIRTY_KEY] ?? '[]') as string[]
  } catch {
    return []
  }
}

describe('删单条 → 撤销恢复原位（全字段保留）', () => {
  it('恢复到原 index，folderId/note/tags/createdAt/lastOpenedAt 全保留', async () => {
    seedFive()
    const removed = snapshotAndRemoveLocal(['c'], 'single')
    expect(removed).not.toBeNull()
    expect(removed!.removed).toHaveLength(1)
    expect(removed!.removed[0]!.index).toBe(2)
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['a', 'b', 'd', 'e'])

    // persist 成功后快照进回收站（先改本体、再写快照，见 snapshotAndRemoveLocal）
    const trash = readTrash()
    expect(trash.items.map((i) => i.siteId)).toEqual(['c'])
    expect(trash.items[0]!.note).toBe('备注 c')
    expect(trash.items[0]!.index).toBe(2)

    const entry = buildRemoveUndoEntry(removed!.removed, removed!.batchId)
    expect(entry).not.toBeNull()
    expect(entry!.label).toBe('已删除「站点 c」')
    pushGlobalUndo(entry!)
    const result = await popGlobalUndo()!.undo()
    expect(result.ok).toBe(true)
    const restored = __getSharedFavoritesForTests()
    expect(restored.map((i) => i.siteId)).toEqual(['a', 'b', 'c', 'd', 'e'])
    const c = restored[2]!
    expect(c.folderId).toBe('folder-1')
    expect(c.note).toBe('备注 c')
    expect(c.tags).toEqual(['t1', 't2'])
    expect(c.createdAt).toBe(1000)
    expect(c.lastOpenedAt).toBe(1500)
    // 撤销后置脏 + 记恢复时刻（同步 add op 的 at 用它，LWW 才不会被墓碑挡掉）
    expect(readDirty()).toContain('c')
    expect(readRestoreAtOverrides()['c']).toBeGreaterThan(1000)
    // 恢复成功后回收站里的快照清掉
    expect(readTrash().items).toHaveLength(0)
  })

  it('删除不存在的 siteId 不推撤销条', () => {
    seedFive()
    const removed = snapshotAndRemoveLocal(['zzz'], 'single')
    expect(removed).not.toBeNull()
    expect(removed!.removed).toHaveLength(0)
    expect(buildRemoveUndoEntry(removed!.removed, removed!.batchId)).toBeNull()
    expect(__getSharedFavoritesForTests()).toHaveLength(5)
  })
})

describe('批量删 5 条 → 一次撤销全回', () => {
  it('合并成一条"已删除 5 条收藏"，一次 undo 全回原位', async () => {
    seedFive()
    // 模拟 handleBatchDelete 的逐条 remove：同 kind 8 秒内合并成一条
    for (const siteId of ['a', 'b', 'c', 'd', 'e']) {
      const removed = snapshotAndRemoveLocal([siteId], 'batch')
      const entry = buildRemoveUndoEntry(removed!.removed, removed!.batchId)
      if (entry) pushGlobalUndo(entry)
    }
    const top = peekGlobalUndo()
    expect(top).not.toBeNull()
    expect(top!.label).toBe('已删除 5 条收藏')
    expect(top!.count).toBe(5)
    expect(__getSharedFavoritesForTests()).toHaveLength(0)
    const result = await popGlobalUndo()!.undo()
    expect(result.ok).toBe(true)
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('移夹 → 撤销回原夹', () => {
  it('updateMeta 推 move-folder 条目，undo 回原夹并记恢复时刻', async () => {
    seedFive()
    expect(applyMetaUpdate('b', { folderId: 'folder-2' })).toBe(true)
    expect(__getSharedFavoritesForTests().find((i) => i.siteId === 'b')!.folderId).toBe('folder-2')
    const top = peekGlobalUndo()
    expect(top?.kind).toBe('favorite.move-folder')
    const result = await popGlobalUndo()!.undo()
    expect(result.ok).toBe(true)
    expect(__getSharedFavoritesForTests().find((i) => i.siteId === 'b')!.folderId).toBe('folder-1')
    expect(readRestoreAtOverrides()['b']).toBeGreaterThan(1000)
  })

  it('改备注/改标签不进栈；pushUndo=false 的内部调用不进栈', () => {
    seedFive()
    expect(applyMetaUpdate('b', { note: '新备注' })).toBe(true)
    expect(peekGlobalUndo()).toBeNull()
    expect(applyMetaUpdate('b', { tags: ['x'] })).toBe(true)
    expect(peekGlobalUndo()).toBeNull()
    expect(applyMetaUpdate('b', { folderId: 'folder-9' }, { pushUndo: false })).toBe(true)
    expect(peekGlobalUndo()).toBeNull()
  })

  it('移夹两次按栈顺序倒序恢复', async () => {
    seedFive()
    applyMetaUpdate('b', { folderId: 'folder-2' })
    applyMetaUpdate('b', { folderId: 'folder-3' })
    // 两次移夹是两条不同 kind？不，都是 move-folder 且 8 秒内 → 合并成一条，
    // undo 先恢复新操作再恢复旧操作，最终回到 folder-1
    expect(__getSharedFavoritesForTests().find((i) => i.siteId === 'b')!.folderId).toBe('folder-3')
    const result = await popGlobalUndo()!.undo()
    expect(result.ok).toBe(true)
    expect(__getSharedFavoritesForTests().find((i) => i.siteId === 'b')!.folderId).toBe('folder-1')
  })
})

describe('清空 → 全量恢复；storageBlocked 时删除与撤销都被拦', () => {
  it('清空快照全量进回收站，一次 undo 全回', async () => {
    seedFive()
    const removed = snapshotAndRemoveLocal(['a', 'b', 'c', 'd', 'e'], 'clear')
    expect(removed!.removed).toHaveLength(5)
    expect(readTrash().items).toHaveLength(5)
    const entry = buildRemoveUndoEntry(removed!.removed, removed!.batchId)
    expect(entry!.label).toBe('已删除 5 条收藏')
    const result = await entry!.undo()
    expect(result.ok).toBe(true)
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('storageBlocked 时删除不执行、撤销返回 false', async () => {
    seedFive()
    __setSharedFavoritesForTests(__getSharedFavoritesForTests(), '本地收藏数据读不出来')
    expect(snapshotAndRemoveLocal(['c'], 'single')).toBeNull()
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['a', 'b', 'c', 'd', 'e'])
    // 撤销同样被拦：persistLocalFavorites 在 storageBlocked 时拒绝一切写入
    __setSharedFavoritesForTests(seedFive(), null)
    const removed = snapshotAndRemoveLocal(['c'], 'single')!
    __setSharedFavoritesForTests(__getSharedFavoritesForTests(), '本地收藏数据读不出来')
    const result = await restoreRemovedFavorites(removed.removed, 'undo')
    expect(result.ok).toBe(false)
  })
})

describe('clear()：pushUndo:false 绝不写回收站键；persist 失败不留快照（B1/N1）', () => {
  it('pushUndo:false 时只清本体：收藏空了、回收站键没被碰过', () => {
    seedFive()
    const result = clearFavoritesLocal({ pushUndo: false })
    expect(result).not.toBeNull()
    expect(result!.removed).toHaveLength(5)
    expect(__getSharedFavoritesForTests()).toHaveLength(0)
    // 账号删除绝不碰回收站键：之前没有快照，之后也没有
    expect(readTrash().items).toHaveLength(0)
    // 清空仍置脏（同步走 remove ops，把云端收藏也清掉）
    expect(readDirty().sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('默认清空时快照全量进回收站（source=clear）', () => {
    seedFive()
    const result = clearFavoritesLocal()
    expect(result).not.toBeNull()
    expect(__getSharedFavoritesForTests()).toHaveLength(0)
    const trash = readTrash()
    expect(trash.items.map((i) => i.siteId)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(trash.items.every((i) => i.source === 'clear')).toBe(true)
  })

  it('storageBlocked 时清空不执行：返回 null、收藏不动、回收站无快照', () => {
    seedFive()
    __setSharedFavoritesForTests(__getSharedFavoritesForTests(), '本地收藏数据读不出来')
    expect(clearFavoritesLocal()).toBeNull()
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(readTrash().items).toHaveLength(0)
  })

  it('storageBlocked 时单条删除不执行：返回 null、回收站无「没删成」的快照', () => {
    seedFive()
    __setSharedFavoritesForTests(__getSharedFavoritesForTests(), '本地收藏数据读不出来')
    expect(snapshotAndRemoveLocal(['c'], 'single')).toBeNull()
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(readTrash().items).toHaveLength(0)
  })
})

describe('撤销两次按栈顺序倒序恢复', () => {
  it('先删 A 后删 B：第一次 Ctrl+Z 回 B，第二次回 A', async () => {
    seedFive()
    // 用不同 kind 避免合并：删 B（remove），再移夹 A（move-folder）
    const removedB = snapshotAndRemoveLocal(['b'], 'single')!
    pushGlobalUndo(buildRemoveUndoEntry(removedB.removed, removedB.batchId)!)
    applyMetaUpdate('a', { folderId: 'folder-2' })
    expect(peekGlobalUndo()?.kind).toBe('favorite.move-folder')

    const first = await popGlobalUndo()!.undo()
    expect(first.ok).toBe(true)
    expect(__getSharedFavoritesForTests().find((i) => i.siteId === 'a')!.folderId).toBe('folder-1')
    expect(__getSharedFavoritesForTests().some((i) => i.siteId === 'b')).toBe(false)

    const second = await popGlobalUndo()!.undo()
    expect(second.ok).toBe(true)
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(popGlobalUndo()).toBeUndefined()
  })
})

describe('接线守卫：replaceAll 不经过撤销路径；hook 回调推栈', () => {
  const hookSrc = overlaySource('src/hooks/useFavorites.ts')

  it('replaceAll 不推撤销条、不写回收站（云端事实源整体替换、清全部脏标记）', () => {
    const replaceAllBody = hookSrc.slice(hookSrc.indexOf('const replaceAll'))
    const replaceAllEnd = replaceAllBody.indexOf('const clear')
    const body = replaceAllBody.slice(0, replaceAllEnd)
    expect(body).not.toContain('pushGlobalUndo')
    expect(body).not.toContain('snapshotToTrash')
    expect(body).toContain('clearDirty()')
  })

  it('toggle 的取消分支与 remove 都走 snapshotAndRemoveLocal + 推栈', () => {
    expect(hookSrc).toContain("snapshotAndRemoveLocal([site.siteId], 'single')")
    expect(hookSrc).toContain("snapshotAndRemoveLocal([siteId], 'single')")
    expect(hookSrc).toContain('buildRemoveUndoEntry')
    expect(hookSrc).toContain('pushGlobalUndo(entry)')
  })

  it('clear()：persist 成功后才写回收站快照；pushUndo:false 跳过快照（B1）', () => {
    // 本地清空走模块级 clearFavoritesLocal（行为见上一个 describe），
    // 这里钉死接线：快照在 persist 成功之后、且被 pushUndo:false 守卫。
    const localBody = hookSrc.slice(hookSrc.indexOf('export function clearFavoritesLocal'))
    const localEnd = localBody.indexOf('export function restoreRemovedFavorites')
    const body = localBody.slice(0, localEnd)
    expect(body).toContain("snapshotToTrash(removed, 'clear', batchId, now)")
    expect(body.indexOf('persistLocalFavorites([])')).toBeLessThan(
      body.indexOf("snapshotToTrash(removed, 'clear', batchId, now)"),
    )
    expect(body).toContain('if (opts?.pushUndo !== false) snapshotToTrash')
    expect(hookSrc).toContain('已清空全部收藏')
    const dataSrc = overlaySource('src/app/me/data/page.tsx')
    expect(dataSrc).toContain('favorites.clear({ pushUndo: false })')
    expect(dataSrc).toContain('navhub.favorites.trash.v1')
  })

  it('syncFavoritesToCloud 的 add op 优先用恢复时刻覆盖（撤销才不会被 LWW 挡掉）', () => {
    expect(hookSrc).toContain('restoreAt[f.siteId] ?? f.createdAt')
    expect(hookSrc).toContain('clearRestoreAt(ops.map((o) => o.siteId))')
  })

  it('回收站键：persist 成功后再写回收站；写失败报 trashError 不拦删除', () => {
    expect(hookSrc).toContain('snapshotToTrash(removed, source, batchId, now)')
    expect(hookSrc).toContain("reportTrashError('回收站写不进去")
  })
})

describe('回收站键本身：useFavorites 初始化时剪枝', () => {
  it('启动剪枝只剪本地视图（pruneExpiredTrash 在 init effect 里）', () => {
    const hookSrc = overlaySource('src/hooks/useFavorites.ts')
    expect(hookSrc).toContain('pruneExpiredTrash(trash)')
    expect(hookSrc).toContain('回收站启动剪枝一次')
  })
})
