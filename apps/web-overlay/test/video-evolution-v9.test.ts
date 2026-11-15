import { describe, it, expect } from 'vitest'
import {
  evaluateVideoWithAIModel,
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
            enabled: true,
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

    describe('AutonomousAIHarvesterController', () => {
    it('executes a dry-run cycle without mutating original dataset items', async () => {
      const controller = new AutonomousAIHarvesterController()
      const { updatedData, report } = await controller.runCycle(mockNavigationData, { dryRun: true })

      expect(report.scannedCandidatesCount).toBeGreaterThan(0)
      expect(report.aiApprovedCount).toBeGreaterThan(0)
      expect(report.newCourses.length).toBeGreaterThan(0)
      expect(report.logs.length).toBeGreaterThan(5)

      // dryRun should not insert new items into updatedData
      const originalItemCount = mockNavigationData.navigationItems[0]?.items?.length ?? 0
      const updatedItemCount = updatedData.navigationItems[0]?.items?.length ?? 0
      expect(updatedItemCount).toBe(originalItemCount)
    })

    it('executes a real ingest cycle and correctly expands categories with AI metadata', async () => {
      const controller = new AutonomousAIHarvesterController()
      const { updatedData, report } = await controller.runCycle(mockNavigationData, { dryRun: false })

      expect(report.aiApprovedCount).toBeGreaterThan(0)
      const aiCat = updatedData.navigationItems.find(c => c.id === 'cat_ai_engineering')
      expect(aiCat).toBeDefined()
      // Should have new items added
      const aiItems = aiCat!.items ?? []
      expect(aiItems.length).toBeGreaterThan(1)

      const newlyAdded = aiItems[aiItems.length - 1]
      expect(newlyAdded?.videoConfig?.qualityScore).toBeGreaterThanOrEqual(70)
      // 合成章节/字幕默认关闭：模板内容不得冒充视频原文
      expect(newlyAdded?.videoConfig?.chapters).toBeUndefined()
      expect(newlyAdded?.videoConfig?.transcript).toBeUndefined()
      expect(newlyAdded?.videoConfig?.synthetic).toBeUndefined()
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
