import { describe, expect, it } from 'vitest'
import { descendantSiteCounts, type CountableNode } from '../src/lib/seo/category-totals'

/**
 * 类目站点数聚合。
 *
 * 新树口径：站点只挂叶子，`/api/categories/counts` 又是按单个类目 GROUP BY 的，
 * 所以一级根本身在原始计数里就是 0。不聚合的话根页、首页目录带、`/category`
 * 总览会一致地把每个根判成薄分类——而这三个地方的「达标」判定是同一份口径，
 * 一处漏聚合就是成片死链。
 */

const tree: CountableNode[] = [
  { id: 'r1' },
  { id: 'r2' },
  { id: 'l1', parentId: 'r1' },
  { id: 'l2', parentId: 'r1' },
  { id: 'l3', parentId: 'r2' },
]

describe('descendantSiteCounts', () => {
  it('叶子计数聚合到一级根，叶子保持自身值', () => {
    const totals = descendantSiteCounts(tree, new Map([['l1', 9], ['l2', 3], ['l3', 1]]))
    expect(totals?.get('r1')).toBe(12)
    expect(totals?.get('r2')).toBe(1)
    expect(totals?.get('l1')).toBe(9)
  })

  it('父级自己也有站点时（存量数据挂根）不丢掉那部分', () => {
    const totals = descendantSiteCounts(tree, new Map([['r1', 4], ['l1', 9]]))
    expect(totals?.get('r1')).toBe(13)
  })

  it('只累加库里出现的节点，多余计数不影响结果', () => {
    const totals = descendantSiteCounts(tree, new Map([['l1', 9], ['gone', 500]]))
    expect(totals?.get('r1')).toBe(9)
    expect(totals?.has('gone')).toBe(false)
  })

  it('counts 为 null 时返回 null：降级不能变成「全树 0 站」', () => {
    expect(descendantSiteCounts(tree, null)).toBeNull()
  })

  it('parent_id 成环（存量脏行）时不无限递归', () => {
    const cyclic: CountableNode[] = [{ id: 'x', parentId: 'y' }, { id: 'y', parentId: 'x' }]
    const totals = descendantSiteCounts(cyclic, new Map([['x', 2], ['y', 5]]))
    // 从 x 进入：y 处断环回 0 → y=5、x=2+5。数值依赖遍历顺序是刻意的，
    // 这个用例锁的是「有限、不自我翻倍」，不是环的正确解。
    expect(totals?.get('y')).toBe(5)
    expect(totals?.get('x')).toBe(7)
  })
})
