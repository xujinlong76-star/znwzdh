import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 命令面板两缺口补齐（2026-11-15 1022 轮）的静态守卫。
 *
 * 背景：① 搜索框 placeholder 全站无“按 /”提示，<kbd> 徽标是唯一提示且触屏
 * 隐藏；② FloatingQuickNav 只挂首页且滚动超 300px 才浮现，深链直达内页
 * （/drama、/favorites、/me/*）的移动端用户无 Spotlight 常驻入口。
 * 补法：placeholder 全站加“（按 / 快速搜索）”后缀；FloatingQuickNav 提为
 * 全局挂载（providers.tsx，与 GlobalSpotlightGateway 同级），非首页阈值
 * 100px，/videos* 与首页不重复挂（首页仍用带微工具键的实例）。
 * 底栏不动：仍为 5 项，不加第 6 项“搜索”（mobile-nav.test.ts 另锁）。
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

const SUFFIX = '（按 / 快速搜索）'

/** 5 处显式 placeholder 挂载点：文案各异，但都必须带“按 /”后缀。 */
const EXPLICIT_PLACEHOLDER_PAGES = [
  'src/components/navigation-toolbar.tsx',
  'src/app/category/[slug]/category-board.tsx',
  'src/app/collections/[slug]/collection-detail-view.tsx',
  'src/app/hot/hot-view.tsx',
  'src/components/tag-results-board.tsx',
  'src/app/not-found.tsx',
]

describe('命令面板缺口 ①：placeholder 必须提示“按 / 快速搜索”', () => {
  it('SearchPalette 默认 placeholder 带后缀', () => {
    const src = read('src/components/search-palette.tsx')
    expect(src).toContain(`placeholder = '搜索导航…（中文 / 拼音 / 语义）${SUFFIX}'`)
  })

  it.each(EXPLICIT_PLACEHOLDER_PAGES)('%s 的显式 placeholder 带后缀', (rel) => {
    const src = read(rel)
    const m = src.match(/<SearchPalette[^>]*placeholder="([^"]*)"/)
    expect(m, `${rel} 应有显式 placeholder`).not.toBeNull()
    expect(m![1]).toContain('按 /')
    expect(m![1]).toContain(SUFFIX)
  })

  it('AI 模式 placeholder 不动：仍是问 AI 的那句，不加后缀', () => {
    const ai = read('src/lib/search-ai-mode.ts')
    expect(ai).toContain("SEARCH_AI_PLACEHOLDER = '问 AI 找站，说一句话…'")
    expect(ai).not.toContain('按 /')
    const palette = read('src/components/search-palette.tsx')
    expect(palette).toContain('aiMode ? SEARCH_AI_PLACEHOLDER : placeholder')
  })

  it('<kbd> 徽标不动：仍由 spotlightHotkeyHint 派生', () => {
    const src = read('src/components/search-palette.tsx')
    expect(src).toContain('spotlightHotkeyHint')
  })
})

describe('命令面板缺口 ②：FloatingQuickNav 全局挂载', () => {
  it('providers.tsx 与 GlobalSpotlightGateway 同级挂载全局版（阈值 100，不传 onOpenTools）', () => {
    const src = read('src/components/providers.tsx')
    expect(src).toContain("import { FloatingQuickNav } from '@/components/floating-quick-nav'")
    expect(src).toContain('GlobalSpotlightGateway')
    expect(src).toContain('<FloatingQuickNav global threshold={100} />')
    expect(src.indexOf('<FloatingQuickNav global threshold={100} />')).toBeGreaterThan(
      src.indexOf('GlobalSpotlightGateway'),
    )
    // 全局版不传 onOpenTools：微工具键不渲染（工具抽屉是首页作用域的）
    const mount = src.match(/<FloatingQuickNav[^>]*\/>/)
    expect(mount, '应有 FloatingQuickNav 挂载').not.toBeNull()
    expect(mount![0]).not.toContain('onOpenTools')
  })

  it('全局版在 /videos* 与首页不渲染（首页仍用带微工具键的实例）', () => {
    const src = read('src/components/floating-quick-nav.tsx')
    expect(src).toContain("import { usePathname } from 'next/navigation'")
    expect(src).toContain("pathname.startsWith('/videos')")
    expect(src).toContain("if (global && (pathname === '/' || pathname.startsWith('/videos'))) return null")
    const content = read('src/components/navigation-content.tsx')
    expect(content).toContain('<FloatingQuickNav onOpenTools={() => setIsToolsOpen(true)} />')
  })

  it('非首页阈值 100px、首页实例保持 300px 默认', () => {
    const src = read('src/components/floating-quick-nav.tsx')
    expect(src).toContain('threshold?: number')
    expect(src).toContain('threshold = 300')
    expect(src).toContain('scrollY > threshold')
    expect(src).not.toContain('scrollY > 300')
  })

  it('唤起仍走现成 open-spotlight 事件，不新增接口与依赖', () => {
    const src = read('src/components/floating-quick-nav.tsx')
    expect(src).toContain("new CustomEvent('open-spotlight')")
  })

  it('位置/样式沿用现有值：z-40、right-4、底栏之上', () => {
    const src = read('src/components/floating-quick-nav.tsx')
    expect(src).toContain('fixed right-4')
    expect(src).toContain('z-40')
    expect(src).toContain('bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+3rem)]')
  })

  it('搜索键触摸目标仍为 44px（h-11 w-11 三处：回顶/搜索/微工具）', () => {
    const src = read('src/components/floating-quick-nav.tsx')
    expect(src.match(/h-11 w-11/g)?.length).toBe(3)
  })
})

describe('命令面板缺口补齐：底栏仍为 5 项，不加搜索', () => {
  it('MobileNav 仍是 5 项且无 /search 入口', () => {
    const src = read('src/components/mobile-nav.tsx')
    for (const href of ["href: '/'", "href: '/category'", "href: '/drama'", "href: '/favorites'", "href: '/me'"]) {
      expect(src, `缺少入口 ${href}`).toContain(href)
    }
    expect(src).not.toContain("href: '/search'")
    expect(src).not.toContain("href: '/hot'")
  })
})
