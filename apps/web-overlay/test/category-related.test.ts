/**
 * 相关类目（P16）：`categories.alt_labels` / `related_categories` 两列
 * 库里有、后台能填，但分类页从没消费。这里钉住三件事：
 * 1. 解析口径（resolveRelatedCategories）：后台 curated 顺序保留，只链
 *    达标分类（薄分类页本身 404，链过去是死链），自身/重复/缺失/停用/
 *    计数取不到一律不链；
 * 2. 别名口径（categoryAltLabels）：只留非空字符串；
 * 3. 接线（源码守卫）：分类页主体视图真的渲染「相关类目」区与别名行，
 *    且用的是上面这两个函数（不是又一份内联解析）。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  RELATED_CATEGORY_LINKS,
  categoryAltLabels,
  resolveRelatedCategories,
  type HubCategory,
} from '../src/lib/server/categories'
import { MIN_SITES_FOR_CATEGORY_INDEX } from '../src/lib/seo/thresholds'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

function cat(partial: Partial<HubCategory> & { id: string; title: string }): HubCategory {
  return { ...partial }
}

const CATEGORIES: HubCategory[] = [
  cat({ id: 'a', title: 'A', relatedCategories: ['b', 'c', 'b', 'a', 'missing', 'thin', 'off', 'd'] }),
  cat({ id: 'b', title: 'B' }),
  cat({ id: 'c', title: 'C' }),
  cat({ id: 'd', title: 'D' }),
  cat({ id: 'thin', title: 'Thin' }),
  cat({ id: 'off', title: 'Off', enabled: false }),
]

const COUNTS = new Map<string, number>([
  ['b', 30],
  ['c', 50],
  ['d', 12],
  ['thin', 3],
  ['off', 99],
])

describe('resolveRelatedCategories：curated 顺序保留，只链达标分类', () => {
  it('按后台顺序返回达标分类（不按站点数重排）', () => {
    const out = resolveRelatedCategories(CATEGORIES[0], CATEGORIES, COUNTS)
    // c 有 50 站、b 只有 30 站：curated 顺序是 b 在前，不能重排成 c、b
    expect(out.map((c) => c.id)).toEqual(['b', 'c', 'd'])
  })

  it('自身、重复 id、列表里找不到的 id 都不要', () => {
    const out = resolveRelatedCategories(CATEGORIES[0], CATEGORIES, COUNTS)
    expect(out.map((c) => c.id)).not.toContain('a')
    expect(out.map((c) => c.id)).not.toContain('missing')
    expect(out.filter((c) => c.id === 'b')).toHaveLength(1)
  })

  it('薄分类（< 12 站）与已停用分类不链——链过去是 404 死链', () => {
    const out = resolveRelatedCategories(CATEGORIES[0], CATEGORIES, COUNTS)
    expect(out.map((c) => c.id)).not.toContain('thin')
    expect(out.map((c) => c.id)).not.toContain('off')
  })

  it('恰好达标（12 站）能链', () => {
    expect(COUNTS.get('d')).toBe(MIN_SITES_FOR_CATEGORY_INDEX)
    expect(resolveRelatedCategories(CATEGORIES[0], CATEGORIES, COUNTS).map((c) => c.id)).toContain('d')
  })

  it('没填 relatedCategories / 计数取不到 / 列表取不到：返回空，不猜', () => {
    expect(resolveRelatedCategories(cat({ id: 'b', title: 'B' }), CATEGORIES, COUNTS)).toEqual([])
    expect(resolveRelatedCategories(CATEGORIES[0], CATEGORIES, null)).toEqual([])
    expect(resolveRelatedCategories(CATEGORIES[0], null, COUNTS)).toEqual([])
    expect(resolveRelatedCategories(null, CATEGORIES, COUNTS)).toEqual([])
  })

  it('脏数据里的非字符串 id 不炸、直接跳过', () => {
    const dirty = cat({
      id: 'a',
      title: 'A',
      relatedCategories: ['b', 5, null] as unknown as string[],
    })
    expect(resolveRelatedCategories(dirty, CATEGORIES, COUNTS).map((c) => c.id)).toEqual(['b'])
  })

  it('条数封顶 8 条（与兄弟位同口径）', () => {
    const many = cat({
      id: 'root',
      title: 'Root',
      relatedCategories: Array.from({ length: 12 }, (_, i) => `r${i}`),
    })
    const cats = [many, ...Array.from({ length: 12 }, (_, i) => cat({ id: `r${i}`, title: `R${i}` }))]
    const counts = new Map(Array.from({ length: 12 }, (_, i) => [`r${i}`, 20] as [string, number]))
    expect(resolveRelatedCategories(many, cats, counts)).toHaveLength(RELATED_CATEGORY_LINKS)
    expect(RELATED_CATEGORY_LINKS).toBe(8)
  })
})

describe('categoryAltLabels：只留非空字符串', () => {
  it('正常别名原样返回', () => {
    expect(categoryAltLabels(cat({ id: 'a', title: 'A', altLabels: ['AI 工具', '人工智能'] }))).toEqual([
      'AI 工具',
      '人工智能',
    ])
  })

  it('空串 / 空白串 / 非字符串（脏数据）不渲染', () => {
    const dirty = cat({
      id: 'a',
      title: 'A',
      altLabels: ['好名字', '', '   ', 7] as unknown as string[],
    })
    expect(categoryAltLabels(dirty)).toEqual(['好名字'])
  })

  it('没填 / null：返回空数组', () => {
    expect(categoryAltLabels(cat({ id: 'a', title: 'A' }))).toEqual([])
    expect(categoryAltLabels(cat({ id: 'a', title: 'A', altLabels: null }))).toEqual([])
    expect(categoryAltLabels(null)).toEqual([])
  })
})

describe('接线守卫：分类页主体视图渲染「相关类目」区与别名行', () => {
  const board = readFileSync(resolve(ROOT, 'src', 'app', 'category', '[slug]', 'category-board.tsx'), 'utf8')

  it('有「相关类目」区，且用 resolveRelatedCategories 解析、不是内联过滤', () => {
    expect(board).toContain('相关类目')
    expect(board).toContain('resolveRelatedCategories(category, categories, counts)')
    expect(board).toContain('curatedRelated')
    expect(board).toContain('categoryHref(item)')
  })

  it('别名行用 categoryAltLabels 解析并渲染在标题区', () => {
    expect(board).toContain('categoryAltLabels(category)')
    expect(board).toContain('别名：')
  })

  it('相关类目为空时整段不渲染，不留空标题', () => {
    expect(board).toContain('curatedRelated.length > 0')
  })
})
