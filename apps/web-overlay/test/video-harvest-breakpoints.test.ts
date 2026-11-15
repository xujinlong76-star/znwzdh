/**
 * 采集链路断点回归锁（2026-11-14，收获修复轮）：
 * 1. WBI 拿不到 key 时不发无签名请求（直接短路，记 degraded，不浪费预算）；
 * 2. 单条解析两路（官方 view + 星之阁）都失败时直接拒绝，不返回无 stats、
 *    无分数的占位条目（占位条目带 pinned: true 会绕过入库守卫）；
 * 3. 轮换上限就是策略上限：分类满了走替换，不再无限膨胀。
 */
import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from 'vitest'
import {
  harvestVideosForTopic,
  resolveVideoUrl,
  runVideoHarvestAndRotation,
} from '../src/lib/video-harvester'
import { commitFile, getFileContent, readStorageFresh } from '../src/lib/github'
import type { NavigationData, NavigationSubItem } from '../src/types/navigation'

const { mockGetWbiMixinKey } = vi.hoisted(() => ({
  mockGetWbiMixinKey: vi.fn(),
}))

vi.mock('@/lib/bilibili-wbi', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/bilibili-wbi')>()
  return { ...orig, getWbiMixinKey: mockGetWbiMixinKey }
})

vi.mock('@/lib/github', () => ({
  getFileContent: vi.fn(),
  commitFile: vi.fn().mockResolvedValue({ success: true }),
  readStorageFresh: vi.fn(),
  getStorageVersion: vi.fn().mockResolvedValue(1),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe('断点 1：WBI 拿不到 key 不发无签名请求', () => {
  it('记 degraded、返回空，且一次 B 站搜索请求都不发', async () => {
    mockGetWbiMixinKey.mockResolvedValue(null)
    const fetchSpy = vi.fn().mockRejectedValue(new Error('must not fetch'))
    vi.stubGlobal('fetch', fetchSpy)

    const failures: Array<{ keyword: string; reason: string }> = []
    const results = await harvestVideosForTopic(['AI'], {
      platforms: ['bilibili'],
      failures,
    })

    expect(results).toEqual([])
    expect(failures.some((f) => f.reason.includes('wbi'))).toBe(true)
    expect(failures.some((f) => f.reason.includes('不发无签名请求'))).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('断点 2：单条解析失败直接拒绝，不给占位条目', () => {
  it('官方 view 接口与星之阁都不可用时抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(
      resolveVideoUrl('https://www.bilibili.com/video/BV1xx411c7mD'),
    ).rejects.toThrow('解析失败')
  })
})

describe('断点 3：轮换上限就是策略上限，满了走替换', () => {
  it('分类已有 maxItems 条旧内容时，新候选替换最旧的一条而不是继续增加', async () => {
    mockGetWbiMixinKey.mockResolvedValue('0123456789abcdef0123456789abcdef')

    const stale = (bvid: string): NavigationSubItem => ({
      id: `old_${bvid}`,
      title: `旧教程 ${bvid} 2020`,
      href: `https://www.bilibili.com/video/${bvid}`,
      enabled: true,
      videoConfig: {
        type: 'bilibili',
        bvid,
        author: '旧UP',
        durationSec: 600,
        publishedAt: '2020-01-01T00:00:00.000Z',
        qualityScore: 10,
        sourceType: 'auto_trend',
        pinned: false,
        healthStatus: 'healthy',
      },
    })

    const data: NavigationData = {
      navigationItems: [
        {
          id: 'cat_test',
          title: '测试分类',
          enabled: true,
          items: [stale('BV1old000001'), stale('BV1old000002')],
          subCategories: [],
          harvestPolicy: {
            enabled: true,
            keywords: ['AI'],
            maxItems: 2,
            minDurationSec: 180,
            autoReplaceOutdated: true,
          },
        },
      ],
    }
    vi.mocked(readStorageFresh).mockResolvedValue(data)
    vi.mocked(getFileContent).mockResolvedValue(data)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('wbi/search/type')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                code: 0,
                data: {
                  result: [
                    {
                      bvid: 'BV1new000001',
                      title: '新教程 AI 实战',
                      description: '全新',
                      pic: '',
                      play: 120000,
                      like: 5000,
                      video_review: 300,
                      favorites: 1000,
                      duration: '10:00',
                      pubdate: Math.floor(Date.now() / 1000) - 86400,
                      aid: 123,
                      author: '新UP',
                    },
                  ],
                },
              }),
          })
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`))
      }),
    )

    const report = await runVideoHarvestAndRotation({
      dryRun: true,
      forceKeywords: ['AI'],
      platforms: ['bilibili'],
    })

    // 旧 Math.max(maxItems, 当前条数 + 50) 下这里会是新增 +1、替换 0（库无限膨胀）；
    // 上限修成策略上限后，满了必须走替换。
    expect(report.totalAddedCount).toBe(0)
    expect(report.totalReplacedCount).toBe(1)
    expect(report.categorySummaries[0]?.replacedCount).toBe(1)
  })

  it('替换不触发缩水守卫误报：实写（dryRun=false）时替换后仍能落盘', async () => {
    mockGetWbiMixinKey.mockResolvedValue('0123456789abcdef0123456789abcdef')

    const stale = (bvid: string): NavigationSubItem => ({
      id: `old_${bvid}`,
      title: `旧教程 ${bvid} 2020`,
      href: `https://www.bilibili.com/video/${bvid}`,
      enabled: true,
      videoConfig: {
        type: 'bilibili',
        bvid,
        author: '旧UP',
        durationSec: 600,
        publishedAt: '2020-01-01T00:00:00.000Z',
        qualityScore: 10,
        sourceType: 'auto_trend',
        pinned: false,
        healthStatus: 'healthy',
      },
    })

    const data: NavigationData = {
      navigationItems: [
        {
          id: 'cat_test',
          title: '测试分类',
          enabled: true,
          items: [stale('BV1old000001'), stale('BV1old000002')],
          subCategories: [],
          harvestPolicy: {
            enabled: true,
            keywords: ['AI'],
            maxItems: 2,
            minDurationSec: 180,
            autoReplaceOutdated: true,
          },
        },
        // 填充分类：120 条已入库内容，只为把 existingExternalIds 的基数推过
        // 缩水守卫的 100 条阈值——否则小库上守卫根本不触发，测不到这个 bug。
        // 它不启用采集策略， harvest 时会被跳过，只影响集合大小。
        {
          id: 'cat_filler',
          title: '填充分类',
          enabled: true,
          items: Array.from({ length: 120 }, (_, i) => ({
            id: `fill_${i}`,
            title: `填充 ${i}`,
            href: `https://www.bilibili.com/video/BV1fill${String(i).padStart(5, '0')}`,
            enabled: true,
            videoConfig: {
              type: 'bilibili' as const,
              bvid: `BV1fill${String(i).padStart(5, '0')}`,
            },
          })),
          subCategories: [],
          harvestPolicy: { enabled: false, keywords: [] },
        },
      ],
    }
    vi.mocked(readStorageFresh).mockResolvedValue(data)
    vi.mocked(getFileContent).mockResolvedValue(data)
    const mockCommit = vi.mocked(commitFile)
    mockCommit.mockResolvedValue({ ok: true } as never)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('wbi/search/type')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                code: 0,
                data: {
                  result: [
                    {
                      bvid: 'BV1new000001',
                      title: '新教程 AI 实战',
                      description: '全新',
                      pic: '',
                      play: 120000,
                      like: 5000,
                      video_review: 300,
                      favorites: 1000,
                      duration: '10:00',
                      pubdate: Math.floor(Date.now() / 1000) - 86400,
                      aid: 123,
                      author: '新UP',
                    },
                  ],
                },
              }),
          })
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`))
      }),
    )

    // 旧 bug：替换时旧 key 仍留在 existingExternalIds 里，集合大小变成
    // 初始 122 + 新增 0 + 替换 1 = 123，写盘守卫拿 123 > 写后总数 122 误报缩减抛错。
    // 修好后集合大小应为 122（1 旧出库、1 新入库），写盘正常进行。
    const report = await runVideoHarvestAndRotation({
      dryRun: false,
      forceKeywords: ['AI'],
      platforms: ['bilibili'],
    })
    expect(report.totalReplacedCount).toBe(1)
    expect(mockCommit).toHaveBeenCalled()
  })
})
