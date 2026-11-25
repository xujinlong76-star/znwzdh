/**
 * P0 C 线：侧栏一级分类短标题 + 拖拽调宽持久化。
 *
 * 短标题：中枢 12 个一级分类里 7 个 5–6 字名在窄侧栏下截断成半截名
 * （后端云与运维 →「后端云与…」等）。行内显示统一收成 4 字，全称仍
 * 保留在 title / tooltip / aria-label，主区标题与数据不动。
 * 拖拽调宽：基底 e502fa5f 已有实现（P1-18 拖拽 + 键盘 + 双击复位、
 * P1-1 视口钳制、localStorage 持久化），本线不重复实现，这里以源码
 * 断言锁住该行为，防止后续改动悄悄删掉。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SIDEBAR_SHORT_TITLES, sidebarShortTitle } from '../src/lib/sidebar-titles'

const sidebarSrc = readFileSync(join(__dirname, '../src/components/sidebar.tsx'), 'utf8')

/** 派单点名的 7 个被截断分类：全称 → 4 字短标题（去「与」，无歧义）。 */
const REQUIRED_SHORT_TITLES: Record<string, string> = {
  '后端云与运维': '后端运维',
  '开发者资源': '开发资源',
  '设计与创意': '设计创意',
  '学习与科研': '学习科研',
  '资讯与创作': '资讯创作',
  '影音与游戏': '影音游戏',
  '生活与服务': '生活服务',
}

/** 派单点名的 5 个未截断分类：保持全称，不缩短。 */
const UNCHANGED_TITLES = ['AI 工具', '前端开发', '效率办公', '职业招聘', '金融财经']

describe('P0 C：侧栏一级分类短标题', () => {
  it('7 个被截断分类各有 4 字短标题', () => {
    for (const [full, short] of Object.entries(REQUIRED_SHORT_TITLES)) {
      expect(sidebarShortTitle(full)).toBe(short)
      expect(SIDEBAR_SHORT_TITLES[full]).toBe(short)
    }
  })

  it('全部短标题 ≤ 4 字、非空、互不相同', () => {
    const shorts = Object.values(SIDEBAR_SHORT_TITLES)
    expect(shorts.length).toBeGreaterThan(0)
    for (const s of shorts) {
      expect(s.length).toBeGreaterThan(0)
      expect(s.length).toBeLessThanOrEqual(4)
    }
    expect(new Set(shorts).size).toBe(shorts.length)
  })

  it('5 个未截断分类保持全称', () => {
    for (const title of UNCHANGED_TITLES) {
      expect(sidebarShortTitle(title)).toBe(title)
      expect(SIDEBAR_SHORT_TITLES[title]).toBeUndefined()
    }
  })

  it('未知标题原样返回（未来新分类不受影响）', () => {
    expect(sidebarShortTitle('短剧')).toBe('短剧')
    expect(sidebarShortTitle('某某新分类')).toBe('某某新分类')
  })

  it('侧栏行内渲染短标题，全称挂 title 悬停', () => {
    expect(sidebarSrc).toContain('{sidebarShortTitle(category.title)}')
    expect(sidebarSrc).toContain("import { sidebarShortTitle } from '@/lib/sidebar-titles'")
  })

  it('收起态 tooltip 与 aria-label 仍用全称（无障碍不丢信息）', () => {
    // 收起态 tooltip 与图标按钮 aria-label 均直接用 category.title
    expect(sidebarSrc).toContain('<span className="font-medium">{category.title}</span>')
    expect(sidebarSrc).toContain('aria-label={totalSiteCount > 0 ? `${category.title}（${totalSiteCount} 站）` : category.title}')
  })
})

describe('P0 C：侧栏拖拽调宽持久化（基底已有实现，锁行为）', () => {
  it('右缘有可聚焦的 slider 手柄（拖拽 + 键盘 + 双击复位）', () => {
    expect(sidebarSrc).toContain('role="slider"')
    expect(sidebarSrc).toContain('data-sidebar-resizer=""')
    expect(sidebarSrc).toContain('aria-label="调整侧边导航栏宽度"')
    expect(sidebarSrc).toContain('onPointerDown={handleSidebarResizeStart}')
    expect(sidebarSrc).toContain('onDoubleClick={handleSidebarResetWidth}')
    expect(sidebarSrc).toContain('onKeyDown={handleSidebarResizeKeyDown}')
  })

  it('默认宽度 256px（sidebarWidth 为 null 时不写内联宽，走 md:w-64）', () => {
    expect(sidebarSrc).toContain('sidebarWidth ?? 256')
    expect(sidebarSrc).toContain('md:w-64')
    expect(sidebarSrc).not.toContain('md:w-56')
    expect(sidebarSrc).not.toContain('md:w-72')
  })

  it('拖拽松手写 localStorage，挂载读回（持久化）', () => {
    expect(sidebarSrc).toContain("window.localStorage?.setItem('navhub_sidebar_width_px', String(latestW))")
    expect(sidebarSrc).toContain("window.localStorage?.getItem('navhub_sidebar_width_px')")
    expect(sidebarSrc).toContain("window.localStorage?.removeItem('navhub_sidebar_width_px')")
  })

  it('拖拽下界 180、上界为视口钳制最大宽（不永久加宽）', () => {
    expect(sidebarSrc).toContain('Math.max(180, Math.min(viewportMaxWidth, Math.round(startW')
  })
})
