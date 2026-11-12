import { describe, it, expect, beforeEach } from 'vitest'
import {
  __resetFeatureMaskForTests,
  getFeatureMaskSnapshot,
  removeFeatureFromMask,
  restoreFeatureToMask,
  undoLastFeatureRemove,
  restoreAllFeaturesToDefault,
  toggleCardElementMask,
  setCompactCapsuleCardMask,
  setBypassFeatureMaskTemporarily,
  syncHiddenCategoriesFromDIY,
  isModulePruned,
  isCategoryPruned,
  isSubcategoryPruned,
  isSitePruned,
  isFeaturePruned,
  computePrunedSearchRecall,
  FEATURE_MASK_STORAGE_KEY,
  NAV_PRUNED_IDS_KEY,
  L1_MODULE_CATALOG,
  L3_MICRO_CATALOG,
  L4_FEATURE_CATALOG,
} from '@/lib/modular/feature-mask-store'

describe('不可变基础配置 + 用户差异掩码层 + 时间轴回收站 (FeatureMaskStore)', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(FEATURE_MASK_STORAGE_KEY)
      window.localStorage.removeItem(NAV_PRUNED_IDS_KEY)
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.removeAttribute('data-pruned')
    }
    __resetFeatureMaskForTests()
  })

  it('暴露完整的 L1 全局模块、L3 卡片微元素与 L4 交互特性元数据目录', () => {
    expect(L1_MODULE_CATALOG.length).toBeGreaterThanOrEqual(8)
    expect(L3_MICRO_CATALOG.length).toBe(4)
    expect(L4_FEATURE_CATALOG.length).toBe(4)
    expect(L1_MODULE_CATALOG.some((m) => m.id === 'mod:speed-dial')).toBe(true)
    expect(L1_MODULE_CATALOG.some((m) => m.id === 'mod:hero-deck')).toBe(true)
    expect(L4_FEATURE_CATALOG.some((f) => f.id === 'feat:diy-fab')).toBe(true)
  })

  it('支持 L1 ~ L4 四层颗粒度无损裁剪并自动推入时间轴回收站（按 deletedAt 倒序）', () => {
    removeFeatureFromMask({
      id: 'mod:speed-dial',
      level: 'L1_MODULE',
      title: '⚡ 极速直达坞 Top 10',
      deletedAt: 1000,
    })
    removeFeatureFromMask({
      id: 'cat:life',
      level: 'L2_CATEGORY',
      title: '消费生活',
      previousIndex: 5,
      deletedAt: 2000,
    })
    removeFeatureFromMask({
      id: 'sub:ai-audio',
      level: 'L2_SUBCATEGORY',
      title: 'AI 音频语音',
      parentTitle: 'AI 工具 > AI 音频语音',
      deletedAt: 3000,
    })
    removeFeatureFromMask({
      id: 'site:40',
      level: 'L3_SITE',
      title: 'FlowGPT',
      parentTitle: '提示词工程',
      deletedAt: 4000,
    })
    removeFeatureFromMask({
      id: 'feat:diy-fab',
      level: 'L4_FEATURE',
      title: '右下角 [DIY 排版工坊 E] 悬浮按钮',
      deletedAt: 5000,
    })

    const state = getFeatureMaskSnapshot()
    expect(isModulePruned(state, 'mod:speed-dial')).toBe(true)
    expect(isCategoryPruned(state, 'life')).toBe(true)
    expect(isCategoryPruned(state, 'cat:life')).toBe(true)
    expect(isSubcategoryPruned(state, 'ai-audio')).toBe(true)
    expect(isSitePruned(state, '40')).toBe(true)
    expect(isFeaturePruned(state, 'feat:diy-fab')).toBe(true)

    expect(state.trashBin).toHaveLength(5)
    // 严格按删除时间倒序排列
    expect(state.trashBin.map((t) => t.id)).toEqual([
      'feat:diy-fab',
      'site:40',
      'sub:ai-audio',
      'cat:life',
      'mod:speed-dial',
    ])
    expect(state.trashBin.find((t) => t.id === 'cat:life')?.previousIndex).toBe(5)
  })

  it('支持单步撤销 (undoLastFeatureRemove)、单项精确还原 (restoreFeatureToMask) 与全量重置 (restoreAllFeaturesToDefault)', () => {
    removeFeatureFromMask({
      id: 'mod:hero-deck',
      level: 'L1_MODULE',
      title: '极速启动展板',
      deletedAt: 100,
    })
    removeFeatureFromMask({
      id: 'site:1024',
      level: 'L3_SITE',
      title: 'OpenAI Cookbook',
      deletedAt: 200,
    })

    // 1. 撤销最近一次删减 (site:1024)
    const undone = undoLastFeatureRemove()
    expect(undone?.id).toBe('site:1024')
    expect(isSitePruned(getFeatureMaskSnapshot(), '1024')).toBe(false)
    expect(isModulePruned(getFeatureMaskSnapshot(), 'mod:hero-deck')).toBe(true)

    // 2. 单项还原 (mod:hero-deck)
    const restored = restoreFeatureToMask('mod:hero-deck')
    expect(restored?.title).toBe('极速启动展板')
    expect(isModulePruned(getFeatureMaskSnapshot(), 'mod:hero-deck')).toBe(false)
    expect(getFeatureMaskSnapshot().trashBin).toHaveLength(0)

    // 3. 全量重置
    removeFeatureFromMask({ id: 'cat:dev', level: 'L2_CATEGORY', title: '前端开发' })
    setCompactCapsuleCardMask(true)
    expect(getFeatureMaskSnapshot().cardElements.showDescription).toBe(false)
    restoreAllFeaturesToDefault()

    const resetState = getFeatureMaskSnapshot()
    expect(resetState.hiddenCategories).toHaveLength(0)
    expect(resetState.cardElements.showDescription).toBe(true)
    expect(resetState.cardElements.showTags).toBe(true)
    expect(resetState.trashBin).toHaveLength(0)
  })

  it('支持 L3 卡片内部微元素开关与一键「极简胶囊卡片」模式', () => {
    toggleCardElementMask('showTags', false)
    let state = getFeatureMaskSnapshot()
    expect(state.cardElements.showTags).toBe(false)
    expect(state.trashBin.some((t) => t.id === 'micro:showTags')).toBe(true)

    setCompactCapsuleCardMask(true)
    state = getFeatureMaskSnapshot()
    expect(state.cardElements.showDescription).toBe(false)
    expect(state.cardElements.showTags).toBe(false)

    // 从回收站恢复 micro:showDescription
    restoreFeatureToMask('micro:showDescription')
    state = getFeatureMaskSnapshot()
    expect(state.cardElements.showDescription).toBe(true)
  })

  it('支持「全部探索（临时透视完整版）」而不丢失底层自定义裁剪掩码', () => {
    removeFeatureFromMask({
      id: 'cat:shopping',
      level: 'L2_CATEGORY',
      title: '消费生活',
    })
    expect(isCategoryPruned(getFeatureMaskSnapshot(), 'shopping')).toBe(true)

    setBypassFeatureMaskTemporarily(true)
    const bypassed = getFeatureMaskSnapshot()
    expect(isCategoryPruned(bypassed, 'shopping')).toBe(false)
    // 底层掩码并未丢失
    expect(bypassed.hiddenCategories).toContain('cat:shopping')

    setBypassFeatureMaskTemporarily(false)
    expect(isCategoryPruned(getFeatureMaskSnapshot(), 'shopping')).toBe(true)
  })

  it('与传统分类隐藏列表 (syncHiddenCategoriesFromDIY) 保持双向幂等同步', () => {
    syncHiddenCategoriesFromDIY(['cat-ai', 'cat-cloud'], {
      'cat-ai': 'AI 工具',
      'cat-cloud': '后端与云',
    })
    const state = getFeatureMaskSnapshot()
    expect(isCategoryPruned(state, 'cat-ai')).toBe(true)
    expect(isCategoryPruned(state, 'cat-cloud')).toBe(true)
    expect(state.trashBin.some((t) => t.title.includes('AI 工具'))).toBe(true)

    syncHiddenCategoriesFromDIY(['cat-ai'], { 'cat-ai': 'AI 工具' })
    const afterUnhide = getFeatureMaskSnapshot()
    expect(isCategoryPruned(afterUnhide, 'cat-cloud')).toBe(false)
    expect(afterUnhide.trashBin.some((t) => t.id === 'cat:cat-cloud')).toBe(false)
  })

  it('搜索框穿透召回 (computePrunedSearchRecall) 能精准识别落在已删减分类或站点中的匹配项', () => {
    removeFeatureFromMask({
      id: 'sub:ai-audio',
      level: 'L2_SUBCATEGORY',
      title: 'AI 音频语音',
      parentTitle: 'AI 工具 > AI 音频语音',
    })
    removeFeatureFromMask({
      id: 'site:888',
      level: 'L3_SITE',
      title: 'Suno 音乐生成',
    })

    const state = getFeatureMaskSnapshot()
    const recall = computePrunedSearchRecall('音频', state, [
      {
        siteId: '888',
        site: { id: '888', title: 'Suno 音乐生成', categoryId: 'ai-tools' },
      },
    ])

    expect(recall.count).toBeGreaterThanOrEqual(2)
    expect(recall.matchedTrashItems.some((t) => t.id === 'sub:ai-audio')).toBe(true)
    expect(recall.matchedPrunedSiteIds).toContain('888')
    expect(recall.titles).toContain('AI 音频语音')
    expect(recall.titles).toContain('Suno 音乐生成')
  })
})
