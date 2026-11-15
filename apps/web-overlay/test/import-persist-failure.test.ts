import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  useFavorites,
  __resetFavoritesForTests,
  __setSharedFavoritesForTests,
  type FavoritesApi,
} from '../src/hooks/useFavorites'

/**
 * B-5：`importJson` 吞掉 `persist` 失败的回归测试。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom / @testing-library——组件挂载
 * 测不了，但 hook 本体可以用 `renderToString` 跑一次拿到 `importJson`
 * （effects 在 SSR 下不跑，importJson 只依赖模块级共享状态与 localStorage）。
 * quota 满用“setItem 抛错”的 localStorage 模拟（saveLocal 收到抛错返回 false）。
 */

const FAVORITES_KEY = 'navhub.favorites.v1'
const DIRTY_KEY = 'navhub.favorites.dirty.v1'

const globals = globalThis as unknown as { window?: unknown; localStorage?: unknown }

function installStorage(opts: { failSet?: boolean; seed?: Record<string, string> }) {
  const store: Record<string, string> = { ...(opts.seed ?? {}) }
  const localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      if (opts.failSet) throw new Error('QuotaExceededError')
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

function captureApi(): FavoritesApi {
  let api: FavoritesApi | null = null
  function Probe() {
    api = useFavorites()
    return null
  }
  renderToString(createElement(Probe))
  if (!api) throw new Error('hook did not run')
  return api
}

function importPayload(items: Array<Record<string, unknown>>): string {
  return JSON.stringify({ version: 1, items })
}

describe('B-5：importJson 不再把未落盘的 chunk 报成成功', () => {
  it('persist 失败时返回 ok:false + 本地存储不可用，不置脏、不报新增', () => {
    __resetFavoritesForTests()
    __setSharedFavoritesForTests([])
    const store = installStorage({ failSet: true })
    try {
      const api = captureApi()
      const res = api.importJson(
        importPayload([
          { siteId: 'x1', title: '站 1', href: 'https://example.com/x1', createdAt: 1 },
          // 模板非法条：失败返回里 skippedInvalid 也要照实上报
          { siteId: 'x2', title: '坏模板', href: 'https://example.com/x2', quickPrefix: 'gh', templateUrl: 'javascript:alert({q})', createdAt: 1 },
        ]),
      )
      expect(res.ok).toBe(false)
      expect(res.error).toBe('本地存储不可用')
      expect(res.imported).toBe(0)
      expect(res.addedSiteIds).toEqual([])
      expect(res.skippedInvalid).toBe(1)
      // 失败时不置脏：没存进去的条目没有待推变更
      expect(store[DIRTY_KEY]).toBeUndefined()
      expect(store[FAVORITES_KEY]).toBeUndefined()
    } finally {
      delete globals.window
      delete globals.localStorage
      __resetFavoritesForTests()
    }
  })

  it('persist 成功时照常 ok:true、报实际新增、置脏', () => {
    __resetFavoritesForTests()
    __setSharedFavoritesForTests([])
    const store = installStorage({})
    try {
      const api = captureApi()
      const res = api.importJson(
        importPayload([{ siteId: 'x1', title: '站 1', href: 'https://example.com/x1', createdAt: 1 }]),
      )
      expect(res.ok).toBe(true)
      expect(res.imported).toBe(1)
      expect(res.addedSiteIds).toEqual(['x1'])
      expect(store[FAVORITES_KEY]).toContain('x1')
      expect(store[DIRTY_KEY]).toContain('x1')
    } finally {
      delete globals.window
      delete globals.localStorage
      __resetFavoritesForTests()
    }
  })

  it('先成功、后 quota 满：第二次失败不影响第一次已落盘的成功', () => {
    __resetFavoritesForTests()
    __setSharedFavoritesForTests([])
    const store = installStorage({})
    try {
      const api = captureApi()
      const first = api.importJson(
        importPayload([{ siteId: 'x1', title: '站 1', href: 'https://example.com/x1', createdAt: 1 }]),
      )
      expect(first.ok).toBe(true)
      const diskAfterFirst = store[FAVORITES_KEY]
      expect(diskAfterFirst).toContain('x1')
      // 第二次写盘开始抛错（quota 在两次写入之间满了）
      const failing = {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
        removeItem: (k: string) => {
          delete store[k]
        },
      }
      globals.localStorage = failing
      globals.window = { localStorage: failing, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true }
      const second = api.importJson(
        importPayload([{ siteId: 'x2', title: '站 2', href: 'https://example.com/x2', createdAt: 1 }]),
      )
      expect(second.ok).toBe(false)
      expect(second.error).toBe('本地存储不可用')
      // 磁盘仍是第一次的结果：失败的 chunk 没有覆盖、没有谎报
      expect(store[FAVORITES_KEY]).toBe(diskAfterFirst)
    } finally {
      delete globals.window
      delete globals.localStorage
      __resetFavoritesForTests()
    }
  })
})
