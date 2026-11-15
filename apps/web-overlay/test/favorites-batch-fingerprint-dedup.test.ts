/**
 * 批量 pin 指纹去重（addFavoritesLocal）：
 * 同一站点经不同 URL 写法到达（带 www / 带 utm 参数 / 尾斜杠 /
 * http 与 https）只应收一条——否则首页批量 pin 会把同一站收两次，
 * 用户得靠眼睛清理。指纹口径与导入路径共用 fingerprintUrl（SSOT）。
 *
 * 覆盖：
 *  (a) www vs 裸域名 → 跳过；(b) utm 参数变体 → 跳过；
 *  (c) 尾斜杠变体 → 跳过；(d) http vs https → 跳过；
 *  (e) 非追踪 query 不同 → 不跳过；(f) 路径不同 → 不跳过；
 *  (g) 同批内两条同指纹 → 只留第一条；
 *  (h) 两条非 http(s) href（指纹为空）不同 siteId → 都收下；
 *  (i) 被指纹跳过的条目不改存储列表、siteId 进 skippedSiteIds；
 *  (j) 默认端口 :443 变体 → 跳过；(k) query 换序 → 跳过；
 *  (l) hash 变体 → 跳过。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __getSharedFavoritesForTests,
  __resetFavoritesForTests,
  __setSharedFavoritesForTests,
  addFavoritesLocal,
  type LocalFavorite,
} from '@/hooks/useFavorites'

/* ------------------------------------------------------------------ *
 * 假的浏览器环境（home-batch-undo.test.ts 同款）
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

function fav(siteId: string, href: string, createdAt = 1000): LocalFavorite {
  return { siteId, title: '站点 ' + siteId, href, createdAt }
}

beforeEach(() => {
  installStorage()
  __resetFavoritesForTests()
})

afterEach(() => {
  __resetFavoritesForTests()
  uninstallBrowser()
})

describe('addFavoritesLocal 指纹去重', () => {
  it('(a) 已收裸域名，www 变体被跳过', () => {
    __setSharedFavoritesForTests([fav('s1', 'https://example.com/')])
    const res = addFavoritesLocal([fav('s2', 'https://www.example.com/', 2000)])
    expect(res).not.toBeNull()
    expect(res!.added).toHaveLength(0)
    expect(res!.skippedSiteIds).toEqual(['s2'])
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['s1'])
  })

  it('(b) 已收裸域名，utm 参数变体被跳过', () => {
    __setSharedFavoritesForTests([fav('s1', 'https://example.com/')])
    const res = addFavoritesLocal([fav('s2', 'https://example.com/?utm_source=wechat&utm_medium=share', 2000)])
    expect(res!.added).toHaveLength(0)
    expect(res!.skippedSiteIds).toEqual(['s2'])
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['s1'])
  })

  it('(c) 已收带斜杠路径，尾斜杠变体被跳过', () => {
    __setSharedFavoritesForTests([fav('s1', 'https://example.com/docs')])
    const res = addFavoritesLocal([fav('s2', 'https://example.com/docs/', 2000)])
    expect(res!.added).toHaveLength(0)
    expect(res!.skippedSiteIds).toEqual(['s2'])
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['s1'])
  })

  it('(d) 已收 https，http 同站同路径被跳过', () => {
    __setSharedFavoritesForTests([fav('s1', 'https://example.com/docs')])
    const res = addFavoritesLocal([fav('s2', 'http://example.com/docs', 2000)])
    expect(res!.added).toHaveLength(0)
    expect(res!.skippedSiteIds).toEqual(['s2'])
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['s1'])
  })

  it('(e) 非追踪 query 不同 → 不跳过，正常收下', () => {
    __setSharedFavoritesForTests([fav('s1', 'https://example.com/search?q=apple')])
    const res = addFavoritesLocal([fav('s2', 'https://example.com/search?q=banana', 2000)])
    expect(res!.added.map((i) => i.siteId)).toEqual(['s2'])
    expect(res!.skippedSiteIds).toEqual([])
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['s2', 's1'])
  })

  it('(f) 路径不同 → 不跳过，正常收下', () => {
    __setSharedFavoritesForTests([fav('s1', 'https://example.com/a')])
    const res = addFavoritesLocal([fav('s2', 'https://example.com/b', 2000)])
    expect(res!.added.map((i) => i.siteId)).toEqual(['s2'])
    expect(res!.skippedSiteIds).toEqual([])
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['s2', 's1'])
  })

  it('(g) 同批内两条同指纹 → 只留第一条（先出现者胜）', () => {
    const res = addFavoritesLocal([
      fav('s1', 'https://example.com/', 1000),
      fav('s2', 'https://www.example.com/?utm_source=x', 2000),
    ])
    expect(res!.added.map((i) => i.siteId)).toEqual(['s1'])
    expect(res!.skippedSiteIds).toEqual(['s2'])
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['s1'])
  })

  it('(h) 两条非 http(s) href（指纹为空）不同 siteId → 都收下，不按空指纹去重', () => {
    const res = addFavoritesLocal([
      fav('s1', 'ftp://example.com/a', 1000),
      fav('s2', 'ftp://example.com/b', 2000),
    ])
    expect(res!.added.map((i) => i.siteId)).toEqual(['s1', 's2'])
    expect(res!.skippedSiteIds).toEqual([])
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['s1', 's2'])
  })

  it('(i) 被指纹跳过的条目不改存储列表、siteId 进 skippedSiteIds（无新增不写盘）', () => {
    const before = [fav('s1', 'https://example.com/')]
    __setSharedFavoritesForTests(before)
    // 快照副本断言：__setSharedFavoritesForTests 按引用存数组，直接拿 before
    // 比对会在原地改动下也通过；先拍一份副本再比才是真守卫。
    const beforeSnapshot = before.map((i) => ({ ...i }))
    const res = addFavoritesLocal([fav('s2', 'https://www.example.com/', 2000)])
    expect(res).not.toBeNull()
    expect(res!.added).toHaveLength(0)
    expect(res!.skippedSiteIds).toEqual(['s2'])
    // 存储列表原样：内容与快照一致，且 localStorage 未被重写
    expect(__getSharedFavoritesForTests()).toEqual(beforeSnapshot)
    expect(store['navhub.favorites.v1']).toBeUndefined()
  })

  it('siteId 去重仍优先：同 siteId 不同 href 只按 siteId 跳过', () => {
    __setSharedFavoritesForTests([fav('s1', 'https://example.com/')])
    const res = addFavoritesLocal([fav('s1', 'https://other.com/', 2000)])
    expect(res!.added).toHaveLength(0)
    expect(res!.skippedSiteIds).toEqual(['s1'])
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['s1'])
  })

  it('(j) 已收裸域名，:443 默认端口变体被跳过', () => {
    __setSharedFavoritesForTests([fav('s1', 'https://example.com/docs')])
    const res = addFavoritesLocal([fav('s2', 'https://example.com:443/docs', 2000)])
    expect(res!.added).toHaveLength(0)
    expect(res!.skippedSiteIds).toEqual(['s2'])
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['s1'])
  })

  it('(k) query 换序 → 同一指纹，被跳过', () => {
    __setSharedFavoritesForTests([fav('s1', 'https://example.com/search?a=1&b=2')])
    const res = addFavoritesLocal([fav('s2', 'https://example.com/search?b=2&a=1', 2000)])
    expect(res!.added).toHaveLength(0)
    expect(res!.skippedSiteIds).toEqual(['s2'])
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['s1'])
  })

  it('(l) 已收裸域名，带 hash 变体被跳过', () => {
    __setSharedFavoritesForTests([fav('s1', 'https://example.com/docs')])
    const res = addFavoritesLocal([fav('s2', 'https://example.com/docs#section', 2000)])
    expect(res!.added).toHaveLength(0)
    expect(res!.skippedSiteIds).toEqual(['s2'])
    expect(__getSharedFavoritesForTests().map((i) => i.siteId)).toEqual(['s1'])
  })
})
