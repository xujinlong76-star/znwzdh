import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { categoryDisplayName, type HubCategory } from '../src/lib/server/categories'

/**
 * 分类 hub 的结构锁（2026-10-21，2026-10-22 补 slug 路由）。
 *
 * 分类页最容易悄悄退化的五件事：
 * 1. 又变回客户端取数（标题链接不进 SSR HTML，孤岛问题复发）；
 * 2. 薄分类（<5 站）不再 404，变成批量 noindex 空页；
 * 3. 页 ≥2 的 canonical 回指第 1 页（后续页站点永远不被单独收录）；
 * 4. sitemap 把未达标分类也提交（等于主动送死链）；
 * 5. URL 退回 uuid 形态，或把 `/category/{uuid}` 的老外链直接判 404。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const ROUTE = 'src/app/category/[slug]/page.tsx'

describe('分类页结构', () => {
  it('详情页是服务端页面：安全解码 + 真 404 + SSR 站点内链', () => {
    const src = overlayFile(ROUTE)
    expect(src).not.toContain("'use client'")
    expect(src).toContain('safeDecodeParam')
    expect(src).toContain('notFound()')
    expect(src).toContain('/site/${encodeURIComponent(site.id)}')
  })

  it('URL 标识是 slug，老 uuid 链接 301 而不是 404', () => {
    const src = overlayFile(ROUTE)
    expect(src).toContain('params: Promise<{ slug: string }>')
    expect(src).toContain('categoryUrlKey(category)')
    expect(src).toContain('isCategoryUuidRef(safeRef)')
    expect(src).toMatch(/permanentRedirect\(categoryHref\(urlKey, requested\)\)/)
  })

  it('构建期只预渲染「有 slug、未停用、达标、非未分类」的类目', () => {
    const src = overlayFile(ROUTE)
    expect(src).toContain('export async function generateStaticParams()')
    expect(src).toMatch(/Boolean\(c\.slug\)/)
    expect(src).toMatch(/!isHiddenCategory\(c\)/)
    expect(src).toMatch(/\(counts\.get\(c\.id\) \?\? 0\) >= MIN_SITES_FOR_INDEX/)
  })

  it('薄分类 404，而不是生成 noindex 空页', () => {
    const src = overlayFile(ROUTE)
    expect(src).toContain('MIN_SITES_FOR_INDEX')
    expect(src).toMatch(/sites\.length\s*>=\s*MIN_SITES_FOR_INDEX\s*\|\|\s*Boolean\(res\?\.hasMore\)/)
  })

  it('页 ≥2 自指 canonical + noindex,follow；页 1 输出 ItemList', () => {
    const src = overlayFile(ROUTE)
    expect(src).toContain('canonical')
    expect(src).toContain("robots: { index: false, follow: true }")
    expect(src).toContain('itemListLd')
    expect(src).toMatch(/indexable\s*=\s*requested\s*===\s*1/)
  })

  it('分页查询只取 active 站点，避免 broken 占 offset 名额导致漏站/误判', () => {
    const src = overlayFile('src/lib/server/categories.ts')
    expect(src).toContain('/api/search?q=&status=active&categoryId=')
  })

  it('分类总览只链接达标分类，且不把「未分类」当入口', () => {
    const src = overlayFile('src/app/category/page.tsx')
    expect(src).toContain('MIN_SITES_FOR_INDEX')
    expect(src).toMatch(/count\s*<\s*MIN_SITES_FOR_INDEX/)
    expect(src).toContain('isHiddenCategory(category)')
    expect(src).toContain("alternates: { canonical: '/category' }")
  })

  it('sitemap 接入达标分类条目', () => {
    const src = overlayFile('src/app/sitemap.ts')
    expect(src).toContain('categoryEntries')
    expect(src).toContain('countCategorySites')
    expect(src).toContain('/api/categories')
  })
})

describe('categoryDisplayName', () => {
  const cats: HubCategory[] = [
    { id: 'a', title: '语言', parentId: 'p1' },
    { id: 'b', title: '语言', parentId: 'p2' },
    { id: 'p1', title: '编程' },
    { id: 'p2', title: '自然语言' },
    { id: 'c', title: '设计' },
  ]

  it('同名分类用「父 · 子」消歧', () => {
    expect(categoryDisplayName(cats[0]!, cats)).toBe('编程 · 语言')
    expect(categoryDisplayName(cats[1]!, cats)).toBe('自然语言 · 语言')
  })

  it('不同名分类保持原样', () => {
    expect(categoryDisplayName(cats[4]!, cats)).toBe('设计')
  })
})
