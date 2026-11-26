/**
 * 热词冷启动回落（U-367）前端：文案诚实化。
 *
 * 锁：
 * 1. HotwordChips source="curated" 时标题标「热门推荐」，绝不冒充「大家都在搜」；
 *    缺省 / source="behavioral" 时仍是「大家都在搜」（旧行为不变）；
 * 2. 空数组时无论哪种来源都整块不渲染（目录也空时不编造）；
 * 3. 零结果页 popular 区同理：suggestionSource="curated" 时「热门推荐」，
 *    否则「大家在搜」；「换个词试试」本身不宣称来源，不改；
 * 4. page.tsx 把 /api/search/hotwords 的 source 透传给 SearchResults，
 *    SearchResults 把 result.suggestionSource 透传给 EmptyResults。
 *
 * 真渲染断言：react-dom/server 的 renderToStaticMarkup（search-hotwords.test.ts
 * 与 search-plugin-results.test.ts 同款先例；node 无 jsdom）。next/link 替成
 * 直通 <a>；ZeroResultActions / WantedActions 是客户端岛，替成标记桩。
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HotwordChips, SearchResults } from '../src/app/search/search-results'
import type { HubSearchResult } from '../src/lib/navhub-api'

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
      React.createElement('div', { 'data-testid': 'zero-result-actions' }, `让 AI 帮我找「${query}」`),
  }
})

vi.mock('@/components/search/wanted-actions', async () => {
  const React = await import('react')
  return {
    WantedActions: () =>
      React.createElement('div', { 'data-testid': 'wanted-actions' }, '存为待找', '新建收藏'),
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
const PAGE = 'src/app/search/page.tsx'

function zeroResult(over: Partial<HubSearchResult> = {}): HubSearchResult {
  return {
    hits: [],
    suggestions: ['考研', '写作'],
    popular: ['考研', '写作', '设计'],
    ...over,
  } as unknown as HubSearchResult
}

function renderSearch(props: Partial<Parameters<typeof SearchResults>[0]>): string {
  return renderToStaticMarkup(
    createElement(SearchResults, {
      q: 'zzprobe-nonexistent-word',
      page: 1,
      tag: null,
      result: zeroResult(),
      failed: false,
      unavailable: [],
      plugins: null,
      recommended: [],
      ...props,
    }),
  )
}

describe('HotwordChips：回落文案诚实化（U-367）', () => {
  it('source=curated 时标「热门推荐」，不出现「大家都在搜」', () => {
    const html = renderToStaticMarkup(createElement(HotwordChips, { hotwords: ['考研', '写作'], source: 'curated' }))
    expect(html).toContain('热门推荐')
    expect(html).not.toContain('大家都在搜')
    expect(html).toContain('href="/search?q=%E8%80%83%E7%A0%94"')
  })

  it('缺省 / source=behavioral 时仍是「大家都在搜」，不出现「热门推荐」', () => {
    const htmlDefault = renderToStaticMarkup(createElement(HotwordChips, { hotwords: ['考研'] }))
    expect(htmlDefault).toContain('大家都在搜')
    expect(htmlDefault).not.toContain('热门推荐')
    const htmlBehavioral = renderToStaticMarkup(createElement(HotwordChips, { hotwords: ['考研'], source: 'behavioral' }))
    expect(htmlBehavioral).toContain('大家都在搜')
    expect(htmlBehavioral).not.toContain('热门推荐')
  })

  it('空数组时 curated 也不渲染（目录也空时不编造）', () => {
    expect(renderToStaticMarkup(createElement(HotwordChips, { hotwords: [], source: 'curated' }))).toBe('')
  })
})

describe('空态与零结果页：回落文案随 source 切换', () => {
  it('空态（无 q）：hotwordSource=curated 时标「热门推荐」', () => {
    const html = renderSearch({
      q: '',
      result: null,
      hotwords: ['考研', '写作'],
      hotwordSource: 'curated',
    })
    expect(html).toContain('热门推荐')
    expect(html).not.toContain('大家都在搜')
    expect(html).toContain('输入关键词开始搜索')
  })

  it('空态（无 q）：缺省时仍是「大家都在搜」', () => {
    const html = renderSearch({ q: '', result: null, hotwords: ['考研'] })
    expect(html).toContain('大家都在搜')
    expect(html).not.toContain('热门推荐')
  })

  it('零结果：suggestionSource=curated 时 popular 区标「热门推荐」', () => {
    const html = renderSearch({ result: zeroResult({ suggestionSource: 'curated' }) })
    expect(html).toContain('热门推荐')
    expect(html).not.toContain('大家在搜')
    expect(html).toContain('换个词试试')
  })

  it('零结果：suggestionSource=behavioral / 缺省时 popular 区仍是「大家在搜」', () => {
    const htmlBehavioral = renderSearch({ result: zeroResult({ suggestionSource: 'behavioral' }) })
    expect(htmlBehavioral).toContain('大家在搜')
    expect(htmlBehavioral).not.toContain('热门推荐')
    const htmlDefault = renderSearch({ result: zeroResult() })
    expect(htmlDefault).toContain('大家在搜')
    expect(htmlDefault).not.toContain('热门推荐')
  })
})

describe('回落 source 接线：page.tsx → SearchResults → EmptyResults', () => {
  it('page.tsx 取 hotwords 时带 source，并透传 hotwordSource', () => {
    const src = overlaySource(PAGE)
    expect(src).toContain("hubGet<{ hotwords?: string[]; source?: 'behavioral' | 'curated' }>('/api/search/hotwords', 60)")
    expect(src).toContain("hotwordSource={hotwordsData?.source ?? 'behavioral'}")
  })

  it('SearchResults 把 result.suggestionSource 透传给 EmptyResults', () => {
    const src = overlaySource(RESULTS)
    expect(src).toContain('suggestionSource={suggestionSource}')
    expect(src).toContain("const suggestionSource = result?.suggestionSource ?? 'behavioral'")
    expect(src).toContain('<HotwordChips hotwords={hotwords} source={hotwordSource} />')
  })
})
