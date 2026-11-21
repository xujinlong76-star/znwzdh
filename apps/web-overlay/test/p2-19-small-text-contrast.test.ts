/**
 * P2-19：10px 级灰字对比度实测锁定。
 *
 * 审计要求“用实测工具量每处前景/背景组合的对比度，全部 ≥4.5:1”。
 * 本测试从 globals.css 实读浅/深两套 Token 值（含半透明底的 alpha 混合），
 * 逐组合算出比值并断言 ≥4.5——Token 一改就重算，改坏即红，不靠目测。
 *
 * 2026-11-21 实测比值（node 直算，见提交说明）：
 * 浅色：mutedFg/card 6.04、mutedFg/muted70 5.65、mutedFg/primary5 5.45、
 *   pinnedFg/pinned10 4.67、pinnedFg/pinned15 4.52（最紧）、catFg/cat10 6.82、
 *   primaryFg/primary 16.97；
 * 深色：mutedFg/card 7.76、mutedFg/muted70 6.49、pinnedFg/pinned10 10.34、
 *   pinnedFg/pinned15 9.48、catFg/cat10 6.27、primaryFg/primary 16.97。
 * （注意：深色 --pinned/--category 本体未在 .dark 重定义，继承浅色值
 * amber-500/indigo-500；测试的 token() 按此层叠回退。）
 * 全部 ≥4.5:1，故 P2-19 不改源码、只锁定测量；最紧的 pinned15（4.52）若
 * 日后 Token 变动跌破 4.5，本测试即红。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(join(__dirname, '../src/styles/globals.css'), 'utf8')

/** 从 :root（浅色）与 .dark（深色）变量块里取 `--name: h s% l%;`。
 * 深色未重定义的 Token 继承 :root 值（CSS 自定义属性可继承），故回退到 :root。 */
function token(name: string, dark: boolean): [number, number, number] {
  const blockOf = (re: RegExp) => CSS.match(re)?.[1] ?? ''
  const rootBlock = blockOf(/:root\s*\{([\s\S]*?)\}/)
  const darkBlock = blockOf(/\.dark\s*\{([\s\S]*?)\}/)
  const read = (block: string) => {
    const m = block.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`))
    return m ? ([Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number]) : null
  }
  if (dark) {
    // 深色：.dark 优先，未定义则继承 :root（如 --pinned/--category 本体只在 :root 定义）。
    const v = read(darkBlock) ?? read(rootBlock)
    if (!v) throw new Error(`token --${name} not found (dark/root)`)
    return v
  }
  const v = read(rootBlock)
  if (!v) throw new Error(`token --${name} not found (light)`)
  return v
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [number, number, number]
}

function luminance(rgb: [number, number, number]): number {
  const f = (c: number) => {
    c /= 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const l1 = luminance(a)
  const l2 = luminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** 前景色以 alpha 盖在背景色上（Tailwind /N 透明度变体的实际呈现）。 */
function over(fg: [number, number, number], bg: [number, number, number], alpha: number): [number, number, number] {
  return fg.map((v, i) => Math.round(alpha * v + (1 - alpha) * bg[i])) as [number, number, number]
}

const CASES: Array<{ name: string; fg: string; bg: string; bgAlpha?: number }> = [
  { name: 'mutedFg on card（卡片内 10px 提示）', fg: 'muted-foreground', bg: 'card' },
  { name: 'mutedFg on muted/70（标签芯片底）', fg: 'muted-foreground', bg: 'muted', bgAlpha: 0.7 },
  { name: 'mutedFg on primary/5（目录 hover 底）', fg: 'muted-foreground', bg: 'primary', bgAlpha: 0.05 },
  { name: 'pinnedFg on pinned/10（置顶/数字角标）', fg: 'pinned-foreground', bg: 'pinned', bgAlpha: 0.1 },
  { name: 'pinnedFg on pinned/15（已置顶角标，最紧）', fg: 'pinned-foreground', bg: 'pinned', bgAlpha: 0.15 },
  { name: 'catFg on cat/10（分类标签）', fg: 'category-foreground', bg: 'category', bgAlpha: 0.1 },
  { name: 'primaryFg on primary（数字角标）', fg: 'primary-foreground', bg: 'primary' },
]

describe('P2-19：10px 级灰字对比度实测', () => {
  for (const dark of [false, true]) {
    const mode = dark ? '深色' : '浅色'
    for (const c of CASES) {
      it(`${mode} ${c.name} ≥ 4.5:1`, () => {
        const fg = hslToRgb(token(c.fg, dark))
        const bgRaw = hslToRgb(token(c.bg, dark))
        const card = hslToRgb(token('card', dark))
        const bg = c.bgAlpha === undefined ? bgRaw : over(bgRaw, card, c.bgAlpha)
        const ratio = contrast(fg, bg)
        expect(ratio).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})
