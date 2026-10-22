import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * M6 移动端底部导航的静态守卫。
 *
 * 背景：窄屏下用户中心入口只剩页脚文字链，不可达。mobile-nav.tsx 补了一条
 * 常驻底栏，footer 的 `pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] sm:pb-8`
 * 就是为它预留的坑。这里锁死四件事，防止后续改动把这条契约拆掉：
 *   1. 组件是客户端组件且默认导出，四个入口路径齐全；
 *   2. 高亮与可访问性接线（usePathname / aria-current / aria-label）；
 *   3. 根布局真的挂了它（只建组件不挂载 = 没做）；
 *   4. 断点与 footer 预留对齐：组件不得自带会让 5.5rem 空隙失效的负 margin，
 *      且可见断点必须与 footer 的 sm 切换一致（sm 以上 footer 只留 pb-8）。
 */
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
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const COMPONENT = 'src/components/mobile-nav.tsx'
const LAYOUT = 'src/app/layout.tsx'
const FOOTER = 'src/components/footer.tsx'

describe('mobile-nav 组件本体', () => {
  it('存在，是客户端组件且默认导出', () => {
    expect(existsSync(join(ROOT, COMPONENT))).toBe(true)
    const src = read(COMPONENT)
    expect(src).toContain("'use client'")
    expect(src).toContain('export default function MobileNav')
  })

  it('四个入口路径齐全（/ /category /favorites /me）', () => {
    const src = read(COMPONENT)
    for (const href of ["href: '/'", "href: '/category'", "href: '/favorites'", "href: '/me'"]) {
      expect(src, `缺少入口 ${href}`).toContain(href)
    }
    // 分类入口必须指向真实存在的路由：/categories 全站不存在（会 404），
    // 分类总览在 app/category/page.tsx。注释里允许出现这个名字（解释由来），
    // 但不允许任何入口指向它。
    expect(src).not.toContain("href: '/categories'")
    expect(existsSync(join(ROOT, 'src/app/category/page.tsx'))).toBe(true)
    for (const route of ['src/app/favorites/page.tsx', 'src/app/me/page.tsx']) {
      expect(existsSync(join(ROOT, route)), `${route} 应存在`).toBe(true)
    }
  })

  it('用 next/link 与 lucide 图标，不用裸 a 标签', () => {
    const src = read(COMPONENT)
    expect(src).toContain("import Link from 'next/link'")
    expect(src).toContain("from 'lucide-react'")
    expect(src).not.toMatch(/<a\s/)
  })

  it('高亮与可访问性接线：usePathname + aria-current + aria-label', () => {
    const src = read(COMPONENT)
    expect(src).toContain("import { usePathname } from 'next/navigation'")
    expect(src).toContain('usePathname()')
    expect(src).toContain("aria-current={active ? 'page' : undefined}")
    expect(src).toContain('aria-label={label}')
    // 根路径只认精确匹配，其余走前缀匹配（/category/xxx 也点亮分类）
    expect(src).toContain("pathname.startsWith(href + '/')")
  })

  it('固定底部、可见断点与高度区符合约定', () => {
    const src = read(COMPONENT)
    expect(src).toContain('fixed bottom-0 left-0 right-0')
    expect(src).toContain('sm:hidden')
    expect(src).toContain('h-14')
    // 安全区由组件自负；footer 的 5.5rem 预留即为其让位
    expect(src).toContain('pb-[env(safe-area-inset-bottom,0px)]')
  })
})

describe('根布局挂载', () => {
  it('app/layout.tsx 引入并渲染 MobileNav', () => {
    const layout = read(LAYOUT)
    expect(layout).toContain("import MobileNav from '@/components/mobile-nav'")
    expect(layout).toContain('<MobileNav />')
  })
})

describe('与 footer 预留的契约', () => {
  it('footer 仍保留 5.5rem 预留且 sm 以上收回（pb-8）', () => {
    const footer = read(FOOTER)
    expect(footer).toContain('pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]')
    expect(footer).toContain('sm:pb-8')
  });

  it('组件不得自带会让 footer 空隙失效的负 margin', () => {
    const src = read(COMPONENT)
    // 负外边距工具类：-m-1 / -mt- / -mb- / -ml- / -mr- 等
    expect(src).not.toMatch(/-m[tblrxy]?-\d/)
    expect(src).not.toContain('margin-bottom: -')
    expect(src).not.toContain('marginBottom')
  });

  it('可见断点与 footer 的 sm 切换一致（sm 以上无预留，底栏也不出现）', () => {
    const src = read(COMPONENT)
    // footer 只在 sm 以下留 5.5rem；底栏若宽到 md 会压住 640–768px 的 footer 内容
    expect(src).toContain('sm:hidden')
    expect(src).not.toContain('md:hidden')
  });

  it('避让自带 fixed bottom-0 移动端 UI 的 /videos 路由', () => {
    const src = read(COMPONENT)
    expect(src).toContain("pathname.startsWith('/videos')")
  });
});
