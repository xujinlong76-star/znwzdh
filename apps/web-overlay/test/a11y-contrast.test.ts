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

/**
 * 无障碍 #11/#14（2026-11-15）：热榜/合集/市场/追剧清单/星图弹窗低对比度打包修。
 *
 * 大头由扫荡 16ac463d 落地（216 处 amber/emerald -600→-700、追剧清单与星图
 * zinc-400 正文修正，另有 §11/§12 守卫）；本轮补齐扫荡漏掉的三类：
 * ① 追剧清单登录按钮是 bg-amber-600 白字（3.19:1，扫荡只扫了 text-*），
 * ② 视频横幅 blue-600 仍命中徽章门禁 §7（bg-blue-500/10 + text-blue-600），
 * ③ 豁免清退前置项（hot-view/collection-detail-view 的 muted /90、
 * reset-password 的 bg-destructive/10→/15），随后清退 WIP_HOT_EXEMPT。
 * ④ 扫荡漏掉的同色系：星图 rose-600（边界值：oklch 口径 4.48、hex 口径 4.70；
 * 按仓库页脚既有判定——页脚已锁 rose-700——修掉）、追剧清单 rose-600/80
 * （3.75）、市场 sky-600（4.10），同配方 -700 修掉。
 * 星图弹窗剩余 3 处纯图标 zinc-400（关闭按钮、箭头分隔、ArrowRight）是扫荡
 * 有意保留并由 §12 锁死恰 3 处的，本轮不碰。
 * 修法与扫荡一致：-600→-700 配 dark:-400、zinc-400→zinc-500 配 dark:zinc-400，
 * 裸换会把深色拖下水。数值口径与 UX #9 相同（Tailwind 默认色板 hex 现场算）。
 */
describe('无障碍 #11/#14 对比度打包修复', () => {
  const hot = overlayFile('src/app/hot/hot-view.tsx')
  const collection = overlayFile('src/app/collections/[slug]/collection-detail-view.tsx')
  const watchlistPage = overlayFile('src/app/me/watchlist/page.tsx')
  const starMap = overlayFile('src/components/graph/knowledge-star-map-modal.tsx')
  const resetPassword = overlayFile('src/app/auth/reset-password/page.tsx')

  it('热榜 chips：浅色 -700 / 深色 -400，≥4.5:1', () => {
    const amber = hot.split('\n').find((l) => l.includes('border-amber-500/25'))
    const emerald = hot.split('\n').find((l) => l.includes('border-emerald-500/25'))
    expect(amber).toContain('text-amber-700 dark:text-amber-400')
    expect(amber).not.toContain('text-amber-600')
    expect(emerald).toContain('text-emerald-700 dark:text-emerald-400')
    expect(emerald).not.toContain('text-emerald-600')
    expect(ux9Contrast('#b45309', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#047857', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#fbbf24', '#09090b')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#34d399', '#09090b')).toBeGreaterThanOrEqual(4.5)
  })

  it('合集详情：已复制/全部收藏/已逛/阶段徽章/已掌握，浅色 -700 配 dark:-400', () => {
    const copied = collection.split('\n').find((l) => l.includes('>已复制<'))
    expect(copied).toContain('text-emerald-700 dark:text-emerald-400')
    const batch = collection.split('\n').find((l) => l.includes('border-amber-500/30'))
    expect(batch).toContain('text-amber-700 dark:text-amber-400')
    const visited = collection.split('\n').find((l) => l.includes('✓ 已逛'))
    expect(visited).toContain('text-emerald-700 dark:text-emerald-400')
    const badges = collection.split('\n').filter((l) => l.includes('bg-emerald-500/10'))
    expect(badges.length).toBeGreaterThanOrEqual(2)
    for (const line of badges) {
      expect(line).toContain('text-emerald-700 dark:text-emerald-400')
      expect(line).not.toContain('text-emerald-600')
    }
  })

  it('视频横幅：blue-600→blue-700 配 dark:blue-400，不再命中徽章门禁 §7', () => {
    const hotIcon = hot.split('\n').find((l) => l.includes('bg-blue-500/10 text-blue-'))
    expect(hotIcon).toContain('text-blue-700 dark:text-blue-400')
    expect(hotIcon).not.toContain('text-blue-600')
    const hotBtn = hot.split('\n').find((l) => l.includes('border-blue-500/30'))
    expect(hotBtn).toContain('text-blue-700 dark:text-blue-400')
    const collIcon = collection.split('\n').find((l) => l.includes('bg-blue-500/10 text-blue-'))
    expect(collIcon).toContain('text-blue-700 dark:text-blue-400')
    const collBtn = collection.split('\n').find((l) => l.includes('border-blue-500/30'))
    expect(collBtn).toContain('text-blue-700 dark:text-blue-400')
    expect(ux9Contrast('#1d4ed8', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#60a5fa', '#09090b')).toBeGreaterThanOrEqual(4.5)
  })

  it('追剧清单删除按钮：浅色 zinc-500 / 深色 zinc-400，按图标 3:1 计', () => {
    const line = watchlistPage.split('\n').find((l) => l.includes('hover:border-red-400'))
    expect(line).toBeTruthy()
    // 扫荡把 dark:text-zinc-400 排到了串尾，不与 text-zinc-500 相邻，分开断言
    expect(line).toContain('text-zinc-500')
    expect(line).toContain('dark:text-zinc-400')
    expect(line).not.toMatch(/p-1.5 text-zinc-400"/)
    expect(ux9Contrast('#71717a', '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(ux9Contrast('#a1a1aa', '#09090b')).toBeGreaterThanOrEqual(3)
  })

  it('追剧清单登录按钮：白字压 amber-700（悬停 amber-800），双模式同解 ≥4.5:1', () => {
    const line = watchlistPage.split('\n').find((l) => l.includes('hover:bg-amber-800'))
    expect(line).toBeTruthy()
    expect(line).toContain('bg-amber-700')
    expect(line).not.toContain('bg-amber-600')
    expect(line).not.toContain('hover:bg-amber-500')
    expect(ux9Contrast('#ffffff', '#b45309')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#ffffff', '#92400e')).toBeGreaterThanOrEqual(4.5)
    const syncLines = watchlistPage.split('\n')
    const syncIdx = syncLines.findIndex((l) => l.includes('上次同步'))
    expect(syncIdx).toBeGreaterThan(0)
    expect(syncLines[syncIdx - 1]).toContain('text-zinc-500 dark:text-zinc-400')
    const empty = syncLines.find((l) => l.includes('没有安排'))
    expect(empty).toContain('text-zinc-500 dark:text-zinc-400')
    expect(empty).not.toContain('dark:text-zinc-500')
  })

  it('星图弹窗：去重统计 -700 配 dark:-400，zinc-400 小字统一 zinc-500 配 dark:zinc-400', () => {
    const dup = starMap.split('\n').find((l) => l.includes('识别潜在雷同对'))
    expect(dup).toContain('text-amber-700 dark:text-amber-400')
    const conf = starMap.split('\n').find((l) => l.includes('高置信度重复'))
    expect(conf).toContain('text-rose-700 dark:text-rose-400')
    expect(conf).not.toContain('text-rose-600')
    expect(ux9Contrast('#be123c', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#fb7185', '#09090b')).toBeGreaterThanOrEqual(4.5)
    const searchIcon = starMap.split('\n').find((l) => l.includes('<Search className='))
    expect(searchIcon).toContain('text-zinc-500 dark:text-zinc-400')
  })

  it('追剧清单 rose 提醒：标注链接与更新日说明浅色 -700，≥4.5:1', () => {
    // :513 标注链接 rose-600 是边界值（oklch 4.48 / hex 4.70）、悬停 rose-500 仅 3.67 不达标；:535 rose-600/80 仅 3.75
    expect(watchlistPage).toContain('text-xs text-rose-700 underline underline-offset-2 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-400')
    expect(watchlistPage).toContain('text-xs text-rose-700 dark:text-rose-300/70')
    expect(watchlistPage).not.toContain('text-rose-600/80')
    expect(ux9Contrast('#be123c', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('市场品类徽章：sky-600→sky-700 配 dark:sky-400，≥4.5:1', () => {
    // site-pack 徽章 sky-600 白底 4.10:1 不达标（扫荡只覆盖了 amber/emerald）
    const plugin = overlayFile('src/app/marketplace/[slug]/plugin-detail-view.tsx')
    expect(plugin).toContain('text-sky-700 dark:text-sky-400 bg-sky-500/5')
    expect(plugin).not.toContain('text-sky-600')
    expect(ux9Contrast('#0369a1', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#38bdf8', '#09090b')).toBeGreaterThanOrEqual(4.5)
  })

  it('重置密码缺 token 提示条：浅色 amber-700 / 深色 amber-400，≥4.5:1', () => {
    const lines = resetPassword.split('\n')
    const idx = lines.findIndex((l) => l.includes('缺少重置令牌'))
    expect(idx).toBeGreaterThan(0)
    // 文案在内层 div，类名在往上找的 bg-amber-500/10 外层提示条上
    const classLine = [...lines.slice(0, idx)].reverse().find((l) => l.includes('bg-amber-500/10'))
    expect(classLine).toBeTruthy()
    expect(classLine).toContain('text-amber-700 dark:text-amber-400')
    expect(classLine).not.toContain('text-amber-600')
    expect(ux9Contrast('#b45309', '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
})
