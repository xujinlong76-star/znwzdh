/**
 * 搜索框热词点选直达（W4-0622-1 收尾③）。
 *
 * 锁：
 * 1. 空态热词 chips 由 HotwordChips 渲染：每枚 chip 都是指向
 *    `/search?q=<词>` 的普通 <a>（searchHref 编码），点选即直达该词的站内搜索；
 * 2. 无 JS 照常：HotwordChips 是纯服务端组件（search-results.tsx 无 'use client'），
 *    chips 不依赖任何客户端状态或脚本；
 * 3. 空数组不渲染（取数失败时整块消失，不谎称「没有热词」）；
 * 4. page.tsx 只在无筛选时取一次 /api/search/hotwords（60s 缓存），并把结果
 *    传给 SearchResults；有筛选的页不取、不渲染空态。
 *
 * 真渲染断言：用 react-dom/server 的 renderToStaticMarkup 直接渲染
 * HotwordChips（p3-13-search-result-row.test.ts 同款先例；node 无 jsdom）。
 * next/link 替成直通 <a>，只测 chips 自己的结构。
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HotwordChips } from '../src/app/search/search-results'

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

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

const RESULTS = 'src/app/search/search-results.tsx'
const PAGE = 'src/app/search/page.tsx'

describe('HotwordChips：热词点选直达', () => {
  it('每枚 chip 都是指向 /search?q=<词> 的链接，词文本在链内', () => {
    const html = renderToStaticMarkup(createElement(HotwordChips, { hotwords: ['考研', '短剧'] }))
    expect(html).toContain('href="/search?q=%E8%80%83%E7%A0%94"')
    expect(html).toContain('>考研</a>')
    expect(html).toContain('href="/search?q=%E7%9F%AD%E5%89%A7"')
    expect(html).toContain('>短剧</a>')
    expect(html).toContain('大家都在搜')
  })

  it('空数组不渲染（取数失败时整块消失）', () => {
    expect(renderToStaticMarkup(createElement(HotwordChips, { hotwords: [] }))).toBe('')
  })

  it('chip 经 searchHref 构造，不手写 /search?q= 拼接', () => {
    const src = overlaySource(RESULTS)
    expect(src).toContain('href={searchHref({ q: item })}')
    expect(src).not.toContain('`/search?q=${')
  })
})

describe('热词接线：page.tsx 取数、SearchResults 空态挂载', () => {
  it('page.tsx 只在无筛选时取一次 /api/search/hotwords，并传给 SearchResults', () => {
    const src = overlaySource(PAGE)
    expect(src).toContain("hubGet<{ hotwords?: string[]; source?: 'behavioral' | 'curated' }>('/api/search/hotwords', 60)")
    expect(src).toContain('hotwords={hotwordsData?.hotwords ?? []}')
    // U-367：source 随 hotwords 一起透传，SearchResults 据此切换「大家都在搜 / 热门推荐」
    expect(src).toContain("hotwordSource={hotwordsData?.source ?? 'behavioral'}")
  })

  it('SearchResults 空态（无 q/tag/category/facets）挂载 HotwordChips', () => {
    const src = overlaySource(RESULTS)
    expect(src).toContain('<HotwordChips hotwords={hotwords} source={hotwordSource} />')
    // 挂载点在空态 section 内：空态门之后、浏览入口 nav 之前
    const gateAt = src.indexOf("q === '' && !tag && !category")
    const mountAt = src.indexOf('<HotwordChips hotwords={hotwords} source={hotwordSource} />')
    const navAt = src.indexOf('aria-label="浏览入口"', gateAt)
    expect(gateAt).toBeGreaterThan(-1)
    expect(mountAt).toBeGreaterThan(gateAt)
    expect(mountAt).toBeLessThan(navAt)
  })

  it('HotwordChips 是纯服务端组件：search-results.tsx 无 use client，chips 不用客户端岛', () => {
    const src = overlaySource(RESULTS)
    expect(src).not.toContain("'use client'")
    expect(src).not.toContain('"use client"')
  })
})
