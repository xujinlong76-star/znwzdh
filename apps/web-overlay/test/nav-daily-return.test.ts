import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 每日回访三链（/drama /brief /exam）的入口守卫。
 *
 * ## 2026-11-21 架构变更
 *
 * 原设计把三链放在顶栏罗盘下拉的「每日回访」分组里。顶栏收口时，
 * 今日中心整体移入聚合菜单，该分组随之删除——但三链本身并未消失，
 * 而是改由**首页今日区（home-today-zone.tsx）**统一提供，
 * 移动端「短剧」另有底栏常驻入口（mobile-nav.tsx）。
 *
 * 因此本测试从「锁下拉分组结构」改为「锁三链可达性与真实路由」，
 * 避免锁死已被移除的 UI 形态。
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
const TODAY_ZONE = 'src/components/home-today-zone.tsx'
const MOBILE_NAV = 'src/components/mobile-nav.tsx'

describe('每日回访三链可达性', () => {
  it('首页今日区提供 /drama /brief /exam 三链，且指向真实路由', () => {
    const src = read(TODAY_ZONE)
    for (const href of ['/drama', '/brief', '/exam']) {
      expect(src, `今日区缺少入口 ${href}`).toContain(href)
      expect(
        existsSync(join(ROOT, `src/app${href}/page.tsx`)),
        `src/app${href}/page.tsx 应存在`,
      ).toBe(true)
    }
  })

  it('移动端底栏常驻「短剧」/drama 入口', () => {
    const src = read(MOBILE_NAV)
    expect(src).toContain("href: '/drama'")
  })
});
