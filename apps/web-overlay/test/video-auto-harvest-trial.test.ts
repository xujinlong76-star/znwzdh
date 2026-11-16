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
    // 新增数与库状态有关，不硬编码 >0：30 个精选选题大多已在 2265 条库中，
    // 本轮只补缺失的几条；真正的不变量是「不超过上限」+「不重复入库」（见第 8 步）。
    expect(report.newCourses.length).toBeLessThanOrEqual(6)
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
    // （若本轮无新增——精选池已全在库——则跳过，防抖收敛由第 8 步断言）
    const newTitles = new Set(report.newCourses.map((c) => c.title))
    const newlyAddedItems = allItems.filter((it) => newTitles.has(it.title))
    expect(newlyAddedItems.length).toBe(report.newCourses.length)

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

    // 8. 自愈验证：反复采集直到收敛——每轮新增递减至 0，且再跑一轮仍为 0。
    //
    // 旧算术已失效：它假设空库起步（2026-11-13 清空后），精选池 30 个选题
    // 都不在库，第 2 轮（上限 100）必补齐剩余 24 个、第 3 轮 0 新增。
    // 现库里已有 2265 条，30 个选题大多已在库——第 1 轮只补了缺失的 5 条，
    // 第 2 轮 0 新增是正确的防抖表现，不是失败。
    // 真正与库状态无关的不变量：重复采集最终收敛到 0 新增，且永不重复入库。
    // 因此用排空循环代替固定轮次：第 1 轮上限 6 可能留有缺失选题，排空轮
    // （上限 100）把剩余选题一次性补齐，随后轮次必须 0 新增。
    let currentData = updatedData
    let drainedAdditions = -1
    for (let i = 0; i < 5 && drainedAdditions !== 0; i++) {
      const drainRun = await controller.runCycle(currentData, {
        dryRun: false,
        includeMultiPlatform: false,
        maxAdditionsPerCycle: 100,
        fetchImpl: mockFetch as any,
      })
      drainedAdditions = drainRun.report.newCourses.length
      currentData = drainRun.updatedData
      console.log(`排空第 ${i + 1} 轮: 本次新增 ${drainedAdditions} 部`)
    }
    expect(drainedAdditions).toBe(0)

    const confirmRun = await controller.runCycle(currentData, {
      dryRun: false,
      includeMultiPlatform: false,
      fetchImpl: mockFetch as any,
    })
    console.log(`确认轮防抖结果: 本次新增 ${confirmRun.report.newCourses.length} 部（预期 0 部，成功自愈去重）`)
    expect(confirmRun.report.newCourses.length).toBe(0)
  })

  it('种子正向用例：空库起步必须真实新增（什么都不新增的采集器必失败）', async () => {
    const controller = new AutonomousAIHarvesterController()
    // 种子空库：30 个精选选题全都不在库，采集器必须真实产出新增。
    const emptyData = { navigationItems: [] } as NavigationData

    // 拒绝一切未处理的网络请求：空库 + 纯精选池路径不应产生任何 fetch
    //（多平台扩展已关闭，IndexNow 提交已关闭）。
    const mockFetch = vi.fn().mockImplementation((url: string) =>
      Promise.reject(new Error(`Unhandled network request: ${url}`))
    )

    // 第 1 轮：空库起步，上限 6。
    const first = await controller.runCycle(emptyData, {
      dryRun: false,
      includeMultiPlatform: false,
      autoSubmitIndexNow: false,
      maxAdditionsPerCycle: 6,
      fetchImpl: mockFetch as any,
    })

    console.log('\n========================================')
    console.log('       种子正向用例：空库起步实跑报告')
    console.log('========================================')
    console.log(`候选扫描总数:          ${first.report.scannedCandidatesCount}`)
    console.log(`AI 评估通过数:         ${first.report.aiApprovedCount}`)
    console.log(`AI 评估拒绝数:         ${first.report.aiRejectedCount}`)
    console.log(`富化技术分类数:        ${first.report.categoriesEnriched.length}`)
    console.log(`新入库课程总数:        ${first.report.newCourses.length}`)
    console.log('----------------------------------------')

    // 核心正向断言：空库 + 精选池，一个什么都不新增的采集器必须在这里失败。
    // （这是本文件的正向覆盖锚点——上面那个用例在 2265 条库上允许 0 新增。）
    expect(first.report.scannedCandidatesCount).toBeGreaterThan(0)
    expect(first.report.aiApprovedCount).toBeGreaterThan(0)
    expect(first.report.newCourses.length).toBeGreaterThan(0)
    expect(first.report.newCourses.length).toBeLessThanOrEqual(6)
    expect(first.report.categoriesEnriched.length).toBeGreaterThan(0)
    // 空库 + 纯精选池路径全程无网络：任何 fetch 都是实现越界。
    expect(mockFetch).not.toHaveBeenCalled()

    // 逐条校验新入库课程的评分与时长基线。
    for (const nc of first.report.newCourses) {
      console.log(`  ✓ 课程: [${nc.platform || 'bilibili'}] 《${nc.title}》`)
      console.log(`    所属分类: ${nc.categoryTitle} | AI 教学价值评分: ${nc.aiScore}分 | 时长: ${nc.durationSec}s`)
      expect(nc.aiScore).toBeGreaterThanOrEqual(70)
      expect(nc.durationSec).toBeGreaterThanOrEqual(180)
    }

    // 校验本轮新入库视频的 SEO 增强字段（复用上一个用例第 5 步的模式：
    // 空库下分类是采集器现场创建的，条目落在子分类里，同样要扫全量）。
    const collectAllItems = (data: NavigationData): NavigationSubItem[] => {
      const all: NavigationSubItem[] = []
      for (const cat of data.navigationItems) {
        all.push(...(cat.items || []))
        for (const sub of cat.subCategories || []) {
          all.push(...(sub.items || []))
        }
      }
      return all
    }
    const firstItems = collectAllItems(first.updatedData)
    const newTitles = new Set(first.report.newCourses.map((c) => c.title))
    const newlyAddedItems = firstItems.filter((it) => newTitles.has(it.title))
    expect(newlyAddedItems.length).toBe(first.report.newCourses.length)

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

    // 排空轮：上限 100，一次性补齐第 1 轮上限之外剩余的全部已批准选题。
    const drain = await controller.runCycle(first.updatedData, {
      dryRun: false,
      includeMultiPlatform: false,
      autoSubmitIndexNow: false,
      maxAdditionsPerCycle: 100,
      fetchImpl: mockFetch as any,
    })
    console.log(`排空轮: 本次新增 ${drain.report.newCourses.length} 部`)
    // 精选池共 30 个选题，第 1 轮上限 6 已入 6 个，排空轮必须正好补齐剩余 24 个；
    // 只断言 ≤100 会让「后 24 个选题被静默拒绝」也通过，确认轮 0 新增兜不住。
    expect(drain.report.newCourses.length).toBe(24)
    for (const nc of drain.report.newCourses) {
      expect(nc.aiScore).toBeGreaterThanOrEqual(70)
      expect(nc.durationSec).toBeGreaterThanOrEqual(180)
    }
    expect(mockFetch).not.toHaveBeenCalled()

    // 确认轮：精选池已全部入库，必须 0 新增（收敛）。
    const confirmRun = await controller.runCycle(drain.updatedData, {
      dryRun: false,
      includeMultiPlatform: false,
      autoSubmitIndexNow: false,
      fetchImpl: mockFetch as any,
    })
    console.log(`确认轮防抖结果: 本次新增 ${confirmRun.report.newCourses.length} 部（预期 0 部）`)
    expect(confirmRun.report.newCourses.length).toBe(0)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
