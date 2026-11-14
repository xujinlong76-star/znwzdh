/**
 * /sites 目录筛选（升级第 2 条：筛选只搜当前页 → 筛全部已取回站点）。
 *
 * 覆盖：
 *  - filterSitesByQuery 纯函数：3 页数据中第 3 页的站能被查到（旧逻辑只筛
 *    当前页 60 条，第 2 页以后的站永远搜不到）；标题/链接/描述/tags 同一匹
 *    配语义、大小写不敏感、去空白；空查询返回原数组；宽泛查询命中 >60 条
 *    时只由 SEARCH_RESULT_LIMIT 截 display（见下）。
 *  - SSR 渲染（无查询）：占位与计数行是新文案、只渲染当前页 60 条（第 3 页
 *    的站不在 HTML 里——清空查询即恢复当前页，同一事实的另一面）。
 *  - 源码守卫：组件真的把 searchableSites（而不是 initialSites）交给
 *    filterSitesByQuery、截断/失败时文案写「只在已取回站点里筛选」、父级
 *    真的把 all 当 searchableSites 传下来；旧文案（「当前第 X 页筛选」/
 *    「当前第 X 页未匹配到」）已清干净。
 *
 * 未覆盖（仓库 vitest 是 node 环境、无 jsdom / Testing Library，组件无法
 * 挂载交互——见 skin-picker.test.ts 同款说明）：在输入框里敲字后结果实时
 * 变化、点「重置」/清空按钮恢复当前页、EmptyState 的运行时渲染、超 60 条
 * 时「显示前 60 个。输入更多关键字缩小范围」那行字的运行时出现。上面
 * 这些分支的逻辑面由纯函数 + 源码守卫钉住，真实点按等 CI / 上线后复核。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi, afterAll } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  SitesDirectoryFilterableGrid,
  filterSitesByQuery,
  SEARCH_RESULT_LIMIT,
} from '../src/components/sites-directory-filterable-grid'
import type { HubSite } from '../src/lib/navhub-api'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(HERE, '..')
const OVERLAY_ROOT = join(HERE, '..', '..', 'apps', 'web-overlay')
const readSrc = (rel: string): string | null => {
  for (const root of [WEB_ROOT, OVERLAY_ROOT]) {
    try {
      return readFileSync(join(root, rel), 'utf8')
    } catch {
      // 镜像与 overlay 双份并存时优先读镜像
    }
  }
  return null
}

// next/link 在 node 测试环境没有 Next 运行时：替成直通 <a>，只保留 href/文案。
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

type TestSite = HubSite & { id: string; title: string; url: string }

function makeSite(i: number, overrides: Partial<TestSite> = {}): TestSite {
  return {
    id: `site-${i}`,
    title: `测试站 ${i}`,
    url: `https://example-${i}.com`,
    description: `第 ${Math.floor(i / 60) + 1} 页的站点 ${i}`,
    tags: [`标签${i % 10}`],
    // HubSite 必填的契约字段（匹配逻辑用不到，但类型要求在场）。
    categoryId: 'test-category',
    status: 'active',
    ...overrides,
  }
}

/** 3 页 × 60 条 = 180 条；第 3 页（下标 120 起）放一台专属站。 */
function makeThreePages(): TestSite[] {
  const all = Array.from({ length: 180 }, (_, i) => makeSite(i))
  all[150] = makeSite(150, {
    title: '第3页专属站',
    url: 'https://page3-only.example.com',
    description: '只有在全量里筛才能找到的站',
    tags: ['冷门标签'],
  })
  return all
}

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe('filterSitesByQuery（纯函数：筛全部已取回站点）', () => {
  it('命中第 3 页的站：旧逻辑只筛当前页时它永远搜不到', () => {
    const all = makeThreePages()
    const hits = filterSitesByQuery(all, '第3页专属站')
    expect(hits.map((s) => s.id)).toEqual(['site-150'])
    // 同一查询只筛当前页（前 60 条）时必为 0 —— 这正是旧 bug 的复现面。
    expect(filterSitesByQuery(all.slice(0, 60), '第3页专属站')).toEqual([])
  })

  it('标题 / 链接 / 描述 / tags 四路同一匹配，大小写不敏感、去空白', () => {
    const all = makeThreePages()
    expect(filterSitesByQuery(all, 'page3-only.example.com').map((s) => s.id)).toEqual(['site-150'])
    expect(filterSitesByQuery(all, '冷门标签').map((s) => s.id)).toEqual(['site-150'])
    expect(filterSitesByQuery(all, '只有在全量里筛').map((s) => s.id)).toEqual(['site-150'])
    expect(filterSitesByQuery(all, '  第3页专属站  ').map((s) => s.id)).toEqual(['site-150'])
    expect(filterSitesByQuery(all, 'PAGE3-ONLY').map((s) => s.id)).toEqual(['site-150'])
  })

  it('无命中返回空数组；空查询返回原数组（不过滤）', () => {
    const all = makeThreePages()
    expect(filterSitesByQuery(all, '不存在的站名 xyz')).toEqual([])
    expect(filterSitesByQuery(all, '   ')).toBe(all)
  })

  it('宽泛查询命中超过上限：上限常量为 60，组件只展前 60 条', () => {
    const all = makeThreePages()
    expect(SEARCH_RESULT_LIMIT).toBe(60)
    const hits = filterSitesByQuery(all, '测试站')
    expect(hits.length).toBeGreaterThan(60)
    expect(hits.slice(0, SEARCH_RESULT_LIMIT)).toHaveLength(60)
  })
})

describe('网格 SSR（无查询时仍是当前页）', () => {
  // renderToString 会在相邻文本/表达式边界插 `<!-- -->` 分隔注释：
  // 先清掉再断言跨表达式的整句文案，否则「显示 60 / 全站 180 个站点」
  // 这类句子永远匹配不上。
  const stripComments = (html: string) => html.replace(/<!-- -->/g, '')

  function renderGrid(props: Partial<Parameters<typeof SitesDirectoryFilterableGrid>[0]> = {}) {
    const all = makeThreePages()
    return stripComments(
      renderToString(
        createElement(SitesDirectoryFilterableGrid, {
          initialSites: all.slice(0, 60),
          searchableSites: all,
          totalPages: 3,
          totalSites: all.length,
          truncated: false,
          failed: false,
          ...props,
        }),
      ),
    )
  }

  it('占位与计数行是新文案：筛全部站点，计数按全站总数', () => {
    const html = renderGrid()
    expect(html).toContain('在全部站点中筛选（标题 / 链接 / 描述）')
    expect(html).toContain('aria-label="在全部站点中筛选"')
    expect(html).toContain('显示 60 / 全站 180 个站点')
    expect(html).not.toContain('在当前第')
    expect(html).not.toContain('筛选当前页站点')
  })

  it('无查询只渲染当前页：第 1 页的站在，第 3 页专属站不在（清空即恢复当前页）', () => {
    const html = renderGrid()
    expect(html).toContain('测试站 0')
    expect(html).toContain('测试站 59')
    expect(html).not.toContain('第3页专属站')
    expect(html).not.toContain('page3-only.example.com')
  })

  it('取数不完整时计数行如实写「已取回」，不谎称全站', () => {
    const html = renderGrid({ truncated: true })
    expect(html).toContain('显示 60 / 已取回 180 个站点')
    expect(html).not.toContain('全站 180 个站点')
  })
})

describe('源码守卫（接线与诚实文案）', () => {
  const gridSrc = readSrc('src/components/sites-directory-filterable-grid.tsx')
  const dirSrc = readSrc('src/app/sites/sites-directory.tsx')

  it('网格把 searchableSites 交给过滤函数，而不是 initialSites', () => {
    expect(gridSrc).not.toBeNull()
    expect(gridSrc).toContain('filterSitesByQuery(searchableSites, filterQuery)')
    expect(gridSrc).not.toContain('filterSitesByQuery(initialSites')
  })

  it('超 60 条只展前 60 条并提示缩小范围；截断/失败文案写「只在已取回站点里筛选」', () => {
    expect(gridSrc).toContain('slice(0, SEARCH_RESULT_LIMIT)')
    expect(gridSrc).toContain('只在已取回站点里筛选')
    expect(gridSrc).toContain('显示前 60 个。输入更多关键字缩小范围')
    expect(gridSrc).toContain('在已取回的 ${searchableSites.length} 个站点中未匹配到')
  })

  it('旧文案已清干净', () => {
    expect(gridSrc).not.toContain('在当前第')
    expect(gridSrc).not.toContain('筛选当前页站点')
    expect(gridSrc).not.toContain('当前第 ${current} 页未匹配到')
  })

  it('父级把全量 all 当 searchableSites 传下来，并传 truncated/failed', () => {
    expect(dirSrc).not.toBeNull()
    expect(dirSrc).toContain('searchableSites={all}')
    expect(dirSrc).toContain('truncated={truncated}')
    expect(dirSrc).toContain('failed={failed}')
    // 分页逻辑与 canonical 口径不动：只改网格这一个调用点。
    expect(dirSrc).toContain('SitesDirectoryFilterableGrid')
  })
})
