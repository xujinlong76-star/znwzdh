/**
 * U-112：翻页 / 重试 / 重搜不丢分类与分面。
 *
 * 源码断言模式仿 U-143（test/search-zero-result-rescue.test.ts:269-293），
 * 用 overlaySource 读 search-results.tsx 断言。
 * 用例口径：q=笔记，category=ai-tools，f_pricing=free。
 *
 * 锁死的口径：
 * - Pagination / FailedNotice 的三处链接与重试链接必须显式透传 category 与 facets；
 * - 重搜表单的 category hidden 只在 category 非空时渲染，不补 page（重搜回第 1 页）；
 * - 分面 hidden 必须逐值一个 input（name=`f_${key}`、value=单值），禁止逗号 join
 *   一个 input：join 串仍能过 URL 形参检查，但值一旦含非法字符会被
 *   normalizeSearchFacets 静默丢掉，逐值是唯一可审计的写法。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeSearchFacets, searchHref } from '../src/lib/search-page'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

describe('U-112：翻页/重试/重搜不丢分类/分面', () => {
  const results = overlaySource('src/app/search/search-results.tsx')
  const formStart = results.indexOf('<form action="/search"')
  const form = results.slice(formStart, results.indexOf('</form>', formStart))

  it('Pagination 签名含 category 与 facets（可选，与 FailedNotice 同口径）', () => {
    const start = results.indexOf('function Pagination({')
    expect(start, 'search-results.tsx 缺少 function Pagination').toBeGreaterThan(-1)
    const sig = results.slice(start, results.indexOf('}) {', start))
    expect(sig).toContain('category,')
    expect(sig).toContain('facets,')
    expect(sig).toContain('category?: string | null')
    expect(sig).toContain('facets?: Record<string, string[]>')
  })

  it('FailedNotice 签名含 category 与 facets', () => {
    const start = results.indexOf('function FailedNotice({')
    expect(start, 'search-results.tsx 缺少 function FailedNotice').toBeGreaterThan(-1)
    const sig = results.slice(start, results.indexOf('}) {', start))
    // 单行签名：解构尾项 facets 后无逗号，断言 "category, facets" 整体
    expect(sig).toContain('category, facets')
    expect(sig).toContain('category?: string | null')
    expect(sig).toContain('facets?: Record<string, string[]>')
  })

  it('Pagination 三链接（上一页/页码/下一页）均显式透传 category 与 facets', () => {
    expect(results).toContain('searchHref({ q, page: page - 1, tag, category, facets })')
    expect(results).toContain('searchHref({ q, page: n, tag, category, facets })')
    expect(results).toContain('searchHref({ q, page: page + 1, tag, category, facets })')
    // 旧的丢 scope 写法必须消失，不能只在新链接旁残留
    expect(results).not.toContain('searchHref({ q, page: page - 1, tag })')
    expect(results).not.toContain('searchHref({ q, page: n, tag })')
    expect(results).not.toContain('searchHref({ q, page: page + 1, tag })')
  })

  it('FailedNotice 重试链接显式透传 category 与 facets', () => {
    const label = results.indexOf('重试\n')
    expect(label, 'search-results.tsx 缺少「重试」链接').toBeGreaterThan(-1)
    const link = results.slice(Math.max(0, label - 300), label)
    expect(link).toContain('searchHref({ q, page, tag, category, facets })')
    expect(results).not.toContain('searchHref({ q, page, tag })')
  })

  it('Pagination 调用处传入当前 category 与 facets（tag 仍走 tagApplied 口径）', () => {
    const start = results.indexOf('<Pagination')
    expect(start, 'search-results.tsx 缺少 <Pagination 调用').toBeGreaterThan(-1)
    const call = results.slice(start, results.indexOf('/>', start))
    expect(call).toContain('category={category}')
    expect(call).toContain('facets={facets}')
    expect(call).toContain('tag={tagApplied ? tag : null}')
  })

  it('FailedNotice 调用处传入当前 category 与 facets', () => {
    const start = results.indexOf('<FailedNotice')
    expect(start, 'search-results.tsx 缺少 <FailedNotice 调用').toBeGreaterThan(-1)
    const call = results.slice(start, results.indexOf('/>', start))
    expect(call).toContain('category={category}')
    expect(call).toContain('facets={facets}')
  })

  it('重搜表单：category 非空才渲染一个 hidden input，不补 page', () => {
    expect(formStart, 'search-results.tsx 缺少重搜表单').toBeGreaterThan(-1)
    expect(form).toContain(
      '{category ? <input type="hidden" name="category" value={category} aria-hidden="true" /> : null}',
    )
    // 重搜回到第 1 页：表单里不许出现 page hidden
    expect(form).not.toContain('name="page"')
  })

  it('重搜表单：分面逐值一个 hidden input，name 与值口径锁死', () => {
    // 逐值：每个 f_<key> 的每个值各一个 input，禁止逗号 join 一个 input
    expect(form).toContain('{Object.entries(facets).flatMap(([key, values]) =>')
    expect(form).toContain('values.map((value) => (')
    expect(form).toContain('name={`f_${key}`}')
    expect(form).toContain('value={value}')
    expect(form).toContain('key={`f_${key}-${value}`}')
    expect(form, '分面 hidden 不许用逗号 join：值会被 normalizeSearchFacets 静默丢掉').not.toContain('.join(')
  })

  it('无 category/facets 时不渲染空 hidden', () => {
    // category hidden 全文件只出现一次，且就是上面那句条件渲染
    expect(results.split('name="category"').length - 1).toBe(1)
    expect(results).toContain(
      '{category ? <input type="hidden" name="category" value={category} aria-hidden="true" /> : null}',
    )
    // 分面 hidden 由 Object.entries(facets) 驱动：facets 为 {} 时零输出；
    // SearchResults 给 facets 兜底 {}，Object.entries 永不抛
    expect(results).toContain('facets = {},')
    expect(form).toContain('{Object.entries(facets).flatMap(([key, values]) =>')
  })

  it('口径锁死：f_pricing=free 解析回 pricing=free，翻页 URL 原样带回', () => {
    expect(normalizeSearchFacets({ f_pricing: 'free' })).toEqual({ pricing: ['free'] })
    expect(
      searchHref({ q: '笔记', page: 2, category: 'ai-tools', facets: { pricing: ['free'] } }),
    ).toBe('/search?q=%E7%AC%94%E8%AE%B0&category=ai-tools&f_pricing=free&page=2')
    // 第 1 页省略 page，但 scope 参数仍在
    expect(searchHref({ q: '笔记', category: 'ai-tools', facets: { pricing: ['free'] } })).toBe(
      '/search?q=%E7%AC%94%E8%AE%B0&category=ai-tools&f_pricing=free',
    )
    // 无筛选回归：不出现空 category / f_ 参数
    expect(searchHref({ q: '笔记', page: 2 })).toBe('/search?q=%E7%AC%94%E8%AE%B0&page=2')
  })
})

describe('U-112 残留：横幅/零结果/相关标签/结果行 chip 不丢分类与分面', () => {
  const results = overlaySource('src/app/search/search-results.tsx')
  const cat = 'ai-tools'
  const facets = { pricing: ['free'] }

  it('纠正横幅「已替你纠正为」：纠正后词保留 category/facets，tag 仍走 tagApplied 口径', () => {
    expect(results).toContain(
      'searchHref({ q: correction.corrected, tag: tagApplied ? tag : null, category, facets })',
    )
    expect(results).not.toContain(
      'searchHref({ q: correction.corrected, tag: tagApplied ? tag : null })',
    )
    const href = searchHref({ q: '笔记工具', tag: 'ai', category: cat, facets })
    expect(href).toContain('category=ai-tools')
    expect(href).toContain('f_pricing=free')
    expect(href).toContain('tag=ai')
  })

  it('纠正横幅回退「搜原来的」：保留 category/facets 与 nocorrect=1', () => {
    expect(results).toContain(
      'searchHref({ q: correction.original, tag: tagApplied ? tag : null, category, facets, nocorrect: true })',
    )
    const href = searchHref({ q: '笔记工俱', tag: 'ai', category: cat, facets, nocorrect: true })
    expect(href).toContain('category=ai-tools')
    expect(href).toContain('f_pricing=free')
    expect(href).toContain('nocorrect=1')
  })

  it('纠正横幅 didYouMean：保留 category/facets，tag 仍走 tagApplied 口径', () => {
    expect(results).toContain(
      'searchHref({ q: didYouMean, tag: tagApplied ? tag : null, category, facets })',
    )
    expect(results).not.toContain('searchHref({ q: didYouMean, tag: tagApplied ? tag : null })')
  })

  it('零结果「去掉标签筛选」：只丢 tag，保留 category/facets', () => {
    const label = results.indexOf('去掉标签筛选')
    expect(label, 'search-results.tsx 缺少「去掉标签筛选」链接').toBeGreaterThan(-1)
    const link = results.slice(Math.max(0, label - 300), label)
    expect(link).toContain('searchHref({ q, category, facets })')
    expect(results).not.toContain('searchHref({ q })')
    // URL 口径：不传 tag 时 tag 参数消失，category 与 f_* 仍在
    const href = searchHref({ q: '笔记', category: cat, facets })
    expect(href).toBe('/search?q=%E7%AC%94%E8%AE%B0&category=ai-tools&f_pricing=free')
    expect(href).not.toContain('tag=')
  })

  it('零结果「换个词试试」：新词保留 category/facets（!tag 守卫下本无 tag 可丢）', () => {
    const label = results.indexOf('换个词试试</p>')
    expect(label, 'search-results.tsx 缺少「换个词试试」').toBeGreaterThan(-1)
    const block = results.slice(label, label + 800)
    expect(block).toContain('searchHref({ q: item, category, facets })')
    const href = searchHref({ q: '备忘录', category: cat, facets })
    expect(href).toContain('category=ai-tools')
    expect(href).toContain('f_pricing=free')
  })

  it('零结果「大家在搜」：透传 tag 保留热门词入口，不加 !tag 守卫', () => {
    const label = results.indexOf('大家在搜</p>')
    expect(label, 'search-results.tsx 缺少「大家在搜」').toBeGreaterThan(-1)
    const block = results.slice(label, label + 800)
    expect(block).toContain('searchHref({ q: item, tag, category, facets })')
    // 裁决：不加 !tag 守卫——守卫会整段隐藏热门词、丢掉发现入口；
    // EmptyResults 的 tag 已是 tagApplied 口径（调用处传 tagApplied ? tag : null），
    // 透传 tag 既保作用域又保入口。
    expect(results).toContain('{!hideGenericRecommendations && popular.length > 0 ? (')
    // URL 口径：带 tag 点热门词，tag/category/f_* 全保留
    const href = searchHref({ q: '备忘录', tag: 'ai', category: cat, facets })
    expect(href).toContain('tag=ai')
    expect(href).toContain('category=ai-tools')
    expect(href).toContain('f_pricing=free')
  })

  it('相关标签 SearchRelatedTags：签名与调用处接 category/facets，换 tag 保留作用域', () => {
    const start = results.indexOf('function SearchRelatedTags({')
    expect(start, 'search-results.tsx 缺少 function SearchRelatedTags').toBeGreaterThan(-1)
    const sig = results.slice(start, results.indexOf('}) {', start))
    expect(sig).toContain('category = null,')
    expect(sig).toContain('facets = {},')
    expect(sig).toContain('category?: string | null')
    expect(sig).toContain('facets?: Record<string, string[]>')
    expect(results).toContain('searchHref({ q: q || undefined, tag: t.slug, category, facets })')
    const call = results.indexOf('<SearchRelatedTags')
    expect(call, 'search-results.tsx 缺少 <SearchRelatedTags 调用').toBeGreaterThan(-1)
    const callText = results.slice(call, results.indexOf('/>', call))
    expect(callText).toContain('category={category}')
    expect(callText).toContain('facets={facets}')
    const href = searchHref({ q: '笔记', tag: 'opensource', category: cat, facets })
    expect(href).toContain('tag=opensource')
    expect(href).toContain('category=ai-tools')
    expect(href).toContain('f_pricing=free')
  })

  it('结果行标签 chip：只丢 q（既有注释在案的有意行为），保留 category/facets', () => {
    // 裁决依据：U-112「透传」口径——站内导航不得静默丢掉用户已设的作用域；
    // q 的丢弃是有意行为（「按这个标签浏览」比「在本次查询里再收窄」更符合预期）。
    const start = results.indexOf('export function ResultRow({')
    expect(start, 'search-results.tsx 缺少 export function ResultRow').toBeGreaterThan(-1)
    const sig = results.slice(start, results.indexOf('}) {', start))
    expect(sig).toContain('category?: string | null')
    expect(sig).toContain('facets?: Record<string, string[]>')
    expect(results).toContain('href={searchHref({ tag, category, facets })}')
    expect(results).not.toContain('href={searchHref({ tag })}')
    // 三处调用点（正常结果 / 巡检打不开分区 / 零结果今日热榜）均透传作用域
    expect(results).toContain('<ResultRow key={hit.siteId} hit={hit} q={q} category={category} facets={facets} externalRel={externalRel} />')
    expect(results).toContain('<UnavailableSection hits={unavailable} q={q} category={category} facets={facets} />')
    // URL 口径：只带 tag+scope 时无 q 参数，category 与 f_* 仍在
    const href = searchHref({ tag: 'ai', category: cat, facets })
    expect(href).toBe('/search?tag=ai&category=ai-tools&f_pricing=free')
    expect(href).not.toContain('q=')
  })
})
