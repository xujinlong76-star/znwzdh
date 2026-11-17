/**
 * P1-3：/search 结果页丢插件。
 *
 * 行为断言为主（复审 D 要求）：用 react-dom/server 的 renderToStaticMarkup
 * 真渲染 SearchResults / PluginSection（node 环境无 jsdom，沿用
 * empty-states.test.ts / drama-due-badge.test.ts 的先例），再用 mock 的
 * hubGet 测 loadSearchPage 的取数接线。
 *
 * next/link 在 node 测试环境没有 Next 运行时：替成直通 <a>（drama-due-badge
 * 同款）。ZeroResultActions / WantedActions 是客户端岛（后者读
 * localStorage 的 useFavorites），本文件只测 SearchResults 的分支，不测
 * 它们本身；两岛替成只复刻四个出口文案的标记桩——能证明 EmptyResults
 * 仍挂载两岛（A3 方案 b 的关键），真实按钮行为/文案归岛组件自身测试。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PluginSection, SearchResults } from '../src/app/search/search-results'
import type {
  HubPluginItem,
  HubPluginSearchResponse,
  HubSearchHit,
  HubSearchResult,
  HubSite,
} from '../src/lib/navhub-api'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock，这里统一清掉（drama-due-badge.test.ts 同款）。
afterAll(() => {
  vi.resetModules()
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

vi.mock('@/components/search/zero-result-actions', async () => {
  const React = await import('react')
  return {
    ZeroResultActions: ({ query }: { query: string }) =>
      React.createElement(
        'div',
        { 'data-testid': 'zero-result-actions' },
        `让 AI 帮我找「${query}」`,
        '投稿收录这个站',
      ),
  }
})

vi.mock('@/components/search/wanted-actions', async () => {
  const React = await import('react')
  return {
    WantedActions: () =>
      React.createElement('div', { 'data-testid': 'wanted-actions' }, '存为待找', '新建收藏'),
  }
})

const mockHubGet = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/server/hub', () => ({ hubGet: mockHubGet }))

/* ---------- fixtures ---------- */

function pluginItem(over: Partial<HubPluginItem> & { slug: string; name: string }): HubPluginItem {
  // TS2783 返工：over 的 slug/name 是必填，末尾 ...over 会与显式 slug/name 重复；
  // 先把 slug/name 解构出来，剩余可选字段再铺开（行为不变，覆盖仍以后者为准）。
  const { slug, name, ...rest } = over
  return {
    id: `plugin-${slug}`,
    slug,
    kind: 'theme',
    name,
    description: `${name} 的简介`,
    version: '1.2.0',
    manifest: {},
    source: 'seed',
    status: 'published',
    installCount: 0,
    starCount: 0,
    reportCount: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...rest,
  }
}

function pluginResponse(items: HubPluginItem[], over: Partial<HubPluginSearchResponse> = {}): HubPluginSearchResponse {
  return { items, total: items.length, mode: 'keyword', degraded: false, ...over }
}

function siteResult(over: Partial<HubSearchResult> = {}): HubSearchResult {
  return {
    hits: [],
    suggestions: [],
    popular: [],
    ...over,
  } as unknown as HubSearchResult
}

function siteHit(title: string): HubSearchHit {
  return {
    siteId: `site-${title}`,
    score: 1,
    contributions: { exact: { rank: 1, value: 1 } },
    site: {
      id: `site-${title}`,
      title,
      url: `https://${title}.example.com`,
      description: `${title} 的描述`,
      tags: [],
      status: 'active',
    } as unknown as HubSite,
  }
}

function renderSearch(props: Partial<Parameters<typeof SearchResults>[0]>): string {
  return renderToStaticMarkup(
    createElement(SearchResults, {
      q: 'AI 工具',
      page: 1,
      tag: null,
      result: siteResult(),
      failed: false,
      unavailable: [],
      plugins: null,
      recommended: [],
      ...props,
    }),
  )
}

/* ---------- A1：插件分区 ---------- */

describe('A1：/search?q=<插件名> 出现插件分区', () => {
  it('分区标题含“插件市场”，每行显示名称/描述，详情链进 /marketplace/{slug}', () => {
    const html = renderToStaticMarkup(
      createElement(PluginSection, {
        q: 'dark',
        plugins: pluginResponse([
          pluginItem({ slug: 'dark-theme-pro', name: 'Dark Theme Pro', description: '深色主题插件' }),
          pluginItem({ slug: 'ai-search-pack', name: 'AI 搜索包', kind: 'search-pack' }),
        ]),
      }),
    )
    expect(html).toContain('插件市场')
    // 名称里的查询词会被高亮包进 <mark>，纯文本 'Dark Theme Pro' 不连续出现；
    // 断言高亮存在 + 剩余部分存在，等价于名称完整渲染。
    expect(html).toContain('<mark')
    expect(html).toContain('Theme Pro')
    expect(html).toContain('深色主题插件')
    expect(html).toContain('href="/marketplace/dark-theme-pro"')
    expect(html).toContain('href="/marketplace/ai-search-pack"')
    expect(html).toContain('AI 搜索包')
  })

  it('非 published 插件详情链走 /preview，不直接 404', () => {
    const html = renderToStaticMarkup(
      createElement(PluginSection, {
        q: 'draft',
        plugins: pluginResponse([pluginItem({ slug: 'draft-plugin', name: 'Draft', status: 'pending' })]),
      }),
    )
    expect(html).toContain('href="/marketplace/draft-plugin/preview"')
  })

  it('分区尾部有“查看全部插件结果”，href 为 /marketplace?q=…（q 编码，总数超出前 5 条时显总数）', () => {
    const html = renderToStaticMarkup(
      createElement(PluginSection, {
        q: 'AI 工具',
        plugins: pluginResponse([pluginItem({ slug: 'a', name: 'A' })], { total: 7 }),
      }),
    )
    expect(html).toContain('查看全部插件结果')
    expect(html).toContain('href="/marketplace?q=AI%20%E5%B7%A5%E5%85%B7"')
    expect(html).toContain('共 7 个')
    expect(html).not.toContain('q=AI 工具')
  })

  it('插件命中为空时分区不渲染（不得出现空标题的分区壳）', () => {
    expect(
      renderToStaticMarkup(
        createElement(PluginSection, { q: 'x', plugins: pluginResponse([]) }),
      ),
    ).toBe('')
  })

  it('站点命中与插件命中并存时，两区都出现（SearchResults 整页）', () => {
    const html = renderSearch({
      q: 'dark',
      result: siteResult({ hits: [siteHit('dark-site')] }),
      plugins: pluginResponse([pluginItem({ slug: 'dark-theme-pro', name: 'Dark Theme Pro' })]),
    })
    expect(html).toContain('dark-site')
    expect(html).toContain('插件市场')
    expect(html).toContain('href="/marketplace/dark-theme-pro"')
  })
})

/* ---------- A2：零结果页插件出口 ---------- */

describe('A2：零结果页有插件出口', () => {
  it('双零命中时 EmptyResults 渲染且含插件出口，href 编码正确', () => {
    const html = renderSearch({ q: 'AI 工具', result: siteResult({ hits: [] }), plugins: null })
    expect(html).toContain('站内暂时没有收录')
    expect(html).toContain('在插件市场中搜索')
    expect(html).toContain('href="/marketplace?q=AI%20%E5%B7%A5%E5%85%B7"')
    expect(html).not.toContain('q=AI 工具')
  })
})

/* ---------- A3：站点零命中 + 插件命中 ---------- */

describe('A3：站点零命中、插件命中时空态仍在、但只说站点（方案 b）', () => {
  it('插件分区在前、EmptyResults 同在且四个出口都在，无限定空态标题不出现，状态行改写为站点暂无匹配', () => {
    const html = renderSearch({
      q: 'dark',
      result: siteResult({ hits: [] }),
      plugins: pluginResponse([pluginItem({ slug: 'dark-theme-pro', name: 'Dark Theme Pro' })], { total: 3 }),
    })
    // PluginSection 在 EmptyResults 之前（视觉优先）：按 section 标记定位，
    // 不用裸 '插件市场'（状态行里也有这四个字）。
    expect(html).toContain('aria-label="插件市场"')
    expect(html).toContain('href="/marketplace/dark-theme-pro"')
    expect(html.indexOf('aria-label="插件市场"')).toBeLessThan(
      html.indexOf('站点暂无与“dark”匹配的收录'),
    )
    // 空态仍渲染，但标题限定为站点：无限定「站内暂时没有收录」不得出现
    expect(html).not.toContain('站内暂时没有收录')
    expect(html).toContain('站点暂无与“dark”匹配的收录')
    // 四个出口同在（两岛挂载标记桩复刻的文案）
    expect(html).toContain('让 AI 帮我找')
    expect(html).toContain('投稿收录这个站')
    expect(html).toContain('存为待找')
    expect(html).toContain('新建收藏')
    // 插件出口也在（EmptyResults 底部 nav）
    expect(html).toContain('在插件市场中搜索')
    // 状态行改写
    expect(html).toContain('站点暂无匹配')
    expect(html).toContain('插件市场有 3 个相关结果')
  })

  it('纠正后仍零结果时插件出口仍在（不得藏进被 hideGenericRecommendations 隐藏的泛推荐块）', () => {
    const html = renderSearch({
      q: 'dakr',
      result: siteResult({
        hits: [],
        correction: { original: 'dakr', corrected: 'dark', reason: 'spelling' },
      }),
      plugins: null,
    })
    expect(html).toContain('换了“dark”还是没有')
    expect(html).not.toContain('换个词试试')
    expect(html).toContain('在插件市场中搜索')
    expect(html).toContain('href="/marketplace?q=dakr"')
  })
})

/* ---------- B1：插件取数失败隔离降级 ---------- */

describe('B1：插件取数失败不得影响站点结果', () => {
  it('plugins=null 时站点结果照常渲染，插件分区缺席，无任何插件失败文案', () => {
    const html = renderSearch({
      q: 'dark',
      result: siteResult({ hits: [siteHit('dark-site')] }),
      plugins: null,
    })
    expect(html).toContain('dark-site')
    // 页眉导航自带「插件市场」链接（页面 chrome，与插件分区无关），
    // 故只断言插件分区本身缺席（aria-label），不禁裸词。
    expect(html).not.toContain('aria-label="插件市场"')
    expect(html).not.toContain('插件检索')
    expect(html).not.toContain('插件加载失败')
  })

  it('degraded:true（语义回退关键词）时插件结果仍可展示，附“语义未就绪”标注，不当作失败', () => {
    const html = renderToStaticMarkup(
      createElement(PluginSection, {
        q: 'dark',
        plugins: pluginResponse([pluginItem({ slug: 'dark-theme-pro', name: 'Dark Theme Pro' })], {
          mode: 'keyword',
          degraded: true,
        }),
      }),
    )
    // 同 A1：名称里的查询词被高亮包进 <mark>，断言高亮 + 剩余部分。
    expect(html).toContain('<mark')
    expect(html).toContain('Theme Pro')
    expect(html).toContain('语义检索未就绪')
    expect(html).not.toContain('失败')
  })
})

/* ---------- B2/B3：loadSearchPage 取数接线 ---------- */

describe('loadSearchPage：插件请求与站点查询并行、只第 1 页、有超时、不新增缓存', () => {
  beforeEach(() => {
    mockHubGet.mockReset()
  })

  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((res) => {
      resolve = res
    })
    return { promise, resolve }
  }

  it('插件请求与站点主查询同时发出（任一未 resolve 时两路调用已存在），返回后 plugins 落盘', async () => {
    const { loadSearchPage } = await import('../src/lib/server/search')
    const main = deferred<unknown>()
    const plugin = deferred<unknown>()
    mockHubGet.mockImplementation((path: string) => {
      if (path.includes('status=broken')) return Promise.resolve({ hits: [] })
      if (path.startsWith('/api/plugins/search')) return plugin.promise
      return main.promise
    })
    const pending = loadSearchPage('ai', 1)
    // 两路都还是 pending：已同时发出，不是串行 await
    // 注意主查询只传 1 个参数（hubGet 默认超时/不挂缓存），断言只匹配这 1 个；
    // 插件路显式传 (path, 0, 5000)，三个参数全匹配。
    expect(mockHubGet).toHaveBeenCalledWith(expect.stringContaining('/api/search?q=ai'))
    expect(mockHubGet).toHaveBeenCalledWith('/api/plugins/search?q=ai&limit=5', 0, 5000)
    main.resolve({ hits: [] })
    plugin.resolve(pluginResponse([pluginItem({ slug: 'a', name: 'A' })]))
    const data = await pending
    expect(data.failed).toBe(false)
    expect(data.plugins?.items).toHaveLength(1)
    expect(data.plugins?.items[0].slug).toBe('a')
  })

  it('page>1 时不发起插件请求（分区仅第 1 页展示）', async () => {
    const { loadSearchPage } = await import('../src/lib/server/search')
    mockHubGet.mockImplementation((path: string) => {
      if (path.includes('status=broken')) return Promise.resolve({ hits: [] })
      return Promise.resolve({ hits: [] })
    })
    await loadSearchPage('ai', 2)
    expect(mockHubGet.mock.calls.some(([path]: any[]) => path.startsWith('/api/plugins/search'))).toBe(false)
  })

  it('空 q 与纯标签浏览（q 为空）都不发起插件请求', async () => {
    const { loadSearchPage } = await import('../src/lib/server/search')
    mockHubGet.mockResolvedValue({ hits: [] })
    await loadSearchPage('', 1)
    await loadSearchPage('', 1, '开源', { category: 'dev' })
    expect(mockHubGet.mock.calls.some(([path]: any[]) => path.startsWith('/api/plugins/search'))).toBe(false)
  })

  it('插件取数失败（hubGet 返回 null）时站点结果照常、plugins 为 null', async () => {
    const { loadSearchPage } = await import('../src/lib/server/search')
    mockHubGet.mockImplementation((path: string) => {
      if (path.startsWith('/api/plugins/search')) return Promise.resolve(null)
      return Promise.resolve({ hits: [siteHit('x')] })
    })
    const data = await loadSearchPage('x', 1)
    expect(data.failed).toBe(false)
    expect(data.result?.hits).toHaveLength(1)
    expect(data.plugins).toBeNull()
  })

  it('插件请求只带 q/limit，不透传 tag/category/facets；revalidate=0（不新增 Data Cache）、超时 5s', async () => {
    const { loadSearchPage } = await import('../src/lib/server/search')
    mockHubGet.mockImplementation((path: string) => {
      if (path.startsWith('/api/plugins/search')) {
        return Promise.resolve(pluginResponse([]))
      }
      return Promise.resolve({ hits: [] })
    })
    await loadSearchPage('AI 工具', 1, '开源', { category: 'dev', facets: { pricing: ['free'] } })
    const pluginCall = mockHubGet.mock.calls.find(([path]: any[]) => path.startsWith('/api/plugins/search'))
    expect(pluginCall).toBeDefined()
    expect(pluginCall![0]).toBe('/api/plugins/search?q=AI%20%E5%B7%A5%E5%85%B7&limit=5')
    expect(pluginCall![1]).toBe(0)
    expect(pluginCall![2]).toBe(5000)
  })
})

/* ---------- 接线守卫：page.tsx 透传 + 站点逻辑不动 ---------- */

describe('接线守卫：page.tsx 透传 plugins，站点搜索逻辑不动', () => {
  it('page.tsx 从 loadSearchPage 解构 plugins 并透传给 SearchResults', () => {
    const page = overlaySource('src/app/search/page.tsx')
    expect(page).toContain('plugins')
    expect(page).toContain('plugins={plugins}')
    expect(page).toContain('loadSearchPage(q, page, tag,')
  })

  it('search.ts 保留 broken 补取（第 1 页限定、按标题去重、isLexicalHit 口径），主查询不动', () => {
    const src = overlaySource('src/lib/server/search.ts')
    expect(src).toContain("status: 'broken'")
    expect(src).toContain('isLexicalHit')
    expect(src).toContain('page === 1')
    expect(src).toContain('searchApiPath(q, page, tag,')
  })
})
