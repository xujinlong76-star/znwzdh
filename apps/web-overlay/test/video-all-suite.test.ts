import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  resolveAvailableMirrors,
  selectBestMirror,
  recordMirrorFailover,
  getFailoverHistory,
  clearFailoverHistory,
} from '@/lib/video-failover'
import {
  parseTimestampToSeconds,
  extractHeuristicChapters,
  getVideoAISummary,
} from '@/lib/video-ai-summary'
import {
  saveOfflineVideo,
  getOfflineVideo,
  listOfflineVideos,
  isOfflineVideo,
  removeOfflineVideo,
  clearOfflineCache,
} from '@/lib/offline-video-cache'
import {
  getUserPlaylists,
  createPlaylist,
  addToPlaylist,
  removeFromPlaylist,
  toggleWatchLater,
  isInWatchLater,
  getNextPlaylistItem,
  WATCH_LATER_ID,
} from '@/lib/user-playlists'
import {
  extractTechKeywords,
  computeJaccardSimilarity,
  getPersonalizedRecommendations,
  getRelatedVideos,
} from '@/lib/video-recommendation'
import type { NavigationSubItem, VideoConfig } from '@/types/navigation'

// In-memory mock storage
class MockStorage implements Storage {
  private store: Record<string, string> = {}
  get length() {
    return Object.keys(this.store).length
  }
  clear() {
    this.store = {}
  }
  getItem(key: string) {
    return this.store[key] || null
  }
  key(index: number) {
    return Object.keys(this.store)[index] || null
  }
  removeItem(key: string) {
    delete this.store[key]
  }
  setItem(key: string, value: string) {
    this.store[key] = String(value)
  }
}

const mockStorage = new MockStorage()

beforeEach(() => {
  mockStorage.clear()
  clearOfflineCache()
  clearFailoverHistory()
  ;(globalThis as any).localStorage = mockStorage
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      writable: true,
    })
  }
})

describe('Proposal [5]: Multi-Source Resilience & Auto-Failover', () => {
  const dummyConfig: VideoConfig = {
    type: 'bilibili',
    bvid: 'BV1xx411c7mD',
    mirrors: [
      {
        id: 'mirror-yt',
        platform: 'youtube',
        sourceId: 'dQw4w9WgXcQ',
        label: 'YouTube 备用线路',
        priority: 5,
      },
      {
        id: 'mirror-custom',
        platform: 'custom',
        sourceId: 'https://cdn.example.com/stream.m3u8',
        label: '自建 CDN 线路',
        priority: 2,
      },
    ],
  }

  it('correctly resolves available mirrors sorted by priority', () => {
    const mirrors = resolveAvailableMirrors(dummyConfig)
    expect(mirrors.length).toBe(3)
    expect(mirrors[0].platform).toBe('bilibili')
    expect(mirrors[0].priority).toBe(0) // Primary is highest priority
    expect(mirrors[1].id).toBe('mirror-custom') // Priority 2 comes before 5
    expect(mirrors[2].id).toBe('mirror-yt')
  })

  it('selects best mirror excluding failed sources', () => {
    const mirrors = resolveAvailableMirrors(dummyConfig)
    const best1 = selectBestMirror(mirrors, [])
    expect(best1?.id).toBe('primary-bilibili-BV1xx411c7mD')

    const best2 = selectBestMirror(mirrors, ['primary-bilibili-BV1xx411c7mD'])
    expect(best2?.id).toBe('mirror-custom')

    const best3 = selectBestMirror(mirrors, ['primary-bilibili-BV1xx411c7mD', 'mirror-custom'])
    expect(best3?.id).toBe('mirror-yt')
  })

  it('records and retrieves failover history', () => {
    recordMirrorFailover('v1', 'primary', 'mirror-custom', 'HTTP 502 Bad Gateway')
    const history = getFailoverHistory('v1')
    expect(history.length).toBe(1)
    expect(history[0].fromSourceId).toBe('primary')
    expect(history[0].toSourceId).toBe('mirror-custom')
    expect(history[0].reason).toContain('HTTP 502')
  })
})

describe('Proposal [1]: Multimodal AI Keyframe & Code TOC', () => {
  it('parses timestamps in MM:SS and HH:MM:SS format', () => {
    expect(parseTimestampToSeconds('01:30')).toBe(90)
    expect(parseTimestampToSeconds('02:15:30')).toBe(8130)
    expect(parseTimestampToSeconds('invalid')).toBe(0)
  })

  it('extracts heuristic chapters and code blocks from text', () => {
    const desc = `
本课程介绍 Kubernetes 核心部署
00:00 简介与背景
02:15 编写 Pod 清单
\`\`\`yaml
apiVersion: v1
kind: Pod
metadata:
  name: demo-pod
\`\`\`
08:30 生产级探针与就绪检查
    `
    const { chapters, keyTakeaways, overview } = extractHeuristicChapters('K8s 实战', desc, 600)
    expect(chapters.length).toBe(3)
    expect(chapters[0].startTime).toBe(0)
    expect(chapters[1].startTime).toBe(135)
    expect(chapters[1].codeSnippet).toContain('demo-pod')
    expect(chapters[1].codeLanguage).toBe('yaml')
    expect(keyTakeaways.length).toBe(3)
    expect(overview).toContain('K8s 实战')
  })

  it('generates logical milestones if no timestamps in description', async () => {
    const summary = await getVideoAISummary({
      videoId: 'v-no-ts',
      title: 'Docker 从零入门',
      description: '简要介绍 Docker 核心命令',
      durationSec: 800,
    })
    expect(summary.chapters.length).toBeGreaterThanOrEqual(4)
    expect(summary.chapters[0].startTime).toBe(0)
    expect(summary.chapters[1].startTime).toBeGreaterThan(0)
  })
})

describe('Proposal [3]: Offline PWA & IndexedDB Cache', () => {
  const dummyItem: NavigationSubItem = {
    id: 'off-1',
    title: 'Offline Tutorial',
    href: 'https://example.com',
    enabled: true,
    videoConfig: {
      type: 'bilibili',
      bvid: 'BV1abc123',
    },
  }

  it('saves, checks, and retrieves offline videos', async () => {
    await saveOfflineVideo(dummyItem)
    const isCached = await isOfflineVideo('off-1')
    expect(isCached).toBe(true)

    const retrieved = await getOfflineVideo('off-1')
    expect(retrieved?.id).toBe('off-1')
    expect(retrieved?.title).toBe('Offline Tutorial')

    const list = await listOfflineVideos()
    expect(list.some(v => v.id === 'off-1')).toBe(true)

    await removeOfflineVideo('off-1')
    const existsAfterRemove = await isOfflineVideo('off-1')
    expect(existsAfterRemove).toBe(false)
  })
})

describe('Proposal [4]: Personal Learning Space: Watch Later & Custom Playlists', () => {
  const dummyItem1: NavigationSubItem = {
    id: 'v-item-1',
    title: 'Vue 3 实战',
    href: 'https://example.com/1',
    enabled: true,
    videoConfig: { type: 'bilibili', bvid: 'BV1' },
  }
  const dummyItem2: NavigationSubItem = {
    id: 'v-item-2',
    title: 'React 19 实战',
    href: 'https://example.com/2',
    enabled: true,
    videoConfig: { type: 'bilibili', bvid: 'BV2' },
  }

  it('initializes default system playlists including Watch Later', () => {
    const playlists = getUserPlaylists()
    expect(playlists.some(p => p.id === WATCH_LATER_ID)).toBe(true)
  })

  it('toggles Watch Later queue accurately', () => {
    expect(isInWatchLater('v-item-1')).toBe(false)
    const added = toggleWatchLater(dummyItem1)
    expect(added).toBe(true)
    expect(isInWatchLater('v-item-1')).toBe(true)

    const removed = toggleWatchLater(dummyItem1)
    expect(removed).toBe(false)
    expect(isInWatchLater('v-item-1')).toBe(false)
  })

  it('creates custom playlist and resolves next item for continuous playback', () => {
    const pl = createPlaylist('前端全栈课', '深入学习现代前端框架')
    expect(pl.title).toBe('前端全栈课')

    addToPlaylist(pl.id, dummyItem1)
    addToPlaylist(pl.id, dummyItem2)

    const nextFrom1 = getNextPlaylistItem(pl.id, dummyItem1.id)
    // dummyItem2 was added second (or unshifted), check navigation order
    expect(nextFrom1).not.toBeNull()

    removeFromPlaylist(pl.id, dummyItem1.id)
    const playlists = getUserPlaylists()
    const updatedPl = playlists.find(p => p.id === pl.id)
    expect(updatedPl?.items.some(i => i.id === dummyItem1.id)).toBe(false)
  })
})

describe('Proposal [6]: Tech-Stack & Behavioral Recommendation Engine', () => {
  it('extracts technical keywords and tokens accurately', () => {
    const text = 'Kubernetes K8s 容器编排与 Docker 构建实战教程'
    const tokens = extractTechKeywords(text)
    expect(tokens.has('k8s')).toBe(true)
    expect(tokens.has('kubernetes')).toBe(true)
    expect(tokens.has('docker')).toBe(true)
  })

  it('computes Jaccard Similarity correctly', () => {
    const setA = new Set(['k8s', 'docker', 'devops'])
    const setB = new Set(['docker', 'linux'])
    // Intersection: ['docker'] (1), Union: ['k8s', 'docker', 'devops', 'linux'] (4)
    const sim = computeJaccardSimilarity(setA, setB)
    expect(sim).toBeCloseTo(0.25, 2)
  })

  it('generates ranked personalized recommendations from a video pool', () => {
    const pool: NavigationSubItem[] = [
      {
        id: 'p1',
        title: 'K8s 生产部署进阶',
        href: '/videos?id=p1',
        enabled: true,
        tags: ['K8s', 'DevOps'],
        videoConfig: { type: 'bilibili', bvid: 'BV1', qualityScore: 90, freshnessScore: 85 },
      },
      {
        id: 'p2',
        title: 'UI 设计灵感',
        href: '/videos?id=p2',
        enabled: true,
        tags: ['Design'],
        videoConfig: { type: 'bilibili', bvid: 'BV2', qualityScore: 70, freshnessScore: 50 },
      },
      {
        id: 'p3',
        title: 'Docker 镜像瘦身技巧',
        href: '/videos?id=p3',
        enabled: true,
        tags: ['Docker', 'DevOps'],
        videoConfig: { type: 'bilibili', bvid: 'BV3', qualityScore: 95, freshnessScore: 90 },
      },
    ]

    const recs = getPersonalizedRecommendations({ pool, limit: 2 })
    expect(recs.length).toBe(2)
    // p1 and p3 have high quality & DevOps tags, should rank high
    expect(recs.some(r => r.id === 'p1' || r.id === 'p3')).toBe(true)
  })

  it('finds related videos for a current video', () => {
    const targetVideo: NavigationSubItem = {
      id: 'target',
      title: 'Docker 容器快速入门',
      href: '/videos?id=target',
      enabled: true,
      tags: ['Docker'],
      videoConfig: { type: 'bilibili', bvid: 'BVT' },
    }

    const pool: NavigationSubItem[] = [
      {
        id: 'r1',
        title: 'Docker 多阶段构建高级指南',
        href: '/videos?id=r1',
        enabled: true,
        tags: ['Docker'],
        videoConfig: { type: 'bilibili', bvid: 'BVR1' },
      },
      {
        id: 'r2',
        title: 'Python 数据分析入门',
        href: '/videos?id=r2',
        enabled: true,
        tags: ['Python'],
        videoConfig: { type: 'bilibili', bvid: 'BVR2' },
      },
    ]

    const related = getRelatedVideos(targetVideo, pool, 1)
    expect(related.length).toBe(1)
    expect(related[0].id).toBe('r1')
  })
})
