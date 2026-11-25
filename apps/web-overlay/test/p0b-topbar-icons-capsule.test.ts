/**
 * P0-B 顶栏（2026-11-26）：极速置顶图标线性布局 + 「自适应热度」胶囊对比度与下拉。
 *
 * 仓库 vitest 是 node 环境、无 jsdom：组件无法挂载，effect 不跑。
 * 因此按 home-quick-dock-default-tab.test.ts 的同款三分法：
 *   - 纯函数半：sortItemsByVisitFrequency / resolveRankingMode /
 *     sortCategoryItemsByMode 直接单测；
 *   - SSR 半：renderToString 首帧断言（角标在流内、图标 18px 白底容器、
 *     胶囊下拉触发器常驻且带当前模式文案）；
 *   - 守卫半：旧绝对定位角标 / 旧紫胶囊配方不得回潮、对照度实测值锁死、
 *     下拉只有三种已有模式（「最新收录」无数据，不得出现）。
 * 真浏览器挂载后的行为（1366/1920 两档截图、Gemini/Kimi 可见、下拉点开切
 * 换后排序真实变化）无法在 node 环境测，缺口如实记在这里，等人工验收。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { HomeQuickDock } from '../src/components/home-quick-dock'
import {
  RANKING_MODE_OPTIONS,
  sortCategoryItemsByMode,
} from '../src/components/navigation-category-section'
import {
  readVisitCounts,
  sortItemsByVisitFrequency,
  type VisitStats,
} from '../src/lib/offline-recent'
import { resolveRankingMode } from '../src/lib/modular/home-diy-storage'
import type { SpeedDialSite } from '../src/lib/speed-dial-order'

const HERE = dirname(fileURLToPath(import.meta.url))
const DOCK_SRC = readFileSync(join(HERE, '..', 'src', 'components', 'home-quick-dock.tsx'), 'utf8')
const SECTION_SRC = readFileSync(
  join(HERE, '..', 'src', 'components', 'navigation-category-section.tsx'),
  'utf8',
)

// ---------- WCAG 相对亮度 / 对比度（sRGB 标准公式，与 a11y-token-contrast 同款） ----------
function lin(v: number): number {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
/** 前景以 alpha 合成到底色上（半透明底必须合成后再算） */
function over(fg: string, alpha: number, bg: string): string {
  const f = [1, 3, 5].map((i) => parseInt(fg.slice(i, i + 2), 16))
  const b = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16))
  return (
    '#' +
    f
      .map((v, i) => Math.round(v * alpha + b[i]! * (1 - alpha)).toString(16).padStart(2, '0'))
      .join('')
  )
}

function speedSite(id: string, title: string): SpeedDialSite {
  return { id, title, href: `https://${id}.example.com/`, icon: null }
}

describe('P0-B 极速置顶图标：线性 flex，角标永不盖图标', () => {
  const sites = [
    speedSite('claude', 'Claude'),
    speedSite('gemini', 'Google Gemini'),
    speedSite('kimi', 'Kimi'),
  ]
  const digits = new Map<string, number>([
    ['claude', 1],
    ['gemini', 5],
    ['kimi', 6],
  ])
  const html = renderToString(
    createElement(HomeQuickDock, { speedSites: sites, dialDigitById: digits }),
  )

  it('SSR 首帧：三站站名都在，角标 kbd 在流内、位于站名前', () => {
    for (const title of ['Claude', 'Google Gemini', 'Kimi']) expect(html).toContain(title)
    // inline kbd：relative 流内、无绝对定位偏移；三个数字各出现一次
    expect(html).toContain('>1</kbd>')
    expect(html).toContain('>5</kbd>')
    expect(html).toContain('>6</kbd>')
    // 每只角标都在本站名前（线性顺序 [kbd][图标][站名]）
    for (const [digit, title] of [
      ['1', 'Claude'],
      ['5', 'Google Gemini'],
      ['6', 'Kimi'],
    ] as const) {
      const kbdAt = html.indexOf(`>${digit}</kbd>`)
      const titleAt = html.indexOf(title)
      expect(kbdAt, `${title} 的角标应在站名前`).toBeGreaterThan(-1)
      expect(kbdAt).toBeLessThan(titleAt)
    }
  })

  it('SSR 首帧：图标是 18px 固定圆角容器 + 白色兜底底色', () => {
    expect(html).toContain('h-[18px] w-[18px]')
    expect(html).toContain('bg-white')
    // 容器在角标之后、站名之前
    const boxAt = html.indexOf('h-[18px] w-[18px]')
    expect(boxAt).toBeGreaterThan(html.indexOf('>1</kbd>'))
    expect(boxAt).toBeLessThan(html.indexOf('Claude'))
  })

  it('源码守卫：坞内不再有压在图标上的绝对定位角标', () => {
    expect(DOCK_SRC).not.toContain("className=\"-bottom-1 -right-1\"")
    expect(DOCK_SRC).not.toContain('-bottom-1 -right-1')
    expect(DOCK_SRC).toContain('<NumberDialBadge digit={item.digit} inline />')
    expect(DOCK_SRC).toContain('h-[18px] w-[18px]')
  })
})

describe('P0-B 我的常用排序 sortItemsByVisitFrequency（纯函数）', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const stats: Record<string, VisitStats> = {
    b: { count: 3, lastVisitedAt: 1000 },
    c: { count: 3, lastVisitedAt: 2000 },
    d: { count: 1, lastVisitedAt: 9999 },
  }

  it('按次数降序，同次数按最后访问倒序，无记录排最后保原序', () => {
    expect(sortItemsByVisitFrequency(items, stats).map((i) => i.id)).toEqual(['c', 'b', 'd', 'a'])
  })

  it('置顶永远在最前（置顶内部保钉选顺序），其余再按频次', () => {
    expect(sortItemsByVisitFrequency(items, stats, ['d', 'a']).map((i) => i.id)).toEqual([
      'd',
      'a',
      'c',
      'b',
    ])
  })

  it('空表退化为置顶优先原序；不改原数组；脏 count 按 0 计', () => {
    expect(sortItemsByVisitFrequency(items, {}).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
    const dirty: Record<string, VisitStats> = {
      b: { count: Number.NaN },
      c: { count: -5, lastVisitedAt: -1 },
    }
    expect(sortItemsByVisitFrequency(items, dirty).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
    const before = items.map((i) => i.id)
    sortItemsByVisitFrequency(items, stats)
    expect(items.map((i) => i.id)).toEqual(before)
  })

  it('SSR 下读不到 localStorage 返回空表（永不抛错）', () => {
    expect(readVisitCounts()).toEqual({})
  })
})

describe('P0-B 排序方式 resolveRankingMode（旧配置兼容）', () => {
  it('显式 rankingMode 优先', () => {
    expect(resolveRankingMode({ rankingMode: 'frequent', enableAdaptiveRanking: false })).toBe(
      'frequent',
    )
    expect(resolveRankingMode({ rankingMode: 'adaptive', enableAdaptiveRanking: false })).toBe(
      'adaptive',
    )
  })

  it('缺 rankingMode 时由旧布尔值派生，升级后排序不变', () => {
    expect(resolveRankingMode({ enableAdaptiveRanking: true })).toBe('adaptive')
    expect(resolveRankingMode({ enableAdaptiveRanking: false })).toBe('default')
    expect(resolveRankingMode({})).toBe('default')
  })

  it('非法字符串不采信，退回布尔派生', () => {
    expect(
      resolveRankingMode({
        rankingMode: 'newest' as unknown as 'adaptive',
        enableAdaptiveRanking: true,
      }),
    ).toBe('adaptive')
  })
})

describe('P0-B 模式切换 sortCategoryItemsByMode：三种模式都是已有排序', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const stats: Record<string, VisitStats> = { b: { count: 5, lastVisitedAt: 100 } }

  it('frequent 按本机次数排，default 保收录次序（置顶优先）', () => {
    expect(sortCategoryItemsByMode(items, [], 'frequent', stats).map((i) => i.id)).toEqual([
      'b',
      'a',
      'c',
    ])
    expect(sortCategoryItemsByMode(items, [], 'default', stats).map((i) => i.id)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(sortCategoryItemsByMode(items, ['c'], 'default', stats).map((i) => i.id)).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('adaptive 仍走既有自适应算法（置顶加权在最前）', () => {
    expect(sortCategoryItemsByMode(items, ['c'], 'adaptive', stats).map((i) => i.id)[0]).toBe('c')
  })

  it('下拉只有三种模式，「最新收录」无数据、不得出现', () => {
    expect(RANKING_MODE_OPTIONS.map((o) => o.id)).toEqual(['adaptive', 'default', 'frequent'])
    expect(RANKING_MODE_OPTIONS.map((o) => o.label)).toEqual([
      '自适应热度',
      '站内综合',
      '我的常用',
    ])
    expect(SECTION_SRC).not.toContain("id: 'newest'")
    expect(SECTION_SRC).not.toContain('id: "newest"')
  })
})

describe('P0-B 胶囊对比度：翠绿半透明底 + 高亮文字，WCAG AA', () => {
  // 浅色：文字 emerald-800 #065f46，底 emerald-500 #10b981 /15 合成到白底；
  // 深色：文字 emerald-300 #6ee7b7，底 emerald-400 #34d399 /15 合成到 --background 深底 #09090b。
  it('实测对比度浅色 ≥4.5:1、深色 ≥4.5:1', () => {
    const light = contrast('#065f46', over('#10b981', 0.15, '#ffffff'))
    const dark = contrast('#6ee7b7', over('#34d399', 0.15, '#09090b'))
    expect(light).toBeGreaterThanOrEqual(4.5)
    expect(dark).toBeGreaterThanOrEqual(4.5)
    // 锁死实测值，回潮即红（以本测试同款 sRGB 公式为准）
    expect(light).toBeCloseTo(6.69, 1)
    expect(dark).toBeCloseTo(10.35, 1)
  })

  it('下拉在 h2 之外（标题不得含 onClick，见 category-section-link 守卫）', () => {
    const start = SECTION_SRC.indexOf('<h2')
    const end = SECTION_SRC.indexOf('</h2>', start)
    const h2 = SECTION_SRC.slice(start, end)
    expect(h2).not.toContain('onClick')
    expect(h2).not.toContain('<DropdownMenu>')
    expect(SECTION_SRC.indexOf('<DropdownMenu>')).toBeGreaterThan(end)
  })

  it('源码守卫：旧紫胶囊配方已清，新配方 + 下拉触发器常驻', () => {
    expect(SECTION_SRC).not.toContain('bg-violet-500/10 text-violet-700')
    expect(SECTION_SRC).not.toContain('>自适应热度</span>')
    expect(SECTION_SRC).toContain('bg-emerald-500/15')
    expect(SECTION_SRC).toContain('text-emerald-800')
    expect(SECTION_SRC).toContain('dark:text-emerald-300')
    expect(SECTION_SRC).toContain('border-emerald-600/40')
    expect(SECTION_SRC).toContain('<DropdownMenu>')
    expect(SECTION_SRC).toContain('分类内排序方式')
    expect(SECTION_SRC).toContain('onClick={() => setRankingMode(opt.id)}')
  })
})
