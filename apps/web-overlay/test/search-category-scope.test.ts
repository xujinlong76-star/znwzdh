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
    expect(src).toContain('{tagApplied || category ? (')
  })

  it('分类清除链接只去 category、保留 q/tag/facets，且带 aria-label 区分读屏', () => {
    expect(src).toContain('searchHref({ q, tag, facets })')
    expect(src).toContain('aria-label={`去掉分类「${categoryName}」筛选`}')
  })

  it('标签清除链接与放宽横幅清除链接只去 tag、保留 category/facets', () => {
    expect(src).toContain('searchHref({ q, category, facets })')
    // 两处（标签芯片、放宽横幅）都只清 tag，不再顺带清分类/分面
    const count = src.split('searchHref({ q, category, facets })').length - 1
    expect(count).toBe(2)
    // 注意：EmptyResults :349「去掉标签筛选」仍用 searchHref({ q })，
    // 按任务书留给 U-112 追补轮，本轮不动，故这里不断言全文件清零。
  })
})
