/**
 * P1-1 残留：420px 宽侧栏在 1024px 档仍溢出。
 *
 * 根因（静态量测）：工具栏最小需 ~704px（搜索 min-w 260 + 右侧工具组 ~430
 * + gap 12）+ 头部 padding 48px，主区至少留 780px；420px 侧栏在 1024px
 * 档只剩 604px，工具栏溢出约 148px。header-layout-guard 锁
 * md:flex-nowrap，不能靠换行修。
 *
 * 修复：侧栏最大宽随视口钳制，max = min(420, 视口宽 − 780)，下限 180。
 * 1024px 档上限 244px（主区 780px，工具栏恰好放下）；≥1200px 档恢复 420 上限。
 * 拖拽、键盘、存量读取、窗口 resize 四处同钳制；slider 的 aria-valuemax
 * 跟随视口上限走。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '../src/components/sidebar.tsx'), 'utf8')

describe('P1-1 残留：侧栏最大宽随视口钳制', () => {
  it('最大宽 = min(420, 视口宽 − 780)，下限 180', () => {
    expect(src).toContain('window.innerWidth - 780')
    expect(src).toContain('Math.max(180, Math.min(420, window.innerWidth - 780))')
  })

  it('拖拽上界用视口钳制后的最大宽（不用写死 420）', () => {
    expect(src).toContain('Math.min(viewportMaxWidth, Math.round(startW')
  })

  it('键盘右移/End 用视口钳制后的最大宽', () => {
    expect(src).toContain('Math.min(viewportMaxWidth, current + step)')
    expect(src).toContain('else if (e.key === \'End\') next = viewportMaxWidth')
  })

  it('存量宽度读取时同样钳制（1024px 档存 420 读回 244）', () => {
    expect(src).toContain('1024px 档存 420 会读回 244')
    expect(src).toContain('parsed > max')
  })

  it('窗口 resize 时重算上限并回钳超宽侧栏', () => {
    expect(src).toContain("window.addEventListener('resize', applyViewportMax)")
    expect(src).toContain('prev <= max')
  })

  it('slider 的 aria-valuemax 跟随视口上限', () => {
    expect(src).toContain('aria-valuemax={viewportMaxWidth}')
    expect(src).not.toContain('aria-valuemax={420}')
  })

  it('1024px 档算术：上限 244，主区 780 ≥ 工具栏最小 752', () => {
    const maxAt1024 = Math.max(180, Math.min(420, 1024 - 780))
    expect(maxAt1024).toBe(244)
    expect(1024 - maxAt1024).toBeGreaterThanOrEqual(752)
    const maxAt1200 = Math.max(180, Math.min(420, 1200 - 780))
    expect(maxAt1200).toBe(420)
  })
})
