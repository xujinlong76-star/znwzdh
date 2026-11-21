import { describe, expect, it } from 'vitest'
import {
  MERGE_OVERLAP_RATIO,
  MIN_INSTALLS_FOR_RANK,
  MIN_REVIEWS_FOR_RANK,
  filterAllRankGroups,
  filterRankEligible,
  overlapRatio,
  shouldMergeInstallRanks,
} from '../src/lib/plugins/rank-eligibility'

/**
 * 插件四榜入榜资格回归（2026-11-21）。
 *
 * 实测数据库：77 个插件里只有 10 个有安装、最高 2 次，review_count 字段
 * 尚不存在。旧实现把接口结果原样透传，于是：
 *   - 飙升榜第 1 名是"AI 效率组合包（暂无安装）"——0 安装排在 2 次安装前面；
 *   - 口碑榜 5 条全是"暂无评价"——零评价硬排 1-5 名。
 * 这些不是文案问题，是**入榜资格**问题：0 安装的插件就不该出现在安装榜里。
 */

const p = (over: Partial<{ id: string; installCount: number; reviewCount: number; publishedAt: string }> = {}) => ({
  id: over.id ?? 'p1',
  name: 'P',
  installCount: over.installCount ?? 0,
  reviewCount: over.reviewCount,
  publishedAt: over.publishedAt,
} as never)

describe('filterRankEligible', () => {
  it('门槛常量', () => {
    expect(MIN_INSTALLS_FOR_RANK).toBe(1)
    expect(MIN_REVIEWS_FOR_RANK).toBe(1)
  })

  describe('安装类榜单（trending / popular）', () => {
    for (const key of ['trending', 'popular'] as const) {
      it(`${key}: 0 安装不得入榜`, () => {
        expect(filterRankEligible(key, [p({ installCount: 0 })])).toHaveLength(0)
      })
      it(`${key}: 0 安装不能排在正安装之前（核心 Bug）`, () => {
        const zero = p({ id: 'zero', installCount: 0 })
        const two = p({ id: 'two', installCount: 2 })
        const out = filterRankEligible(key, [zero, two])
        expect(out.map((x) => x.id)).toEqual(['two'])
        expect(out[0].installCount).toBe(2)
      })
      it(`${key}: 正安装全部保留`, () => {
        const items = [p({ id: 'a', installCount: 1 }), p({ id: 'b', installCount: 2 })]
        expect(filterRankEligible(key, items)).toHaveLength(2)
      })
    }
  })

  describe('口碑榜（rating）', () => {
    it('0 评价不得入榜（不能硬排 5 个"暂无评价"）', () => {
      const items = Array.from({ length: 5 }, (_, i) => p({ id: 'r' + i, reviewCount: 0 }))
      expect(filterRankEligible('rating', items)).toHaveLength(0)
    })
    it('reviewCount 缺失（字段尚未上线）同样不入榜', () => {
      expect(filterRankEligible('rating', [p()])).toHaveLength(0)
    })
    it('有评价的能入榜', () => {
      expect(filterRankEligible('rating', [p({ reviewCount: 3 })])).toHaveLength(1)
    })
  })

  describe('新品榜（fresh）无资格门槛', () => {
    it('0 安装也能上新品榜（它看的是上架时间）', () => {
      const items = [p({ id: 'n1' }), p({ id: 'n2' })]
      expect(filterRankEligible('fresh', items)).toHaveLength(2)
    })
  })
})

describe('filterAllRankGroups', () => {
  it('四组同时过滤', () => {
    const out = filterAllRankGroups({
      trending: [p({ id: 't1', installCount: 2 }), p({ id: 't2', installCount: 0 })],
      popular: [p({ id: 'p1', installCount: 1 })],
      rating: [p({ id: 'r1', reviewCount: 0 })],
      fresh: [p({ id: 'f1' })],
    })
    expect(out.trending.map((x) => x.id)).toEqual(['t1'])
    expect(out.popular).toHaveLength(1)
    expect(out.rating).toHaveLength(0)
    expect(out.fresh).toHaveLength(1)
  })
})

describe('overlapRatio / shouldMergeInstallRanks', () => {
  it('重合率常量', () => {
    expect(MERGE_OVERLAP_RATIO).toBe(0.8)
  })
  it('完全相同 → 1', () => {
    const a = [p({ id: 'x' }), p({ id: 'y' })]
    expect(overlapRatio(a, a)).toBe(1)
  })
  it('完全不同 → 0', () => {
    expect(overlapRatio([p({ id: 'x' })], [p({ id: 'y' })])).toBe(0)
  })
  it('任一为空 → 0（空榜之间谈不上重合）', () => {
    expect(overlapRatio([], [p({ id: 'x' })])).toBe(0)
    expect(overlapRatio([], [])).toBe(0)
  })
  it('重合率按较小榜长度算', () => {
    const big = [p({ id: 'a' }), p({ id: 'b' }), p({ id: 'c' })]
    const small = [p({ id: 'a' })]
    expect(overlapRatio(big, small)).toBe(1) // 1/1
  })

  it('高度重合 → 应合并（冷启动期典型场景）', () => {
    const trending = [p({ id: 'a', installCount: 2 }), p({ id: 'b', installCount: 1 })]
    const popular = [p({ id: 'a', installCount: 2 }), p({ id: 'b', installCount: 1 })]
    expect(shouldMergeInstallRanks(trending, popular)).toBe(true)
  })
  it('两榜都空 → 不合并（交给空态引导）', () => {
    expect(shouldMergeInstallRanks([], [])).toBe(false)
  })
  it('仅一榜有数据 → 不合并', () => {
    expect(shouldMergeInstallRanks([p({ id: 'a' })], [])).toBe(false)
  })
  it('重合率低于阈值 → 不合并（数据丰富后展开完整四榜）', () => {
    const trending = [p({ id: 'a' }), p({ id: 'b' }), p({ id: 'c' }), p({ id: 'd' }), p({ id: 'e' })]
    const popular = [p({ id: 'a' }), p({ id: 'f' }), p({ id: 'g' }), p({ id: 'h' }), p({ id: 'i' })]
    expect(shouldMergeInstallRanks(trending, popular)).toBe(false) // 1/5 = 0.2
  })
})
