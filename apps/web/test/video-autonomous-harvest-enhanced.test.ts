import { describe, expect, it, vi } from 'vitest'
import {
  evaluateVideoWithAIModel,
  generateAISanitizedMetadata,
  AutonomousAIHarvesterController,
} from '../src/lib/video-autonomous-ai-harvester'
import {
  submitUrlsToIndexNow,
  enrichVideoItemSeo,
} from '../src/lib/video-seo'
import {
  harvestMultiPlatformVideosForKeyword,
} from '../src/lib/video-multi-platform-harvester'
import type { NavigationData } from '../src/types/navigation'

describe('Autonomous Multi-Platform Video Harvester & Intelligent SEO Engine', () => {
  describe('evaluateVideoWithAIModel 智能评估与教学价值定级', () => {
    it('对前沿大模型与高并发架构教程给出 85+ 优异评分与 architect 定级', () => {
      const result = evaluateVideoWithAIModel({
        title: 'DeepSeek R1 本地部署与高并发微服务架构实战：从零构建分布式 Agent 集群',
        description: '系统深入讲解 Kubernetes 集群调度、Tokio 异步并发与内存模型调优。',
        durationSec: 2400,
        author: '分布式架构实验室',
        stats: {
          views: 60000,
          likes: 5000,
          coins: 3000,
          favorites: 4500,
        },
      })

      expect(result.isApproved).toBe(true)
      expect(result.aiQualityScore).toBeGreaterThanOrEqual(85)
      expect(result.techDepth).toBe('architect')
      expect(result.conceptTags).toContain('DeepSeek')
      expect(result.conceptTags).toContain('架构')
      expect(result.detectedClickbait).toBe(false)
    })

    it('对短于 180s 的碎片短视频予以拦截拒绝', () => {
      const result = evaluateVideoWithAIModel({
        title: '一分钟学会 Kubernetes 核心架构',
        description: '快速入门',
        durationSec: 120, // 2 分钟
      })

      expect(result.isApproved).toBe(false)
      expect(result.rejectReason).toContain('不足3分钟')
      expect(result.aiQualityScore).toBeLessThan(50)
    })

    it('对标题党营销话术施加严厉惩罚分', () => {
      const normalResult = evaluateVideoWithAIModel({
        title: 'Rust Tokio 异步编程与系统内核高性能实战指南',
        description: '深入分析 Rust 并发安全与内存模型。',
        durationSec: 1800,
      })

      const clickbaitResult = evaluateVideoWithAIModel({
        title: '震惊！全网最强逆天神作！看这一篇就够了！秒杀所有 Rust 教程',
        description: '深入分析 Rust 并发安全与内存模型。',
        durationSec: 1800,
      })

      expect(clickbaitResult.detectedClickbait).toBe(true)
      expect(clickbaitResult.aiQualityScore).toBeLessThan(normalResult.aiQualityScore)
    })

    it('支持新兴 2025/2026 技术关键词 (MCP, LangGraph, vLLM, eBPF, Cilium)', () => {
      const result = evaluateVideoWithAIModel({
        title: 'Anthropic MCP 协议标准与 LangGraph 多智能体协同开发实战',
        durationSec: 1500,
      })

      expect(result.isApproved).toBe(true)
      expect(result.conceptTags).toContain('MCP')
    })
  })

  describe('submitUrlsToIndexNow 搜索引擎主动推送协议', () => {
    it('未配置 INDEXNOW_KEY 时优雅跳过并返回明确说明', async () => {
      const result = await submitUrlsToIndexNow(
        ['https://example.com/videos/v/course-1'],
        { key: '' }
      )
      expect(result.ok).toBe(false)
      expect(result.submitted).toBe(0)
      expect(result.error).toContain('未配置 INDEXNOW_KEY')
    })

    it('向 IndexNow 正确发送批量 JSON Payload 并处理成功响应', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      })

      const urls = [
        'https://example.com/videos/v/course-1',
        'https://example.com/videos/v/course-2',
      ]

      const result = await submitUrlsToIndexNow(urls, {
        key: 'test-indexnow-key-12345678',
        siteOrigin: 'https://example.com',
        fetchImpl: mockFetch as any,
      })

      expect(result.ok).toBe(true)
      expect(result.submitted).toBe(2)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const callArgs = mockFetch.mock.calls[0]
      expect(callArgs[0]).toBe('https://api.indexnow.org/indexnow')
      const sentBody = JSON.parse(callArgs[1].body)
      expect(sentBody.host).toBe('example.com')
      expect(sentBody.key).toBe('test-indexnow-key-12345678')
      expect(sentBody.urlList).toEqual(urls)
    })
  })

  describe('harvestMultiPlatformVideosForKeyword 多平台搜索扩展', () => {
    it('支持 TED Talks 公开 API 搜索通道与 SEO 元数据富化', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('ted.com/talks.json')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                talks: [
                  {
                    slug: 'sal_khan_ai_education',
                    name: 'How AI Could Save (Not Destroy) Education',
                    description: 'Sal Khan talks about the future of AI-powered tutoring systems.',
                    duration: 960,
                    published_at: '2024-05-10T12:00:00Z',
                    speaker_name: 'Sal Khan',
                    primary_image_tag: 'https://pi.tedcdn.com/sal_khan.jpg',
                    view_count: 240000,
                  },
                ],
              }),
          })
        }
        return Promise.reject(new Error('Unknown URL'))
      })

      const items = await harvestMultiPlatformVideosForKeyword(
        'AI Education',
        {
          platforms: ['ted'],
          minDurationSec: 180,
          limitPerKeyword: 2,
        },
        mockFetch as any
      )

      expect(items.length).toBe(1)
      const tedItem = items[0]
      expect(tedItem.videoConfig?.type).toBe('ted')
      expect(tedItem.videoConfig?.videoId).toBe('sal_khan_ai_education')
      expect(tedItem.videoConfig?.author).toBe('Sal Khan')
      expect(tedItem.videoConfig?.durationSec).toBe(960)
      // SEO 富化验证
      expect(tedItem.videoConfig?.seoSlug).toBeDefined()
      expect(tedItem.videoConfig?.seoTitle).toContain('How AI Could Save')
    })

    it('支持 YouTube 开放镜像通道搜索与解析', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('search?q=')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                items: [
                  {
                    url: '/watch?v=dQw4w9WgXcQ',
                    title: 'Fullstack Next.js and React 19 Engineering Masterclass',
                    uploaderName: 'Web Mastery',
                    duration: 1800,
                    uploaded: Date.now() - 86400000,
                    views: 45000,
                    thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
                  },
                ],
              }),
          })
        }
        return Promise.reject(new Error('Network error'))
      })

      const items = await harvestMultiPlatformVideosForKeyword(
        'Next.js React 19',
        {
          platforms: ['youtube'],
          minDurationSec: 300,
          limitPerKeyword: 1,
        },
        mockFetch as any
      )

      expect(items.length).toBe(1)
      const ytItem = items[0]
      expect(ytItem.videoConfig?.type).toBe('youtube')
      expect(ytItem.videoConfig?.videoId).toBe('dQw4w9WgXcQ')
      expect(ytItem.videoConfig?.author).toBe('Web Mastery')
      expect(ytItem.videoConfig?.durationSec).toBe(1800)
    })
  })

  describe('AutonomousAIHarvesterController 全自动自主采集循环', () => {
    it('执行完整采集周期，多平台排重入库并提交 IndexNow', async () => {
      const controller = new AutonomousAIHarvesterController()

      const initialData: NavigationData = {
        navigationItems: [
          {
            id: 'cat_ai_engineering',
            title: 'AI 与大模型工程',
            enabled: true,
            items: [],
            subCategories: [
              {
                id: 'sub_ai_agents',
                title: '多智能体协同开发',
                enabled: true,
                items: [],
              },
            ],
            harvestPolicy: {
              enabled: true,
              keywords: ['Agent 开发'],
              platforms: ['ted'],
              maxItems: 10,
              minQualityScore: 70,
              minDurationSec: 180,
            },
          },
        ],
      }

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('ted.com/talks.json')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                talks: [
                  {
                    slug: 'ai_autonomous_agent_architecture',
                    name: 'Autonomous AI Agents and the Future of Software Systems',
                    description: 'Deep architectural discussion of LLM reasoning engines and agents.',
                    duration: 1200,
                    published_at: '2024-06-01T10:00:00Z',
                    speaker_name: 'Andrew Ng',
                    primary_image_tag: 'https://pi.tedcdn.com/andrew_ng.jpg',
                    view_count: 500000,
                  },
                ],
              }),
          })
        }
        if (url.includes('indexnow.org/indexnow')) {
          return Promise.resolve({
            ok: true,
            status: 200,
          })
        }
        return Promise.reject(new Error('Unknown URL'))
      })

      const { updatedData, report } = await controller.runCycle(initialData, {
        dryRun: false,
        forceCategory: 'cat_ai_engineering',
        includeMultiPlatform: true,
        autoSubmitIndexNow: true,
        maxAdditionsPerCycle: 10,
        fetchImpl: mockFetch as any,
      })

      expect(report.scannedCandidatesCount).toBeGreaterThan(0)
      expect(report.aiApprovedCount).toBeGreaterThan(0)
      expect(report.newCourses.length).toBeGreaterThan(0)
      expect(report.logs.length).toBeGreaterThan(0)

      // 验证入库条目落入正确的分类树结构中
      const aiCat = updatedData.navigationItems.find((c) => c.id === 'cat_ai_engineering')
      expect(aiCat).toBeDefined()
      const totalItems = (aiCat?.items?.length || 0) + (aiCat?.subCategories?.[0]?.items?.length || 0)
      expect(totalItems).toBeGreaterThan(0)

      // 第二次跑同一数据应当触发排重跳过
      const secondRun = await controller.runCycle(updatedData, {
        dryRun: false,
        forceCategory: 'cat_ai_engineering',
        includeMultiPlatform: false,
        fetchImpl: mockFetch as any,
      })
      expect(secondRun.report.newCourses.length).toBe(0)
    })
  })
})
