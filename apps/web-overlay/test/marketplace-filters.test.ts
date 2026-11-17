import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MARKETPLACE_SORT,
  countSortDegenerateKind,
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

  it('每种排序只看自己的键：别家计数非 0 不影响本排序退化', () => {
    // :3001 实测（2026-11-17）：安装 2 次、星标 2 次、评价全 0。
    // 旧断言「任一计数非 0 即不退化」是共享谓词的误判：rating 的键只有评价，
    // 评价全 0 时 rating 已退化、必须注明；popular/stars 同理只看自己的键。
    // 旧断言已按新行为改写（守卫断言只可按新行为改写，不删除）。
    expect(isCountSortDegenerate('popular', [zero, { installCount: 0, starCount: 2, reviewCount: 1 }])).toBe(true)
    expect(isCountSortDegenerate('popular', [zero, { installCount: 1, starCount: 0, reviewCount: 0 }])).toBe(false)
    expect(isCountSortDegenerate('stars', [zero, { installCount: 1, starCount: 0, reviewCount: 0 }])).toBe(true)
    expect(isCountSortDegenerate('stars', [zero, { installCount: 0, starCount: 2, reviewCount: 0 }])).toBe(false)
    expect(isCountSortDegenerate('rating', [zero, { installCount: 1, starCount: 2, reviewCount: 0 }])).toBe(true)
    expect(isCountSortDegenerate('rating', [zero, { installCount: 0, starCount: 0, reviewCount: 1 }])).toBe(false)
    expect(isCountSortDegenerate('trending', [zero, { installCount: 1, starCount: 0, reviewCount: 0 }])).toBe(false)
    expect(isCountSortDegenerate('trending', [zero, { installCount: 0, starCount: 2, reviewCount: 0 }])).toBe(false)
    expect(isCountSortDegenerate('trending', [zero, { installCount: 0, starCount: 0, reviewCount: 1 }])).toBe(false)
  })

  it('退化时报出是哪个键（板面文案只说该键，不再三键并提）', () => {
    expect(countSortDegenerateKind('popular', [zero])).toBe('install')
    expect(countSortDegenerateKind('stars', [zero])).toBe('star')
    expect(countSortDegenerateKind('rating', [zero])).toBe('review')
    expect(countSortDegenerateKind('trending', [zero])).toBe('trending')
    expect(countSortDegenerateKind('new', [zero])).toBeNull()
    expect(countSortDegenerateKind('popular', [{ installCount: 1, starCount: 0, reviewCount: 0 }])).toBeNull()
  })

  it('trending 下任一举报非 0 即撤注明（飙升分含 -report_count*10，与 new 分叉）', () => {
    const reported = { installCount: 0, starCount: 0, reviewCount: 0, reportCount: 1 }
    expect(isCountSortDegenerate('trending', [zero, reported])).toBe(false)
    expect(isCountSortDegenerate('trending', [reported])).toBe(false)
  })

  it('popular / stars / rating 下举报非 0 仍注明（排序键不含 report_count）', () => {
    const reported = { installCount: 0, starCount: 0, reviewCount: 0, reportCount: 3 }
    for (const sort of ['popular', 'stars', 'rating'] as const) {
      expect(isCountSortDegenerate(sort, [zero, reported])).toBe(true)
    }
  })

  it('空列表不注明（0 命中走空态，不叠加两条提示）', () => {
    expect(isCountSortDegenerate('popular', [])).toBe(false)
    expect(isCountSortDegenerate('trending', [])).toBe(false)
  })

  it('DEFAULT_MARKETPLACE_SORT 是 trending，首屏默认即计数型排序', () => {
    expect(DEFAULT_MARKETPLACE_SORT).toBe('trending')
  })
})
