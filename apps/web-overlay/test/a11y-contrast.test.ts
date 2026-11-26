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
    // P2-2（2026-11-21）：DIY 徽章由 emerald-700 改为语义 token text-success-foreground。
    // success-foreground 与 emerald-700（浅 #047857 白底 5.48:1）/ emerald-400
    // （深 #34d399 深底 10.35:1）同值，对比度等效；emerald-600（3.62:1 不达标）仍禁。
    expect(custom).toContain('text-success-foreground')
    expect(custom).not.toContain('text-emerald-600')
    // P1-15（2026-11-21）：插件市场链由 rose-700 改为 text-primary（页脚链接统一样式）。
    // text-primary 浅色为近黑（hsl 240 5.9% 10%），白底对比度远超 AA 4.5:1；
    // 旧 rose-600 实测 4.48:1（差 0.02 不达标）的教训仍适用——任何强调色不得低于 4.5:1。
    expect(market).toContain('text-primary')
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
 * 首页考试条带 + exam-countdown 数值对比度（2026-11-15 1422 轮）。
 *
 * 根因：条带背景是横向渐变 `from-sky-500/10 via-card to-card`，左端底色为
 * sky-500 10% 叠白底 ≈ #e7f6fd；<sm 时倒计时岛换行贴左沿、落在 tint 区，
 * red-600 只有 4.40–4.41:1（< 4.5）；soon 档徽章 amber-700 压
 * bg-amber-500/5 + tint 只有 4.40–4.45:1（全断点）。修法是渐变起点
 * from-sky-500/10 → from-card（两处：条带视图 + 空态外壳），倒计时与
 * 徽章回到实色卡片上；exam-countdown token 与 exam-urgency.test.ts:198
 * 断言不动。数值口径与 UX #9 相同（Tailwind 色板 hex 现场算）。
 */
describe('首页考试条带渐变底 + exam-countdown 数值对比度', () => {
  const strip = overlayFile('src/components/home-exam-strip-view.tsx')
  const stripEmpty = overlayFile('src/components/home-exam-strip.tsx')
  const countdown = overlayFile('src/app/exam/exam-countdown.tsx')

  it('条带渐变起点已是实色卡片：倒计时/徽章不再落在 sky tint 上', () => {
    for (const src of [strip, stripEmpty]) {
      expect(src).toContain('from-card via-card to-card')
      expect(src).not.toContain('from-sky-500/10')
    }
  })

  it('倒计时岛：浅色 red-600 / 深色 red-400 压实色卡片，≥4.5:1', () => {
    const days = countdown.split('\n').find((l) => l.includes("today: 'text-red-600"))
    expect(days).toBeTruthy()
    expect(countdown).toContain("today: 'text-red-600 dark:text-red-400'")
    expect(countdown).toContain("soon: 'text-amber-700 dark:text-amber-400'")
    expect(ux9Contrast('#dc2626', '#ffffff')).toBeGreaterThanOrEqual(4.5) // 实测 4.83
    expect(ux9Contrast('#f87171', '#09090b')).toBeGreaterThanOrEqual(4.5) // 实测 7.19
    // soon 档：浅色 amber-700 白底 5.02、深色 amber-400 深卡 11.92
    expect(ux9Contrast('#b45309', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#fbbf24', '#09090b')).toBeGreaterThanOrEqual(4.5)
  })

  it('soon 档徽章与 7d 提醒前缀：amber-700 压徽章底 + 实色卡片，≥4.5:1', () => {
    const badge = strip.split('\n').find((l) => l.includes("soon: 'border-amber-500/25"))
    expect(badge).toBeTruthy()
    expect(badge).toContain('text-amber-700 dark:text-amber-400')
    expect(strip).toContain("'7d': 'text-amber-700 dark:text-amber-400'")
    // 徽章底 = amber-500 5% 叠白卡 #fefaf2（向下取整的保守值；叠 tint 时只有 4.40–4.45:1）
    expect(ux9Contrast('#b45309', '#fefaf2')).toBeGreaterThanOrEqual(4.5) // 实测 4.82
    // 深色徽章底 = amber-500 5% 叠深卡 #15100b
    expect(ux9Contrast('#fbbf24', '#15100b')).toBeGreaterThanOrEqual(4.5) // 实测 11.32
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
    // 锚定 JSX 行「上次同步：{」：文件里另有两处含「上次同步」的注释行（:272、:289），
    // 用裸串 findIndex 会先命中注释、取到其上一行 syncingRef.current = false 而断言失败。
    const syncIdx = syncLines.findIndex((l) => l.includes('上次同步：{'))
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

/**
 * rose/sky 残留 32 处（2026-11-15 1122 轮）：0922 轮盘点第一档「正文小字必修」。
 *
 * 盘点见 ~/workspace/goals/efficiency-goal/hidden_files/rose-sky-remainder-2026-11-15-1022.md：
 * rose 正文 16（R3/R12/R13/R14/R18/R19/R20/R24/R25/R26/R27/R28/R30/R31/R32/R33）、
 * sky 正文 13（S4–S16 除 S17）、bg-rose-600 hover 态白字 3（B2/B3/B6）。
 * 修法与 0922 轮同款：-600→-700 配 dark:-400（R13/R14/R18/R28/R30/S14/S15 原无 dark: 变体，
 *  hover 态补 dark:hover:-400）；B2/B3/B6 的 hover:bg-rose-500（白字 3.67）→hover:bg-rose-700（6.29）。
 * 第二档 23 处原有意保留；2026-11-15 第二档轮次修掉其中 21 处（管理后台小字 11、
 * 纯图标 7、大字 3），-600→-700 配 dark:-400（R1/R2/R9/R21–R23/R29 原无 dark: 伴生，
 * 本轮补 dark:/dark:hover:-400；深色 hover rose-600 实测仅 4.24:1，补后 7.39）。
 * 残留 text-rose-600/text-sky-600 为 0；仅 bg-rose-600 默认态 6 行（B1–B6）有意保留：
 * B5 由 UX #9 另锁，B1/B4 默认态口径分歧未定，B2/B3/B6 默认态与第一档 hover 修复一致。
 * 下方三处残留断言已按新行为改写（原因见各注释），未删除。
 */
describe('rose/sky 残留 32 处：正文小字 -600→-700 配 dark:-400', () => {
  const watchlistPage = overlayFile('src/app/me/watchlist/page.tsx')
  const watchlistBtn = overlayFile('src/components/watchlist-add-button.tsx')
  const importPage = overlayFile('src/app/marketplace/import/page.tsx')
  const minePage = overlayFile('src/app/marketplace/mine/page.tsx')
  const auditModal = overlayFile('src/components/ai/site-health-audit-modal.tsx')
  const widget = overlayFile('src/components/modular/modules/declarative-widget.tsx')
  const categorySection = overlayFile('src/components/navigation-category-section.tsx')
  const healthPanel = overlayFile('src/components/plugins/plugin-url-health-panel.tsx')
  const studioHealth = overlayFile('src/components/plugins/studio-health-panel.tsx')
  const studioJson = overlayFile('src/components/plugins/studio-json-panel.tsx')
  const spotlight = overlayFile('src/components/search/spotlight-modal.tsx')
  const detailPanels = overlayFile('src/app/marketplace/[slug]/detail-tab-panels.tsx')
  const publishSteps = overlayFile('src/app/marketplace/publish/publish-intro-steps.tsx')
  const offlinePage = overlayFile('src/app/offline/page.tsx')
  const importer = overlayFile('src/components/bookmark-importer.tsx')
  const pluginCard = overlayFile('src/components/plugins/plugin-card.tsx')
  const installModal = overlayFile('src/components/plugins/plugin-install-modal.tsx')

  it('市场导入失败提示与已驳回徽章：R12/R13/R14，浅色 -700 配 dark:-400', () => {
    const alert = importPage.split('\n').find((l) => l.includes('role="alert"'))
    expect(alert).toContain('text-rose-700 dark:text-rose-400')
    expect(importPage).not.toContain('text-rose-600')
    expect(minePage).toContain("className: 'text-rose-700 dark:text-rose-400 border-rose-500/30 bg-rose-500/5'")
    expect(minePage).toContain('className="border-rose-500/30 text-rose-700 dark:text-rose-400"')
    expect(minePage).not.toContain('text-rose-600')
  })

  it('巡检弹窗徽章与异常数：R18/R19/R20，浅色 -700 配 dark:-400', () => {
    expect(auditModal).toContain('text-[10px] font-normal text-rose-700 dark:text-rose-400 border-rose-500/30 shrink-0')
    expect(auditModal).toContain('text-base font-semibold text-rose-700 dark:text-rose-400 mt-0.5')
    expect(auditModal).not.toContain('text-rose-600')
    expect(widget).toContain("? 'text-rose-700 dark:text-rose-400'")
    expect(widget).not.toContain('text-rose-600')
  })

  it('分类区移除按钮与收起提示：R24/S8，浅色 -700 配 dark:rose-200', () => {
    // U-447（2026-11-26）：1b363e65 子分类头布局重排时把该移除 chip 的深色文字由
    // rose-400 改为 rose-200，并补 dark:bg-rose-500/20 / dark:hover:bg-rose-500/30 /
    // dark:border-rose-400/40。rose-200 更亮、深底对比度反而更高（14.10 vs 旧 7.39），
    // 不是回归；浅色 rose-700 未动。断言按新行为改写，未删除（rose-600 禁令仍锁）。
    expect(categorySection).toContain('text-[11px] font-medium text-rose-700 dark:text-rose-200 bg-rose-500/10 dark:bg-rose-500/20')
    // rose-200 #fecdd3：深卡 #09090b 上 14.10:1、chip 自身深底（rose-500/20 叠深卡 ≈ #38141c）11.59:1，均 ≥4.5
    expect(ux9Contrast('#fecdd3', '#09090b')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#fecdd3', '#38141c')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#be123c', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(categorySection).toContain('bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20')
    expect(categorySection).not.toContain('text-rose-600')
    expect(categorySection).not.toContain('text-sky-600')
  })

  it('插件巡检面板：R25/S13/S14/S15/S16；第二档 S17 大字亦已 -700（残留 sky-600 为 0）', () => {
    expect(healthPanel).toContain("degrading: { label: '近期恶化', className: 'text-rose-700 dark:text-rose-400' }")
    expect(healthPanel).not.toContain('text-rose-600')
    expect(healthPanel).toContain('<span className="text-sky-700 dark:text-sky-400" title="站点存活')
    expect(healthPanel).toContain("'hover:bg-muted text-sky-700 dark:text-sky-400'")
    expect(healthPanel).toContain('text-[10px] text-sky-700 dark:text-sky-400 border-sky-500/30')
    expect(healthPanel).toContain('text-[11px] font-medium text-sky-700 dark:text-sky-400 flex items-center gap-1')
    // 第二档轮次改写：S17 text-xl font-bold 大数字亦 -700（4.10→5.93，大字 3:1 档），残留 sky-600 为 0
    expect(healthPanel).toContain('text-xl font-bold tracking-tight text-sky-700 dark:text-sky-400')
    expect(healthPanel).not.toContain('text-sky-600')
  })

  it('工作台失败行与增减数：R26/R27/R28，浅色 -700 配 dark:-400', () => {
    expect(studioHealth).toContain("'bg-rose-500/5 border-rose-500/20 text-rose-700 dark:text-rose-400'")
    expect(studioHealth).not.toContain('text-rose-600')
    expect(studioJson).toContain('font-mono font-bold text-rose-700 dark:text-rose-400')
    expect(studioJson).toContain('<span className="text-rose-700 dark:text-rose-400 font-mono text-[11px] font-medium">')
    expect(studioJson).not.toContain('text-rose-600')
  })

  it('搜索弹窗徽章与百度外链：R30/R31/R32；第二档 R29 纯图标亦已 -700（残留 rose-600 为 0）', () => {
    expect(spotlight).toContain('text-[10px] bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20')
    expect(spotlight).toContain('text-xs px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-400')
    expect(spotlight).toContain('px-2 py-0.5 rounded text-[11px] bg-rose-500/10 text-rose-700 dark:text-rose-400')
    // 第二档轮次改写：R29 Store 图标 tile（w-8 h-8）亦 -700（4.12→5.52，图标 3:1 档），残留 rose-600 为 0
    expect(spotlight).toContain('bg-rose-500/10 text-rose-700 dark:text-rose-400 flex items-center justify-center shrink-0')
    expect(spotlight).not.toContain('text-rose-600')
  })

  it('市场详情链接/发布引导/离线徽章/导入器/插件卡片/安装弹窗：S4–S12', () => {
    expect(detailPanels).toContain('text-[11px] text-sky-700 dark:text-sky-400 hover:underline truncate block')
    expect(detailPanels).not.toContain('text-sky-600')
    expect(publishSteps).toContain('flex items-center gap-2 text-sky-700 dark:text-sky-400 font-semibold text-xs')
    expect(publishSteps).not.toContain('text-sky-600')
    expect(offlinePage).toContain('bg-sky-500/5 text-xs text-sky-700 dark:text-sky-400')
    expect(offlinePage).not.toContain('text-sky-600')
    expect(importer).toContain("className: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/25'")
    expect(importer).not.toContain('text-sky-600')
    expect(pluginCard).toContain("plugin.kind === 'site-pack' && 'text-sky-700 dark:text-sky-400 bg-sky-500/5'")
    expect(pluginCard).toContain("plugin.kind === 'search-pack' && 'text-sky-700 dark:text-sky-400 bg-sky-500/5'")
    expect(pluginCard).not.toContain('text-sky-600')
    expect(installModal).toContain('flex items-center gap-2 text-sky-700 dark:text-sky-400 font-medium text-xs')
    expect(installModal).toContain('cursor-pointer text-sky-700 dark:text-sky-400 font-medium select-none hover:underline')
    expect(installModal).not.toContain('text-sky-600')
  })

  it('追剧清单 hover 提醒与加入按钮：R3/R33/B2/B3/B6；第二档 R1/R2 纯图标亦已 -700（残留 rose-600 为 0）', () => {
    const remind = watchlistPage.split('\n').find((l) => l.includes('hover:border-rose-400') && l.includes('text-xs'))
    expect(remind).toBeTruthy()
    expect(remind).toContain('hover:text-rose-700 dark:hover:text-rose-400')
    expect(remind).not.toContain('hover:text-rose-600')
    const btnRemind = watchlistBtn.split('\n').find((l) => l.includes('hover:border-rose-400'))
    expect(btnRemind).toBeTruthy()
    expect(btnRemind).toContain('hover:text-rose-700 dark:hover:text-rose-400')
    expect(btnRemind).not.toContain('hover:text-rose-600')
    expect(watchlistPage).toContain('inline-flex items-center gap-1 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-700')
    expect(watchlistPage).toContain('rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50')
    expect(watchlistBtn).toContain('rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-50')
    // B2/B3/B6 的 hover:bg-rose-500（白字 3.67）已无残留；/15、/20 透明度变体不受此限
    for (const src of [watchlistPage, watchlistBtn]) {
      expect(src).not.toContain('hover:bg-rose-500"')
      expect(src).not.toContain('hover:bg-rose-500 ')
    }
    expect(watchlistBtn).not.toContain('text-rose-600')
    // 第二档轮次改写：R1/R2 ±集纯图标按钮（h-7 w-7）亦 -700，补 dark:hover:-400；残留 rose-600 为 0
    const iconBtns = watchlistPage.split('\n').filter((l) => l.includes('h-7 w-7') && l.includes('hover:text-rose-700'))
    expect(iconBtns).toHaveLength(2)
    for (const line of iconBtns) expect(line).toContain('dark:hover:text-rose-400')
    expect(watchlistPage).not.toContain('text-rose-600')
  })

  it('修后数值：rose-700/sky-700 浅色 ≥4.5:1，白字压 rose-700 ≥4.5:1，深色 -400 ≥4.5:1', () => {
    expect(ux9Contrast('#be123c', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#0369a1', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#ffffff', '#be123c')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#fb7185', '#09090b')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#38bdf8', '#09090b')).toBeGreaterThanOrEqual(4.5)
  })
})

/**
 * rose/sky 第二档 21 处（2026-11-15）：0922 轮盘点第二档「大字或图标可缓 + 管理后台小字」。
 *
 * 盘点见 ~/workspace/goals/efficiency-goal/hidden_files/rose-sky-remainder-2026-11-15-1022.md：
 * 管理后台小字 11（R5/R6/R8/R9/R10/R11/R15/R16/R17/S2/S3）、纯图标 7
 * （R1/R2/R21/R22/R23/R29/S1）、大字 3（R4/R7/S17）。
 * 修法与第一档同款：-600→-700 配 dark:-400；原无 dark: 伴生的 R1/R2/R9/R21–R23/R29
 * 补 dark:/dark:hover:-400（深色 hover rose-600 实测仅 4.24:1，补 dark:hover:-400 后 7.39）。
 * 大字与纯图标修前已达所在档位（大字 4.70/4.10≥3、图标 3.67–4.12≥3），本次一并 -700
 * 是为统一 token、并防将来在同一按钮上加文字时立刻跌破；修后数值见末 it。
 * 未动：B1/B4（bg-rose-600 默认态口径分歧，等主聊定口径）、B5（UX #9 另锁）、
 * B2/B3/B6 默认态 bg-rose-600（第一档已修 hover 态）、星图 zinc-400×3（§12 锁死）、
 * navigation-card 非编辑态 hover:text-rose-500（纯图标，3.67≥3，盘点未列入）。
 * 修后源码 text-rose-600/text-sky-600 残留为 0。
 */
describe('rose/sky 第二档 21 处：管理后台/纯图标/大字 -600→-700 配 dark:-400', () => {
  const dashboard = overlayFile('src/app/admin/AdminDashboardClient.tsx')
  const jobsPage = overlayFile('src/app/admin/jobs/page.tsx')
  const pluginsPage = overlayFile('src/app/admin/plugins/page.tsx')
  const taxonomyPage = overlayFile('src/app/admin/taxonomy/page.tsx')
  const slowRoutes = overlayFile('src/components/admin/dashboard/dashboard-slow-routes.tsx')
  const trafficChart = overlayFile('src/components/admin/dashboard/dashboard-traffic-chart.tsx')
  const deliveryPanel = overlayFile('src/components/admin/notification-delivery-panel.tsx')
  const navCard = overlayFile('src/components/navigation-card.tsx')
  const itemShell = overlayFile('src/components/site-item-shell.tsx')
  const watchlistPage2 = overlayFile('src/app/me/watchlist/page.tsx')
  const spotlight2 = overlayFile('src/components/search/spotlight-modal.tsx')
  const healthPanel2 = overlayFile('src/components/plugins/plugin-url-health-panel.tsx')

  it('管理后台小字 11 处：R5/R6/R8/R9/R10/R11/R15/R16/R17/S2/S3，浅色 -700 配 dark:-400', () => {
    expect(dashboard).toContain('inline-flex items-center gap-1 text-rose-700 dark:text-rose-400 font-medium')
    expect(dashboard).not.toContain('text-rose-600')
    expect(jobsPage).toContain('text-xs text-rose-700 dark:text-rose-400 font-medium')
    expect(jobsPage).toContain('text-rose-700 dark:text-rose-400 bg-rose-50')
    expect(jobsPage).toContain('text-xs text-rose-700 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:text-rose-400')
    expect(jobsPage).not.toContain('text-rose-600')
    expect(pluginsPage).toContain("tabular-nums text-rose-700 dark:text-rose-400")
    expect(pluginsPage).toContain('text-xs text-sky-700 dark:text-sky-400')
    expect(pluginsPage).not.toContain('text-rose-600')
    expect(pluginsPage).not.toContain('text-sky-600')
    expect(taxonomyPage).toContain("color: 'text-sky-700 dark:text-sky-400'")
    expect(taxonomyPage).toContain("color: 'text-rose-700 dark:text-rose-400'")
    expect(taxonomyPage).not.toContain('text-rose-600')
    expect(taxonomyPage).not.toContain('text-sky-600')
    expect(slowRoutes).toContain("'text-rose-700 dark:text-rose-400 font-bold'")
    expect(slowRoutes).not.toContain('text-rose-600')
    expect(trafficChart).toContain("'text-rose-700 dark:text-rose-400'")
    expect(trafficChart).not.toContain('text-rose-600')
    expect(deliveryPanel).toContain('text-[11px] text-rose-700 dark:text-rose-400')
    expect(deliveryPanel).not.toContain('text-rose-600')
  })

  it('纯图标 7 处：R1/R2/R21/R22/R23/R29/S1，-700 配 dark:-400（图标 3:1 档）', () => {
    const iconBtns = watchlistPage2.split('\n').filter((l) => l.includes('h-7 w-7') && l.includes('hover:text-rose-700'))
    expect(iconBtns).toHaveLength(2)
    // P1-15（2026-11-21）：卡片删除钮由 rose-700 改为语义 token text-destructive-text。
    // destructive-text 浅色 #BA1C1C（hsl 0 74% 42%）白底 6.42:1、深色 #F37272 深底 7.07:1，
    // 均超 AA 4.5:1，与 rose-700（6.29:1）等效；dark: 变体由 token 自身处理，不再单写。
    // U-447（2026-11-26）：1b363e65 S3 解剖迁移把紧凑条形卡的编辑态内联隐藏钮撤掉，
    // 编辑态改走 controller.renderEditCapsule()（右上角悬停/聚焦浮现迷你胶囊操作条，
    // 注释见 navigation-card.tsx「Phase 1 编辑态彻底去除常驻内联挤字图标」）。
    // 隐藏 affordance 未丢：胶囊里的隐藏钮仍是 text-destructive-text（6.42/7.07:1），
    // 只是从 navigation-card.tsx 搬到 site-item-shell.tsx，且 hover 不再重复写
    // hover:text-destructive-text（基底已是 destructive-text）。navigation-card 内
    // 只剩 rich/grid 两处三元，计数 3→2；新增胶囊断言锁住迁移后的落点，不只放宽计数。
    expect(navCard).toContain('"text-destructive-text hover:text-destructive-text hover:bg-destructive/15"')
    expect(navCard.split('\n').filter((l) => l.includes('text-destructive-text hover:text-destructive-text'))).toHaveLength(2)
    expect(itemShell).toContain('data-testid="card-action-hide"')
    expect(itemShell).toContain('text-destructive-text transition-colors hover:bg-destructive/15')
    expect(navCard).not.toContain('text-rose-600')
    expect(spotlight2).toContain('bg-rose-500/10 text-rose-700 dark:text-rose-400 flex items-center justify-center shrink-0')
    expect(pluginsPage).toContain("tone: 'text-sky-700 dark:text-sky-400'")
  })

  it('大字 3 处：R4/R7/S17，-700 配 dark:-400（大字 3:1 档）', () => {
    expect(dashboard).toContain("? 'text-rose-700 dark:text-rose-400'")
    expect(jobsPage).toContain('text-2xl font-bold text-rose-700 dark:text-rose-400')
    expect(healthPanel2).toContain('text-xl font-bold tracking-tight text-sky-700 dark:text-sky-400')
    expect(healthPanel2).not.toContain('text-sky-600')
  })

  it('修后数值：-700 浅色 ≥4.5:1（含 -50 底与 /10 底），深色 -400 ≥4.5:1', () => {
    expect(ux9Contrast('#be123c', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#0369a1', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#be123c', '#fff1f2')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#0369a1', '#f0f9ff')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#be123c', '#feecef')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#0369a1', '#e7f6fd')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#be123c', '#fde2e7')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#fb7185', '#09090b')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#38bdf8', '#09090b')).toBeGreaterThanOrEqual(4.5)
    expect(ux9Contrast('#fb7185', '#240711')).toBeGreaterThanOrEqual(4.5)
  })
})
