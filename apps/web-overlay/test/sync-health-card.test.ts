/**
 * 「同步与健康」卡片的空态引导不变量。
 *
 * 背景是真实缺口：五行状态在「未建立 / 未启用 / 无 / 使用默认值」时只陈述事实，
 * 卡片里唯一的可点击元素是页头的「账户自检」，用户读完「尚未建立」没有任何
 * 一步可走（概览页的空态死路）。
 *
 * 这里锁三件事：
 * 1. 每一行都带 next 引导，且 href 指向真实存在的路由（防止引导本身变 404）；
 * 2. 引导只在空心（未启用）行出现，实心行不额外占高度，也不改成提示框；
 * 3. 引导是可键盘聚焦的链接，带 focus-visible 环，文案色号沿用卡片既有层级；
 * 4. 引导的命中区不小于 24×24 CSS px（WCAG 2.2 SC 2.5.8 AA），
 *    且靠自身最小高度达成，不是用负 margin 把热区叠到邻居身上。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** 引导链接的目标路由：href → 该路由的页面文件（相对 src/app） */
const ROUTES: Record<string, string> = {
  '/': 'page.tsx',
  '/me/vault': 'me/vault/page.tsx',
  '/me/data': 'me/data/page.tsx',
  '/me/settings': 'me/settings/page.tsx',
  '/preferences': 'preferences/page.tsx',
}

const LABELS = ['个性化画像', 'E2EE 金库', '个人 AI 配置', '已合并匿名身份', '偏好设置']

function overlaySrcDir(): string {
  const candidates = ['../src', '../../web-overlay/src'].map((rel) =>
    fileURLToPath(new URL(rel, import.meta.url)),
  )
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 的 src（候选：' + candidates.join(' | ') + '）')
  return hit
}

function readComponent(): string {
  return readFileSync(
    join(overlaySrcDir(), 'components', 'user-center', 'dashboard', 'sync-health-card.tsx'),
    'utf8',
  )
}

describe('sync-health-card 空态引导', () => {
  const src = readComponent()
  const appDir = join(overlaySrcDir(), 'app')

  it('每一行都给了 next 引导', () => {
    const rows = src.split('<Row\n').length - 1
    const hints = src.split('next={{').length - 1
    expect(rows).toBe(LABELS.length)
    expect(hints).toBe(LABELS.length)
  })

  it('五行标签齐全，缺标签即断言失败', () => {
    for (const label of LABELS) {
      expect(src, `缺少行：${label}`).toContain(`label="${label}"`)
    }
  })

  it('每条引导都带 href 与文案，且 href 指向真实路由', () => {
    const hrefs = [...src.matchAll(/next=\{\{\s*href:\s*'([^']+)'/g)].map((m) => m[1])
    expect(hrefs.length).toBe(LABELS.length)
    for (const href of hrefs) {
      const rel = ROUTES[href]
      expect(rel, `引导 href 不在白名单：${href}`).toBeTruthy()
      expect(existsSync(join(appDir, rel)), `引导指向不存在的页面：${href}`).toBe(true)
    }
    for (const m of src.matchAll(/next=\{\{\s*href:[^,]+,\s*label:\s*'([^']+)'\s*\}/g)) {
      expect(m[1].length).toBeGreaterThanOrEqual(4)
    }
    expect([...src.matchAll(/label:\s*'[^']+'\s*\}/g)].length).toBe(LABELS.length)
  })

  it('空态文案仍在（只陈述事实，不夸大）', () => {
    for (const dead of ['尚未建立', '未启用', '跟随系统默认', '使用默认值']) {
      expect(src, `空态文案被改掉：${dead}`).toContain(dead)
    }
  })

  it('引导只在未启用行渲染，且不新增提示框', () => {
    expect(src).toMatch(/next && !ok/)
    expect(src).not.toMatch(/bg-amber|border-amber|bg-destructive|role="alert"/)
  })

  it('引导是键盘可达的链接，带 focus-visible 环与箭头指示', () => {
    // 外链/配置来源的地址现在过安全闸：`safeHref(next.href, '/')`。
    // 守卫要守的是「用 Link 且 href 经过闸门」，不是某个字面量。
    expect(src).toMatch(/<Link\s+href=\{safeHref\(next\.href/)
    expect(src).toContain('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')
    expect(src).toContain('ArrowRight')
    // 色号沿用卡片既有层级（muted-foreground 在亮色下约 4.6:1，达 AA）
    expect(src).toMatch(/text-\[11px\] text-muted-foreground/)
  })

  it('引导命中区不小于 24×24 CSS px（WCAG 2.5.8），且不靠负 margin 达成', () => {
    const m = /<Link\s+href=\{safeHref\(next\.href,\s*\'\/\'\)\}\s+className="([^"]+)"/.exec(src)
    expect(m, '找不到引导 Link 的 className').toBeTruthy()
    const classes = m![1].split(/\s+/)
    // Tailwind min-h-6 = 1.5rem = 24px；11px 文字自身约 13px 高，不撑不达下限
    expect(classes).toContain('min-h-6')
    expect(classes.some((c) => /^-?(my|mt|mb)-/.test(c))).toBe(false)
  })

  it('Row 既有布局未破坏：状态点 + 图标 + 标签仍在同一行', () => {
    expect(src).toContain('h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500')
    expect(src).toContain('h-1.5 w-1.5 shrink-0 rounded-full border border-foreground/25')
    expect(src).toMatch(/<li className="flex items-center justify-between gap-3 py-2\.5">/)
  })

  it('镜像侧 apps/web 若有同名文件，须与 overlay 逐字节同源', () => {
    const twin = join(
      dirname(dirname(overlaySrcDir())),
      'web',
      'src',
      'components',
      'user-center',
      'dashboard',
      'sync-health-card.tsx',
    )
    if (!existsSync(twin)) return
    expect(readFileSync(twin, 'utf8')).toBe(src)
  })
})
