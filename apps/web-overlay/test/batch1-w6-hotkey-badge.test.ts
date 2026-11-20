/**
 * Batch 1 W6 PoC：Alt+数字热键 + 数字徽标 + 底部提示行（04 §4/§7.3）。
 *
 * 验收：D1（Alt+1..0 映射与越界静默）、D2（无 Alt 时数字正常进文本）、
 * D3（前 10 条有徽标、第 11 条起无、底部提示行文案逐字）。
 *
 * 测试策略（与仓库既有模式一致：lib 层真跑、组件层源码守卫 + 轻量渲染）：
 *  - `altDigitTargetIndex` 是纯函数，直接跑；
 *  - `NavDigitBadge` / `PaletteFooterHint` 用 renderToString 真渲染断言；
 *  - 接线（分支位置、打开逻辑、9 处徽标挂载、footer 挂载）用源码守卫锁住，
 *    因为 SearchPalette 整组件在 node 环境挂不起来（hooks + 检索 + 面板状态）。
 *
 * 真机才能验的（记为「需真人/真机验证」，不伪造通过）：
 *  - D1 的端到端：真键盘 Alt+1 打开第 1 条且与 Enter 同结果（含 recordOfflineVisit）；
 *  - D2 的真键盘：输入框里敲 123 正常进文本、Ctrl+1/⌘+1 不触发本站直达；
 *  - macOS 上 Option+数字的 e.key 是特殊字符（¡/™ 等）而非数字，Alt+数字
 *    在 macOS 键盘上可能不触发——方案只写了 e.key 口径，须真机核实后定是否补 e.code；
 *  - D3 的 390px 真实渲染：徽标不挤占标题、底部提示行不断行。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

import { altDigitTargetIndex } from '@/lib/palette-actions'
import { NavDigitBadge, PaletteFooterHint } from '@/components/search-palette'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位 overlay 根目录（镜像副本 apps/web/test 不会被误当成源） */
function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
  return hit
}

const ROOT = overlayRoot()
const paletteSrc = readFileSync(join(ROOT, 'src/components/search-palette.tsx'), 'utf8')

/** renderToString 的 HTML 去标签后即 textContent。 */
const textOf = (html: string) => html.replace(/<[^>]*>/g, '')

describe('altDigitTargetIndex（D1：映射本身）', () => {
  it('Alt+1..9 → 0..8，Alt+0 → 9', () => {
    for (let d = 1; d <= 9; d++) expect(altDigitTargetIndex(String(d), 10)).toBe(d - 1)
    expect(altDigitTargetIndex('0', 10)).toBe(9)
  })

  it('只有 3 条结果时 Alt+5 静默无操作（null）；空列表时任何数字都 null', () => {
    expect(altDigitTargetIndex('5', 3)).toBeNull()
    expect(altDigitTargetIndex('4', 3)).toBeNull()
    expect(altDigitTargetIndex('1', 0)).toBeNull()
    expect(altDigitTargetIndex('0', 9)).toBeNull()
    expect(altDigitTargetIndex('0', 10)).toBe(9)
  })

  it('非数字键一律 null（不劫持其他按键）', () => {
    for (const key of ['a', 'Enter', ' ', '10', '', 'ArrowDown']) {
      expect(altDigitTargetIndex(key, 10)).toBeNull()
    }
  })
})

describe('NavDigitBadge（D3：徽标）', () => {
  it('第 1..10 条显示 1..9、0', () => {
    expect(textOf(renderToString(createElement(NavDigitBadge, { index: 0 })))).toBe('1')
    expect(textOf(renderToString(createElement(NavDigitBadge, { index: 8 })))).toBe('9')
    expect(textOf(renderToString(createElement(NavDigitBadge, { index: 9 })))).toBe('0')
  })

  it('第 11 条起不显示（index 10 与 -1 都渲染为空）', () => {
    expect(renderToString(createElement(NavDigitBadge, { index: 10 }))).toBe('')
    expect(renderToString(createElement(NavDigitBadge, { index: -1 }))).toBe('')
  })

  it('徽标是视觉辅助：aria-hidden="true"，复用行内 kbd 样式', () => {
    const html = renderToString(createElement(NavDigitBadge, { index: 0 }))
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('<kbd')
    expect(html).toContain('font-mono')
  })

  it('源码守卫：9 组结果行（建议/快捷链接/DIY/场景/收藏/操作/工具/插件/站点）各挂一个徽标', () => {
    expect(paletteSrc.match(/<NavDigitBadge index=/g)?.length).toBe(9)
    expect(paletteSrc).toContain("if (index < 0 || index > 9) return null")
    expect(paletteSrc).toContain("const digit = index === 9 ? '0' : String(index + 1)")
  })
})

describe('PaletteFooterHint（D3：底部提示行文案逐字）', () => {
  it('文案一字不差：↑↓ 选择 · Enter 打开 · Alt+1–0 直达前 10 条 · Esc 关闭', () => {
    const text = textOf(renderToString(createElement(PaletteFooterHint)))
    expect(text).toBe('↑↓ 选择 · Enter 打开 · Alt+1–0 直达前 10 条 · Esc 关闭')
  })

  it('标点是全角 ·（U+00B7）与 en dash –（U+2013），不是半角点与连字符', () => {
    const text = textOf(renderToString(createElement(PaletteFooterHint)))
    // 三个 · 分隔出四段
    expect(text.split('·')).toHaveLength(4)
    // dash 从渲染文本里取位置，不依赖测试里手打的字符
    const dash = text[text.indexOf('Alt+1') + 5]!
    expect(dash.charCodeAt(0)).toBe(0x2013)
    expect(text).not.toContain('Alt+1-0')
  })

  it('源码守卫：底部提示行只此一处；Alt+1–0 的 kbd 只出现一次（另一次在上方注释里）', () => {
    expect(paletteSrc.match(/<PaletteFooterHint \/>/g)?.length).toBe(1)
    expect(paletteSrc.match(/>Alt\+1–0</g)?.length).toBe(1)
  })
})

describe('onSearchKeyDown 的 Alt+数字分支（D1/D2 接线守卫）', () => {
  it('分支在 ArrowDown/ArrowUp 之后、Enter 之前', () => {
    const arrowAt = paletteSrc.indexOf("e.key === 'ArrowUp'")
    const altAt = paletteSrc.indexOf('altDigitTargetIndex(e.key, navItems.length)')
    const enterAt = paletteSrc.indexOf("if (e.key === 'Enter') {")
    expect(arrowAt).toBeGreaterThan(-1)
    expect(altAt).toBeGreaterThan(arrowAt)
    expect(enterAt).toBeGreaterThan(altAt)
  })

  it('触发条件：altKey 且 meta/ctrl 不同时按下（D2：裸数字与浏览器组合键不触发）', () => {
    expect(paletteSrc).toContain('if (e.altKey && !e.metaKey && !e.ctrlKey) {')
  })

  it('命中后与 Enter 打开同一行：先滚进可视区再点真实元素（与 Enter 分支同款）', () => {
    const altAt = paletteSrc.indexOf('altDigitTargetIndex(e.key, navItems.length)')
    const enterAt = paletteSrc.indexOf("if (e.key === 'Enter') {")
    const segment = paletteSrc.slice(altAt, enterAt)
    expect(segment).toContain('const el = findOptionElement(target)')
    expect(segment).toContain("el.scrollIntoView({ block: 'nearest' })")
    expect(segment).toContain('el.click()')
  })

  it('超出长度静默无操作：Alt+数字越界时 return，不落到其他分支', () => {
    expect(paletteSrc).toContain("if (e.key.length === 1 && e.key >= '0' && e.key <= '9') return")
  })

  it('本分支不碰 IME：全文件无 isComposing / onComposition（那是 W7 的活，不冲突）', () => {
    expect(paletteSrc).not.toContain('isComposing')
    expect(paletteSrc).not.toContain('onComposition')
  })

  it('C3：服务端 hits 仍原样进导航列表（MRU 只加本地行分，不动 RRF 排名）', () => {
    expect(paletteSrc).toContain('siteIds: hits.filter((h) => h.site).map((h) => `site-${h.siteId}`)')
  })
})
