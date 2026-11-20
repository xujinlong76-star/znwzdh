/**
 * /search 空态「最近搜索」chips 一键重搜（U-292）。
 *
 * 锁：
 * 1. 空态最近搜索 chips 由 RecentSearchChipsList 渲染：每枚 chip 都是指向
 *    `/search?q=<词>` 的普通 <a>（searchHref 编码），点选即直达该词的站内搜索；
 *    chips 本身不需要 JS（点选直达），只有加载个人数据需要 JS——身份只存在
 *    浏览器 localStorage，服务端取不到（见 recent-search-chips.tsx 顶部注释）；
 * 2. 数据源与面板一致：GET /api/search-history（经 /api/hub 代理），
 *    `fetchRecentSearchQueries`（轻量模块，不 import 134KB 的 navhub-api），
 *    去重口径复用 `toRecentSearchItems`；取数失败返回 []，整块不渲染；
 * 3. 与热词不重复：渲染时去掉已在热词区的词（大小写不敏感），两块可共存；
 * 4. 首屏不闪现：RecentSearchChips 服务端首渲染为 null，取到数据后才出现。
 *
 * 真渲染断言：用 react-dom/server 的 renderToStaticMarkup 直接渲染
 * RecentSearchChipsList（search-hotwords.test.ts 同款先例；node 无 jsdom）。
 * next/link 替成直通 <a>，只测 chips 自己的结构。
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  RecentSearchChips,
  RecentSearchChipsList,
  excludeHotwords,
} from '../src/components/search/recent-search-chips'
import { fetchRecentSearchQueries } from '../src/lib/recent-search-fetch'

// mock 卫生兜底：本文件有跨模块 vi.mock，isolate:false 下同 worker 的
// 后续文件会看到留下的 mock，这里统一清掉（drama-due-badge.test.ts 同款）。
afterAll(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: ({ href, children, ...props }: { href?: string; children?: React.ReactNode }) =>
      React.createElement(
        'a',
        { href: typeof href === 'string' ? href : '#', ...props },
        children,
      ),
  }
})

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

const RESULTS = 'src/app/search/search-results.tsx'
const ISLAND = 'src/components/search/recent-search-chips.tsx'
const FETCHER = 'src/lib/recent-search-fetch.ts'

describe('RecentSearchChipsList：最近搜索点选重搜', () => {
  it('每枚 chip 都是指向 /search?q=<词> 的链接，词文本在链内', () => {
    const html = renderToStaticMarkup(
      createElement(RecentSearchChipsList, { queries: ['考研', '短剧'] }),
    )
    expect(html).toContain('href="/search?q=%E8%80%83%E7%A0%94"')
    expect(html).toContain('>考研</a>')
    expect(html).toContain('href="/search?q=%E7%9F%AD%E5%89%A7"')
    expect(html).toContain('最近搜索')
  })

  it('空数组不渲染（无历史 / 取数失败时整块消失）', () => {
    expect(renderToStaticMarkup(createElement(RecentSearchChipsList, { queries: [] }))).toBe('')
  })

  it('chip 经 searchHref 构造，不手写 /search?q= 拼接', () => {
    const src = overlaySource(ISLAND)
    expect(src).toContain('href={searchHref({ q: item })}')
    expect(src).not.toContain('`/search?q=${')
  })
})

describe('excludeHotwords：与热词不重复', () => {
  it('去掉已在热词区的词（大小写不敏感），其余按原顺序保留', () => {
    expect(excludeHotwords(['考研', '短剧', 'AI 办公'], ['考研', 'ai 办公'])).toEqual(['短剧'])
  })

  it('热词为空时原样返回', () => {
    expect(excludeHotwords(['考研'], [])).toEqual(['考研'])
  })
})

describe('fetchRecentSearchQueries：与面板同一数据源', () => {
  function stubFetch(ok: boolean, body: unknown) {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        return { ok, json: async () => body } as Response
      }),
    )
    return calls
  }

  it('成功时按面板口径去重（同词只留最近一条、空词跳过），走 /api/hub 代理、带匿名身份头', async () => {
    const calls = stubFetch(true, {
      items: [
        { id: 3, query: '考研', resultCount: 5, createdAt: 1700000003000 },
        { id: 2, query: '  ', resultCount: 0, createdAt: 1700000002000 },
        { id: 1, query: '考研', resultCount: 5, createdAt: 1700000001000 },
        { id: 0, query: '短剧', resultCount: 2, createdAt: 1700000000000 },
      ],
      hasMore: false,
      nextOffset: 4,
    })
    const queries = await fetchRecentSearchQueries('anon-abc', 8)
    expect(queries).toEqual(['考研', '短剧'])
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/hub/search-history?limit=8')
    expect(calls[0].url).not.toContain('anonId=')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers['X-Navhub-Anon-Id']).toBe('anon-abc')
    expect(headers['Authorization']).toBeUndefined()
  })

  it('有 API token 时带上 Bearer 头（中枢按 token 身份读，不读匿名历史）', async () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'navhub_api_token' ? 'tok-123' : null),
    })
    const calls = stubFetch(true, { items: [{ id: 1, query: '考研', resultCount: 5, createdAt: 1700000001000 }] })
    await fetchRecentSearchQueries('anon-abc', 8)
    expect((calls[0].init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-123')
  })

  it('非 2xx / 抛错 / 形状不对时一律返回 []，不抛错', async () => {
    stubFetch(false, { error: 'x' })
    await expect(fetchRecentSearchQueries('anon-abc', 8)).resolves.toEqual([])
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('boom')
    }))
    await expect(fetchRecentSearchQueries('anon-abc', 8)).resolves.toEqual([])
    stubFetch(true, { items: 'not-an-array' })
    await expect(fetchRecentSearchQueries('anon-abc', 8)).resolves.toEqual([])
    await expect(fetchRecentSearchQueries('', 8)).resolves.toEqual([])
  })
})

describe('RecentSearchChips 接线：空态挂载、与热词共存', () => {
  it('服务端首渲染为 null（身份在浏览器里，首屏不闪现、不取数）', () => {
    expect(
      renderToStaticMarkup(createElement(RecentSearchChips, { hotwords: ['考研'] })),
    ).toBe('')
  })

  it('SearchResults 空态挂载 RecentSearchChips（热词之后、浏览入口之前），与热词共存', () => {
    const src = overlaySource(RESULTS)
    expect(src).toContain('<HotwordChips hotwords={hotwords} />')
    expect(src).toContain('<RecentSearchChips hotwords={hotwords} />')
    const gateAt = src.indexOf("q === '' && !tag && !category")
    const hotAt = src.indexOf('<HotwordChips hotwords={hotwords} />')
    const mountAt = src.indexOf('<RecentSearchChips hotwords={hotwords} />')
    const navAt = src.indexOf('aria-label="浏览入口"', gateAt)
    expect(gateAt).toBeGreaterThan(-1)
    expect(mountAt).toBeGreaterThan(hotAt)
    expect(mountAt).toBeLessThan(navAt)
  })

  it('岛是客户端组件（身份在 localStorage，服务端取不到）；轻量取数不 import 134KB 的 navhub-api 值', () => {
    const islandSrc = overlaySource(ISLAND)
    expect(islandSrc).toContain("'use client'")
    expect(islandSrc).not.toContain('@/lib/navhub-api')
    const fetchSrc = overlaySource(FETCHER)
    // 只允许 import type（编译期擦除、零包体，与 recent-search.ts 同款）；
    // 值 import 会把 134KB 中枢客户端拉进 /search 首屏 chunk。
    const navhubLines = fetchSrc.split('\n').filter((line) => line.includes('@/lib/navhub-api'))
    expect(navhubLines.length).toBeGreaterThan(0)
    expect(navhubLines.every((line) => line.trim().startsWith('import type'))).toBe(true)
    expect(fetchSrc).toContain("'/api/hub/search-history?limit='")
    expect(fetchSrc).toContain('X-Navhub-Anon-Id')
  })

  it('search-results.tsx 仍是服务端组件（岛只挂在空态里，不把整页变客户端）', () => {
    const src = overlaySource(RESULTS)
    expect(src).not.toContain("'use client'")
    expect(src).not.toContain('"use client"')
  })
})
