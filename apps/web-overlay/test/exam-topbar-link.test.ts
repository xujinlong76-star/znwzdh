/**
 * 考试直达顶栏入口（2026-11-28 23:22 轮 · 方案 A）：
 * 首页顶栏在「热榜」旁加「考试」直达按钮（href="/exam"，图标 + 可见文字，
 * 全宽度可见），国考窗口期内在文字旁挂今日中心同款琥珀倒计时徽章。
 *
 * 锁四件事（源码级守卫，风格照抄 header-layout-guard.test.ts）：
 *   1. 考试按钮与热榜同款（h-11 w-11、sm:w-auto 横排、可见「考试」文字，
 *      非仅 title/aria-label），aria-label="考试"，href="/exam"；
 *   2. 倒计时徽章只在 todayBadge.countdownLabel 非空时渲染（服务端值，
 *      不引入客户端倒计时），文案取 countdownLabel 本身、不用硬编码，
 *      样式复用今日中心琥珀 pill，仅 ≥lg 显示（窄屏不占行宽）；
 *   3. 宽度账：360px 行内 7 钮（外观聚合浮层 <390px 隐藏）= 320px ≤ 336px，
 *      390px 行内 8 钮 = 366px = 366px 可用宽；溢出靠减入口、不挤间距；
 *   4. 回归：热榜、今日中心、探索菜单内「考试日历」入口都不动。
 *
 * 真实点击与溢出量测由 e2e/exam-topbar-link.spec.ts 在验证栈上做，
 * 不在这里重复测。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

function windowAround(src: string, needle: string, before = 800, after = 400): string {
  const i = src.indexOf(needle)
  expect(i, `源码中找不到锚点：${needle}`).toBeGreaterThanOrEqual(0)
  return src.slice(Math.max(0, i - before), i + after)
}

describe('navigation-toolbar：考试直达入口（2026-11-28 23:22 轮）', () => {
  const src = read('src/components/navigation-toolbar.tsx')

  it('顶栏有「考试」直达按钮：href="/exam"、可见文字、与热榜同款', () => {
    const btn = windowAround(src, 'aria-label="考试"', 1200, 900)
    expect(btn).toContain('href="/exam"')
    expect(btn).toMatch(/>\s*考试\s*<\/span>/)
    expect(btn).toContain('GraduationCap')
    expect(btn).toContain('h-11 w-11')
    expect(btn).toContain('sm:w-auto')
    expect(btn).toContain('sm:flex-row')
    // 全宽度可见：按钮本体（Button 标签到 Link 标签）不得有 hidden 断点
    //（徽章自身的 hidden lg:inline-flex 不算，那是徽章的分档显示）
    const labelIdx = src.indexOf('aria-label="考试"')
    const linkIdx = src.indexOf('href="/exam"', labelIdx)
    const btnHead = src.slice(Math.max(0, labelIdx - 400), linkIdx)
    expect(btnHead).not.toContain('hidden')
    // 在热榜按钮之后（与热榜并排，探索菜单不是唯一入口）
    expect(src.indexOf('aria-label="热榜"')).toBeLessThan(src.indexOf('aria-label="考试"'))
  })

  it('倒计时徽章只在 todayBadge.countdownLabel 非空时出现，复用今日中心琥珀 pill，仅 ≥lg 显示', () => {
    const btn = windowAround(src, 'aria-label="考试"', 1200, 900)
    expect(btn).toContain('todayBadge?.countdownLabel')
    expect(btn).toContain('{todayBadge.countdownLabel}')
    expect(btn).toContain('bg-amber-500/12')
    expect(btn).toContain('text-amber-700')
    expect(btn).toContain('dark:text-amber-300')
    expect(btn).toContain('lg:inline-flex')
    expect(btn).toContain('data-testid="exam-countdown-badge"')
    // 与今日中心弹窗同款式（today-center-dialog.tsx:84），不另发明样式
    const dlg = read('src/components/home-windows/today-center-dialog.tsx')
    expect(dlg).toContain('bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300')
  })

  it('宽度账：360px 7 钮 320px、390px 8 钮 366px（外观浮层 <390px 隐藏腾位）', () => {
    expect(src).toContain('7×44 + 6×2 = 320px')
    expect(src).toContain('8×44 + 7×2 = 366px')
    // 外观聚合浮层 <390px 隐藏：wrapper 仍在源码里（组件未删），只是窄屏不占位
    expect(src).toContain('<AppearanceQuickPopover')
    expect(src).toContain('hidden min-[390px]:contents')
    // 考试按钮本身不参与分档隐藏
    const btn = windowAround(src, 'aria-label="考试"', 1200, 900)
    expect(btn).not.toContain('min-[390px]')
  })

  it('全站 href="/exam" 恰好 2 处：顶栏直达 + 探索菜单「考试日历」（不多不少）', () => {
    expect(src.split('href="/exam"').length - 1).toBe(2)
  })

  it('回归：热榜、今日中心、探索菜单入口不动', () => {
    // 热榜直达仍在（M-02）
    const hot = windowAround(src, 'aria-label="热榜"', 200, 400)
    expect(hot).toContain('href="/hot"')
    expect(hot).toContain('热榜')
    // 今日中心仍受 onOpenTodayCenter 守卫、仍读 todayBadge
    expect(src).toContain('aria-label="打开今日中心小窗"')
    expect(src).toContain('onOpenTodayCenter')
    expect(src).toContain('todayBadge.todayCount')
    // 探索菜单内「考试日历」仍在（第二入口保留）
    const menu = windowAround(src, '考试日历', 400, 200)
    expect(menu).toContain('href="/exam"')
    expect(menu).toContain('备考节点与倒计时')
  })
})
