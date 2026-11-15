/**
 * DIY「一键调优」收藏信号死读修复（第 73 轮）。
 *
 * 真实缺陷（2026-11-15 第 72 轮摸底实锤）：`applySmartAutoTune` 读的是
 * `navhub_favorite_sites_v1`，全仓没有任何写入——收藏信号恒为空；
 * 但工具栏 toast 却称「已按访问频次与星标把 N 个高频站点置入速览坞」。
 * 修复后读真键 `navhub.favorites.v1`（`lib/favorites-storage.ts`，
 * 注释明示不可改键名），解析走 `parseFavorites` 的 corrupt 语义。
 *
 * 这个文件把修复后的契约钉住：
 *   1. 有收藏时 `computeSmartAutoTune` 的收藏加权生效：站点 +50、分类 +10；
 *   2. 无收藏时行为不变（只按访问频次 / featured / weight 计分）；
 *   3. 坏数据不静默丢收藏：`readFavoriteIdsForAutoTune` 报 corrupt，
 *      `applySmartAutoTune` 返回 null 且不覆盖布局、不落盘；
 *   4. 源码不再出现死键 `navhub_favorite_sites_v1`。
 *
 * 环境：仓库 vitest 是 node 环境、无 jsdom，沿用 home-diy-store.test.ts 的
 * 假浏览器 + react-dom/server 的 renderToString 真渲染 hook 的做法。
 * 注意 `use-home-diy.ts` 读的是裸 `localStorage`（不是 `window.localStorage`），
 * 所以假浏览器除了挂 `globalThis.window`，还要挂裸 `globalThis.localStorage`。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeSmartAutoTune } from '@/lib/modular/diy-presets'
import {
  flushHomeDiyDiskWrites,
  getHomeDiySnapshot,
  readFavoriteIdsForAutoTune,
  resetHomeDiySharedState,
  STORAGE_KEY,
  useHomeDIY,
} from '@/lib/modular/use-home-diy'
import { FAVORITES_STORAGE_KEY } from '@/lib/favorites-storage'

/* ------------------------------------------------------------------ *
 * 假的浏览器环境（node 环境里没有 window / localStorage）
 * ------------------------------------------------------------------ */

interface FakeBrowser {
  get: (key: string) => string | null
  set: (key: string, value: string) => void
  writes: string[]
}

function installBrowser(initial: Record<string, string> = {}): FakeBrowser {
  const store = new Map<string, string>(Object.entries(initial))
  const writes: string[] = []
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
      writes.push(k)
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
    sessionStorage: { getItem: () => null, setItem: () => {} },
    dispatchEvent: () => true,
    location: { hash: '', pathname: '/', search: '' },
    history: { replaceState: () => {} },
  }
  ;(globalThis as unknown as { window: unknown }).window = window
  // use-home-diy.ts 读的是裸 localStorage：真浏览器里它就是 window.localStorage
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = localStorage
  return {
    get: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    set: (key: string, value: string) => {
      store.set(key, value)
    },
    writes,
  }
}

function uninstallBrowser() {
  delete (globalThis as unknown as { window?: unknown }).window
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage
}

let browser: FakeBrowser

beforeEach(() => {
  resetHomeDiySharedState()
  browser = installBrowser()
})

afterEach(() => {
  resetHomeDiySharedState()
  uninstallBrowser()
})

/* ------------------------------------------------------------------ *
 * 共享夹具
 * ------------------------------------------------------------------ */

const SITES = [
  { id: 'site-a', title: 'A 站' },
  { id: 'site-b', title: 'B 站' },
  { id: 'site-c', title: 'C 站' },
]

const CATEGORIES = [
  { id: 'cat-x', title: 'X 分类', items: [{ id: 'site-b' }] },
  { id: 'cat-y', title: 'Y 分类', items: [{ id: 'site-a' }] },
]

/** renderToString 真渲染一次 hook，抓出返回的 api（含 applySmartAutoTune）。 */
function renderHookApi(): ReturnType<typeof useHomeDIY> {
  // 用 holder 对象接 api：直接写外层 let 变量时 TS 看不到闭包内的赋值，
  // 控制流会把 api 窄化成 never。
  const holder: { api: ReturnType<typeof useHomeDIY> | null } = { api: null }
  function Probe() {
    holder.api = useHomeDIY()
    return null
  }
  renderToString(createElement(Probe))
  if (holder.api === null) throw new Error('useHomeDIY 未返回 api')
  return holder.api
}

/* ------------------------------------------------------------------ *
 * 1. computeSmartAutoTune：收藏加权生效
 * ------------------------------------------------------------------ */

describe('computeSmartAutoTune：收藏加权', () => {
  it('收藏站 +50：无访问、无 featured 时收藏站排速览坞首位', () => {
    const result = computeSmartAutoTune(SITES, CATEGORIES, {}, ['site-b'])
    expect(result.speedDialPinnedIds[0]).toBe('site-b')
    expect(result.speedDialPinnedIds).toHaveLength(3)
    expect(result.speedDialEnabled).toBe(true)
  })

  it('收藏分类 +10：含收藏站的分类排前面', () => {
    const result = computeSmartAutoTune(SITES, CATEGORIES, {}, ['site-b'])
    expect(result.categoryOrder[0]).toBe('cat-x')
    expect(result.categoryOrder[1]).toBe('cat-y')
  })

  it('无收藏时行为不变：只按访问频次排序', () => {
    const visits = {
      'site-c': { count: 3 },
      'site-a': { count: 1 },
    }
    const result = computeSmartAutoTune(SITES, CATEGORIES, visits, [])
    expect(result.speedDialPinnedIds).toEqual(['site-c', 'site-a', 'site-b'])
    // 不传收藏参数与传空数组等价
    expect(computeSmartAutoTune(SITES, CATEGORIES, visits)).toEqual(result)
    // 无访问、无收藏时分类顺序保持原序
    const plain = computeSmartAutoTune(SITES, CATEGORIES, {}, [])
    expect(plain.categoryOrder).toEqual(['cat-x', 'cat-y'])
  })
})

/* ------------------------------------------------------------------ *
 * 2. readFavoriteIdsForAutoTune：读真键、走 corrupt 语义
 * ------------------------------------------------------------------ */

describe('readFavoriteIdsForAutoTune：读真键 navhub.favorites.v1', () => {
  it('对象数组 {siteId} → id 列表', () => {
    browser.set(
      FAVORITES_STORAGE_KEY,
      JSON.stringify([
        { siteId: 'site-a', title: 'A 站', href: 'https://a.example', createdAt: 1 },
        { siteId: 'site-b', title: 'B 站', href: 'https://b.example', createdAt: 2 },
      ]),
    )
    expect(readFavoriteIdsForAutoTune()).toEqual({ ids: ['site-a', 'site-b'], corrupt: false })
  })

  it('字符串数组 → id 列表（旧形状兼容）', () => {
    browser.set(FAVORITES_STORAGE_KEY, JSON.stringify(['site-c']))
    expect(readFavoriteIdsForAutoTune()).toEqual({ ids: ['site-c'], corrupt: false })
  })

  it('旧死键有数据、真键无数据 → 不读死键，返回空且不 corrupt', () => {
    browser.set('navhub_favorite_sites_v1', JSON.stringify(['site-a']))
    expect(readFavoriteIdsForAutoTune()).toEqual({ ids: [], corrupt: false })
  })

  it('真键无数据 → 空收藏且不 corrupt', () => {
    expect(readFavoriteIdsForAutoTune()).toEqual({ ids: [], corrupt: false })
  })

  it('坏 JSON → corrupt:true，不伪装成空收藏', () => {
    browser.set(FAVORITES_STORAGE_KEY, '{"siteId":"site-a"')
    expect(readFavoriteIdsForAutoTune()).toEqual({ ids: [], corrupt: true })
  })

  it('非数组 JSON → corrupt:true', () => {
    browser.set(FAVORITES_STORAGE_KEY, JSON.stringify({ siteId: 'site-a' }))
    expect(readFavoriteIdsForAutoTune()).toEqual({ ids: [], corrupt: true })
  })
})

/* ------------------------------------------------------------------ *
 * 3. applySmartAutoTune 端到端（hook）：收藏真进速览坞；坏数据不落盘
 * ------------------------------------------------------------------ */

describe('applySmartAutoTune 端到端', () => {
  it('有收藏时调优把收藏站置入速览坞首位并落盘', () => {
    browser.set(
      FAVORITES_STORAGE_KEY,
      JSON.stringify([{ siteId: 'site-b', title: 'B 站', href: 'https://b.example', createdAt: 1 }]),
    )
    const api = renderHookApi()
    const result = api.applySmartAutoTune(SITES, CATEGORIES)
    expect(result).not.toBeNull()
    expect(result!.speedDialPinnedIds[0]).toBe('site-b')
    flushHomeDiyDiskWrites()
    expect(getHomeDiySnapshot().config.speedDialPinnedIds?.[0]).toBe('site-b')
    const stored = browser.get(STORAGE_KEY)
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored as string).speedDialPinnedIds[0]).toBe('site-b')
  })

  it('无收藏时调优照常执行（不因读不到收藏而拒绝）', () => {
    const api = renderHookApi()
    const result = api.applySmartAutoTune(SITES, CATEGORIES)
    expect(result).not.toBeNull()
    expect(result!.speedDialEnabled).toBe(true)
    expect(result!.speedDialPinnedIds).toHaveLength(3)
  })

  it('坏数据时返回 null 且不覆盖布局、不落盘', () => {
    browser.set(FAVORITES_STORAGE_KEY, '{"siteId":"site-a"')
    const before = getHomeDiySnapshot().config.speedDialPinnedIds
    const api = renderHookApi()
    const result = api.applySmartAutoTune(SITES, CATEGORIES)
    expect(result).toBeNull()
    flushHomeDiyDiskWrites()
    expect(getHomeDiySnapshot().config.speedDialPinnedIds).toEqual(before)
    // applySmartAutoTune 根本没走 persistConfig：DIY 配置键一次都没写过
    expect(browser.writes).not.toContain(STORAGE_KEY)
  })
})

/* ------------------------------------------------------------------ *
 * 4. 源码守卫：死键不再出现；坏数据分支必须接线到工具栏
 * ------------------------------------------------------------------ */

describe('源码守卫：死键已清除、坏数据分支已接线', () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  function overlayRoot(): string {
    const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
    const isOverlayDir = (p: string) => {
      const s = p.replace(/\\/g, '/')
      return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
    }
    const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
    if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
    return hit
  }
  const ROOT = overlayRoot()
  const readSrc = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

  it('use-home-diy.ts 不再出现死键，全仓唯一读走真键 + parseFavorites', () => {
    const src = readSrc('src/lib/modular/use-home-diy.ts')
    expect(src).not.toContain('navhub_favorite_sites_v1')
    expect(src).toContain('FAVORITES_STORAGE_KEY')
    expect(src).toContain('parseFavorites')
    expect(src).toContain('readFavoriteIdsForAutoTune')
  })

  it('工具栏对 null 返回有诚实分支，不弹假成功 toast', () => {
    const toolbar = readSrc('src/components/home-diy-toolbar.tsx')
    expect(toolbar).toContain('const result = applySmartAutoTune(allSites, categories)')
    expect(toolbar).toContain('if (result === null)')
    expect(toolbar).toContain('describeCorruptFavorites')
    // 成功 toast 文案不动：修复后它才变真
    expect(toolbar).toContain('已按访问频次与星标把')
  })
})
