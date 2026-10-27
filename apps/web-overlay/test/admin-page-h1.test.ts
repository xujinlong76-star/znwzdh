/**
 * 管理后台三个页面的「页级 h1」结构不变量。
 *
 * 背景是真实缺陷：navigation / resources / sitelist 三个管理页没有 h1，
 * 而同目录 15 个兄弟页都有（categories:150、tags:94、audit:109 …）。
 * 后果不是纯视觉：e2e/helpers.ts 的 awaitContentReady 硬等
 * `main#main-content h1`（第 52 行），缺 h1 的页面会让助手直接超时；
 * 读屏软件也无法用「按标题跳转」定位页面主体（WCAG 2.4.6 / 1.3.1）。
 *
 * 这两个页面标题同时是仪表盘快捷入口的文案（AdminDashboardClient 的
 * navigationItems），改标题时这里和入口要一起改 —— 断言锁的正是这层契约。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGES = [
  { rel: 'admin/navigation/page.tsx', title: '导航架构管理' },
  { rel: 'admin/resources/page.tsx', title: '站点图像资源库' },
  { rel: 'admin/sitelist/page.tsx', title: '站点列表与录入' },
] as const

/** 定位 overlay 的 src/app：镜像测试（apps/web/test）与源测试的相对路径不同 */
function overlayAppDir(): string {
  const candidates = ['../src/app', '../../web-overlay/src/app'].map((rel) =>
    fileURLToPath(new URL(rel, import.meta.url)),
  )
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 的 src/app（候选：' + candidates.join(' | ') + '）')
  return hit
}

describe('管理后台页级 h1（E2E awaitContentReady 的 SSR 锚点）', () => {
  const appDir = overlayAppDir()

  for (const { rel, title } of PAGES) {
    it(`${rel} 恰好一个 h1，且就是「${title}」`, () => {
      const src = readFileSync(join(appDir, rel), 'utf8')
      expect(src.match(/<h1\b/g) ?? []).toHaveLength(1)
      expect(src).toMatch(new RegExp(`<h1[^>]*>\\s*${title}\\s*</h1>`))
    })
  }
})
