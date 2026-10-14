import { describe, it, expect } from 'vitest'
import {
  sortCategoriesWithOverrides,
  shiftCategoryOrder,
  reorderCategoryToTarget,
  togglePinnedId,
  toggleHiddenId,
  sortCategoryItemsWithPinned,
  togglePinnedSiteInCategory,
  computeAdaptiveSiteRanking,
  evaluateLayoutErgonomics,
  mergeDIYLayoutConfigs,
  suggestCategoryForSite,
  BUILTIN_DIY_PRESETS,
  validateAndCleanDIYConfig,
} from '../src/diy-layout'

describe('首页次世代 DIY 排版与核心算法引擎全景测试 (DIY Core Layout Engine)', () => {
  const mockCategories = [
    { id: 'cat-dev', title: '开发工具' },
    { id: 'cat-ai', title: 'AI 智能' },
    { id: 'cat-design', title: '设计素材' },
    { id: 'cat-ops', title: '运维监控' },
    { id: 'cat-docs', title: '文档手册' },
  ]

  it('默认无配置时保持分类数组原序且不遗漏任何项', () => {
    const sorted = sortCategoriesWithOverrides(mockCategories)
    expect(sorted.map((c) => c.id)).toEqual([
      'cat-dev',
      'cat-ai',
      'cat-design',
      'cat-ops',
      'cat-docs',
    ])
  })

  it('隐藏分类功能：指定 hiddenCategoryIds 能够精准过滤掉对应分类', () => {
    const sorted = sortCategoriesWithOverrides(mockCategories, {
      hiddenCategoryIds: ['cat-ops', 'cat-design'],
    })
    expect(sorted.map((c) => c.id)).toEqual([
      'cat-dev',
      'cat-ai',
      'cat-docs',
    ])
  })

  it('置顶优先级：置顶分类必须优先排在最前，多个置顶保留相对顺序', () => {
    const sorted = sortCategoriesWithOverrides(mockCategories, {
      pinnedCategoryIds: ['cat-ops', 'cat-ai'],
    })
    expect(sorted.map((c) => c.id)).toEqual([
      'cat-ai',
      'cat-ops',
      'cat-dev',
      'cat-design',
      'cat-docs',
    ])
  })

  it('自定义排序与置顶混合：置顶项无论在 categoryOrder 中排在何处，均享有顶级优先级', () => {
    const sorted = sortCategoriesWithOverrides(mockCategories, {
      pinnedCategoryIds: ['cat-docs'],
      categoryOrder: ['cat-ops', 'cat-design', 'cat-dev', 'cat-ai', 'cat-docs'],
    })
    expect(sorted.map((c) => c.id)).toEqual([
      'cat-docs',
      'cat-ops',
      'cat-design',
      'cat-dev',
      'cat-ai',
    ])
  })

  it('shiftCategoryOrder 算法：能够正确上移与下移指定分类并防御边界越界', () => {
    const allIds = mockCategories.map((c) => c.id)

    // 上移中间项
    const movedUp = shiftCategoryOrder([], 'cat-ai', 'up', allIds)
    expect(movedUp).toEqual(['cat-ai', 'cat-dev', 'cat-design', 'cat-ops', 'cat-docs'])

    // 首项上移保持不变 (边界保护)
    expect(shiftCategoryOrder([], 'cat-dev', 'up', allIds)).toEqual(allIds)

    // 末项下移保持不变 (边界保护)
    expect(shiftCategoryOrder([], 'cat-docs', 'down', allIds)).toEqual(allIds)
  })

  it('reorderCategoryToTarget 拖拽定向重排算法：精准支持 before 与 after 定位以及边界防御', () => {
    const allIds = ['cat-dev', 'cat-ai', 'cat-design', 'cat-ops', 'cat-docs']

    // 1. 从后往前拖拽（将 cat-ops 拖到 cat-ai 之前）
    const moved1 = reorderCategoryToTarget([], 'cat-ops', 'cat-ai', 'before', allIds)
    expect(moved1).toEqual(['cat-dev', 'cat-ops', 'cat-ai', 'cat-design', 'cat-docs'])

    // 2. 从前往后拖拽（将 cat-dev 拖到 cat-design 之后）
    const moved2 = reorderCategoryToTarget([], 'cat-dev', 'cat-design', 'after', allIds)
    expect(moved2).toEqual(['cat-ai', 'cat-design', 'cat-dev', 'cat-ops', 'cat-docs'])

    // 3. 拖拽到自身无变动
    expect(reorderCategoryToTarget(allIds, 'cat-ai', 'cat-ai', 'before')).toEqual(allIds)

    // 4. 不存在的源目标处理
    expect(reorderCategoryToTarget(allIds, 'non-existent', 'cat-ai', 'before')).toEqual(allIds)
  })

  it('togglePinnedId 和 toggleHiddenId：能够正确往返切换状态', () => {
    let pinned: string[] = []
    pinned = togglePinnedId(pinned, 'cat-1')
    expect(pinned).toEqual(['cat-1'])
    pinned = togglePinnedId(pinned, 'cat-1')
    expect(pinned).toEqual([])

    let hidden: string[] = ['cat-2']
    hidden = toggleHiddenId(hidden, 'cat-3')
    expect(hidden).toEqual(['cat-2', 'cat-3'])
    hidden = toggleHiddenId(hidden, 'cat-2')
    expect(hidden).toEqual(['cat-3'])
  })

  it('分类内站点置顶排序 (sortCategoryItemsWithPinned)：置顶站点绝对优先排在前面', () => {
    const items = [
      { id: 'item-1', title: 'React' },
      { id: 'item-2', title: 'Vue' },
      { id: 'item-3', title: 'Next.js' },
      { id: 'item-4', title: 'Svelte' },
    ]

    const sorted = sortCategoryItemsWithPinned(items, ['item-3', 'item-4'])
    expect(sorted.map((i) => i.id)).toEqual(['item-3', 'item-4', 'item-1', 'item-2'])
    expect(sortCategoryItemsWithPinned(items, [])).toEqual(items)
  })

  it('切换分类内站点置顶 (togglePinnedSiteInCategory)：能够正确记录与反转置顶状态', () => {
    let map: Record<string, string[]> = {}
    map = togglePinnedSiteInCategory(map, 'cat-dev', 'site-a')
    expect(map['cat-dev']).toEqual(['site-a'])

    map = togglePinnedSiteInCategory(map, 'cat-dev', 'site-b')
    expect(map['cat-dev']).toEqual(['site-a', 'site-b'])

    map = togglePinnedSiteInCategory(map, 'cat-dev', 'site-a')
    expect(map['cat-dev']).toEqual(['site-b'])
  })

  it('时间半衰期自适应热度衰减推荐排序 (computeAdaptiveSiteRanking)', () => {
    const now = 1700000000000
    const oneDayMs = 24 * 60 * 60 * 1000

    const items = [
      { id: 'site-pinned', title: 'Pinned Site', liveMetrics: { githubStars: 100 } },
      { id: 'site-frequent-old', title: 'Old Frequent', liveMetrics: { githubStars: 500 } },
      { id: 'site-recent', title: 'Recent Hot', liveMetrics: { githubStars: 50000 } },
      { id: 'site-cold', title: 'Cold Site' },
    ]

    const visitStats = {
      // 很久以前(30天前)访问了10次，已衰减
      'site-frequent-old': { count: 10, lastVisitedAt: now - 30 * oneDayMs },
      // 刚刚访问了5次，权重极高
      'site-recent': { count: 5, lastVisitedAt: now - 1 * oneDayMs },
      // 冷门站点，只访问过1次
      'site-cold': { count: 1, lastVisitedAt: now - 60 * oneDayMs },
    }

    const ranked = computeAdaptiveSiteRanking(items, {
      pinnedItemIds: ['site-pinned'],
      now,
      halfLifeDays: 7,
      visitStats,
    })

    // 1. 显式置顶项 site-pinned 始终排第 1 位
    expect(ranked[0].id).toBe('site-pinned')
    // 2. 近期访问且高 Star 的 site-recent 应该排在已衰减的 site-frequent-old 前面
    expect(ranked[1].id).toBe('site-recent')
    expect(ranked[2].id).toBe('site-frequent-old')
    expect(ranked[3].id).toBe('site-cold')
  })

  it('排版人机工程学健康度与香农信息熵评估 (evaluateLayoutErgonomics)', () => {
    const testCategories = [
      {
        id: 'c1',
        title: '前端架构',
        items: [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }],
      },
      {
        id: 'c2',
        title: '后端系统',
        items: [{ id: 's5' }, { id: 's6' }, { id: 's7' }],
      },
      {
        id: 'c3',
        title: '空类目',
        items: [],
      },
      {
        id: 'c4',
        title: '巨型仓库',
        items: Array.from({ length: 35 }, (_, i) => ({ id: `giant_${i}` })),
      },
    ]

    const report = evaluateLayoutErgonomics(testCategories, {
      pinnedCategoryIds: ['c1'],
      hiddenCategoryIds: [],
    })

    expect(report.totalCategories).toBe(4)
    expect(report.visibleCategories).toBe(4)
    expect(report.emptyCategoriesCount).toBe(1) // c3 是空类目
    expect(report.overloadedCategoriesCount).toBe(1) // c4 是巨型类目 (35 > 30)
    expect(report.shannonEntropy).toBeGreaterThan(0)
    expect(report.score).toBeLessThan(100)
    expect(report.suggestions.some((s) => s.includes('空类目'))).toBe(true)
    expect(report.suggestions.some((s) => s.includes('巨型仓库'))).toBe(true)

    // 隐藏空类目后的健康度提升验证
    const cleanReport = evaluateLayoutErgonomics(testCategories, {
      pinnedCategoryIds: ['c1'],
      hiddenCategoryIds: ['c3'],
    })
    expect(cleanReport.emptyCategoriesCount).toBe(0)
    expect(cleanReport.score).toBeGreaterThan(report.score)
  })

  it('3-Way 差异比对与无损合并引擎 (mergeDIYLayoutConfigs)', () => {
    const local = {
      viewMode: 'hybrid' as const,
      pinnedCategoryIds: ['cat-local-pinned', 'cat-common'],
      categoryOrder: ['cat-common', 'cat-local-pinned'],
      customCategories: [{ id: 'my-cat', title: '本地专属', items: [{ id: 's1' }] }],
      pinnedSiteIdsByCategory: {
        'cat-common': ['site-local-1'],
      },
    }

    const remote = {
      viewMode: 'workbench' as const,
      pinnedCategoryIds: ['cat-remote-pinned', 'cat-common'],
      categoryOrder: ['cat-common', 'cat-remote-pinned', 'cat-server-new'],
      customCategories: [{ id: 'remote-cat', title: '云端专属', items: [{ id: 's2' }] }],
      pinnedSiteIdsByCategory: {
        'cat-common': ['site-remote-2'],
      },
    }

    const result = mergeDIYLayoutConfigs(local, remote)

    // 1. 置顶并集合并
    expect(result.merged.pinnedCategoryIds).toContain('cat-local-pinned')
    expect(result.merged.pinnedCategoryIds).toContain('cat-remote-pinned')
    expect(result.merged.pinnedCategoryIds).toContain('cat-common')

    // 2. 自建分类并集合并
    expect(result.merged.customCategories?.map((c) => c.id)).toContain('my-cat')
    expect(result.merged.customCategories?.map((c) => c.id)).toContain('remote-cat')

    // 3. 分类内站点置顶无损并集
    expect(result.merged.pinnedSiteIdsByCategory?.['cat-common']).toEqual(['site-remote-2', 'site-local-1'])

    // 4. 统计指标正常记录
    expect(result.stats.addedPinnedCats).toBeGreaterThanOrEqual(1)
    expect(result.stats.addedCustomCats).toBe(1)
  })

  it('智能模糊分类推荐算法 (suggestCategoryForSite)', () => {
    const categories = [
      { id: 'cat-ai', title: 'AI 智能与大模型' },
      { id: 'cat-dev', title: '前端与开发框架' },
      { id: 'cat-design', title: 'UI 设计与灵感素材' },
    ]

    // 场景 1：标题直接包含分类关键词
    const sug1 = suggestCategoryForSite(
      { title: 'Next.js 官方文档', description: 'React 前端现代化开发框架' },
      categories
    )
    expect(sug1).not.toBeNull()
    expect(sug1?.categoryId).toBe('cat-dev')
    expect(sug1?.confidence).toBeGreaterThan(0.5)

    // 场景 2：AI 领域关键词匹配
    const sug2 = suggestCategoryForSite(
      { title: 'Claude 3.7 Sonnet', description: 'Anthropic 前沿大模型推理助手' },
      categories
    )
    expect(sug2).not.toBeNull()
    expect(sug2?.categoryId).toBe('cat-ai')

    // 场景 3：完全无关站点返回 null 或低分过滤
    const sug3 = suggestCategoryForSite(
      { title: 'XYZ 不明神秘外星代码' },
      categories
    )
    expect(sug3).toBeNull()
  })

  it('内置 DIY 预设情境模版与配置清洗防御', () => {
    expect(BUILTIN_DIY_PRESETS.length).toBeGreaterThanOrEqual(4)
    for (const preset of BUILTIN_DIY_PRESETS) {
      expect(preset.id).toBeTruthy()
      expect(preset.name).toBeTruthy()
      expect(['hybrid', 'classic', 'workbench']).toContain(preset.config.viewMode)
      expect(['compact', 'standard', 'rich']).toContain(preset.config.cardDisplayMode)
      expect(['mesh', 'dots', 'grid', 'aurora', 'clean']).toContain(preset.config.canvasBackground)
      expect(['dense', 'comfortable', 'spacious']).toContain(preset.config.density)
    }

    // 畸形数据清洗防护
    expect(validateAndCleanDIYConfig(null).valid).toBe(false)
    expect(validateAndCleanDIYConfig('invalid').valid).toBe(false)
    const validRaw = { viewMode: 'classic', version: 2 }
    expect(validateAndCleanDIYConfig(validRaw).valid).toBe(true)
  })
})
