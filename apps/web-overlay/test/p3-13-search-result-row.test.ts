/**
 * P3-13 / U-37③：/search 结果行主次倒置修正。
 *
 * 原来：结果行标题本身是站外链接（target=_blank），站内「详情」反是
 * 26px 小按钮。现在：标题改为站内详情链（/site/:id），站外链接降为
 * 次级「直达」。
 *
 * 真渲染断言：用 react-dom/server 的 renderToStaticMarkup 直接渲染
 * ResultRow（search-plugin-results.test.ts 同款先例；node 无 jsdom）。
 * next/link 替成直通 <a>；SiteFavicon / AlgorithmHudBadge 替成桩，
 * 只测 ResultRow 自己的主次结构。
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResultRow } from '../src/app/search/search-results'
import type { HubSearchHit, HubSite } from '../src/lib/navhub-api'

// mock 卫生兜底：本文件有跨模块 vi.mock，isolate:false 下同 worker 的
// 后续文件会看到留下的 mock，这里统一清掉（drama-due-badge.test.ts 同款）。
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

function siteHit(url: string): HubSearchHit {
  return {
    siteId: 'site-foo',
    score: 1,
    contributions: {},
    site: {
      id: 'site-foo',
      title: 'Foo Site',
      url,
      description: 'Foo Site 的描述',
      tags: [],
      status: 'active',
    } as unknown as HubSite,
  }
}

/** 查询词用不命中的词：标题不被 <mark> 切断，纯文本可直接断言。 */
function renderRow(url: string): string {
  return renderToStaticMarkup(createElement(ResultRow, { hit: siteHit(url), q: 'zzz' }))
}

describe('P3-13：结果行标题是站内详情，站外链接是次级「直达」', () => {
  it('标题链进站内详情 /site/:id，标题文本在该链内', () => {
    const html = renderRow('https://foo.example.com')
    expect(html).toContain('href="/site/site-foo"')
    expect(html).toContain('>Foo Site</a>')
  })

  it('站外链接是次级「直达」（target=_blank），且排在标题链之后', () => {
    const html = renderRow('https://foo.example.com')
    expect(html).toContain('href="https://foo.example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('直达')
    expect(html.indexOf('href="/site/site-foo"')).toBeLessThan(
      html.indexOf('href="https://foo.example.com"'),
    )
  })

  it('不再有 26px 小「详情」按钮', () => {
    const html = renderRow('https://foo.example.com')
    expect(html).not.toContain('详情')
  })

  it('站外地址不可用时不渲染「直达」，标题仍链进站内详情', () => {
    const html = renderRow('not-a-url')
    expect(html).toContain('href="/site/site-foo"')
    expect(html).toContain('>Foo Site</a>')
    expect(html).not.toContain('直达')
    expect(html).not.toContain('target="_blank"')
  })
})
