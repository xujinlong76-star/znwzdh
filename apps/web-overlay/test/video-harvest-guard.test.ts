/**
 * 采集入库严标准守卫（2026-11-13，Ryan 定稿）。
 *
 * 标准（lib/video-harvest-guard.ts，四条满足其一即放行）：
 *   置顶 / 人工 / 精选；播放 ≥ 50000；播放 ≥ 10000 且点赞 ≥ 100；
 *   播放 ≥ 5000 且点赞 ≥ 200 且弹幕 ≥ 50。其余拒绝；零数据直接拒绝。
 *
 * 覆盖三层：
 *   A. 守卫纯函数本身（边界值 + 豁免 + 零数据）；
 *   B. 多平台汇聚点（mock fetch：不达标被过滤且原因进 failures，达标放行）；
 *   C. 自主采集第二阶段（不达标候选进 rejected 计数与日志，不入库）；
 *   D. 源码守卫（死字段与假默认值不许回来）。
 *   E. Webhook 入库点（零数据拒收、真实数据放行、管理员测试通道同标准）。
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  checkHarvestEligibility,
  isHarvestEligibleForItem,
  HARVEST_GUARD_REJECT_PREFIX,
} from '../src/lib/video-harvest-guard'
import { harvestMultiPlatformVideosForKeyword } from '../src/lib/video-multi-platform-harvester'
import { AutonomousAIHarvesterController } from '../src/lib/video-autonomous-ai-harvester'
import { MultiSourceConnector } from '../src/lib/video-multi-source-connector'
import { signHmacSha256 } from '../src/lib/webhook-signature'
import type { NavigationData, NavigationSubItem, VideoHarvestPolicy } from '../src/types/navigation'

function src(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')
}

/** 去掉注释，避免「注释里写了旧代码」导致守卫误判（同 video-harvest-upgrade） */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ---------------------------------------------------------------------------
// A. 守卫纯函数
// ---------------------------------------------------------------------------
describe('A：checkHarvestEligibility 严标准判定', () => {
  it('播放 ≥ 50000 直接放行（边界 50000 含）', () => {
    expect(checkHarvestEligibility({ stats: { views: 50000 } }).eligible).toBe(true)
    expect(checkHarvestEligibility({ stats: { views: 60000 } }).matchedRule).toBe('views_high')
    expect(checkHarvestEligibility({ stats: { views: 49999 } }).eligible).toBe(false)
  })

  it('播放 ≥ 10000 且点赞 ≥ 100 放行，点赞差 1 也不行', () => {
    const ok = checkHarvestEligibility({ stats: { views: 12000, likes: 100 } })
    expect(ok.eligible).toBe(true)
    expect(ok.matchedRule).toBe('views_likes')
    expect(checkHarvestEligibility({ stats: { views: 10000, likes: 100 } }).eligible).toBe(true)
    expect(checkHarvestEligibility({ stats: { views: 12000, likes: 99 } }).eligible).toBe(false)
    expect(checkHarvestEligibility({ stats: { views: 9999, likes: 500 } }).eligible).toBe(false)
  })

  it('播放 ≥ 5000 且点赞 ≥ 200 且弹幕 ≥ 50 放行，任一差 1 即拒绝', () => {
    const ok = checkHarvestEligibility({ stats: { views: 6000, likes: 250, danmaku: 60 } })
    expect(ok.eligible).toBe(true)
    expect(ok.matchedRule).toBe('views_likes_danmaku')
    expect(checkHarvestEligibility({ stats: { views: 6000, likes: 250, danmaku: 49 } }).eligible).toBe(false)
    expect(checkHarvestEligibility({ stats: { views: 6000, likes: 199, danmaku: 60 } }).eligible).toBe(false)
    expect(checkHarvestEligibility({ stats: { views: 4999, likes: 500, danmaku: 99 } }).eligible).toBe(false)
  })

  it('零数据拒绝：缺 stats、全零、只有弹幕/点赞但零播放都拒绝', () => {
    for (const stats of [undefined, null, {}, { views: 0 }, { views: 0, likes: 0, danmaku: 0 }]) {
      const v = checkHarvestEligibility({ stats: stats as never })
      expect(v.eligible).toBe(false)
      expect(v.rejectReason).toContain('无真实互动数据')
    }
    // 只有点赞没有播放：不是「有数据」，仍拒绝（播放是三条规则的共同前提）
    expect(checkHarvestEligibility({ stats: { likes: 999 } }).eligible).toBe(false)
  })

  it('脏数据按零算：负数与 NaN 不许凑出放行', () => {
    expect(checkHarvestEligibility({ stats: { views: -5, likes: 100 } }).eligible).toBe(false)
    expect(checkHarvestEligibility({ stats: { views: NaN, likes: 100 } }).eligible).toBe(false)
  })

  it('置顶 / 人工 / 精选放行，哪怕零数据（豁免是显式的）', () => {
    expect(checkHarvestEligibility({ pinned: true }).matchedRule).toBe('pinned')
    expect(checkHarvestEligibility({ isManual: true }).matchedRule).toBe('manual')
    expect(checkHarvestEligibility({ isCurated: true }).matchedRule).toBe('curated')
    expect(checkHarvestEligibility({ pinned: true, stats: {} }).eligible).toBe(true)
  })

  it('拒绝原因含真实数值，不许空话', () => {
    const v = checkHarvestEligibility({ stats: { views: 1200, likes: 30, danmaku: 0 } })
    expect(v.eligible).toBe(false)
    expect(v.rejectReason).toContain('1200')
    expect(v.rejectReason).toContain('30')
  })

  it('isHarvestEligibleForItem 从 videoConfig 读 stats / pinned / sourceType', () => {
    const base: NavigationSubItem = {
      id: 'x',
      title: 't',
      href: 'https://example.com',
      enabled: true,
      videoConfig: {
        type: 'ted',
        videoId: 'x',
        stats: { views: 800, likes: 10 },
        pinned: false,
        sourceType: 'auto_trend',
      },
    }
    expect(isHarvestEligibleForItem(base).eligible).toBe(false)
    const manual: NavigationSubItem = {
      ...base,
      videoConfig: {
        type: 'ted',
        videoId: 'x',
        stats: { views: 800, likes: 10 },
        pinned: true,
        sourceType: 'manual',
      },
    }
    expect(isHarvestEligibleForItem(manual).eligible).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// B. 多平台汇聚点：mock fetch
// ---------------------------------------------------------------------------
describe('B：harvestMultiPlatformVideosForKeyword 汇聚点守卫', () => {
  function tedFetch(viewCount: number | undefined) {
    return vi.fn().mockImplementation((url: string) => {
      if (url.includes('ted.com/talks.json')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              talks: [
                {
                  slug: 'guard_probe',
                  name: 'DeepSeek Agent 架构实战',
                  description: 'Agent 架构',
                  duration: 1200,
                  published_at: '2024-06-01T10:00:00Z',
                  speaker_name: 'Test Speaker',
                  ...(viewCount === undefined ? {} : { view_count: viewCount }),
                },
              ],
            }),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
  }

  it('TED 240000 播放放行；100 播放拒收且 failures 记守卫原因', async () => {
    const okItems = await harvestMultiPlatformVideosForKeyword(
      'Agent',
      { platforms: ['ted'], minDurationSec: 180, limitPerKeyword: 2 },
      tedFetch(240000) as never,
    )
    expect(okItems).toHaveLength(1)

    const failures: Array<{ keyword: string; reason: string }> = []
    const badItems = await harvestMultiPlatformVideosForKeyword(
      'Agent',
      { platforms: ['ted'], minDurationSec: 180, limitPerKeyword: 2, failures },
      tedFetch(100) as never,
    )
    expect(badItems).toHaveLength(0)
    expect(failures.some((f) => f.reason.includes(HARVEST_GUARD_REJECT_PREFIX))).toBe(true)
  })

  it('TED 无播放量字段（零数据）拒收，不靠默认值', async () => {
    const failures: Array<{ keyword: string; reason: string }> = []
    const items = await harvestMultiPlatformVideosForKeyword(
      'Agent',
      { platforms: ['ted'], minDurationSec: 180, limitPerKeyword: 2, failures },
      tedFetch(undefined) as never,
    )
    expect(items).toHaveLength(0)
    expect(failures.some((f) => f.reason.includes('无真实互动数据'))).toBe(true)
  })

  it('YouTube 镜像 45000 播放（无点赞/弹幕）拒收，60000 放行', async () => {
    delete process.env.YOUTUBE_API_KEY
    const mirrorFetch = (views: number) =>
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('youtube.com/results')) {
          return Promise.resolve({ ok: true, text: async () => '<html></html>' })
        }
        if (url.includes('inv.tux.pizza')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                url: '/watch?v=dQw4w9WgXcQ',
                title: 'Fullstack Next.js Masterclass',
                uploaderName: 'Web Mastery',
                duration: 1800,
                views,
              },
            ],
          })
        }
        return Promise.reject(new Error('Unknown URL'))
      })

    const failures: Array<{ keyword: string; reason: string }> = []
    const low = await harvestMultiPlatformVideosForKeyword(
      'Next.js',
      { platforms: ['youtube'], minDurationSec: 300, limitPerKeyword: 1, failures },
      mirrorFetch(45000) as never,
    )
    expect(low).toHaveLength(0)
    expect(failures.some((f) => f.reason.includes(HARVEST_GUARD_REJECT_PREFIX))).toBe(true)

    const high = await harvestMultiPlatformVideosForKeyword(
      'Next.js',
      { platforms: ['youtube'], minDurationSec: 300, limitPerKeyword: 1 },
      mirrorFetch(60000) as never,
    )
    expect(high).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// C. 自主采集第二阶段：守卫拒收进报告，不入库
// ---------------------------------------------------------------------------
describe('C：AutonomousAIHarvesterController 第二阶段守卫', () => {
  function tedCycleFetch(viewCount: number) {
    return vi.fn().mockImplementation((url: string) => {
      if (url.includes('ted.com/talks.json')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              talks: [
                {
                  slug: 'agent_architecture',
                  name: 'Autonomous AI Agents and the Future of Software Systems',
                  description: 'Deep architectural discussion of LLM reasoning engines and agents.',
                  duration: 1200,
                  published_at: '2024-06-01T10:00:00Z',
                  speaker_name: 'Andrew Ng',
                  view_count: viewCount,
                },
              ],
            }),
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })
  }

  function cycleData(): NavigationData {
    return {
      navigationItems: [
        {
          id: 'cat_guard_test',
          title: '守卫测试分类',
          enabled: true,
          items: [],
          subCategories: [
            { id: 'sub_guard_test', title: '守卫测试子分类', enabled: true, items: [] },
          ],
          // forceCategory 用一个精选池里不存在的分类 id，隔离第一阶段
          harvestPolicy: {
            enabled: true,
            keywords: ['Agent 开发'],
            platforms: ['ted'],
            maxItems: 10,
            minDurationSec: 180,
          },
        },
      ],
    }
  }

  it('800 播放的候选被守卫拒收：不入库，rejected 计数 + 日志', async () => {
    const controller = new AutonomousAIHarvesterController()
    const { updatedData, report } = await controller.runCycle(cycleData(), {
      dryRun: false,
      forceCategory: 'cat_guard_test',
      includeMultiPlatform: true,
      autoSubmitIndexNow: false,
      maxAdditionsPerCycle: 5,
      fetchImpl: tedCycleFetch(800) as never,
    })
    expect(report.newCourses).toHaveLength(0)
    expect(report.aiRejectedCount).toBeGreaterThan(0)
    expect(report.logs.some((l) => l.level === 'rejected' && l.message.includes('守卫拒绝入库'))).toBe(true)
    const cat = updatedData.navigationItems.find((c) => c.id === 'cat_guard_test')
    expect((cat?.subCategories?.[0]?.items?.length || 0) + (cat?.items?.length || 0)).toBe(0)
  })

  it('500000 播放的同款候选放行入库（对照组）', async () => {
    const controller = new AutonomousAIHarvesterController()
    const { report } = await controller.runCycle(cycleData(), {
      dryRun: false,
      forceCategory: 'cat_guard_test',
      includeMultiPlatform: true,
      autoSubmitIndexNow: false,
      maxAdditionsPerCycle: 5,
      fetchImpl: tedCycleFetch(500000) as never,
    })
    expect(report.newCourses.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// D. 源码守卫：死字段与假默认值不许回来
// ---------------------------------------------------------------------------
describe('D：死字段与假默认值源码守卫', () => {
  it('VideoHarvestPolicy 不再含 minQualityScore / freshnessHalfLifeDays', () => {
    const policy: VideoHarvestPolicy = {
      enabled: true,
      keywords: ['LLM'],
      maxItems: 12,
      minDurationSec: 180,
      autoReplaceOutdated: true,
    }
    expect('minQualityScore' in policy).toBe(false)
    expect('freshnessHalfLifeDays' in policy).toBe(false)
    const typeCode = stripComments(src('types/navigation.ts'))
    expect(typeCode).not.toMatch(/minQualityScore/)
    expect(typeCode).not.toMatch(/freshnessHalfLifeDays/)
  })

  it('采集器不再以 qualityScore 设门（此前拿不可信的 65 分比 60 分）', () => {
    const harvester = stripComments(src('lib/video-harvester.ts'))
    expect(harvester).not.toMatch(/qualityScore\s*</)
    expect(harvester).not.toMatch(/minQualityScore/)
    const multi = stripComments(src('lib/video-multi-platform-harvester.ts'))
    expect(multi).not.toMatch(/minQualityScore/)
    const auto = stripComments(src('lib/video-autonomous-ai-harvester.ts'))
    expect(auto).not.toMatch(/minQualityScore/)
  })

  it('三处假默认值已死，不许回来（YouTube 50000 / TED 60000 / AI 评估默认 stats）', () => {
    const multi = stripComments(src('lib/video-multi-platform-harvester.ts'))
    expect(multi).not.toMatch(/views:\s*50000/)
    expect(multi).not.toMatch(/views:\s*60000/)
    const connector = stripComments(src('lib/video-multi-source-connector.ts'))
    expect(connector).not.toMatch(/views:\s*50000/)
    expect(connector).not.toMatch(/views:\s*60000/)
    // AI 评估此前的默认 stats：10000 播放 / 500 点赞 / 200 投币 / 1000 收藏
    const auto = stripComments(src('lib/video-autonomous-ai-harvester.ts'))
    expect(auto).not.toMatch(/views:\s*10000/)
    expect(auto).not.toMatch(/likes:\s*500/)
    expect(auto).not.toMatch(/coins:\s*200/)
    expect(auto).not.toMatch(/favorites:\s*1000/)
  })

  it('严标准阈值只在守卫模块的 HARVEST_GATE 写死一处，采集器不许各写一份播放量比较', () => {
    for (const rel of [
      'lib/video-harvester.ts',
      'lib/video-multi-platform-harvester.ts',
      'lib/video-autonomous-ai-harvester.ts',
    ]) {
      const code = stripComments(src(rel))
      // 「万」换算（×10000）是单位换算不是阈值，只禁「播放量 >= 阈值」这类比较
      expect(code).not.toMatch(/views\s*>=?\s*50000/)
      expect(code).not.toMatch(/views\s*>=?\s*10000/)
      expect(code).not.toMatch(/views\s*>=?\s*5000/)
    }
    const guard = stripComments(src('lib/video-harvest-guard.ts'))
    expect(guard).toMatch(/viewsHigh:\s*50000/)
    expect(guard).toMatch(/viewsMid:\s*10000/)
    expect(guard).toMatch(/likesMid:\s*100/)
    expect(guard).toMatch(/viewsLow:\s*5000/)
    expect(guard).toMatch(/likesLow:\s*200/)
    expect(guard).toMatch(/danmakuLow:\s*50/)
  })
})

// ---------------------------------------------------------------------------
// E. Webhook 入库点：此前只过 AI 审核就放行，零数据也能入库
// ---------------------------------------------------------------------------
describe('E：MultiSourceConnector webhook 入库守卫', () => {
  const SECRET = 'guard-webhook-secret'
  const connector = new MultiSourceConnector(SECRET)

  function webhookPayload(stats?: { views?: number; likes?: number; danmaku?: number }) {
    return {
      event: 'video_published' as const,
      timestamp: Date.now(),
      source: 'bilibili' as const,
      data: {
        id: `BV1Guard${Math.random().toString(36).slice(2, 8)}`,
        title: 'DeepSeek-R1 分布式集群部署微调与 Agent 企业级实战',
        description: '系统深入讲解 LLM、Agent 原理、RAG 向量检索以及分布式架构调优。',
        author: '架构先锋',
        durationSec: 2400,
        url: 'https://www.bilibili.com/video/BV1GuardProbe',
        domain: 'cat_ai_engineering',
        ...(stats ? { stats } : {}),
      },
    }
  }

  function signedCall(payload: ReturnType<typeof webhookPayload>) {
    const raw = JSON.stringify(payload)
    return connector.processWebhook(payload, signHmacSha256(raw, SECRET), raw)
  }

  it('零数据载荷拒收：AI 审核过了也不行，message 带守卫前缀', () => {
    const res = signedCall(webhookPayload())
    expect(res.ok).toBe(false)
    expect(res.message).toContain(HARVEST_GUARD_REJECT_PREFIX)
    expect(res.message).toContain('无真实互动数据')
    expect(res.subItem).toBeUndefined()
  })

  it('100 播放拒收；12000 播放 + 150 点赞放行，stats 随条目入库', () => {
    const low = signedCall(webhookPayload({ views: 100, likes: 5 }))
    expect(low.ok).toBe(false)
    expect(low.message).toContain(HARVEST_GUARD_REJECT_PREFIX)
    expect(low.subItem).toBeUndefined()

    const mid = signedCall(webhookPayload({ views: 12000, likes: 150 }))
    expect(mid.ok).toBe(true)
    expect(mid.subItem?.videoConfig?.stats).toEqual({ views: 12000, likes: 150 })
  })

  it('60000 播放放行（高播放档）', () => {
    const res = signedCall(webhookPayload({ views: 60000 }))
    expect(res.ok).toBe(true)
    expect(res.subItem).toBeDefined()
  })

  it('管理员测试通道同标准：零数据拒收，真实数据放行', () => {
    const noStats = connector.processAdminTestPayload(webhookPayload())
    expect(noStats.ok).toBe(false)
    expect(noStats.message).toContain(HARVEST_GUARD_REJECT_PREFIX)

    const ok = connector.processAdminTestPayload(
      webhookPayload({ views: 8000, likes: 300, danmaku: 80 }),
    )
    expect(ok.ok).toBe(true)
    expect(ok.subItem?.videoConfig?.stats).toEqual({ views: 8000, likes: 300, danmaku: 80 })
  })

  it('源码守卫：连接器确实调守卫，不靠 AI 评分放行', () => {
    const code = stripComments(src('lib/video-multi-source-connector.ts'))
    expect(code).toMatch(/checkHarvestEligibility\s*\(/)
    expect(code).toMatch(/harvestGuardRejectReason\s*\(/)
    // webhook 路径不得再出现假默认值
    expect(code).not.toMatch(/views:\s*50000/)
    expect(code).not.toMatch(/views:\s*60000/)
  })
})
