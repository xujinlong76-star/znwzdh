import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/lib/github', () => ({
  getFileContent: vi.fn(),
  commitFile: vi.fn(),
}))

// Node 环境模拟 localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString()
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    }
  }
})()
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true })

import {
  tokenizeText,
  buildVideoSearchIndex,
  searchVideoIndex
} from '@/lib/video-search-index'
import {
  isSafeMediaHost,
  generateMediaSignature,
  verifyMediaSignature,
  getSignedMediaProxyUrl
} from '@/lib/media-proxy'
import {
  videoTaskQueue,
  type VideoHarvestTask
} from '@/lib/video-task-queue'
import {
  savePlaybackPosition,
  getPlaybackHistory,
  getResumePosition,
  clearPlaybackHistory
} from '@/lib/video-playback-storage'
import {
  formatHarvestMarkdownReport
} from '@/lib/webhook-notifier'
import type { NavigationData } from '@/types/navigation'
import type { VideoHarvestReport } from '@/lib/video-harvester'

describe('Proposal [1]: Video Harvest Task Queue & Lease Lock', () => {
  it('acquires and releases distributed lease lock correctly', () => {
    const owner1 = 'worker_test_1'
    const owner2 = 'worker_test_2'

    // 首次加锁成功
    const res1 = videoTaskQueue.acquireLock(owner1, 2000)
    expect(res1.success).toBe(true)

    // 相同 owner 可重入 / 续租
    const resReenter = videoTaskQueue.acquireLock(owner1, 2000)
    expect(resReenter.success).toBe(true)

    // 不同 owner 加锁应被互斥阻断
    const res2 = videoTaskQueue.acquireLock(owner2, 2000)
    expect(res2.success).toBe(false)
    expect(res2.error).toContain('已有任务正在执行中')

    // 释放锁
    const released = videoTaskQueue.releaseLock(owner1)
    expect(released).toBe(true)

    // 释放后另一个 worker 可正常抢锁
    const res3 = videoTaskQueue.acquireLock(owner2, 2000)
    expect(res3.success).toBe(true)
    videoTaskQueue.releaseLock(owner2)
  })

  it('manages task lifecycle and tracks progress', () => {
    const task = videoTaskQueue.createTask({
      dryRun: true,
      categoryId: 'cat_test',
      trigger: 'admin'
    })

    expect(task.id).toMatch(/^task_vharvest_/)
    expect(task.status).toBe('pending')

    videoTaskQueue.startTask(task.id)
    expect(videoTaskQueue.getTask(task.id)?.status).toBe('running')

    videoTaskQueue.updateProgress(task.id, {
      percent: 50,
      stage: '正在检索 Bilibili 热门榜单...',
      harvestedCount: 3
    })

    const updated = videoTaskQueue.getTask(task.id)
    expect(updated?.progress.percent).toBe(50)
    expect(updated?.progress.harvestedCount).toBe(3)
  })
})

describe('Proposal [2]: Video CJK Inverted Search & BM25 Scoring', () => {
  const mockData: NavigationData = {
    navigationItems: [
      {
        id: 'cat_frontend',
        title: '前端全栈开发',
        icon: 'Code',
        enabled: true,
        items: [
          {
            id: 'v_nextjs',
            title: 'Next.js 15 App Router 生产级深度实战',
            description: '涵盖 Server Actions 与流式渲染最佳实践',
            href: 'https://bilibili.com/video/BV1xx',
            enabled: true,
            videoConfig: {
              type: 'bilibili',
              bvid: 'BV1xx',
              author: '全栈大师',
              durationSec: 1800,
              qualityScore: 92,
              freshnessScore: 90,
              pinned: true
            }
          },
          {
            id: 'v_docker',
            title: 'Docker 与 K8s 容器编排入门到精通',
            description: '微服务架构与自动化交付体系',
            href: 'https://bilibili.com/video/BV1yy',
            enabled: true,
            videoConfig: {
              type: 'bilibili',
              bvid: 'BV1yy',
              author: '云原生探秘',
              durationSec: 3600,
              qualityScore: 88,
              freshnessScore: 85
            }
          }
        ]
      }
    ]
  }

  it('tokenizes CJK and English words with bigrams', () => {
    const tokens = tokenizeText('Next.js 深度实战与k8s容器')
    expect(tokens).toContain('next.js')
    expect(tokens).toContain('k8s')
    expect(tokens).toContain('kubernetes') // 同义词扩展
    expect(tokens).toContain('深')
    expect(tokens).toContain('深度')
    expect(tokens).toContain('实战')
  })

  it('searches with BM25 and boosts pinned / high quality items', () => {
    const index = buildVideoSearchIndex(mockData)
    expect(index.totalDocs).toBe(2)

    // 搜索 Next.js
    const resultsNext = searchVideoIndex(index, 'Next.js', mockData.navigationItems)
    expect(resultsNext.length).toBeGreaterThan(0)
    expect(resultsNext[0]!.item.id).toBe('v_nextjs')
    expect(resultsNext[0]!.highlightField).toBe('title')

    // 搜索同义词 kubernetes 应命中 k8s 视频
    const resultsK8s = searchVideoIndex(index, 'kubernetes', mockData.navigationItems)
    expect(resultsK8s.length).toBeGreaterThan(0)
    expect(resultsK8s[0]!.item.id).toBe('v_docker')

    // 搜索 UP主名称
    const resultsAuthor = searchVideoIndex(index, '全栈大师', mockData.navigationItems)
    expect(resultsAuthor[0]!.item.id).toBe('v_nextjs')
  })
})

describe('Proposal [3]: Media Anti-Leech Proxy & SSRF Protection', () => {
  it('blocks private, loopback, and untrusted hostnames', () => {
    expect(isSafeMediaHost('127.0.0.1')).toBe(false)
    expect(isSafeMediaHost('localhost')).toBe(false)
    expect(isSafeMediaHost('10.0.0.1')).toBe(false)
    expect(isSafeMediaHost('192.168.1.1')).toBe(false)
    expect(isSafeMediaHost('169.254.169.254')).toBe(false)
    expect(isSafeMediaHost('evil-site.com')).toBe(false)

    // 合法图床允许
    expect(isSafeMediaHost('i0.hdslb.com')).toBe(true)
    expect(isSafeMediaHost('i1.hdslb.com')).toBe(true)
    expect(isSafeMediaHost('i.ytimg.com')).toBe(true)
    expect(isSafeMediaHost('images.unsplash.com')).toBe(true)
  })

  it('signs and verifies media proxy URLs securely', () => {
    const rawUrl = 'https://i0.hdslb.com/bfs/archive/test_cover.jpg'
    const sig = generateMediaSignature(rawUrl)
    expect(sig).toBeDefined()
    expect(sig.length).toBe(16)

    expect(verifyMediaSignature(rawUrl, sig)).toBe(true)
    expect(verifyMediaSignature(rawUrl, 'tampered_signature')).toBe(false)

    const proxyUrl = getSignedMediaProxyUrl(rawUrl)
    expect(proxyUrl).toContain('/api/media/proxy?url=')
    expect(proxyUrl).toContain(`&sig=${sig}`)
  })
})

describe('Proposal [4]: Video Playback Storage & History', () => {
  beforeEach(() => {
    clearPlaybackHistory()
  })

  it('saves playback position and calculates resume time', () => {
    savePlaybackPosition({
      videoId: 'v_test_01',
      title: '测试教程',
      author: '讲师A',
      platform: 'bilibili',
      timestampSec: 250,
      durationSec: 1000
    })

    const history = getPlaybackHistory()
    expect(history.length).toBe(1)
    expect(history[0]!.videoId).toBe('v_test_01')
    expect(history[0]!.progressPercent).toBe(25)

    const resumeSec = getResumePosition('v_test_01')
    expect(resumeSec).toBe(250)
  })

  it('resets resume position if video was watched past 95%', () => {
    savePlaybackPosition({
      videoId: 'v_test_02',
      title: '看完的视频',
      author: '讲师B',
      platform: 'bilibili',
      timestampSec: 960,
      durationSec: 1000
    })

    const resumeSec = getResumePosition('v_test_02')
    expect(resumeSec).toBe(0) // 已看 96%，下次从头播放
  })
})

describe('Proposal [5]: Webhook Notifier Markdown Formatting', () => {
  it('formats structured markdown changelog report', () => {
    // 用**真实**的 VideoHarvestReport 结构。旧测试构造的是
    // { dryRun, categoriesProcessed, totalHarvested, summary, details }——
    // 这套字段在报告里一个都不存在，等于测了一个不存在的对象。
    const mockReport: VideoHarvestReport = {
      timestamp: 1735689600000,
      totalCheckedCategories: 3,
      totalHarvestedCount: 7,
      totalAddedCount: 5,
      totalReplacedCount: 2,
      additions: [],
      replacements: [],
      categorySummaries: [
        {
          categoryId: 'cat_ai',
          categoryTitle: 'AI与大模型',
          policyEnabled: true,
          currentCount: 10,
          maxCapacity: 12,
          averageFreshness: 94,
          addedCount: 3,
          replacedCount: 1,
        },
      ],
      degradedKeywords: [
        { keyword: 'Kubernetes eBPF', reason: 'B 站接口 code=-352 风控校验失败' },
      ],
    }

    const md = formatHarvestMarkdownReport(mockReport)
    expect(md).toContain('NavHub 视频知识库自动巡检与轮换简报')
    expect(md).toContain('巡检分类**: 3')
    expect(md).toContain('本次新入库**: **5**')
    expect(md).toContain('替换过时内容**: **2**')
    expect(md).toContain('AI与大模型**: 新增 +3，替换 -1')
    // 采集失败必须出现在简报里，否则「+0」永远看不出是内容饱和还是接口挂了
    expect(md).toContain('采集失败/跳过的关键词')
    expect(md).toContain('风控校验失败')
  })
})

// mock-hygiene：本文件对 `@/lib/github` 做了跨模块 mock，必须在每个用例后重置
// 模块注册表，否则同进程的其它测试文件会拿到被 mock 过的版本（isolate:false 的前置要求）。
afterEach(() => {
  vi.resetModules()
})
