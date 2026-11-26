/**
 * A3：命令面板浮层同款缺口——分类放宽提示点名被丢的分类 + 可去掉分类。
 *
 * 与搜索页（2222 轮）同款字段与文案逻辑，浮层复用不另起一套：
 * - `HubSearchResult.relaxedCategoryId`（API 分支未合入前恒 undefined，守卫后零行为变化）
 * - `relaxedCategoryNotice(relaxedCategoryId, categoryName)` 文案
 * 浮层是客户端组件、拿不到服务端的 categoryName prop，所以分类名改由
 * `resolveCategoryDisplayName` 本地解析（fetchCategories 拉类目表，只在真的
 * 放宽了分类时才拉）；解析不到退回通用句，原始 id/slug 绝不进文案。
 *
 * 「去掉分类」在浮层内无 URL 可跳：点下即把 categoryId 从后续搜索里摘掉
 * （categoryDropped），只去分类、保留 q/tag/facets，与搜索页导航到无分类
 * URL 同义；分类作用域 prop 变化时复位。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { relaxedCategoryNotice, resolveCategoryDisplayName } from '@/lib/search-page'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

const CATEGORIES = [
  { id: 'dev-tools', title: '开发工具', slug: 'dev-tools', parentId: null },
  { id: 'lang', title: '语言', slug: 'lang', parentId: 'dev-tools' },
  { id: 'os-lang', title: '语言', slug: 'os-lang', parentId: 'os' },
  { id: 'os', title: '操作系统', slug: 'os', parentId: null },
]

describe('A3：浮层复用 relaxedCategoryNotice（与搜索页同款文案）', () => {
  it('字段 undefined 时返回 null，浮层走原有通用文案、零行为变化', () => {
    expect(relaxedCategoryNotice(undefined, '开发工具')).toBeNull()
    expect(relaxedCategoryNotice(undefined, null)).toBeNull()
  })

  it('有值时点名分类展示名，说明结果已混入其他分类', () => {
    expect(relaxedCategoryNotice('dev-tools', '开发工具')).toBe(
      '分类「开发工具」下暂无匹配，已放宽分类条件显示全站结果；下面的站点可能来自其他分类。',
    )
  })
})

describe('resolveCategoryDisplayName：被放宽的分类 id/slug → 中文展示名', () => {
  it('按 id 命中返回 title，不返回原始 id', () => {
    expect(resolveCategoryDisplayName('dev-tools', CATEGORIES)).toBe('开发工具')
  })

  it('按 slug 命中返回 title', () => {
    expect(resolveCategoryDisplayName('os', CATEGORIES)).toBe('操作系统')
  })

  it('同名标题用「父 · 子」消歧（与服务端 categoryDisplayName 同口径）', () => {
    expect(resolveCategoryDisplayName('lang', CATEGORIES)).toBe('开发工具 · 语言')
    expect(resolveCategoryDisplayName('os-lang', CATEGORIES)).toBe('操作系统 · 语言')
  })

  it('未命中 / 类目表取不到 / 入参为空时返回 null，不把原始 id/slug 漏出去', () => {
    expect(resolveCategoryDisplayName('no-such-cat', CATEGORIES)).toBeNull()
    expect(resolveCategoryDisplayName('dev-tools', null)).toBeNull()
    expect(resolveCategoryDisplayName('dev-tools', [])).toBeNull()
    expect(resolveCategoryDisplayName('', CATEGORIES)).toBeNull()
    expect(resolveCategoryDisplayName(null, CATEGORIES)).toBeNull()
  })
})

describe('A3：浮层横幅点名被丢的分类 + 可去掉分类（源码守卫）', () => {
  const src = overlaySource('src/components/search-palette.tsx')

  it('浮层接 relaxedCategoryId：新查询清旧值、响应里取新值', () => {
    expect(src).toContain('setRelaxedCategoryId(undefined)')
    expect(src).toContain('setRelaxedCategoryId(res.relaxedCategoryId)')
  })

  it('横幅级联：pricing 之后、通用句之前插入分类提示（与搜索页同级联）', () => {
    expect(src).toContain('relaxedCategoryNotice(relaxedCategoryId, relaxedCategoryName)')
    const pricingAt = src.indexOf('relaxedPricingNotice(relaxedFacets)')
    const categoryAt = src.indexOf('relaxedCategoryNotice(relaxedCategoryId, relaxedCategoryName)')
    const genericAt = src.indexOf('当前筛选下没有结果，已放宽到全库匹配')
    expect(pricingAt).toBeGreaterThan(-1)
    expect(categoryAt).toBeGreaterThan(pricingAt)
    expect(genericAt).toBeGreaterThan(categoryAt)
  })

  it('分类名只在真的放宽时才解析：fetchCategories 懒取，未命中退回 null', () => {
    expect(src).toContain('fetchCategories()')
    expect(src).toContain('resolveCategoryDisplayName(relaxedCategoryId, categoriesCacheRef.current)')
    // 原始 id/slug 不直接进横幅文本
    expect(src).not.toContain('>{relaxedCategoryId}<')
  })

  it('「去掉分类」按钮：只去分类、保留 q/tag/facets（以无分类条件重查）', () => {
    expect(src).toContain('去掉分类')
    expect(src).toContain('onClick={() => setCategoryDropped(true)}')
    // 只在分类被放宽且当前仍带分类条件时出现
    expect(src).toContain("{fallbackHint === 'filter' && relaxedCategoryId && effectiveCategoryId && (")
    // aria-label 点名展示名，展示名缺失时退回不点名的通用 label
    expect(src).toContain('aria-label={relaxedCategoryName ? `去掉分类「${relaxedCategoryName}」筛选` : \'去掉分类筛选\'}')
  })

  it('去掉分类后搜索不再带 categoryId：主查与加载更多都用生效分类', () => {
    expect(src).toContain('const effectiveCategoryId = categoryDropped ? undefined : categoryId')
    expect(src).toContain('categoryId: effectiveCategoryId')
    expect(src).not.toContain('searchSites({ q, limit: 12, categoryId, identity')
    expect(src).not.toContain('searchSites({ q, limit: 12, offset: offsetRef.current, categoryId, identity')
  })

  it('分类作用域 prop 变化时「去掉分类」复位', () => {
    expect(src).toContain('setCategoryDropped(false)')
    expect(src).toContain('}, [categoryId])')
  })
})
