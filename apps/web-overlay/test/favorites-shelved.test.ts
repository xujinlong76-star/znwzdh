/**
 * 已移出区：解析 / 移入 / 取出 + 接线守卫。
 *
 * 锁三件事：
 *   1. 坏数据不丢整区：坏 JSON / 非数组 → 空列表；缺字段的行丢掉，脏字段只丢字段；
 *   2. 移入幂等：同站重复移入只刷新 movedOutAt，不重复占位；新移入放最前；
 *   3. 取出语义：取不到返回 restored=null 且列表不变（同一引用）。
 *
 * 体例仿归档柜测试（resurface.test.ts 的「归档柜」一节）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  SHELVED_FAVORITES_KEY,
  parseShelved,
  readShelvedFavorites,
  serializeShelved,
  shelveItems,
  unshelveItems,
  writeShelvedFavorites,
  type ShelvableFavoriteLike,
  type ShelvedFavoriteItem,
} from '../src/lib/favorites-shelved'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

/** 固定时钟：2026-11-12 12:00 UTC */
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0)

function fav(siteId: string, over: Partial<ShelvableFavoriteLike> = {}): ShelvableFavoriteLike {
  return {
    siteId,
    title: `站点 ${siteId}`,
    href: `https://example.com/${siteId}`,
    note: '备注',
    tags: ['a', 'b'],
    folderId: 'folder-1',
    createdAt: NOW - 86400000,
    ...over,
  }
}

describe('parseShelved：坏数据不丢整区', () => {
  it('坏 JSON / 非数组 / 空 → 空列表，不抛', () => {
    expect(parseShelved('{bad json')).toEqual([])
    expect(parseShelved('{"a":1}')).toEqual([])
    expect(parseShelved(null)).toEqual([])
    expect(parseShelved(undefined)).toEqual([])
    expect(parseShelved('')).toEqual([])
  })

  it('缺字段的残行丢掉，同站重复只留第一条', () => {
    const raw = JSON.stringify([
      { siteId: 'a', title: 'A', href: 'https://a.example', createdAt: 1, movedOutAt: NOW, originStatus: 'inbox' },
      { siteId: '', title: '空站', href: 'https://b.example', createdAt: 1, movedOutAt: NOW, originStatus: 'inbox' },
      { siteId: 'a', title: 'A 重复', href: 'https://a.example', createdAt: 1, movedOutAt: NOW, originStatus: 'read' },
      { siteId: 'c', title: 'C', href: 'https://c.example', createdAt: 1, movedOutAt: NOW, originStatus: 'weird' },
    ])
    const items = parseShelved(raw)
    expect(items.map((i) => i.siteId)).toEqual(['a'])
  })

  it('脏字段只丢字段不丢整条：备注 / 标签 / 收藏夹 / 快捷链接各认各的形状', () => {
    const raw = JSON.stringify([
      {
        siteId: 'a',
        title: 'A',
        href: 'https://a.example',
        note: 123,
        tags: ['ok', 42, null],
        folderId: 7,
        quickPrefix: 'gh',
        templateUrl: 'https://github.com/search?q={q}',
        createdAt: 1,
        movedOutAt: NOW,
        originStatus: 'read',
        originTriageAt: 'not-a-number',
      },
    ])
    const [item] = parseShelved(raw)
    expect(item?.note).toBeUndefined()
    expect(item?.tags).toEqual(['ok'])
    expect(item?.folderId).toBeUndefined()
    expect(item?.quickPrefix).toBe('gh')
    expect(item?.templateUrl).toBe('https://github.com/search?q={q}')
    expect(item?.originTriageAt).toBeUndefined()
  })

  it('序列化往返不丢字段', () => {
    const list: ShelvedFavoriteItem[] = [
      {
        ...fav('a'),
        movedOutAt: NOW,
        originStatus: 'inbox',
        originTriageAt: NOW - 3600000,
      },
    ]
    expect(parseShelved(serializeShelved(list))).toEqual(list)
  })
})

describe('shelveItems / unshelveItems：移入与取出', () => {
  it('新移入放最前；保留 note / tags / folderId（原文完整保留）', () => {
    const list = shelveItems([], fav('a'), NOW, 'inbox', NOW - 3600000)
    expect(list).toHaveLength(1)
    expect(list[0]?.siteId).toBe('a')
    expect(list[0]?.movedOutAt).toBe(NOW)
    expect(list[0]?.originStatus).toBe('inbox')
    expect(list[0]?.originTriageAt).toBe(NOW - 3600000)
    expect(list[0]?.note).toBe('备注')
    expect(list[0]?.tags).toEqual(['a', 'b'])
    expect(list[0]?.folderId).toBe('folder-1')

    const two = shelveItems(list, fav('b'), NOW + 1000, 'read')
    expect(two.map((i) => i.siteId)).toEqual(['b', 'a'])
  })

  it('同站重复移入只刷新 movedOutAt，不重复占位', () => {
    const once = shelveItems([], fav('a'), NOW, 'inbox')
    const twice = shelveItems(once, fav('a'), NOW + 5000, 'read')
    expect(twice).toHaveLength(1)
    expect(twice[0]?.movedOutAt).toBe(NOW + 5000)
    expect(twice[0]?.originStatus).toBe('read')
  })

  it('取出返回条目并从列表移除；取不到的返回 null 且列表不变', () => {
    const list = shelveItems(shelveItems([], fav('a'), NOW, 'inbox'), fav('b'), NOW, 'read')
    const { items, restored } = unshelveItems(list, 'a')
    expect(restored?.siteId).toBe('a')
    expect(items.map((i) => i.siteId)).toEqual(['b'])

    const missed = unshelveItems(list, 'nope')
    expect(missed.restored).toBeNull()
    expect(missed.items).toBe(list)
  })
})

describe('存储读写：独立键，SSR 安全', () => {
  it('键名与归档柜分开', () => {
    expect(SHELVED_FAVORITES_KEY).toBe('navhub.favorites.shelved.v1')
    expect(SHELVED_FAVORITES_KEY).not.toBe('navhub.favorites.archived.v1')
    expect(SHELVED_FAVORITES_KEY).not.toBe('navhub.favorites.v1')
  })

  it('读写往返；写不进去返回 false；SSR 返回空列表', () => {
    const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown }
    const store: Record<string, string> = {}
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
    globals.window = { localStorage, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true }
    try {
      expect(readShelvedFavorites()).toEqual([])
      const list = shelveItems([], fav('a'), NOW, 'inbox')
      expect(writeShelvedFavorites(list)).toBe(true)
      expect(readShelvedFavorites()).toEqual(list)
    } finally {
      delete globals.window
      delete globals.localStorage
    }
    // 没有 window 时按空列表，不抛
    expect(readShelvedFavorites()).toEqual([])
    expect(writeShelvedFavorites([])).toBe(false)
  })
})

describe('接线守卫：已移出视图与 hook', () => {
  it('已移出视图存在：列表 + 恢复（永久库 / 待读箱）+ 逐条删 + 清空（二次确认）', () => {
    const page = read('src/app/favorites/shelved/page.tsx')
    expect(page).toContain('已移出')
    expect(page).toContain('favorites.restoreShelved(item.siteId, destination)')
    expect(page).toContain("handleRestore(item, 'permanent')")
    expect(page).toContain("handleRestore(item, 'inbox')")
    expect(page).toContain('deleteShelved(item.siteId)')
    expect(page).toContain('clearShelved()')
    expect(page).toContain('window.confirm')
    expect(page).toContain('无法恢复')
    // 标题链接走 safeHref；按钮达 44px；订阅已移出区变更事件后重读
    expect(page).toContain('safeHref(item.href)')
    expect(page).toContain('min-h-11')
    expect(page).not.toContain('h-8 ')
    expect(page).toContain("window.addEventListener('navhub_shelved_updated', refresh)")
  })

  it('hook 的恢复默认进永久库；放回待读箱是显式选项', () => {
    const hook = read('src/hooks/useFavorites.ts')
    expect(hook).toContain("destination: 'inbox' | 'permanent' = 'permanent'")
    expect(hook).toContain('enterInbox(base, now)')
  })

  it('已移出区不进搜索池：收藏页的关键词筛选只读活跃收藏', () => {
    const page = read('src/app/favorites/page.tsx')
    expect(page).toContain('filterFavorites(favorites.items, favoriteQuery)')
    expect(page).not.toContain('readShelvedFavorites().filter')
  })
})
