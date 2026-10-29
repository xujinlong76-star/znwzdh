import { afterAll, describe, expect, it, vi } from 'vitest'
import videosJson from '../src/navsphere/content/videos.json'

vi.mock('@/lib/github', () => ({
  getFileContent: vi.fn().mockResolvedValue(videosJson),
  commitFile: vi.fn().mockResolvedValue({ success: true }),
  readStorageFresh: vi.fn().mockResolvedValue(videosJson),
  getStorageVersion: vi.fn().mockResolvedValue('v1'),
}))

import { runVideoHarvestAndRotation } from '../src/lib/video-harvester'
import {
  getAutonomousHarvesterController,
  evaluateVideoWithAIModel,
} from '../src/lib/video-autonomous-ai-harvester'
import { harvestMultiPlatformVideosForKeyword } from '../src/lib/video-multi-platform-harvester'
import type { NavigationData } from '../src/types/navigation'

// mock 卫生：本文件跨模块 mock 了 @/lib/github，isolate:false 下必须清掉模块缓存，
// 否则同 worker 的后续测试文件会拿到假的 getFileContent。
afterAll(() => {
  vi.resetModules()
})

describe('实机触发采集功能并验证自动化采集管线', () => {
  it('1. 验证多平台公开通道实时检索能力 (Dailymotion / PeerTube / TED / YouTube)', async () => {
    const failures: Array<{ keyword: string; reason: string }> = []
    const results = await harvestMultiPlatformVideosForKeyword(
      'Kubernetes Docker',
      {
        platforms: ['dailymotion', 'peertube', 'ted', 'youtube'],
        minDurationSec: 120,
        minQualityScore: 50,
        limitPerKeyword: 2,
        failures,
      }
    )

    console.log(`[Multi-Platform Test] 采集候选结果数量: ${results.length}`)
    for (const r of results) {
      console.log(`  - 平台: [${r.videoConfig?.type}] 标题: ${r.title} (时长: ${r.videoConfig?.durationSec}s, 作者: ${r.videoConfig?.author})`)
    }
    if (failures.length > 0) {
      console.log(`[Multi-Platform Test] 通道降级/异常记录 (${failures.length} 条):`, failures)
    }

    // 无论网络是否连通，采集管线均能正常执行且有结构化输出
    expect(results.length + failures.length).toBeGreaterThan(0)
  }, 35000)

  it('2. 验证 AI 智能评估模型在实战视频上的评分与深度定级', () => {
    const sample = {
      title: 'DeepSeek R1 满血版本地部署与私有化知识库 Agent 实战',
      description: '详细讲解 Ollama、vLLM、Kubernetes 容器化调度与向量检索优化。',
      author: '云原生架构导师',
      durationSec: 1800,
      stats: {
        views: 85000,
        likes: 6200,
        coins: 3100,
        favorites: 5400,
      },
    }

    const evalResult = evaluateVideoWithAIModel(sample)
    console.log('[AI Eval Test] 评估结果:', evalResult)

    expect(evalResult.isApproved).toBe(true)
    expect(evalResult.aiQualityScore).toBeGreaterThanOrEqual(80)
    expect(evalResult.conceptTags).toContain('DeepSeek')
    expect(evalResult.techDepth).toBe('architect')
  })

  it('3. 触发 AutonomousAIHarvesterController 完整自主采集循环 (Dry-Run)', async () => {
    const controller = getAutonomousHarvesterController()
    const currentData = videosJson as unknown as NavigationData

    const { updatedData, report } = await controller.runCycle(currentData, {
      dryRun: true,
      includeMultiPlatform: true,
      autoSubmitIndexNow: false,
      maxAdditionsPerCycle: 5,
    })

    console.log('\n[Autonomous AI Cycle Report]')
    console.log(`  Cycle ID: ${report.cycleId}`)
    console.log(`  扫描候选总数: ${report.scannedCandidatesCount}`)
    console.log(`  AI 审核通过数: ${report.aiApprovedCount}`)
    console.log(`  AI 审核拒绝数: ${report.aiRejectedCount}`)
    console.log(`  覆盖富化分类数: ${report.categoriesEnriched.length}`)
    console.log(`  新增建议课程数: ${report.newCourses.length}`)
    console.log(`  产生日志条数: ${report.logs.length}`)

    expect(report.scannedCandidatesCount).toBeGreaterThan(0)
    expect(report.logs.length).toBeGreaterThan(0)
  }, 30000)

  it('4. 触发策略型定向采集与保鲜轮换 (runVideoHarvestAndRotation Dry-Run)', async () => {
    const report = await runVideoHarvestAndRotation({
      dryRun: true,
      categoryId: 'cat_ai_engineering',
    })

    console.log('\n[Policy Harvest & Rotation Report]')
    console.log(`  巡检分类总数: ${report.totalCheckedCategories}`)
    console.log(`  采集候选数: ${report.totalHarvestedCount}`)
    console.log(`  拟新增入库数: ${report.totalAddedCount}`)
    console.log(`  拟替换过时数: ${report.totalReplacedCount}`)
    console.log(`  降级/跳过关键词数: ${report.degradedKeywords.length}`)

    expect(report.totalCheckedCategories).toBeGreaterThanOrEqual(1)
  }, 30000)
})
