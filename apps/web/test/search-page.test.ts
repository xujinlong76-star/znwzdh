/**
 * /search 结果页：URL 状态、服务端取数与入口接线。
 *
 * 这一页补的是真实缺陷——搜索此前只有客户端浮层，结果不可分享、不可回退；
 * /me/history 的「再次搜索」链到 `/?q=`，而没有任何页面消费这个参数。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  SEARCH_MAX_OFFSET,
  SEARCH_PAGE_SIZE,
  SEARCH_QUERY_MAX_LENGTH,
  normalizeSearchPage,
  normalizeSearchQuery,
  searchApiPath,
  searchHref,
  searchMaxPage,
  searchPageWindow,
} from '../src/lib/search-page'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位并读取 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

function repoFile(rel: string): string {
  // apps/web/test 与 apps/web-overlay/test 都是仓库根往下三层
  return readFileSync(resolve(HERE, '..', '..', '..', rel), 'utf8')
}

describe('/search 的 URL 状态', () => {
  it('查询词去控制字符、折叠空白并截断到中枢上限', () => {
    expect(normalizeSearchQuery('  ai\u0000   工具  ')).toBe('ai 工具')
    expect(normalizeSearchQuery('x'.repeat(SEARCH_QUERY_MAX_LENGTH + 50))).toHaveLength(SEARCH_QUERY_MAX_LENGTH)
    // Next 对重复 query 传数组形态：取第一个，而不是渲染成 "a,b"
    expect(normalizeSearchQuery(['react', 'vue'])).toBe('react')
    expect(normalizeSearchQuery(undefined)).toBe('')
  })

  it('页码夹在 [1, 中枢 offset 上限] 之间', () => {
    expect(normalizeSearchPage(undefined)).toBe(1)
    expect(normalizeSearchPage('0')).toBe(1)
    expect(normalizeSearchPage('-3')).toBe(1)
    expect(normalizeSearchPage('abc')).toBe(1)
    expect(normalizeSearchPage('2')).toBe(2)
    expect(normalizeSearchPage('9999')).toBe(searchMaxPage())
    expect(searchMaxPage()).toBe(Math.floor(SEARCH_MAX_OFFSET / SEARCH_PAGE_SIZE) + 1)
  })

  it('可分享的 URL：第 1 页省略 page，查询词按 URL 编码', () => {
    expect(searchHref({ q: 'AI 工具' })).toBe('/search?q=AI+%E5%B7%A5%E5%85%B7')
    expect(searchHref({ q: 'AI 工具', page: 1 })).toBe('/search?q=AI+%E5%B7%A5%E5%85%B7')
    expect(searchHref({ q: 'AI 工具', page: 3 })).toBe('/search?q=AI+%E5%B7%A5%E5%85%B7&page=3')
    expect(searchHref({ q: 'react', page: 9999 })).toBe(`/search?q=react&page=${searchMaxPage()}`)
    expect(searchHref()).toBe('/search')
    expect(searchHref({ q: '   ' })).toBe('/search')
  })

  it('中枢取数路径：status=active 且 offset 由页码推出', () => {
    const params = new URLSearchParams(searchApiPath('react', 3).split('?')[1])
    expect(params.get('q')).toBe('react')
    expect(params.get('status')).toBe('active')
    expect(params.get('limit')).toBe(String(SEARCH_PAGE_SIZE))
    expect(params.get('offset')).toBe(String(2 * SEARCH_PAGE_SIZE))
  })

  it('offset 上限与中枢 zod 契约同值（改一处必须改另一处）', () => {
    const api = repoFile('apps/api/src/routes/search.ts')
    expect(api).toContain(`offset: z.coerce.number().int().min(0).max(${SEARCH_MAX_OFFSET})`)
  })

  it('查询词上限与 core 常量同值（web 不依赖 core，只能同构一份）', () => {
    const core = repoFile('packages/core/src/search-limits.ts')
    expect(core).toContain(`MAX_SEARCH_QUERY_LENGTH = ${SEARCH_QUERY_MAX_LENGTH}`)
  })

  it('页码窗口不发明没验证过的页：hasMore 时最多多看一格', () => {
    expect(searchPageWindow(1, true)).toEqual([1, 2])
    expect(searchPageWindow(10, true)).toEqual([7, 8, 9, 10, 11])
    expect(searchPageWindow(10, false)).toEqual([6, 7, 8, 9, 10])
    expect(searchPageWindow(1, false)).toEqual([1])
  })
})

describe('/search 页面契约', () => {
  it('声明 noindex,follow，并带自己的标题与描述（route-titles 的口径）', () => {
    const src = overlaySource('src/app/search/page.tsx')
    expect(src).toContain('robots: { index: false, follow: true }')
    // 显式 `title:` / `description:`：route-titles.test.ts 靠这个识别标题来源
    expect(src).toMatch(/title:\s*title/)
    expect(src).toMatch(/description:\s*description/)
  })

  it('服务端直出：hubGet 走 /api/search 契约，视图不是客户端组件', () => {
    expect(overlaySource('src/lib/server/search.ts')).toContain('hubGet<HubSearchResult>(searchApiPath(')
    const view = overlaySource('src/app/search/search-results.tsx')
    expect(view).not.toContain("'use client'")
    expect(view).toContain('href={`/site/${encodeURIComponent(site.id)}`}')
  })

  it('整页只剩语义近似命中时如实标注（语义 KNN 对乱码也给最近邻）', () => {
    const view = overlaySource('src/app/search/search-results.tsx')
    expect(view).toContain('semanticOnly')
    expect(view).toContain('均为语义近似，无关键词命中')
  })

  it('/me/history 的「再次搜索」指向真实存在的 /search，而不是无人消费的 /?q=', () => {
    const src = overlaySource('src/app/me/history/page.tsx')
    expect(src).not.toContain('/?q=')
    expect(src).toContain('/search?q=')
  })

  it('两个搜索入口都提供通往结果页的链接', () => {
    for (const rel of ['src/components/search-palette.tsx', 'src/components/search/spotlight-modal.tsx']) {
      const src = overlaySource(rel)
      expect(src, rel).toContain('searchHref({ q: query })')
      expect(src, rel).toContain('查看全部')
    }
  })
})
