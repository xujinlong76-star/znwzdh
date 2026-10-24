import { describe, expect, it } from 'vitest'
import {
  CATEGORY_PAGE_SEARCH_MAX_OFFSET,
  categoryPageHasSites,
  categoryPageOffsetIsReachable,
  maxReachableCategoryPage,
} from '../src/lib/seo/category-pagination'

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

/**
 * 「请求本身是否合法」的判定（不依赖计数）。
 *
 * categoryPageHasSites 只在计数可用时才拿来做 404 判断，因此深页码在计数缺失时
 * 仍会渲染成降级页。这个函数不看计数，专门回答「offset 会不会被中枢拒掉」：
 * 越界的页码要在取数之前就 notFound()，否则产出的是一张请求必然 400 的 200 页。
 */
describe('categoryPageOffsetIsReachable', () => {
  it('offset 落在上限内可达，越界不可达（与计数无关）', () => {
    expect(categoryPageOffsetIsReachable(1, 60)).toBe(true)
    expect(categoryPageOffsetIsReachable(17, 60)).toBe(true) // offset 960 <= 1000
    expect(categoryPageOffsetIsReachable(18, 60)).toBe(false) // offset 1020 > 1000
    expect(categoryPageOffsetIsReachable(9999, 60)).toBe(false)
  })

  it('非法页码/容量/上限一律不可达', () => {
    expect(categoryPageOffsetIsReachable(0, 60)).toBe(false)
    expect(categoryPageOffsetIsReachable(-1, 60)).toBe(false)
    expect(categoryPageOffsetIsReachable(1.5, 60)).toBe(false)
    expect(categoryPageOffsetIsReachable(Number.NaN, 60)).toBe(false)
    expect(categoryPageOffsetIsReachable(1, 0)).toBe(false)
    expect(categoryPageOffsetIsReachable(1, 60, -1)).toBe(false)
  })
})

/** 最深可达页：分页器与「下一页」链接都靠它收敛，不能链向必然 404 的页 */
describe('maxReachableCategoryPage', () => {
  it('给出最后一个 offset 仍在上限内的页码', () => {
    expect(maxReachableCategoryPage(60)).toBe(Math.floor(1000 / 60) + 1)
    expect(maxReachableCategoryPage(60)).toBe(17)
    expect(maxReachableCategoryPage(100)).toBe(11)
    expect(maxReachableCategoryPage(1001)).toBe(1)
  })

  it('容量非法时返回 0（调用方据此不渲染任何分页链接）', () => {
    expect(maxReachableCategoryPage(0)).toBe(0)
    expect(maxReachableCategoryPage(-5)).toBe(0)
    expect(maxReachableCategoryPage(2.5)).toBe(0)
  })

  it('与可达性判定同口径：最深页可达、下一页不可达', () => {
    for (const pageSize of [12, 24, 60, 100]) {
      const deepest = maxReachableCategoryPage(pageSize)
      expect(categoryPageOffsetIsReachable(deepest, pageSize)).toBe(true)
      expect(categoryPageOffsetIsReachable(deepest + 1, pageSize)).toBe(false)
    }
    expect(CATEGORY_PAGE_SEARCH_MAX_OFFSET).toBe(1000)
  })
})
