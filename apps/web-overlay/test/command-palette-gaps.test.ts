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
 *
 * 订正（2026-11-20 首屏瘦身，evo/firstscreen-slim-1257）：FloatingQuickNav
 * 整体移除（见下方「缺口 ②（退役）」块），其三键功能由顶栏与命令面板覆盖；
 * 缺口 ①（placeholder 后缀）与底栏 5 项守卫不变。
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

/** 4 处内页显式 placeholder 挂载点（/hot 于 2026-11-21 移除全站搜索框；首页顶栏于 2026-11-22 改为独立 `<kbd>/</kbd>` 徽标避免中窄屏 placeholder 被 [AI] 按钮劈断）。 */
const EXPLICIT_PLACEHOLDER_PAGES = [
  'src/app/category/[slug]/category-board.tsx',
  'src/app/collections/[slug]/collection-detail-view.tsx',
  'src/components/tag-results-board.tsx',
  'src/app/not-found.tsx',
]

describe('命令面板缺口 ①：placeholder 与 `/` 快捷键提示完整可达', () => {
  it('首页顶栏搜索框使用精简 placeholder，`/` 快捷键改由 SearchPalette 内独立 <kbd>/</kbd> 徽标提示（防中窄屏被 [AI] 劈断）', () => {
    const toolbar = read('src/components/navigation-toolbar.tsx')
    // 2026-11-27 0322：placeholder 改为按 categoryId 条件派生（聚焦抽屉内用
    // 「在当前分类内搜索…」，未聚焦仍用「搜索站点、标签或拼音…」），不再是字面量
    // 属性；断言改为两文案均存在 + 条件派生形式，意图不变（顶栏仍有搜索框、默认文案不变）。
    expect(toolbar).toContain('搜索站点、标签或拼音…')
    expect(toolbar).toContain('在当前分类内搜索…（无结果时自动放宽到全库）')
    expect(toolbar).toMatch(/placeholder=\{\s*categoryId\s*\?/)
    const palette = read('src/components/search-palette.tsx')
    expect(palette).toContain('title="按 / 快速搜索"')
    expect(palette).toContain('xl:inline-flex pointer-coarse:hidden')
  })
it('/hot 已移除全站搜索框（2026-11-21），改由 / 快捷键 + 文字链提供出口', () => {
  const src = read('src/app/hot/hot-view.tsx')
  expect(src).not.toContain('<SearchPalette')
  expect(src).toContain('搜不到？按 / 全站检索')
});
  it('SearchPalette 默认 placeholder 带后缀', () => {
    const src = read('src/components/search-palette.tsx')
    expect(src).toContain(`placeholder = '搜索导航…（中文 / 拼音 / 语义）${SUFFIX}'`)
  })

  it.each(EXPLICIT_PLACEHOLDER_PAGES)('%s 的显式 placeholder 带后缀', (rel) => {
    const src = read(rel)
    // 2026-11-27 0322：分类页 placeholder 改为模板字面量（插值 ${name}），
    // JSX 里写作 placeholder={`...`}（花括号 + 反引号）；匹配器同时接受
    // "..." 与 {`...`} 两种形式；断言意图不变（带「按 /」与后缀）。
    const m = src.match(/<SearchPalette[^>]*placeholder=(?:\{`([^`]*)`\}|"([^"]*)")/)
    expect(m, `${rel} 应有显式 placeholder`).not.toBeNull()
    const value = m![1] ?? m![2]!
    expect(value).toContain('按 /')
    expect(value).toContain(SUFFIX)
  })

  it('AI 模式 placeholder 不动：仍是问 AI 的那句，不加后缀', () => {
    const ai = read('src/lib/search-ai-mode.ts')
    expect(ai).toContain("SEARCH_AI_PLACEHOLDER = '问 AI 找站，说一句话…'")
    expect(ai).not.toContain('按 /')
    const palette = read('src/components/search-palette.tsx')
    expect(palette).toContain('aiMode ? SEARCH_AI_PLACEHOLDER : placeholder')
  })

  it('<kbd> 徽标不动：仍由 spotlightHotkeyHint 派生，且是可点击按钮（开超级搜索）', () => {
    const src = read('src/components/search-palette.tsx')
    expect(src).toContain('spotlightHotkeyHint')
    // 2026-11-20 搜索快捷键分流（William 点名）：徽标改为可点击按钮，
    // 派发 open-spotlight 打开超级搜索（Ctrl/⌘+Shift+K 之外的另一触发入口）
    expect(src).toContain("window.dispatchEvent(new CustomEvent('open-spotlight'))")
    expect(src).toContain('打开超级搜索')
  })
})

/**
 * 命令面板缺口 ②（已退役，首屏瘦身重写）：
 * 原守卫锁的是 FloatingQuickNav 全局挂载（深链直达内页的移动端 Spotlight
 * 常驻入口）。2026-11-20 首屏瘦身（evo/firstscreen-slim-1257）把底部悬浮
 * 工具栏整体移除：其三键功能已由顶栏与命令面板覆盖——搜索由顶栏搜索框 +
 * ⌘K / / 覆盖，微工具由 T 键 + 命令面板「极客微工具」指令覆盖，回到顶部
 * 由命令面板新增「回到页面顶部」指令（cmd-scroll-top）覆盖。
 * 本块按新行为改写（不删除守卫）：锁「组件已删、两处挂载已撤、事件桥已删、
 * 三功能均有替代入口」，防止后续重构把悬浮胶囊静默加回来。
 */
describe('命令面板缺口 ②（退役）：FloatingQuickNav 已移除，三功能由顶栏与命令面板覆盖', () => {
  it('FloatingQuickNav 组件文件已删除', () => {
    expect(existsSync(join(ROOT, 'src/components/floating-quick-nav.tsx'))).toBe(false)
  })

  it('两处挂载已撤：providers.tsx 与 navigation-content.tsx 均无 FloatingQuickNav', () => {
    for (const rel of ['src/components/providers.tsx', 'src/components/navigation-content.tsx']) {
      const src = read(rel)
      expect(src, `${rel} 不应再引用 FloatingQuickNav`).not.toContain('FloatingQuickNav')
      // 注：注释里允许出现小写 floating-quick-nav（退役说明），这里只锁 import 路径
      expect(src, `${rel} 不应再 import floating-quick-nav`).not.toContain("from '@/components/floating-quick-nav'")
      expect(src, `${rel} 不应再挂载 <FloatingQuickNav`).not.toContain('<FloatingQuickNav')
    }
    // 全局 Spotlight 入口本身仍在（深链直达内页的搜索入口不依赖悬浮胶囊）
    expect(read('src/components/providers.tsx')).toContain('GlobalSpotlightGateway')
  })

  it('搜索可达：顶栏仍有搜索框，超级搜索改走 ⌘⇧K / / 呼出（⌘K 改为聚焦顶栏）', () => {
    const toolbar = read('src/components/navigation-toolbar.tsx')
    expect(toolbar).toContain('SearchPalette')
    // 2026-11-27 0322：同上，placeholder 已改为按 categoryId 条件派生，见本文件首个断言注释。
    expect(toolbar).toContain('搜索站点、标签或拼音…')
    expect(toolbar).toContain('在当前分类内搜索…（无结果时自动放宽到全库）')
    expect(toolbar).toMatch(/placeholder=\{\s*categoryId\s*\?/)
    const palette = read('src/components/search-palette.tsx')
    expect(palette).toContain('title="按 / 快速搜索"')
    expect(palette).toContain('spotlightHotkeyHint')
    // 2026-11-20 搜索快捷键分流（William 点名）：⌘K 不再开超级搜索弹窗，
    // 改为聚焦顶栏搜索框；超级搜索改由 ⌘⇧K / / 呼出。网守与弹窗都要接新判据。
    const gateway = read('src/components/search/global-spotlight-gateway.tsx')
    expect(gateway).toContain('spotlightModalHotkeyMatches')
    expect(gateway).toContain('topSearchHotkeyMatches')
    const modal = read('src/components/search/spotlight-modal.tsx')
    expect(modal).toContain('spotlightModalHotkeyMatches')
    expect(modal).toContain('topSearchHotkeyMatches')
  })

  it('回到顶部可达：命令面板新增「回到页面顶部」指令（cmd-scroll-top）', () => {
    const modal = read('src/components/search/spotlight-modal.tsx')
    expect(modal).toContain("id: 'cmd-scroll-top'")
    expect(modal).toContain('回到页面顶部')
    expect(modal).toContain('window.scrollTo({ top: 0')
  })

  it('微工具可达：首页仍有 QuickToolsDrawer 与 T 键接线', () => {
    const content = read('src/components/navigation-content.tsx')
    expect(content).toContain('QuickToolsDrawer')
    expect(content).toContain('setIsToolsOpen(true)')
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
