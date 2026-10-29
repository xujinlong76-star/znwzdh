import { describe, expect, it, vi, afterAll } from 'vitest'
import videosJson from '../src/navsphere/content/videos.json'

vi.mock('@/lib/github', () => ({
  getFileContent: vi.fn().mockResolvedValue(videosJson),
  commitFile: vi.fn().mockResolvedValue({ success: true }),
  readStorageFresh: vi.fn().mockResolvedValue(videosJson),
  getStorageVersion: vi.fn().mockResolvedValue('v1'),
}))

import {
  AutonomousAIHarvesterController,
  evaluateVideoWithAIModel,
} from '../src/lib/video-autonomous-ai-harvester'
import {
  generateVideoSitemapXml,
  generateVideoRssFeed,
  auditVideoSeoReadiness,
} from '../src/lib/video-seo'
import { videoExternalKey } from '../src/lib/video-identity'
import type { NavigationData, NavigationSubItem } from '../src/types/navigation'

// mock 卫生兜底：本文件跨模块 mock 了别的模块，isolate:false 下必须清缓存，
// 否则同 worker 的后续测试文件会拿到假模块。
afterAll(() => {
  vi.resetModules();
});

describe('全自动自主采集深度实测试验与自愈校验 (Full Autonomous Harvest Trial)', () => {
  it('执行真实全自动采集（dryRun=false），验证新课程入库、数据自洽性与 SEO 完整闭环', async () => {
    const controller = new AutonomousAIHarvesterController()
    const initialData = JSON.parse(JSON.stringify(videosJson)) as NavigationData

    // 1. 模拟网络请求：针对多平台开放接口提供可靠响应
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('ted.com/talks.json')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              talks: [
                {
                  slug: 'sam_altman_future_of_ai_scale',
                  name: 'The Future of AI and Scaling Compute Systems',
                  description: 'Deep dive into compute scaling laws, distributed training, and AI reasoning models.',
                  duration: 1350,
                  published_at: '2025-02-15T10:00:00Z',
                  speaker_name: 'Sam Altman',
                  primary_image_tag: 'https://pi.tedcdn.com/sam_altman.jpg',
                  view_count: 650000,
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
      return Promise.reject(new Error(`Unhandled network request: ${url}`))
    })

    // 2. 触发全自动采集周期（非试运行模式 dryRun: false）
    const { updatedData, report } = await controller.runCycle(initialData, {
      dryRun: false,
      includeMultiPlatform: true,
      autoSubmitIndexNow: true,
      maxAdditionsPerCycle: 6,
      fetchImpl: mockFetch as any,
    })

    console.log('\n========================================')
    console.log('       全自动自主采集实跑执行报告')
    console.log('========================================')
    console.log(`Cycle ID:              ${report.cycleId}`)
    console.log(`执行耗时:              ${report.completedAt - report.startedAt}ms`)
    console.log(`候选扫描总数:          ${report.scannedCandidatesCount}`)
    console.log(`AI 评估通过数:         ${report.aiApprovedCount}`)
    console.log(`AI 评估拒绝数:         ${report.aiRejectedCount}`)
    console.log(`富化技术分类数:        ${report.categoriesEnriched.length}`)
    console.log(`新入库课程总数:        ${report.newCourses.length}`)
    console.log(`搜索引擎 IndexNow 提交: ${report.indexNowSubmitted || 0} 个落地页`)
    console.log(`AI 思考追踪日志条数:    ${report.logs.length}`)
    console.log('----------------------------------------')

    expect(report.scannedCandidatesCount).toBeGreaterThan(0)
    expect(report.aiApprovedCount).toBeGreaterThan(0)
    expect(report.newCourses.length).toBeGreaterThan(0)
    expect(report.categoriesEnriched.length).toBeGreaterThan(0)

    // 3. 逐条校验新入库课程的结构自洽性与合规性
    for (const nc of report.newCourses) {
      console.log(`  ✓ 课程: [${nc.platform || 'bilibili'}] 《${nc.title}》`)
      console.log(`    所属分类: ${nc.categoryTitle} | AI 教学价值评分: ${nc.aiScore}分 | 时长: ${nc.durationSec}s`)
      expect(nc.aiScore).toBeGreaterThanOrEqual(70)
      expect(nc.durationSec).toBeGreaterThanOrEqual(180)
    }

    // 4. 验证更新后的完整视频库中条目的各项字段完整性
    const allItems: NavigationSubItem[] = []
    const keySet = new Set<string>()
    const duplicates: string[] = []

    for (const cat of updatedData.navigationItems) {
      for (const item of cat.items || []) {
        allItems.push(item)
        const key = videoExternalKey(item.videoConfig)
        if (key) {
          if (keySet.has(key)) duplicates.push(key)
          keySet.add(key)
        }
      }
      for (const sub of cat.subCategories || []) {
        for (const item of sub.items || []) {
          allItems.push(item)
          const key = videoExternalKey(item.videoConfig)
          if (key) {
            if (keySet.has(key)) duplicates.push(key)
            keySet.add(key)
          }
        }
      }
    }

    console.log(`\n视频库去重排查: 检查了 ${allItems.length} 部视频，重复键数量: ${duplicates.length}`)
    // 全局排重守卫：不可存在任何重复视频复合键
    expect(duplicates).toEqual([])

    // 5. 校验本轮新入库视频必须自动带有 SEO 增强字段
    const newTitles = new Set(report.newCourses.map((c) => c.title))
    const newlyAddedItems = allItems.filter((it) => newTitles.has(it.title))
    expect(newlyAddedItems.length).toBeGreaterThan(0)

    for (const item of newlyAddedItems) {
      const cfg = item.videoConfig!
      expect(cfg.qualityScore).toBeGreaterThanOrEqual(70)
      expect(cfg.freshnessScore).toBeGreaterThan(0)
      expect(cfg.healthStatus).toBe('healthy')
      expect(cfg.seoSlug).toBeDefined()
      expect(cfg.seoSlug).toMatch(/^[a-z0-9_-]+$/)
      expect(cfg.seoTitle).toBeDefined()
      expect(cfg.seoKeywords).toBeDefined()
      expect(cfg.seoKeywords!.length).toBeGreaterThan(0)
    }

    // 6. 验证 SEO Sitemap 与 MRSS Feed 端到端生成
    const sitemapXml = generateVideoSitemapXml(allItems.slice(0, 50), 'https://navhub.example.com')
    expect(sitemapXml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(sitemapXml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
    expect(sitemapXml).toContain('<video:video>')

    const rssXml = generateVideoRssFeed(allItems.slice(0, 50), 'https://navhub.example.com')
    expect(rssXml).toContain('<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"')
    expect(rssXml).toContain('<channel>')
    expect(rssXml).toContain('<item>')

    // 7. 审计整库 SEO 收录就绪度
    const audit = auditVideoSeoReadiness(allItems)
    console.log(`\n整库 SEO 收录就绪度评分: ${audit.seoScore}分 / 100`)
    console.log('平台分布统计:', audit.platformBreakdown)
    expect(audit.seoScore).toBeGreaterThanOrEqual(70)

    // 8. 自愈验证：二次采集相同数据，验证排重防抖机制生效（0 重复入库）
    const secondRun = await controller.runCycle(updatedData, {
      dryRun: false,
      includeMultiPlatform: false,
      fetchImpl: mockFetch as any,
    })
    console.log(`二次采集防抖结果: 本次新增 ${secondRun.report.newCourses.length} 部（预期 0 部，成功自愈去重）`)
    expect(secondRun.report.newCourses.length).toBe(0)
  })
})
