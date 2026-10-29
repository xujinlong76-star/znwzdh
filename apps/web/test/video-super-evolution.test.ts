import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock github lib
vi.mock('@/lib/github', () => ({
  getFileContent: vi.fn(),
  saveFileContent: vi.fn(),
}))

import {
  sweepVideoHealth,
  getLatestSweepReport,
  type ProbeResult,
} from '@/lib/video-deadlink-sweeper'
import {
  getP2PStreamCoordinator,
  resetP2PStreamCoordinator,
} from '@/lib/p2p-stream-loader'
import {
  parseWebVTT,
  parseSRT,
  findActiveTranscriptItem,
  searchTranscript,
  exportTranscriptAsMarkdown,
} from '@/lib/video-transcript-sync'
import {
  extractCodeFromOCR,
  saveStudyNote,
  listStudyNotes,
  deleteStudyNote,
  exportNotesAsMarkdown,
  type VideoStudyNote,
} from '@/lib/video-frame-clipper'
import {
  DanmakuEngine,
  getStoredDanmaku,
  saveDanmakuItem,
} from '@/lib/video-danmaku-engine'
import type { NavigationData } from '@/types/navigation'

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
  resetP2PStreamCoordinator()
  ;(globalThis as any).localStorage = mockStorage
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      writable: true,
    })
  }
})

describe('Proposal [5]: Video Quality Assessment & Deadlink Sweeper', () => {
  const dummyNavData: NavigationData = {
    navigationItems: [
      {
        id: 'cat-1',
        title: '云原生与容器',
        items: [
          {
            id: 'v-healthy',
            title: 'K8s 生产部署',
            href: 'https://example.com',
            enabled: true,
            videoConfig: { type: 'bilibili', bvid: 'BV_OK' },
          },
          {
            id: 'v-broken',
            title: '过时已被删教程',
            href: 'https://example.com',
            enabled: true,
            videoConfig: { type: 'bilibili', bvid: 'BV_DEAD' },
          },
        ],
      },
    ],
  }

  it('sweeps and flags broken video assets with custom prober', async () => {
    const mockProber = async (item: any): Promise<ProbeResult> => {
      if (item.id === 'v-broken') {
        return {
          videoId: item.id,
          title: item.title,
          platform: 'bilibili',
          healthy: false,
          statusCode: -404,
          reason: '视频已被UP主删除',
          latencyMs: 120,
        }
      }
      return {
        videoId: item.id,
        title: item.title,
        platform: 'bilibili',
        healthy: true,
        statusCode: 200,
        latencyMs: 80,
      }
    }

    // sweepVideoHealth 的返回已改为 { report, updatedData }：
    // 原声明 Promise<SweepReport> 与实现不符（ignoreBuildErrors 掩盖），
    // 且调用方需要 updatedData 才能把 prune 结果落盘。
    const { report } = await sweepVideoHealth(dummyNavData, {
      prober: mockProber,
    })

    expect(report.totalScanned).toBe(2)
    expect(report.healthyCount).toBe(1)
    expect(report.brokenCount).toBe(1)
    expect(report.brokenItems[0].id).toBe('v-broken')
    expect(dummyNavData.navigationItems[0].items![1].videoConfig?.healthStatus).toBe('broken')
  })
})

describe('Proposal [3]: Adaptive Bitrate & P2P Mesh Streaming', () => {
  it('manages P2P chunk cache and computes offload ratio', async () => {
    const coordinator = getP2PStreamCoordinator({ enableP2P: true })
    const stats0 = coordinator.getStats()
    expect(stats0.cachedChunks).toBe(0)
    expect(stats0.p2pRatio).toBe(0)

    // Simulate chunk download
    const globalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(1024), // 1KB
    })

    const res1 = await coordinator.fetchChunk('https://stream.example.com/seg1.ts')
    expect(res1.source).toBe('cdn')

    // Second fetch of same segment should hit P2P mesh cache
    const res2 = await coordinator.fetchChunk('https://stream.example.com/seg1.ts')
    expect(res2.source).toBe('p2p')

    const stats = coordinator.getStats()
    expect(stats.cdnBytes).toBe(1024)
    expect(stats.p2pBytes).toBe(1024)
    expect(stats.p2pRatio).toBe(0.5)

    globalThis.fetch = globalFetch
  })
})

describe('Proposal [4]: Bilingual Subtitle Sync & Transcript', () => {
  const sampleVtt = `WEBVTT

00:01.000 --> 00:04.500
Hello everyone, welcome to Kubernetes course.
大家好，欢迎来到 Kubernetes 实战进阶。

00:05.000 --> 00:09.000
Today we will discuss multi-cluster ingress routing.
今天我们将深入拆解多集群入口路由网关。
`

  it('parses WebVTT format into bilingual subtitle cues', () => {
    const cues = parseWebVTT(sampleVtt)
    expect(cues.length).toBe(2)
    expect(cues[0].startSec).toBe(1)
    expect(cues[0].endSec).toBe(4.5)
    expect(cues[0].text).toContain('Hello everyone')
    expect(cues[0].translation).toContain('大家好')
  })

  it('locates active transcript cue by playhead timestamp', () => {
    const cues = parseWebVTT(sampleVtt)
    const active = findActiveTranscriptItem(cues, 3.2)
    expect(active).not.toBeNull()
    expect(active?.startSec).toBe(1)

    const none = findActiveTranscriptItem(cues, 15.0)
    expect(none).toBeNull()
  })

  it('searches cues and exports as formatted Markdown notes', () => {
    const cues = parseWebVTT(sampleVtt)
    const searchRes = searchTranscript(cues, 'ingress')
    expect(searchRes.length).toBe(1)
    expect(searchRes[0].item.text).toContain('ingress')

    const md = exportTranscriptAsMarkdown(cues, 'K8s 课程')
    expect(md).toContain('# K8s 课程 · 逐字文字稿与学习笔记')
    expect(md).toContain('[00:01]')
  })
})

describe('Proposal [1]: Frame Clipper & Visual Notes', () => {
  it('extracts technical commands and code from raw OCR text', () => {
    const rawOcr = `
配置示例如下：
$ kubectl apply -f deployment.yaml
apiVersion: apps/v1
kind: Deployment
注意生产环境副本数不要少于3个
    `
    const { codeSnippet, plainText } = extractCodeFromOCR(rawOcr)
    expect(codeSnippet).toContain('kubectl apply')
    expect(codeSnippet).toContain('apiVersion: apps/v1')
    expect(plainText).toContain('配置示例如下')
  })

  it('persists, queries, and exports study notes to Markdown', () => {
    const note: VideoStudyNote = {
      id: 'note-1',
      videoId: 'v100',
      videoTitle: 'Docker 深入剖析',
      timeSec: 125,
      userNote: '核心启动指令与参数解析',
      codeSnippet: 'docker run -d -p 80:80 nginx',
      createdAt: new Date().toISOString(),
    }

    saveStudyNote(note)
    const list = listStudyNotes('v100')
    expect(list.length).toBe(1)
    expect(list[0].id).toBe('note-1')

    const md = exportNotesAsMarkdown(list, 'Docker 深入剖析')
    expect(md).toContain('# Docker 深入剖析 · 视频学习笔记与代码快照')
    expect(md).toContain('[02:05]')
    expect(md).toContain('docker run -d')

    deleteStudyNote('note-1')
    expect(listStudyNotes('v100').length).toBe(0)
  })
})

describe('Proposal [2]: Canvas Danmaku Engine & Pitfall Warnings', () => {
  it('adds and sorts danmaku items and tracks pitfalls', () => {
    const engine = new DanmakuEngine([
      { id: 'd1', timeSec: 10, text: '讲得很清晰！' },
      { id: 'd2', timeSec: 5, text: '注意这里的坑点！', isPitfallWarning: true },
    ])

    // Saved in persistent storage
    const created = saveDanmakuItem('vid-1', {
      timeSec: 25,
      text: '生产环境记得加内存限制',
      isPitfallWarning: true,
      author: '架构师小王',
    })
    expect(created.id).toContain('dmk-')

    const stored = getStoredDanmaku('vid-1')
    expect(stored.length).toBe(1)
    expect(stored[0].isPitfallWarning).toBe(true)
  })

  it('renders canvas frames without throwing errors', () => {
    const engine = new DanmakuEngine([
      { id: 'd1', timeSec: 2, text: 'Hello Danmaku' },
      { id: 'd2', timeSec: 2.5, text: '避坑提示', isPitfallWarning: true },
    ])

    // Mock Canvas Context
    const mockCtx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 80 }),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      font: '',
      textBaseline: '',
      globalAlpha: 1,
      shadowColor: '',
      shadowBlur: 0,
      lineWidth: 1,
      strokeStyle: '',
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D

    expect(() => {
      engine.renderFrame(2.2, mockCtx, 800, 450)
    }).not.toThrow()

    expect(mockCtx.clearRect).toHaveBeenCalled()
    expect(mockCtx.fillText).toHaveBeenCalled()
  })
})

// mock-hygiene：本文件对 `@/lib/github` 做了跨模块 mock，必须在每个用例后重置
// 模块注册表，否则同进程的其它测试文件会拿到被 mock 过的版本（isolate:false 的前置要求）。
afterEach(() => {
  vi.resetModules()
})
