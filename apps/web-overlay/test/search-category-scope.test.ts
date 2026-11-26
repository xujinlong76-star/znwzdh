/**
 * U-183/U-184/U-187/U-190/U-191（0522 进化轮）：/search 状态可见性批量修复。
 *
 * 范式与 search-zero-result-rescue.test.ts 一致：node 环境无 jsdom，
 * 接线类断言读源码字符串；ResultRow / PluginSection 是导出组件，
 * 用 react-dom/server 真渲染断言（p3-13-search-result-row.test.ts 同款）。
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResultRow, PluginSection } from '../src/app/search/search-results'
import { searchHref } from '../src/lib/search-page'
import type { HubPluginSearchResponse, HubSearchHit, HubSite } from '../src/lib/navhub-api'

// mock 卫生兜底：本文件有跨模块 vi.mock，isolate:false 下同 worker 的
// 后续文件会看到留下的 mock，这里统一清掉（p3-13-search-result-row.test.ts 同款）。
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

vi.mock('@/components/site-favicon', () => ({
  SiteFavicon: () => null,
}))

vi.mock('@/components/algorithm-hud-badge', () => ({
  AlgorithmHudBadge: () => null,
}))

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

describe('U-184：空态门与 page.tsx 的 hasFilter 一致，纯分类/纯分面不再被吞', () => {
  const src = overlaySource('src/app/search/search-results.tsx')

  it('空态门补齐 category/facets 四类条件', () => {
    expect(src).toContain("q === '' && !tag && !category && Object.keys(facets).length === 0")
  })

  it('resultLabel 有分类分支与纯分面分支，状态行模板保持无条件拼接', () => {
    expect(src).toContain('分类「${categoryName}」下的站点')
    expect(src).toContain('“${q}” 在分类「${categoryName}」下')
    expect(src).toContain('分面筛选下的站点')
    // 模板本身不加空值兜底：分支补全后结果分支内 resultLabel 恒非空，
    // 加条件会掩盖下一次枚举遗漏（W3 §3.2 三选一裁决）。
    expect(src).toContain('${resultLabel}：本页')
  })

  it('searchHref：去掉分类后的目标 URL 不含 category，去掉标签的目标保留 category/facets', () => {
    // 分类 × 的目标：只去 category，保留 q/tag/facets
    expect(searchHref({ q: 'a', tag: 't', facets: { pricing: ['free'] } })).not.toContain('category')
    expect(searchHref({ q: 'a', tag: 't', facets: { pricing: ['free'] } })).toContain('f_pricing=free')
    // 纯分类入口形态
    expect(searchHref({ category: 'dev-tools' })).toBe('/search?category=dev-tools')
    // 标签 × 的目标：只去 tag，保留 category/facets
    const keepScope = searchHref({ q: 'a', category: 'dev-tools', facets: { pricing: ['free'] } })
    expect(keepScope).toContain('category=dev-tools')
    expect(keepScope).toContain('f_pricing=free')
    expect(keepScope).not.toContain('tag=')
  })

  it('name="category" hidden input 全文件仍恰好 1 次（search-pagination-scope 的回归锁）', () => {
    const count = src.split('name="category"').length - 1
    expect(count).toBe(1)
  })
})

describe('U-183/U-184：categoryName 线程（page.tsx 解析中文名并透传）', () => {
  const page = overlaySource('src/app/search/page.tsx')
  const src = overlaySource('src/app/search/search-results.tsx')

  it('page.tsx：category 非空时 loadCategories(3600) 解析中文名，按 id 或 slug 匹配', () => {
    expect(page).toContain('loadCategories(3600)')
    expect(page).toContain('categoryDisplayName')
    expect(page).toContain('c.id === category || c.slug === category')
  })

  it('page.tsx：SearchResults 收到 categoryName prop', () => {
    expect(page).toContain('categoryName={categoryName}')
  })

  it('generateMetadata：纯分类页标题为「分类：名」', () => {
    expect(page).toContain('分类：${(categoryName ?? category).slice(0, 40)}')
    expect(page).toContain('浏览分类「${(categoryName ?? category).slice(0, 40)}」下的全部收录站点。')
  })

  it('SearchResults 声明 categoryName 可选 prop，取不到时退回 slug', () => {
    expect(src).toContain('categoryName?: string | null')
    expect(src).toContain('categoryNameProp ?? category')
  })
})

describe('U-183：分类芯片可见且可清除，标签清除只清自己', () => {
  const src = overlaySource('src/app/search/search-results.tsx')

  it('分类芯片与标签芯片同容器，复用标签芯片样式', () => {
    expect(src).toContain('分类：{categoryName}')
    // U-210：门条件扩为 tag/category/已选分面三者任一即渲染（此前只有前两项）
    expect(src).toContain('{tagApplied || category || facetChips.length > 0 ? (')
  })

  it('分类清除链接只去 category、保留 q/tag/facets，且带 aria-label 区分读屏', () => {
    expect(src).toContain('searchHref({ q, tag, facets })')
    expect(src).toContain('aria-label={`去掉分类「${categoryName}」筛选`}')
  })

  it('标签清除链接与放宽横幅清除链接只去 tag、保留 category/facets', () => {
    expect(src).toContain('searchHref({ q, category, facets })')
    // 三处（标签芯片、放宽横幅、零结果「去掉标签筛选」）都只清 tag，不再顺带清分类/分面
    const count = src.split('searchHref({ q, category, facets })').length - 1
    expect(count).toBe(3)
    // U-112 残留已修：EmptyResults「去掉标签筛选」现为 searchHref({ q, category, facets })。
  })
})

describe('U-183：零结果标题与页头文案看得见分类/分面作用域', () => {
  const src = overlaySource('src/app/search/search-results.tsx')

  it('零结果标题：纯分类与带词分类分支（两路：插件命中限定版与通用版）', () => {
    expect(src).toContain('分类「${categoryName}」下暂时没有站点。')
    expect(src).toContain('站内暂时没有收录与“${q}”匹配、且在分类「${categoryName}」下的站点。')
    expect(src).toContain('分类「${categoryName}」下站点暂无收录。')
    expect(src).toContain('站点暂无与“${q}”匹配、且在分类「${categoryName}」下的收录。')
  })

  it('零结果标题：纯分面分支；末端两处原文一字不改（防回归）', () => {
    expect(src).toContain('按当前分面筛选暂时没有站点。')
    expect(src).toContain('站内暂时没有收录与“${q}”匹配的站点。')
    // 末端分支唯一锚点：带三元冒号前缀的整行形态；:325 纠正分支是
    // `换了“…”还是没有——站点暂无匹配的收录。`，不含该前缀。
    // 删末端分支时本断言必须失败（裸子串断言会被 :325 兜住，回归锁失效）。
    expect(src).toContain(': `站点暂无匹配的收录。`')
  })

  it('EmptyResults 收到 categoryName prop', () => {
    expect(src).toContain('categoryName={categoryName}')
  })

  it('页头文案：分类作用域生效时不再说「全部收录站点」', () => {
    expect(src).toContain('在分类「${categoryName}」中检索，支持中文、拼音与语义匹配')
    expect(src).toContain('从站内全部收录站点中检索，支持中文、拼音与语义匹配')
  })
})

describe('U-187：翻页空页「回到第 1 页」在空态标题正下方', () => {
  const src = overlaySource('src/app/search/search-results.tsx')
  // 链接文本锚点：区别于 :270 prop 注释与 :780 重搜注释里的同词
  const LINK = '回到第 1 页\n          </Link>'

  it('「回到第 1 页」链接只出现一次，且排在 AI 找站/待找/相关分类之前', () => {
    const count = src.split(LINK).length - 1
    expect(count).toBe(1)
    const backPos = src.indexOf(LINK)
    expect(backPos).toBeLessThan(src.indexOf('{q ? <ZeroResultActions'))
    expect(backPos).toBeLessThan(src.indexOf('{q ? <WantedActions'))
    // 相关分类渲染块（锚定 JSX，不用裸词「相关分类」——U-187 注释本身就含该词）
    expect(backPos).toBeLessThan(src.indexOf('{inferredCategory ? ('))
  })

  it('链接仍保留 category/facets（U-143 不回归），且只在 page > 1 时渲染', () => {
    expect(src).toContain('searchHref({ q, tag, category, facets })')
    // 「回到第 1 页」所在的 JSX 块由 page > 1 守卫
    const block = src.slice(src.indexOf('U-187'), src.indexOf(LINK))
    expect(block).toContain('{page > 1 ? (')
  })
})

describe('U-191：结果行截断有全文出口（真渲染）', () => {
  /** 查询词用不命中的词：标题/描述不被 <mark> 切断，纯文本可直接断言。 */
  function rowHit(tags: string[]): HubSearchHit {
    return {
      siteId: 'site-long',
      score: 1,
      contributions: {},
      site: {
        id: 'site-long',
        title: '一个非常长的站点标题用于验证悬停全文出口',
        url: 'https://long.example.com',
        description: '一个非常长的站点描述用于验证悬停全文出口，超过两行会被截断。',
        tags,
        status: 'active',
      } as unknown as HubSite,
    }
  }

  it('长标题/长描述悬停可见全文（title 属性）', () => {
    const html = renderToStaticMarkup(createElement(ResultRow, { hit: rowHit([]), q: 'zzz' }))
    expect(html).toContain('title="一个非常长的站点标题用于验证悬停全文出口"')
    expect(html).toContain('title="一个非常长的站点描述用于验证悬停全文出口，超过两行会被截断。"')
  })

  it('标签超 4 个时补 +N 余数标记，只渲染前 4 个标签', () => {
    const html = renderToStaticMarkup(
      createElement(ResultRow, { hit: rowHit(['t1', 't2', 't3', 't4', 't5', 't6']), q: 'zzz' }),
    )
    expect(html).toContain('>+2</span>')
    expect(html).toContain('>t4</a>')
    expect(html).not.toContain('>t5</a>')
    expect(html).not.toContain('>t6</a>')
  })

  it('标签恰好 4 个时无余数标记', () => {
    const html = renderToStaticMarkup(
      createElement(ResultRow, { hit: rowHit(['t1', 't2', 't3', 't4']), q: 'zzz' }),
    )
    expect(html).not.toContain('>+')
  })

  it('插件分区：长插件名/长描述悬停可见全文（title 属性）', () => {
    const plugins = {
      items: [
        {
          id: 'p1',
          slug: 'long-plugin',
          kind: 'theme',
          name: '一个非常长的插件名称用于验证悬停全文出口',
          description: '一个非常长的插件描述用于验证悬停全文出口，超过两行会被截断。',
          version: '1.0.0',
          manifest: {},
        },
      ],
      total: 1,
      mode: 'keyword',
      degraded: false,
    } as unknown as HubPluginSearchResponse
    const html = renderToStaticMarkup(createElement(PluginSection, { plugins, q: 'zzz' }))
    expect(html).toContain('title="一个非常长的插件名称用于验证悬停全文出口"')
    expect(html).toContain('title="一个非常长的插件描述用于验证悬停全文出口，超过两行会被截断。"')
  })
})

describe('U-190：分面 Link 不再误挂 aria-pressed（链接不是开关）', () => {
  const src = overlaySource('src/components/search-facet-bar.tsx')

  it('分面选项 Link 无 aria-pressed，选中态改用 aria-current', () => {
    expect(src).not.toContain('aria-pressed')
    expect(src).toContain('aria-current={active ? true : undefined}')
  })
})

describe('A3：分类放宽态不再谎称「分类 X 下的站点」，横幅内可去掉分类', () => {
  const src = overlaySource('src/app/search/search-results.tsx')

  it('纯分类态 resultLabel：放宽时改写为全站口径，未放宽时仍点名分类', () => {
    expect(src).toContain("'全站结果（已放宽分类条件）'")
    expect(src).toContain('分类「${categoryName}」下的站点')
    // 放宽分支挂在纯分类分支内、与有词分支「已放宽筛选」同口径
    expect(src).toContain('“${q}” 的结果（已放宽筛选）')
  })

  it('横幅放宽时：category 有「去掉分类」链接，只去分类、保留 q/tag/facets', () => {
    expect(src).toContain('去掉分类')
    expect(src).toContain('href={searchHref({ q, tag, facets })}')
    expect(src).toContain('aria-label={`去掉分类「${categoryName}」筛选`}')
    // 只在 category 且放宽时出现，不与分类芯片的常驻「去掉筛选」混淆
    expect(src).toContain('{category && filterRelaxed ? (')
  })

  it('HubSearchResult 带可选 relaxedCategoryId，API 分支未合入前为 undefined', () => {
    const api = overlaySource('src/lib/navhub-api.ts')
    expect(api).toContain('relaxedCategoryId?: string')
  })
})
