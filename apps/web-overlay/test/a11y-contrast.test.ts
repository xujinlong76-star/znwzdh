import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 对比度回归（Lighthouse 2026-10-23 /custom：color-contrast 0 分）。
 *
 * 两处 12px 小字在浅色模式下低于 WCAG AA 4.5:1：
 * - 看板切换条的未选中项：muted 前景色再叠 opacity-75 → 2.91:1；
 * - 页脚「模块化工作台」：emerald-600 → 3.62:1（emerald-700 达标）。
 *
 * 这类退化不会被单元测试自然覆盖（纯样式），所以按仓库惯例锁源码意图。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('浅色模式对比度', () => {
  it('看板计数不再叠 opacity，避免 12px muted 文本跌破 AA', () => {
    const canvas = overlayFile('src/components/modular/modular-canvas.tsx')
    const line = canvas.split('\n').find((l) => l.includes('({b.widgets.length})'))
    expect(line).toBeTruthy()
    expect(line).not.toContain('opacity-75')
  })

  it('页脚强调色与版权行都达到 AA', () => {
    const footer = overlayFile('src/components/footer.tsx')
    const custom = footer.split('\n').find((l) => l.includes('href="/custom"'))
    const market = footer.split('\n').find((l) => l.includes('href="/marketplace"'))
    expect(custom).toContain('text-emerald-700')
    expect(custom).not.toContain('text-emerald-600')
    // rose-600 实测 4.48:1，差 0.02 也是不达标
    expect(market).toContain('text-rose-700')
    expect(market).not.toContain('text-rose-600')
    // 版权行再叠 /80 透明度只有 3.63:1
    expect(footer).not.toContain('text-muted-foreground/80')
  })
})

/**
 * UX #9（2026-11-15）：追剧弹窗 + 简报页 6 处低对比度小字打包修。
 *
 * 浅色模式下 10–11px 小字低于 WCAG AA 4.5:1（图标按 1.4.11 计 3:1），
 * 深色模式大多本来就达标，所以修法必须分模式写 dark: 变体——
 * 裸换浅色 token 会把深色模式拖下水（zinc-400→zinc-500 深色 6.91→3.67）。
 * 数值用 Tailwind 默认色板 hex 现场算（v4 oklch 四舍五入后漂移 ≤0.05），
 * 背景取自 globals.css 实测 token：浅色弹窗/卡片白 #ffffff、
 * 深色弹窗 zinc-900 #18181b、深色卡片 --card #09090b、悬停底 --accent #f4f4f5。
 */
function hexToRgb(h: string): [number, number, number] {
  const v = h.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number]
}
function ux9Lin(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
function ux9Contrast(fgHex: string, bgHex: string): number {
  const lum = (rgb: [number, number, number]) =>
    0.2126 * ux9Lin(rgb[0]) + 0.7152 * ux9Lin(rgb[1]) + 0.0722 * ux9Lin(rgb[2])
  const a = lum(hexToRgb(fgHex))
  const b = lum(hexToRgb(bgHex))
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('UX #9 追剧弹窗与简报页小字对比度', () => {
  const watchlist = overlayFile('src/components/watchlist-add-button.tsx')
  const brief = overlayFile('src/app/brief/page.tsx')

  it('节奏说明行：浅色 zinc-500 / 深色 zinc-400，≥4.5:1', () => {
    const line = watchlist.split('\n').find((l) => l.includes('text-[11px] leading-relaxed'))
    expect(line).toBeTruthy()
    expect(line).toContain('text-zinc-500 dark:text-zinc-400')
    expect(line).not.toMatch(/leading-relaxed text-zinc-400"/)
    expect(ux9Contrast('#71717a', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#a1a1aa', '#18181b')).toBeGreaterThanOrEqual(4.5)
  })

  it('简报热度标签：浅色 orange-700（悬停态也不跌破）/ 深色 orange-400，≥4.5:1', () => {
    const line = brief.split('\n').find((l) => l.includes('hotLabel'))
    expect(line).toBeTruthy()
    expect(line).toContain('text-orange-700 dark:text-orange-400')
    expect(line).not.toContain('text-orange-600')
    expect(ux9Contrast('#c2410c', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#c2410c', '#f4f4f5')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#fb923c', '#09090b')).toBeGreaterThanOrEqual(4.5)
  })

  it('“已加入”状态：浅色 emerald-700 / 深色 emerald-400，≥4.5:1', () => {
    const line = watchlist.split('\n').find((l) => l.includes('inline-flex items-center gap-1'))
    expect(line).toBeTruthy()
    expect(line).toContain('text-emerald-700 dark:text-emerald-400')
    expect(line).not.toContain('text-emerald-500')
    expect(ux9Contrast('#047857', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#34d399', '#18181b')).toBeGreaterThanOrEqual(4.5)
  })

  it('“已在清单”提示：浅色 amber-700 / 深色 amber-400，≥4.5:1', () => {
    const line = watchlist.split('\n').find((l) => l.includes('text-amber-'))
    expect(line).toBeTruthy()
    expect(line).toContain('text-amber-700 dark:text-amber-400')
    expect(line).not.toContain('text-amber-600')
    expect(ux9Contrast('#b45309', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#fbbf24', '#18181b')).toBeGreaterThanOrEqual(4.5)
  })

  it('存储受阻 alert：浅色 red-600 / 深色 red-400，≥4.5:1', () => {
    const line = watchlist.split('\n').find((l) => l.includes('role="alert"'))
    expect(line).toBeTruthy()
    expect(line).toContain('text-red-600 dark:text-red-400')
    expect(line).not.toContain('text-red-500')
    expect(ux9Contrast('#dc2626', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#f87171', '#18181b')).toBeGreaterThanOrEqual(4.5)
  })

  it('周几选中态：白字压 rose-600（双模式同解），≥4.5:1；边框不动', () => {
    const line = watchlist.split('\n').find((l) => l.includes('bg-rose-') && l.includes("text-white'"))
    expect(line).toBeTruthy()
    expect(line).toContain('border-rose-500 bg-rose-600 font-semibold text-white')
    expect(line).not.toContain('bg-rose-500 ')
    expect(ux9Contrast('#ffffff', '#e11d48')).toBeGreaterThanOrEqual(4.5)
  })

  it('关闭钮 X 图标：浅色 zinc-500 / 深色 zinc-400，按图标 3:1 计', () => {
    const line = watchlist.split('\n').find((l) => l.includes('rounded-full p-1'))
    expect(line).toBeTruthy()
    expect(line).toContain('text-zinc-500 dark:text-zinc-400')
    expect(line).not.toMatch(/p-1 text-zinc-400"/)
    expect(ux9Contrast('#71717a', '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(ux9Contrast('#a1a1aa', '#18181b')).toBeGreaterThanOrEqual(3)
  })
})
