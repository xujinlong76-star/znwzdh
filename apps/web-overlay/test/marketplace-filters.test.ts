import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MARKETPLACE_SORT,
  isCountSortDegenerate,
} from '../src/lib/plugins/marketplace-filters'

/**
 * 计数型排序退化判定（Phase 2 批 A）：
 * 种子 install/star/review 全 0 时，安装 / 星标 / 评分 / 飙升四种排序键全部相等、
 * 只剩 created_at 倒序兜底，与「最新发布」同序——页面须如实注明，不得编假数据
 * 让排序看起来分化。判定只看已加载项：排序把最大值放最前，首屏全 0 即全局全 0。
 */
describe('isCountSortDegenerate（排序退化注明）', () => {
  const zero = { installCount: 0, starCount: 0, reviewCount: 0 }
  const zeroNoReview = { installCount: 0, starCount: 0 }

  it('四种计数型排序在全 0 时退化', () => {
    for (const sort of ['popular', 'stars', 'rating', 'trending'] as const) {
      expect(isCountSortDegenerate(sort, [zero, zeroNoReview])).toBe(true)
    }
  })

  it('最新发布 / 最近更新是时间排序本身，不退化、不注明日', () => {
    expect(isCountSortDegenerate('new', [zero])).toBe(false)
    expect(isCountSortDegenerate('updated', [zero])).toBe(false)
  })

  it('任一计数非 0 即不退化', () => {
    expect(isCountSortDegenerate('popular', [zero, { installCount: 1, starCount: 0, reviewCount: 0 }])).toBe(false)
    expect(isCountSortDegenerate('stars', [zero, { installCount: 0, starCount: 2, reviewCount: 0 }])).toBe(false)
    expect(isCountSortDegenerate('rating', [zero, { installCount: 0, starCount: 0, reviewCount: 1 }])).toBe(false)
  })

  it('空列表不注明（0 命中走空态，不叠加两条提示）', () => {
    expect(isCountSortDegenerate('popular', [])).toBe(false)
    expect(isCountSortDegenerate('trending', [])).toBe(false)
  })

  it('DEFAULT_MARKETPLACE_SORT 是 trending，首屏默认即计数型排序', () => {
    expect(DEFAULT_MARKETPLACE_SORT).toBe('trending')
  })
})
