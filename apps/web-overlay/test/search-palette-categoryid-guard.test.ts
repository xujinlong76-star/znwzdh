import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 搜索浮层接 categoryId 守卫（2026-11-27 0322 轮实施，方案见 0222 轮 §7）。
 *
 * 接线口径（有意为之，非遗漏）：
 *  - 传 categoryId：分类页 category-board、首页聚焦抽屉（经 navigation-toolbar）。
 *  - 不传 categoryId：专题 collection-detail-view、404 not-found、标签 tag-results-board、
 *    首页未聚焦顶栏（navigation-content L1636 挂载点）。
 *  - 不改动：search-palette.tsx（本体已就绪）、search-palette-lazy.tsx（已透传）、
 *    packages/store/src/search.ts（L1 放宽与 categoryWithDescendants 已就绪）。
 *  - 聚焦抽屉传 focusedSubCategoryId 优先，'__direct__'（精选直属哨兵值）回落父级
 *    focusedCategoryId；回落时搜索范围是父级整树，比可见「仅直属」略宽（已知近似）。
 */
const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位 overlay 根目录（镜像副本 apps/web/test 不会被误当成源） */
function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
  return hit
}

const ROOT = overlayRoot()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/** 取文件中第 n 个 `<NavigationToolbar ... />` JSX 块（从 `<` 到首个 `/>`）。 */
function toolbarBlock(src: string, nth: 0 | 1): string {
  const starts = [...src.matchAll(/<NavigationToolbar/g)].map((m) => m.index!)
  expect(starts.length, '应恰有 2 处 <NavigationToolbar 挂载点').toBe(2)
  const start = starts[nth]
  const end = src.indexOf('/>', start)
  expect(end, '挂载点应以 /> 闭合').toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('搜索浮层接 categoryId（0322 实施轮）', () => {
  it('分类页 category-board：<SearchPalette> 传 categoryId={category?.id}，placeholder 点名分类并注明放宽', () => {
    const src = read('src/app/category/[slug]/category-board.tsx')
    expect(src).toContain('categoryId={category?.id}')
    expect(src).toContain('在「${name}」分类内搜索')
    expect(src).toContain('（无结果时自动放宽到全库）')
    expect(src).toContain('（按 / 快速搜索）')
  })

  it.each([
    'src/app/collections/[slug]/collection-detail-view.tsx',
    'src/app/not-found.tsx',
    'src/components/tag-results-board.tsx',
  ])('%s 的 <SearchPalette> 仍不传 categoryId（专题/标签/404 保持全站）', (rel) => {
    const src = read(rel)
    expect(src).toContain('<SearchPalette')
    expect(src, `${rel} 不应出现 categoryId`).not.toContain('categoryId')
  })

  it('navigation-toolbar 透传链完整：局部 props → 内部 <SearchPalette> → 外部 props/解构 → 挂载点', () => {
    const src = read('src/components/navigation-toolbar.tsx')
    // 2a：局部 LazySearchPalette props 含 categoryId
    expect(src).toContain('categoryId?: string')
    // 2b：内部 <SearchPalette> 透传
    expect(src).toContain('categoryId={categoryId}')
    // 2c：NavigationToolbarProps 含 categoryId（与 2a 共计恰好 2 处类型声明）
    expect(src.match(/categoryId\?: string/g)?.length).toBe(2)
    expect(src).toContain('export interface NavigationToolbarProps')
    // 2d：挂载点 <LazySearchPalette> 透传；placeholder 按 categoryId 条件派生
    expect(src).toContain('<LazySearchPalette')
    expect(src).toContain('placeholder={')
    expect(src).toContain('在当前分类内搜索…（无结果时自动放宽到全库）')
    expect(src).toContain('搜索站点、标签或拼音…')
  })

  it('navigation-content：聚焦抽屉挂载点传 focusedSubCategoryId（__direct__ 回落父级），未聚焦挂载点不传', () => {
    const src = read('src/components/navigation-content.tsx')
    const unfocused = toolbarBlock(src, 0)
    expect(unfocused, '未聚焦挂载点（L1636）不应传 categoryId').not.toContain('categoryId')
    const focused = toolbarBlock(src, 1)
    expect(focused).toContain('focusedSubCategoryId')
    expect(focused).toContain('focusedCategoryId')
    expect(focused).toContain("'__direct__'")
    expect(focused).toContain('categoryId={')
  })

  it('浮层本体与懒加载层零改动：仍是既有 categoryId 透传，不新增逻辑', () => {
    const palette = read('src/components/search-palette.tsx')
    expect(palette).toContain('categoryId?: string')
    expect(palette).toContain('searchSites({ q, limit: 12, categoryId,')
    expect(palette).toContain('当前筛选下没有结果，已放宽到全库匹配（结果可能来自其他类目）。')
    const lazy = read('src/components/search-palette-lazy.tsx')
    expect(lazy).toContain('categoryId?: string')
    // 懒加载层仍是纯透传，不做任何 categoryId 分支处理
    expect(lazy).toContain('<SearchPalette {...props} />')
    expect(lazy).not.toContain('focusedSubCategoryId')
    expect(lazy).not.toContain('__direct__')
  })
})
