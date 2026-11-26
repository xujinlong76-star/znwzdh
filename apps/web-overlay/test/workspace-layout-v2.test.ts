import { describe, expect, it } from 'vitest'
import {
  applyRglCommitToLayout,
  computeAutoRowsForHeight,
  deriveBreakpointFromLg,
  migrateLayoutToV2,
  reconcileBreakpointBlocks,
  resolveBreakpointForWidth,
  restoreBlockInLayout,
  sanitizeLayoutBlocks,
  trashBlockInLayout,
  updateBlockInLayout,
  type AvailableWorkspaceBlock,
  type LayoutBlock,
} from '@/lib/modular/workspace-layout-v2'

describe('WorkspaceLayoutV2 Schema 与无损迁移器（Phase 2）', () => {
  it('migrateLayoutToV2 将 Phase 1 单列配置无损升维为 V2 且严格幂等', () => {
    const phase1Config = {
      version: 3,
      categoryOrder: ['cat-fe', 'cat-ai', 'cat-cloud'],
      pinnedCategoryIds: ['cat-ai'],
      hiddenCategoryIds: ['cat-hidden'],
      collapsedCategoryIds: ['cat-cloud'],
      pinnedSiteIdsByCategory: { 'cat-ai': ['site-1'] },
      siteOrderByCategory: { 'cat-ai': ['site-2', 'site-1'] },
      customCategories: [{ id: 'custom_1', title: '我的常用' }],
    }

    const v2Once = migrateLayoutToV2(phase1Config, {
      catalogCategoryIds: ['cat-ai', 'cat-fe', 'cat-cloud', 'cat-design'],
      legacyTrash: [
        { id: 'site:999', title: '旧站点', level: 'L3_SITE', deletedAt: 1700000000000 },
      ],
    })

    expect(v2Once.version).toBe(2)
    expect(v2Once.gridConfig.columns).toBe(12)
    expect(v2Once.gridConfig.compactType).toBe('vertical')
    // 置顶 cat-ai 排首位，随后按 categoryOrder / custom / catalog 顺序依次排布且均为 w=12, x=0
    expect(v2Once.breakpoints.lg.map((b) => b.id)).toEqual([
      'cat-ai',
      'cat-fe',
      'cat-cloud',
      'custom_1',
      'cat-design',
    ])
    expect(v2Once.breakpoints.lg.every((b) => b.w === 12 && b.x === 0)).toBe(true)
    expect(v2Once.breakpoints.lg.find((b) => b.id === 'custom_1')?.type).toBe('custom_group')
    expect(v2Once.breakpoints.lg.find((b) => b.id === 'cat-cloud')?.style?.collapsed).toBe(true)
    // sm 自动派生为 4 列满宽单列
    expect(v2Once.breakpoints.sm.every((b) => b.w === 4 && b.x === 0)).toBe(true)
    // Phase 1 排序/置顶覆写与回收站完整保留
    expect(v2Once.blockOverrides['cat-ai']?.siteOrder).toEqual(['site-2', 'site-1'])
    expect(v2Once.blockOverrides['cat-ai']?.pinnedSiteIds).toEqual(['site-1'])
    expect(v2Once.trash).toHaveLength(1)
    expect(v2Once.trash[0]?.id).toBe('site:999')

    // 幂等性验证：二次迁移结果完全一致
    const v2Twice = migrateLayoutToV2(v2Once)
    expect(v2Twice).toEqual(v2Once)
  })

  it('sanitizeLayoutBlocks 自动纠偏越界坐标并消除重叠碰撞', () => {
    const dirty = [
      { id: 'a', type: 'category', x: 99, y: -5, w: 6, h: 4 },
      { id: 'b', type: 'category', x: 6, y: 0, w: 6, h: 4 }, // 与 a(x=6,y=0,w=6,h=4) 重叠
      { id: 'a', type: 'category', x: 0, y: 0, w: 4, h: 4 }, // 重复 id 应被去重
    ]
    const clean = sanitizeLayoutBlocks(dirty, 12)
    expect(clean).toHaveLength(2)
    expect(clean[0]).toMatchObject({ id: 'a', x: 6, y: 0, w: 6, h: 4 })
    expect(clean[1]).toMatchObject({ id: 'b', x: 6, y: 4, w: 6, h: 4 })
  })

  it('多断点独立记忆：修改 sm 断点不会破坏 lg 断点的 6+6 左右并排布局', () => {
    const available: AvailableWorkspaceBlock[] = [
      { id: 'a', type: 'category' },
      { id: 'b', type: 'category' },
    ]
    let layout = migrateLayoutToV2({}, { catalogCategoryIds: ['a', 'b'] })

    // 桌面端 lg：将 a、b 设为左右并排 (0,0,6) 与 (6,0,6)
    const committedLg = applyRglCommitToLayout(
      layout,
      'lg',
      [
        { i: 'a', x: 0, y: 0, w: 6, h: 8 },
        { i: 'b', x: 6, y: 0, w: 6, h: 8 },
      ],
      available,
    )
    expect(committedLg).not.toBeNull()
    layout = committedLg!

    // 窄屏 sm：调整顺序为 b 在前、a 在后
    const committedSm = applyRglCommitToLayout(
      layout,
      'sm',
      [
        { i: 'b', x: 0, y: 0, w: 4, h: 8 },
        { i: 'a', x: 0, y: 8, w: 4, h: 8 },
      ],
      available,
    )
    expect(committedSm).not.toBeNull()
    layout = committedSm!

    // 校验 lg 断点双列并排完好无损
    const lgAfter = reconcileBreakpointBlocks(layout, 'lg', available)
    expect(lgAfter.find((x) => x.id === 'a')).toMatchObject({ x: 0, y: 0, w: 6 })
    expect(lgAfter.find((x) => x.id === 'b')).toMatchObject({ x: 6, y: 0, w: 6 })
    // 校验 sm 断点独立生效
    const smAfter = reconcileBreakpointBlocks(layout, 'sm', available)
    expect(smAfter.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('无坐标变化时 applyRglCommitToLayout 返回 null（避免污染撤销栈）', () => {
    const available: AvailableWorkspaceBlock[] = [{ id: 'a', type: 'category' }]
    const layout = migrateLayoutToV2({}, { catalogCategoryIds: ['a'] })
    const a = layout.breakpoints.lg[0]!
    const res = applyRglCommitToLayout(
      layout,
      'lg',
      [{ i: 'a', x: a.x, y: a.y, w: a.w, h: a.h }],
      available,
    )
    expect(res).toBeNull()
  })

  it('软删除进回收站记录原 (x, y, w, h) 坐标并支持原位还原', () => {
    const available: AvailableWorkspaceBlock[] = [
      { id: 'a', type: 'category' },
      { id: 'b', type: 'category' },
    ]
    let layout = migrateLayoutToV2({}, { catalogCategoryIds: ['a', 'b'] })
    layout = applyRglCommitToLayout(
      layout,
      'lg',
      [
        { i: 'a', x: 0, y: 0, w: 6, h: 6 },
        { i: 'b', x: 6, y: 0, w: 6, h: 6 },
      ],
      available,
    )!

    const trashed = trashBlockInLayout(layout, 'b', '前端开发', available)
    expect(trashed.breakpoints.lg.map((x) => x.id)).toEqual(['a'])
    expect(trashed.trash[0]?.previousLayout?.lg).toMatchObject({ id: 'b', x: 6, y: 0, w: 6, h: 6 })

    const restored = restoreBlockInLayout(trashed, 'b')
    expect(restored.trash).toHaveLength(0)
    expect(restored.breakpoints.lg.find((x) => x.id === 'b')).toMatchObject({ x: 6, y: 0, w: 6, h: 6 })
  })

  it('resolveBreakpointForWidth、deriveBreakpointFromLg、updateBlockInLayout 与 computeAutoRowsForHeight 边界准确', () => {
    expect(resolveBreakpointForWidth(1440)).toBe('lg')
    expect(resolveBreakpointForWidth(900)).toBe('md')
    expect(resolveBreakpointForWidth(390)).toBe('sm')

    const lgSample: LayoutBlock[] = [
      { id: 'a', type: 'category', x: 0, y: 0, w: 8, h: 6 },
      { id: 'hot', type: 'hotlist', x: 8, y: 0, w: 4, h: 6 },
    ]
    const smDerived = deriveBreakpointFromLg(lgSample, 'sm')
    expect(smDerived.every((b) => b.w === 4 && b.x === 0)).toBe(true)

    const available: AvailableWorkspaceBlock[] = [
      { id: 'a', type: 'category' },
      { id: 'hot', type: 'hotlist' },
    ]
    const layout = migrateLayoutToV2({}, { catalogCategoryIds: ['a'] })
    const updated = updateBlockInLayout(
      layout,
      'lg',
      'a',
      { w: 6, locked: true, heightMode: 'fixed-scroll', style: { cardVariant: 'capsule', innerCols: 2 } },
      available,
    )
    expect(updated?.breakpoints.lg.find((b) => b.id === 'a')).toMatchObject({
      w: 6,
      locked: true,
      heightMode: 'fixed-scroll',
      style: { cardVariant: 'capsule', innerCols: 2 },
    })

    // rowHeight=40, gapY=16 => 3 行占 40*3 + 16*2 = 152px；300px 需要 ceil((300+16)/56) = 6 行
    expect(computeAutoRowsForHeight(300, 40, 16, 3)).toBe(6)
  })
})
