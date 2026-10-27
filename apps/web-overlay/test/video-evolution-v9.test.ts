import { describe, it, expect } from 'vitest'
import {
  evaluateVideoWithAIModel,
  generateAISanitizedMetadata,
  AutonomousAIHarvesterController,
} from '../src/lib/video-autonomous-ai-harvester'
import type { NavigationData } from '../src/types/navigation'

describe('Autonomous AI Video Harvester & Intelligent Content Enrichment Pipeline', () => {
  const mockNavigationData: NavigationData = {
    navigationItems: [
      {
        id: 'cat_ai_engineering',
        title: 'AI 与大模型工程',
        icon: 'Bot',
        items: [
          {
            id: 'video_seed_1',
            title: '现有深度学习课程',
            href: 'https://www.bilibili.com/video/BV1seed1',
            videoConfig: {
              type: 'bilibili',
              bvid: 'BV1seed1',
              qualityScore: 88,
              author: '老导师',
            },
          },
        ],
        subCategories: [],
      },
      {
        id: 'cat_fullstack_architecture',
        title: '现代全栈与架构演进',
        icon: 'Globe',
        items: [],
        subCategories: [],
      },
    ],
  }

  describe('evaluateVideoWithAIModel', () => {
    it('rejects short video under 180 seconds due to lacking engineering depth', () => {
      const res = evaluateVideoWithAIModel({
        title: 'DeepSeek 30秒极速上手！',
        durationSec: 30,
        author: '快剪客',
      })

      expect(res.isApproved).toBe(false)
      expect(res.rejectReason).toContain('不足3分钟')
      expect(res.aiQualityScore).toBeLessThan(70)
    })

    it('rejects videos without hard technical keywords', () => {
      const res = evaluateVideoWithAIModel({
        title: '日常搞笑日常分享 vlog 真实记录',
        durationSec: 1200,
        author: '生活UP',
      })

      expect(res.isApproved).toBe(false)
      // 文案已改为可执行的说明：原「未识别到核心硬核计算机科学或软件工程关键词」
      // 无法区分「非技术内容」与「词表未覆盖该领域」
      expect(res.rejectReason).toContain('未匹配到技术栈关键词')
      expect(res.aiQualityScore).toBeLessThan(70)
    })

    it('approves enterprise-grade deep technical tutorial and calculates high quality score', () => {
      const res = evaluateVideoWithAIModel({
        title: 'DeepSeek-R1 架构剖析与企业级私有化 Agent 部署微调实战',
        description: '系统深入讲解 LLM、Agent 原理、RAG 向量检索以及分布式架构调优。',
        durationSec: 3600,
        author: '架构导师',
        stats: {
          views: 200000,
          likes: 20000,
          coins: 12000, // high coin ratio
          favorites: 30000,
        },
      })

      expect(res.isApproved).toBe(true)
      expect(res.aiQualityScore).toBeGreaterThanOrEqual(85)
      expect(res.techDepth).toBe('architect')
      expect(res.conceptTags).toContain('DeepSeek')
      expect(res.conceptTags).toContain('Agent')
      expect(res.pedagogicalValue).toContain('企业生产级必读')
    })

    it('flags clickbait titles correctly while penalizing score', () => {
      const normalRes = evaluateVideoWithAIModel({
        title: 'TypeScript 5.8 与 React 19 最佳实践',
        durationSec: 1500,
      })

      const clickbaitRes = evaluateVideoWithAIModel({
        title: '震惊！全网最强 TypeScript 5.8 与 React 19 秒杀所有架构！',
        durationSec: 1500,
      })

      expect(clickbaitRes.detectedClickbait).toBe(true)
      expect(clickbaitRes.aiQualityScore).toBeLessThan(normalRes.aiQualityScore)
    })
  })

  describe('generateAISanitizedMetadata', () => {
    it('sanitizes titles by removing brackets, punctuation and sensational tags', () => {
      const raw = '【全网最强】震惊！DeepSeek-R1 私有化微调实战！！！[无废话]'
      const sanitized = generateAISanitizedMetadata(raw, '课程详情介绍', 2400, ['DeepSeek', '微调'])

      expect(sanitized.cleanTitle).not.toContain('【全网最强】')
      expect(sanitized.cleanTitle).not.toContain('震惊')
      expect(sanitized.cleanTitle).not.toContain('！！！')
      expect(sanitized.cleanTitle).toContain('DeepSeek-R1 私有化微调实战')
    })

    it('synthesizes 4 balanced chapters with timestamps and code snippets', () => {
      const sanitized = generateAISanitizedMetadata('Rust 高性能网络编程', 'desc', 3600, ['Rust', 'Tokio'])

      expect(sanitized.chapters).toHaveLength(4)
      expect(sanitized.chapters[0].startTime).toBe(0)
      expect(sanitized.chapters[1].startTime).toBe(900)
      expect(sanitized.chapters[2].startTime).toBe(1800)
      expect(sanitized.chapters[3].startTime).toBe(2700)
      expect(sanitized.chapters[0].codeSnippet).toContain('Rust')
    })

    it('synthesizes transcripts and automated self-assessment quizzes', () => {
      const sanitized = generateAISanitizedMetadata('eBPF 与 Cilium 网络可观测性', 'desc', 2000, ['eBPF', 'Cilium'])

      expect(sanitized.transcripts.length).toBeGreaterThanOrEqual(4)
      expect(sanitized.quizzes.length).toBe(3)
      sanitized.quizzes.forEach(q => {
        expect(q.options.length).toBe(4)
        expect(q.correctAnswerIndex).toBeGreaterThanOrEqual(0)
        expect(q.correctAnswerIndex).toBeLessThan(4)
        expect(q.explanation.length).toBeGreaterThan(5)
      })
    })
  })

  describe('AutonomousAIHarvesterController', () => {
    it('executes a dry-run cycle without mutating original dataset items', async () => {
      const controller = new AutonomousAIHarvesterController()
      const { updatedData, report } = await controller.runCycle(mockNavigationData, { dryRun: true })

      expect(report.scannedCandidatesCount).toBeGreaterThan(0)
      expect(report.aiApprovedCount).toBeGreaterThan(0)
      expect(report.newCourses.length).toBeGreaterThan(0)
      expect(report.logs.length).toBeGreaterThan(5)

      // dryRun should not insert new items into updatedData
      const originalItemCount = mockNavigationData.navigationItems[0].items.length
      const updatedItemCount = updatedData.navigationItems[0].items.length
      expect(updatedItemCount).toBe(originalItemCount)
    })

    it('executes a real ingest cycle and correctly expands categories with AI metadata', async () => {
      const controller = new AutonomousAIHarvesterController()
      const { updatedData, report } = await controller.runCycle(mockNavigationData, { dryRun: false })

      expect(report.aiApprovedCount).toBeGreaterThan(0)
      const aiCat = updatedData.navigationItems.find(c => c.id === 'cat_ai_engineering')
      expect(aiCat).toBeDefined()
      // Should have new items added
      expect(aiCat!.items.length).toBeGreaterThan(1)

      const newlyAdded = aiCat!.items[aiCat!.items.length - 1]
      expect(newlyAdded.videoConfig?.qualityScore).toBeGreaterThanOrEqual(70)
      expect(newlyAdded.videoConfig?.chapters).toBeDefined()
      expect(newlyAdded.videoConfig?.transcript).toBeDefined()
    })

    it('respects forceCategory to restrict autonomous scan to single domain', async () => {
      const controller = new AutonomousAIHarvesterController()
      const { report } = await controller.runCycle(mockNavigationData, {
        dryRun: true,
        forceCategory: 'cat_devops_cloud',
      })

      expect(report.scannedCandidatesCount).toBeGreaterThan(0)
      report.newCourses.forEach(c => {
        expect(c.categoryTitle).toContain('云原生')
      })
    })

    it('retains recent logs with appropriate severity levels', async () => {
      const controller = new AutonomousAIHarvesterController()
      await controller.runCycle(mockNavigationData, { dryRun: true })
      const logs = controller.getLogs()

      expect(logs.length).toBeGreaterThan(0)
      const hasAiThought = logs.some(l => l.level === 'ai_thought')
      const hasApproved = logs.some(l => l.level === 'approved')
      expect(hasAiThought).toBe(true)
      expect(hasApproved).toBe(true)
    })
  })
})
