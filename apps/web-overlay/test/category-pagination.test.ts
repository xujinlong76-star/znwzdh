import { describe, expect, it } from 'vitest'
import { categoryPageHasSites } from '../src/lib/seo/category-pagination'

/**
 * 分类分页深度边界（2026-10-23 实测回归锁）。
 *
 * `/category/{slug}/p/18` 与 `/p/9999` 会命中 `/api/search?offset=` 的
 * 1000 上限被 400；hubGet 把 4xx 归为 null 后，页面按「中枢抖动」降级渲染，
 * 返回 200 空页且可被索引。这里锁住「按聚合计数判断该页是否还可能存在站点」，
 * 让超出末页的页码回到真 404。
 */
describe('categoryPageHasSites', () => {
  it('按总数判断页码：最后一页有站点，下一页没有', () => {
    expect(categoryPageHasSites(1, 66, 60)).toBe(true)
    expect(categoryPageHasSites(2, 66, 60)).toBe(true)
    expect(categoryPageHasSites(3, 66, 60)).toBe(false)
  })

  it('超过 API offset 上限的深页码一律判空（不渲染可索引的降级页）', () => {
    // 中枢 offset 上限 1000：第 17 页 offset=960 合法，第 18 页 offset=1020 越界。
    // 即使总数足够（2000），第 18 页也不该按「降级」渲染成 200。
    expect(categoryPageHasSites(17, 2000, 60)).toBe(true)
    expect(categoryPageHasSites(18, 2000, 60)).toBe(false)
    expect(categoryPageHasSites(9999, 66, 60)).toBe(false)
  })

  it('零/非法输入按无站点处理，避免把「取不到」当成可索引空页', () => {
    expect(categoryPageHasSites(1, 0, 60)).toBe(false)
    expect(categoryPageHasSites(1, -1, 60)).toBe(false)
    expect(categoryPageHasSites(0, 66, 60)).toBe(false)
    expect(categoryPageHasSites(1.5, 66, 60)).toBe(false)
    expect(categoryPageHasSites(1, Number.NaN, 60)).toBe(false)
    expect(categoryPageHasSites(1, 66, 0)).toBe(false)
  })
})
