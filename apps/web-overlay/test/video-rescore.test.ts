import { describe, expect, it } from 'vitest'
import { rescoreNavigationItems, rescoreVideoItem, summarizeScores } from '../src/lib/video-rescore'
import { calculateQualityScore } from '../src/lib/video-scoring'
import type { NavigationItem, NavigationSubItem } from '../src/types/navigation'

function item(overrides: Partial<NavigationSubItem> = {}): NavigationSubItem {
  return {
    id: 'video_test',
    title: 'TypeScript 5.8 与 React 19 最佳实践',
    href: 'https://www.bilibili.com/video/BV1test',
    description: '',
    enabled: true,
    videoConfig: {
      type: 'bilibili',
      bvid: 'BV1test',
      durationSec: 1500,
      publishedAt: '2025-06-01T00:00:00.000Z',
      qualityScore: 65,
      freshnessScore: 80,
      stats: { views: 180000, likes: 12000, danmaku: 800 },
    },
    ...overrides,
  } as NavigationSubItem
}

describe('video-rescore 回填：只用真实数据重算', () => {
  it('重算结果等于公式直算，不读旧分', () => {
    const { item: next, diff } = rescoreVideoItem(item())
    expect(next.videoConfig!.qualityScore).toBe(
      calculateQualityScore({ views: 180000, likes: 12000, danmaku: 800 }, 1500)
    )
    expect(diff.oldQualityScore).toBe(65)
    expect(diff.changed).toBe(true)
  })

  it('没有统计数据就是 0 分，不继承旧分、不编造', () => {
    const noStats = item({
      videoConfig: {
        type: 'bilibili',
        bvid: 'BV1test',
        durationSec: 1500,
        publishedAt: '2025-06-01T00:00:00.000Z',
        qualityScore: 92,
        freshnessScore: 90,
      } as NavigationSubItem['videoConfig'],
    })
    const { item: next, diff } = rescoreVideoItem(noStats)
    expect(next.videoConfig!.qualityScore).toBe(0)
    expect(diff.missingStats).toBe(true)
    expect(diff.changed).toBe(true)
  })

  it('重算保鲜分没有 5 分底线：无统计数据的旧视频重算后是 0 分', () => {
    // 旧保鲜分 Math.max(5, …) 会让 0 分视频重算后仍剩 5 分。
    const noStats = item({
      videoConfig: {
        type: 'bilibili',
        bvid: 'BV1test',
        durationSec: 1500,
        publishedAt: '2020-06-01T00:00:00.000Z',
        qualityScore: 65,
        freshnessScore: 80,
      } as NavigationSubItem['videoConfig'],
    })
    const { item: next } = rescoreVideoItem(noStats)
    expect(next.videoConfig!.qualityScore).toBe(0)
    expect(next.videoConfig!.freshnessScore).toBe(0)
  })

  it('不修改输入条目（返回新对象）', () => {
    const src = item()
    const before = src.videoConfig!.qualityScore
    rescoreVideoItem(src)
    expect(src.videoConfig!.qualityScore).toBe(before)
  })

  it('整库重算：覆盖顶级与子分类，报告与分数一致', () => {
    const cats: NavigationItem[] = [
      {
        id: 'cat_a',
        title: '分类 A',
        items: [item({ id: 'v1' }), item({ id: 'v2', videoConfig: { ...item().videoConfig, qualityScore: 65 } as NavigationSubItem['videoConfig'] })],
        subCategories: [
          {
            id: 'sub_a1',
            title: '子分类 A1',
            parentId: 'cat_a',
            items: [item({ id: 'v3' })],
          },
        ],
      },
    ]
    const { items: next, report } = rescoreNavigationItems(cats)
    expect(report.total).toBe(3)
    expect(report.rescored).toBe(3)
    expect(report.changed).toBe(3)
    // 输入未被修改
    expect(cats[0]!.items![0]!.videoConfig!.qualityScore).toBe(65)
    // 输出全部等于公式直算，且三条同数据视频同分（不再靠旧分区分）
    const scores = [
      next[0]!.items![0]!.videoConfig!.qualityScore,
      next[0]!.items![1]!.videoConfig!.qualityScore,
      next[0]!.subCategories![0]!.items![0]!.videoConfig!.qualityScore,
    ]
    expect(new Set(scores).size).toBe(1)
    expect(report.qualityAfter.mode!.count).toBe(3)
    expect(report.qualityAfter.mode!.value).toBe(scores[0])
  })

  it('分布统计能发现扎堆：众数占比直接可见', () => {
    const dist = summarizeScores([65, 65, 65, 65, 70, 80])
    expect(dist.mode).toEqual({ value: 65, count: 4 })
    expect(dist.passAt65).toBe(6) // >= 65：4 个 65 + 70 + 80
    expect(dist.passAt60).toBe(6)
    expect(dist.min).toBe(65)
    expect(dist.max).toBe(80)
    expect(dist.median).toBe(65)
  })

  it('空库不抛错，分布全为空', () => {
    const { report } = rescoreNavigationItems([])
    expect(report.total).toBe(0)
    expect(report.qualityAfter.count).toBe(0)
    expect(report.qualityAfter.mode).toBeNull()
  })
})
