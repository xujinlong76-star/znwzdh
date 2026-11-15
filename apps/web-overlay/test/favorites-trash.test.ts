/**
 * 收藏回收站（第 2 层：30 天持久快照）。
 *
 * 钉死：
 *  - parseTrash 坏 JSON / 非数组按空 + 不抛；
 *  - addToTrash 保留全字段与原 index；
 *  - pruneExpiredTrash 恰好 30 天边界；
 *  - formatTrashRemaining（今天到期 / 还剩 N 天 / 已过期）；
 *  - 超 MAX_ITEMS 时最旧的先被剪掉；
 *  - removeFromTrash 只删指定 siteId；
 *  - insertRestoredFavorites 按原位插回、幂等、越界钳制；
 *  - readTrash 坏 JSON 隔离到 .corrupt 键且不抛；writeTrash 写不进去返回 false。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FAVORITES_TRASH_MAX_ITEMS,
  FAVORITES_TRASH_RETENTION_MS,
  FAVORITES_TRASH_STORAGE_KEY,
  addFolderToTrash,
  addToTrash,
  formatTrashRemaining,
  insertRestoredFavorites,
  parseTrash,
  pruneExpiredTrash,
  readTrash,
  removeFolderFromTrash,
  removeFromTrash,
  serializeTrash,
  trashExpiresAt,
  writeTrash,
  type FavoritesTrashState,
  type TrashedFavorite,
} from '@/lib/favorites-trash'
import { resolveTriageStatus } from '@/lib/favorites-triage'

const DAY = 24 * 60 * 60 * 1000

function trashed(siteId: string, overrides: Partial<TrashedFavorite> = {}): TrashedFavorite {
  return {
    siteId,
    title: '站点 ' + siteId,
    href: 'https://example.com/' + siteId,
    note: '备注 ' + siteId,
    tags: ['a', 'b'],
    folderId: 'folder-1',
    createdAt: 1000,
    lastOpenedAt: 1500,
    deletedAt: 10_000,
    batchId: 'batch-1',
    source: 'single',
    index: 0,
    ...overrides,
  }
}

function stateWith(items: TrashedFavorite[]): FavoritesTrashState {
  return { items, folders: [] }
}

/** fake localStorage（与 favorites-sync.test.ts 同款） */
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

afterEach(() => {
  vi.unstubAllGlobals()
  const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown }
  delete globals.window
  delete globals.localStorage
})

describe('parseTrash：坏数据按空，不抛', () => {
  it('真的没有数据 → 空回收站', () => {
    for (const raw of [null, undefined, '']) {
      expect(parseTrash(raw)).toEqual({ items: [], folders: [] })
    }
  })

  it('坏 JSON / 非数组 / 非对象 → 空回收站，不抛', () => {
    expect(parseTrash('{bad json')).toEqual({ items: [], folders: [] })
    expect(parseTrash('123')).toEqual({ items: [], folders: [] })
    expect(parseTrash('"str"')).toEqual({ items: [], folders: [] })
    expect(parseTrash('null')).toEqual({ items: [], folders: [] })
  })

  it('脏条目只丢字段不丢整条：缺 siteId / 缺 deletedAt 的行跳过', () => {
    const raw = JSON.stringify({
      items: [
        trashed('a'),
        { title: '没 siteId', href: 'https://x', createdAt: 1, deletedAt: 2, batchId: 'b' },
        { siteId: 'c', title: '没 deletedAt', href: 'https://x', createdAt: 1, batchId: 'b' },
        trashed('d'),
      ],
      folders: [{ id: 'f1', name: '夹', deletedAt: 2, batchId: 'b', memberSiteIds: ['a'] }],
    })
    const parsed = parseTrash(raw)
    expect(parsed.items.map((i) => i.siteId)).toEqual(['a', 'd'])
    expect(parsed.folders).toHaveLength(1)
  })

  it('同站重复只留一份', () => {
    const parsed = parseTrash(
      JSON.stringify({ items: [trashed('a'), trashed('a', { title: '后一条' })], folders: [] }),
    )
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]!.title).toBe('站点 a')
  })
})

describe('addToTrash：保留全字段与原 index', () => {
  it('新删的放最前，同站只刷新 deletedAt 不重复占位', () => {
    // 条目自带 source 时以条目为准；没带时用调用方传的 source 默认值
    const first = addToTrash(
      stateWith([trashed('a', { deletedAt: 1000 })]),
      [{ ...trashed('b', { index: 2 }), source: undefined }],
      'batch-2',
      5000,
      'batch',
    )
    expect(first.items.map((i) => i.siteId)).toEqual(['b', 'a'])
    expect(first.items[0]!.index).toBe(2)
    expect(first.items[0]!.note).toBe('备注 b')
    expect(first.items[0]!.tags).toEqual(['a', 'b'])
    expect(first.items[0]!.folderId).toBe('folder-1')
    expect(first.items[0]!.lastOpenedAt).toBe(1500)
    expect(first.items[0]!.deletedAt).toBe(5000)
    expect(first.items[0]!.batchId).toBe('batch-2')
    expect(first.items[0]!.source).toBe('batch')

    const again = addToTrash(first, [trashed('b', { index: 0 })], 'batch-3', 9000, 'single')
    expect(again.items.map((i) => i.siteId)).toEqual(['b', 'a'])
    expect(again.items[0]!.deletedAt).toBe(9000)
    expect(again.items[0]!.batchId).toBe('batch-3')
  })

  it('超 MAX_ITEMS 时最旧的先被剪掉', () => {
    const many = Array.from({ length: FAVORITES_TRASH_MAX_ITEMS + 5 }, (_, i) =>
      trashed('s' + i, { deletedAt: 1000 + i }),
    )
    const next = addToTrash(stateWith(many.slice(0, FAVORITES_TRASH_MAX_ITEMS)), [trashed('new', { deletedAt: 9999 })], 'b', 9999)
    expect(next.items).toHaveLength(FAVORITES_TRASH_MAX_ITEMS)
    expect(next.items[0]!.siteId).toBe('new')
    // 队尾最旧的一条（s499）被剪掉，新删的与较新的都留着
    expect(next.items.some((i) => i.siteId === 's499')).toBe(false)
    expect(next.items.some((i) => i.siteId === 's498')).toBe(true)
    expect(next.items.some((i) => i.siteId === 's0')).toBe(true)
  })

  it('删夹快照进 folders，同夹只留最新一份', () => {
    const withFolder = addFolderToTrash(
      stateWith([]),
      { id: 'f1', name: '工作', sort: 1, createdAt: 100, memberSiteIds: ['a', 'b'] },
      'batch-9',
      7000,
    )
    expect(withFolder.folders).toHaveLength(1)
    expect(withFolder.folders[0]!.memberSiteIds).toEqual(['a', 'b'])
    expect(withFolder.folders[0]!.deletedAt).toBe(7000)
    const again = addFolderToTrash(
      withFolder,
      { id: 'f1', name: '工作', sort: 1, createdAt: 100, memberSiteIds: ['c'] },
      'batch-10',
      8000,
    )
    expect(again.folders).toHaveLength(1)
    expect(again.folders[0]!.memberSiteIds).toEqual(['c'])
  })
})

describe('分流字段透传：经回收站恢复的 inbox/read 收藏不丢待读状态（N3）', () => {
  it('addToTrash + parseTrash 往返保留 triageStatus/triageAt，恢复后仍为 inbox', () => {
    const inbox = trashed('inbox-1', { triageStatus: 'inbox', triageAt: 9000 })
    const state = addToTrash(stateWith([]), [inbox], 'batch-triage', 10_000, 'single')
    expect(state.items[0]!.triageStatus).toBe('inbox')
    expect(state.items[0]!.triageAt).toBe(9000)
    // 序列化 → 解析（回收站读盘路径）同样保留
    const roundTripped = parseTrash(serializeTrash(state))
    expect(roundTripped.items[0]!.triageStatus).toBe('inbox')
    expect(roundTripped.items[0]!.triageAt).toBe(9000)
    // 恢复成收藏后仍按 inbox 判定（不会按祖父规则落为 permanent）
    expect(resolveTriageStatus(roundTripped.items[0]!, 10_000)).toBe('inbox')
  })

  it('read 收藏同样保留；非法分流值按缺字段处理（恢复后为 permanent）', () => {
    const read = addToTrash(
      stateWith([]),
      [trashed('read-1', { triageStatus: 'read', triageAt: 8000 })],
      'batch-triage',
      10_000,
      'single',
    )
    expect(read.items[0]!.triageStatus).toBe('read')
    expect(read.items[0]!.triageAt).toBe(8000)
    expect(resolveTriageStatus(read.items[0]!, 10_000)).toBe('read')
    const bad = parseTrash(
      JSON.stringify({
        items: [{ ...trashed('bad-1'), triageStatus: 'someday', triageAt: 8000 }],
        folders: [],
      }),
    )
    expect(bad.items[0]!.triageStatus).toBeUndefined()
    expect(resolveTriageStatus(bad.items[0]!, 10_000)).toBe('permanent')
  })
})

describe('pruneExpiredTrash / formatTrashRemaining：30 天边界', () => {
  it('恰好 30 天 = 过期（deletedAt + 30d <= now 即剪）', () => {
    const now = 100 * DAY
    const state = stateWith([
      trashed('expired-exact', { deletedAt: now - FAVORITES_TRASH_RETENTION_MS }),
      trashed('expired-old', { deletedAt: now - FAVORITES_TRASH_RETENTION_MS - 1 }),
      trashed('alive-1ms', { deletedAt: now - FAVORITES_TRASH_RETENTION_MS + 1 }),
      trashed('fresh', { deletedAt: now }),
    ])
    const pruned = pruneExpiredTrash(state, now)
    expect(pruned.items.map((i) => i.siteId)).toEqual(['alive-1ms', 'fresh'])
  })

  it('trashExpiresAt = deletedAt + 30 天', () => {
    expect(trashExpiresAt(1000)).toBe(1000 + FAVORITES_TRASH_RETENTION_MS)
    expect(FAVORITES_TRASH_RETENTION_MS).toBe(30 * DAY)
  })

  it('formatTrashRemaining：还剩 N 天 / 今天到期 / 已过期', () => {
    const now = 100 * DAY
    // 剩 2 天
    expect(formatTrashRemaining(now - 28 * DAY, now)).toBe('还剩 2 天')
    // 剩 12 天
    expect(formatTrashRemaining(now - 18 * DAY, now)).toBe('还剩 12 天')
    // 剩恰好 1 天：今天到期
    expect(formatTrashRemaining(now - 29 * DAY, now)).toBe('今天到期')
    // 不到 1 天：今天到期
    expect(formatTrashRemaining(now - 30 * DAY + 60_000, now)).toBe('今天到期')
    // 已过期
    expect(formatTrashRemaining(now - 31 * DAY, now)).toBe('已过期')
    expect(formatTrashRemaining(now - FAVORITES_TRASH_RETENTION_MS, now)).toBe('已过期')
  })
})

describe('removeFromTrash / removeFolderFromTrash：只删指定', () => {
  it('removeFromTrash 只删指定 siteId，返回被取出的条目', () => {
    const state = stateWith([trashed('a'), trashed('b'), trashed('c')])
    const { state: next, restored } = removeFromTrash(state, 'b')
    expect(restored?.siteId).toBe('b')
    expect(next.items.map((i) => i.siteId)).toEqual(['a', 'c'])
    const missing = removeFromTrash(next, 'zzz')
    expect(missing.restored).toBeNull()
    expect(missing.state).toBe(next)
  })

  it('removeFolderFromTrash 只删指定夹', () => {
    const state: FavoritesTrashState = {
      items: [trashed('a')],
      folders: [
        { id: 'f1', name: '一', sort: 0, createdAt: 1, deletedAt: 2, batchId: 'b', memberSiteIds: ['a'] },
        { id: 'f2', name: '二', sort: 0, createdAt: 1, deletedAt: 2, batchId: 'b', memberSiteIds: [] },
      ],
    }
    const { state: next, restored } = removeFolderFromTrash(state, 'f1')
    expect(restored?.id).toBe('f1')
    expect(next.folders.map((f) => f.id)).toEqual(['f2'])
    expect(next.items).toHaveLength(1)
  })
})

describe('insertRestoredFavorites：按原位插回', () => {
  it('按删除前 index 插回，恢复后顺序与删除前一致', () => {
    const current = [
      { siteId: 'a', title: 'A' },
      { siteId: 'd', title: 'D' },
    ]
    const next = insertRestoredFavorites(current, [
      { item: { siteId: 'c', title: 'C' }, index: 2 },
      { item: { siteId: 'b', title: 'B' }, index: 1 },
    ])
    expect(next.map((i) => i.siteId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('已在列表里的跳过（幂等，重复恢复不插重）', () => {
    const current = [{ siteId: 'a' }, { siteId: 'b' }]
    const next = insertRestoredFavorites(current, [{ item: { siteId: 'b' }, index: 0 }])
    expect(next).toEqual(current)
  })

  it('index 越界钳制到末尾，负数钳制到开头', () => {
    const current = [{ siteId: 'a' }]
    const next = insertRestoredFavorites(current, [
      { item: { siteId: 'z' }, index: 99 },
      { item: { siteId: 'y' }, index: -5 },
    ])
    expect(next.map((i) => i.siteId)).toEqual(['y', 'a', 'z'])
  })
})

describe('readTrash / writeTrash：存储 IO', () => {
  it('读写往返 + 坏 JSON 隔离到 .corrupt 键且不抛', () => {
    const store = installStorage({ [FAVORITES_TRASH_STORAGE_KEY]: '{bad json' })
    const read = readTrash()
    expect(read).toEqual({ items: [], folders: [] })
    // 隔离键已写：原文留档
    const corruptKeys = Object.keys(store).filter((k) =>
      k.startsWith(FAVORITES_TRASH_STORAGE_KEY + '.corrupt.'),
    )
    expect(corruptKeys).toHaveLength(1)
    expect(store[corruptKeys[0]!]).toBe('{bad json')

    const ok = writeTrash(stateWith([trashed('a')]))
    expect(ok).toBe(true)
    expect(JSON.parse(store[FAVORITES_TRASH_STORAGE_KEY]!).items[0].siteId).toBe('a')
    expect(serializeTrash(stateWith([trashed('a')]))).toContain('"siteId":"a"')
  })

  it('writeTrash 写不进去返回 false（配额满）', () => {
    installStorage()
    const globals = globalThis as unknown as { window: { localStorage: { setItem: unknown } } }
    globals.window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(writeTrash(stateWith([trashed('a')]))).toBe(false)
  })
})
