import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 常驻导航补入口（2026-11-14 第 52 轮，UX 走查 Top 1）。
 *
 * 背景：/drama、/brief、/exam 不在任何常驻导航里，/hot 的图标按钮只在
 * ≥1280px 出现；手机上的短剧观众、考公学生、简报读者从任何一页都找不到
 * 入口，只能回首页滚正文或翻到页脚。本轮只加链接，不改路由、不改首页结构：
 *   - 桌面端：顶栏罗盘下拉新增「每日回访」组（/drama、/brief、/exam），
 *     /hot 本就全宽可达（≥xl 图标钮 + <xl 下拉项），不重复加；
 *   - 移动端：底栏加第五项「短剧」/drama（另见 mobile-nav.test.ts），
 *     /hot、/brief、/exam 走首页顶栏罗盘下拉（移动端同样可见，两跳可达）。
 *
 * 锁死两件事：三链齐全且指向真实路由；新增项必须用两行式类名
 * （px-2 py-2），不得挤占 mobile-touch-targets 锁死的 8 个单行式
 * （min-h-11 px-2 py-1.5）菜单项计数。
 */
const HERE = dirname(fileURLToPath(import.meta.url))

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
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const TOOLBAR = 'src/components/navigation-toolbar.tsx'

describe('桌面下拉「每日回访」组', () => {
  it('三链齐全（/drama /brief /exam），且指向真实路由', () => {
    const src = read(TOOLBAR)
    expect(src).toContain('每日回访')
    for (const href of ['/drama', '/brief', '/exam']) {
      expect(src, `下拉缺少入口 ${href}`).toContain(`href="${href}"`)
      expect(
        existsSync(join(ROOT, `src/app${href}/page.tsx`)),
        `src/app${href}/page.tsx 应存在`,
      ).toBe(true)
    }
  })

  it('新增三项用两行式类名，不挤占单行式 8 项计数', () => {
    const src = read(TOOLBAR)
    // 两行式（标题 + 副标题）是 /graph、/algorithms、/custom 的既有范式；
    // 单行式 min-h-11 px-2 py-1.5 在 mobile-touch-targets 里锁死为 8 项。
    for (const href of ['/drama', '/brief', '/exam']) {
      const idx = src.indexOf(`href="${href}"`)
      expect(idx, `找不到 ${href} 入口`).toBeGreaterThanOrEqual(0)
      const chunk = src.slice(idx, idx + 400)
      expect(chunk, `${href} 应与两行式菜单项同块`).toContain('px-2 py-2')
    }
    const single = src.split('min-h-11 px-2 py-1.5 text-xs rounded-md cursor-pointer hover:bg-accent').length - 1
    expect(single, '单行式菜单项仍应为 8 项').toBe(8)
  })

  it('/hot 不重复进下拉新组（全宽已有入口）', () => {
    const src = read(TOOLBAR)
    const labelIdx = src.indexOf('每日回访')
    const nextLabelIdx = src.indexOf('全景与发现', labelIdx)
    const group = src.slice(labelIdx, nextLabelIdx)
    expect(group).not.toContain('href="/hot"')
  })
})
