/**
 * 首页「极简首屏 + 功能小窗化」核心单元测试与结构守卫：
 *   1. computeHomeTodayBadge 确定性摘要（顶栏 `📅 今日` 角标）；
 *   2. 桌面角落固定微件 store（最多 2 个、折叠状态、损坏 JSON 安全降级）；
 *   3. 首页入口将大型功能收进按需 dynamic({ ssr: false }) 小窗口，不再堆叠于首屏前。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { computeHomeTodayBadge } from '../src/lib/home-today-summary'
import { todayNodes } from '../src/lib/exam-calendar'
import {
  applyPinCornerWidget,
  applyTogglePinnedCollapse,
  loadPinnedCornerWidgets,
  MAX_PINNED_CORNER_WIDGETS,
  parsePinnedWidgets,
  PINNED_WIDGETS_STORAGE_KEY,
  savePinnedCornerWidgets,
  type KeyValueStorageLike,
} from '../src/lib/modular/pinned-widgets-store'

const HERE = dirname(fileURLToPath(import.meta.url))
const readOverlay = (rel: string) => readFileSync(join(HERE, '..', rel), 'utf8')

function createMemoryStorage(): KeyValueStorageLike {
  const store = new Map<string, string>()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => {
      store.set(key, val)
    },
  }
}

describe('computeHomeTodayBadge', () => {
  it('2026-11-18 返回与今日节点数据源一致的计数，并带最近考试倒计时文案', () => {
    const nov18 = Date.UTC(2026, 10, 18, 0, 0, 0)
    const summary = computeHomeTodayBadge(nov18)
    // 期望从同一数据源 todayNodes() 动态派生（U-98）：考试数据增长时
    // 硬编码计数会滞后——U-144 新增江苏/广东自考后 11-18 今日节点
    // 已从 5 增至 7；徽标是 todayNodes 的投影，计数必须与数据源一致。
    const nodes = todayNodes(nov18)
    const expectedToday = nodes.length
    const expectedUrgent = nodes.filter(
      (item) => item.kind === 'today' || item.kind === 'endsToday',
    ).length
    expect(expectedToday).toBeGreaterThan(0)
    expect(summary.todayCount).toBe(expectedToday)
    expect(summary.urgentCount).toBe(expectedUrgent)
    expect(summary.countdownLabel).toBeTruthy()
  })
})

describe('pinned-widgets-store（桌面角落固定微件）', () => {
  it('最多保留 2 个固定微件，再次点击同一微件则取消固定', () => {
    let list = applyPinCornerWidget([], 'clock-pomodoro')
    expect(list).toEqual([{ type: 'clock-pomodoro', collapsed: false }])

    list = applyPinCornerWidget(list, 'weather-clock')
    expect(list).toHaveLength(2)

    list = applyPinCornerWidget(list, 'markdown-notes')
    expect(list).toHaveLength(MAX_PINNED_CORNER_WIDGETS)
    expect(list.map((i) => i.type)).toEqual(['weather-clock', 'markdown-notes'])

    list = applyPinCornerWidget(list, 'weather-clock')
    expect(list.map((i) => i.type)).toEqual(['markdown-notes'])
  })

  it('支持切换折叠态并在损坏 JSON 时安全回退为空数组', () => {
    const collapsed = applyTogglePinnedCollapse(
      [{ type: 'clock-pomodoro', collapsed: false }],
      'clock-pomodoro',
    )
    expect(collapsed).toEqual([{ type: 'clock-pomodoro', collapsed: true }])

    expect(parsePinnedWidgets('{bad-json')).toEqual([])
    expect(parsePinnedWidgets(JSON.stringify([{ type: 'unknown-type' }]))).toEqual([])

    const storage = createMemoryStorage()
    savePinnedCornerWidgets([{ type: 'clock-pomodoro', collapsed: true }], storage)
    expect(storage.getItem(PINNED_WIDGETS_STORAGE_KEY)).toContain('clock-pomodoro')
    expect(loadPinnedCornerWidgets(storage)).toEqual([
      { type: 'clock-pomodoro', collapsed: true },
    ])
  })
})

describe('首页极简结构与小窗懒加载边界', () => {
  // U-358：今日/简报/考试/接力四条内容不再由 page.tsx 注入 todaySlots——
  // 它们只在「今日中心」小窗打开时才需要，现由 NavigationContent 以
  // dynamic(ssr:false) 按需加载；page.tsx 只把 todayBadge 摘要传给导航中心，
  // 首屏上方不直接堆叠渲染。
  // M-01（2026-11-25）：插件精选区不在此列——44394500 随极简首屏重构撤下它后，
  // 四视口首页无可见插件区块（只剩页脚链接与胶囊下拉小窗入口），多视口验收
  // 判为 P2；本用例的插件断言按新行为改写为「必须挂载可见区」，小窗接线不动。
  it('page.tsx 不再注入今日内容（改由导航中心 dynamic 懒加载），不在首屏上方直接堆叠渲染', () => {
    const src = readOverlay('src/app/page.tsx')
    expect(src).not.toContain('todaySlots={{')
    expect(src).toContain('todayBadge={todayBadge}')
    expect(src).not.toContain('<HomeTodayMore>')
    expect(src).toContain('<HomePluginSpotlight')
    const nav = readOverlay('src/components/navigation-content.tsx')
    expect(nav).toContain('todayContent={<TodayZoneContent />}')
    expect(nav).toContain('briefContent={<BriefStripContent />}')
    expect(nav).toContain('examContent={<ExamStripContent />}')
    expect(nav).toContain('<HandoffCardWithCloudContent />')
    expect(nav).toContain('<StreakBarContent />')
  })

  it('layout.tsx 不再全局渲染遮挡顶部的 fixed HomepageBanner', () => {
    const src = readOverlay('src/app/layout.tsx')
    expect(src).not.toContain('<HomepageBanner')
  })

  it('navigation-content.tsx 采用 HomeCapsuleRow + HomeQuickDock 与 dynamic({ ssr: false }) 小窗', () => {
    const src = readOverlay('src/components/navigation-content.tsx')
    // 29489f4c 首屏瘦身：运营胶囊行 HomeMicroStrip 已内联进 HomeCapsuleRow（合并行），
    // navigation-content 只挂载 <HomeCapsuleRow；旧文件 home-micro-strip.tsx 保留但不再挂载。
    expect(src).toContain('<HomeCapsuleRow')
    expect(readOverlay('src/components/home-capsule-row.tsx')).toContain('运营胶囊')
    expect(src).toContain('<HomeQuickDock')
    expect(src).toContain('<HomeDIYTrigger hideStaticButton />')
    expect(src).toContain('TodayCenterDialog')
    expect(src).toContain('WidgetBoxDialog')
    expect(src).toContain('PinnedCornerWidgets')
    expect(src).toContain('AppearanceGuideDialog')
    expect(src).toContain('AiFinderDialog')
  })
})
