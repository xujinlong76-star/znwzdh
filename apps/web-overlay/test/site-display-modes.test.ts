import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CARD_DISPLAY_MODE_OPTIONS,
  VALID_CARD_DISPLAY_MODES,
  VIEW_MODE_IDS,
  VIEW_MODE_REGISTRY,
  computePreviewCountForMode,
  extractDisplayHostname,
  getCardDisplayModeMeta,
  getGridClassForCardMode,
  getPreviewRowsForCardMode,
  normalizeCardDisplayMode,
  resolveEffectiveViewMode,
} from '@/lib/modular/card-display-modes'
import {
  NAV_VIEW_MODE_COOKIE,
  NAV_VIEW_MODE_COOKIE_MAX_AGE_S,
  parseViewModeCookie,
  serializeViewModeCookie,
} from '@/lib/modular/view-mode-cookie'
import { parseGridTemplateColumnCount } from '@/lib/grid-column-observer'
import { parseDiyShortcut, validateAndCleanDIYConfig } from '@/lib/modular/diy-presets'
import { sanitizeDiyLayoutInput } from '@/lib/modular/diy-layout-schema-zod'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件: ' + rel)
  return readFileSync(hit, 'utf8')
}

describe('强类型单一真相模式注册表（VIEW_MODE_REGISTRY）', () => {
  it('覆盖 7 大主流网址展示范式且每个模式均具备完整强类型元信息', () => {
    const ids = CARD_DISPLAY_MODE_OPTIONS.map((o) => o.id)
    expect(ids).toEqual([
      'standard',
      'icon-wall',
      'list',
      'minimal',
      'compact',
      'rich',
      'directory',
    ])
    expect(new Set(ids).size).toBe(7)
    expect(new Set(VIEW_MODE_IDS)).toEqual(new Set(ids))
    expect(VALID_CARD_DISPLAY_MODES).toContain('mini-chip')

    for (const id of ids) {
      const cfg = VIEW_MODE_REGISTRY[id]
      expect(cfg.id).toBe(id)
      expect(cfg.name.length).toBeGreaterThanOrEqual(2)
      expect(cfg.shortName.length).toBeGreaterThanOrEqual(2)
      expect(cfg.description.length).toBeLessThanOrEqual(14)
      expect(cfg.densityLabel).toContain('一屏')
      expect(cfg.gridClassName).toContain('grid')
      expect(cfg.diyCompatible.supported).toBe(true)
      expect(['inline-compact', 'overlay-corner', 'bottom-dock']).toContain(cfg.diyCompatible.handleStyle)
      expect(cfg.diyCompatible.note.length).toBeGreaterThan(0)
      // defaultItemsPerSubcategory 在任意列数下必须是列数的精确整倍数
      for (const cols of [1, 2, 3, 4, 5, 6, 8]) {
        const count = cfg.defaultItemsPerSubcategory(cols)
        expect(count).toBeGreaterThanOrEqual(cols)
        expect(count % cols).toBe(0)
      }
    }

    // 极简列表 / 书签目录 / 紧凑条形 / 极速胶囊均声明使用紧凑内联 DIY 手柄
    for (const inlineMode of ['list', 'minimal', 'compact', 'directory'] as const) {
      expect(VIEW_MODE_REGISTRY[inlineMode].diyCompatible.handleStyle).toBe('inline-compact')
    }
  })

  it('兼容历史 mini-chip 别名并规范化未知值到 standard', () => {
    expect(normalizeCardDisplayMode('mini-chip')).toBe('minimal')
    expect(normalizeCardDisplayMode('icon-wall')).toBe('icon-wall')
    expect(normalizeCardDisplayMode('list')).toBe('list')
    expect(normalizeCardDisplayMode('directory')).toBe('directory')
    expect(normalizeCardDisplayMode('unknown-mode')).toBe('standard')
    expect(normalizeCardDisplayMode(undefined)).toBe('standard')
  })

  it('resolveEffectiveViewMode 在 <640px 手机端自动降级桌面专属模式，切回桌面自动恢复', () => {
    expect(VIEW_MODE_REGISTRY.list.mobileFallbackId).toBe('standard')
    // 移动端：list 自动降级为 standard
    expect(resolveEffectiveViewMode('list', true)).toBe('standard')
    // 切回桌面端：自动恢复 list
    expect(resolveEffectiveViewMode('list', false)).toBe('list')
    // 原生适配移动端的模式不受影响
    for (const nativeMode of ['standard', 'icon-wall', 'minimal', 'compact', 'rich', 'directory'] as const) {
      expect(resolveEffectiveViewMode(nativeMode, true)).toBe(nativeMode)
      expect(resolveEffectiveViewMode(nativeMode, false)).toBe(nativeMode)
    }
  })

  it('每种模式都具备专属响应式容器网格与合理的折叠行数', () => {
    expect(getGridClassForCardMode('standard', 12)).toContain('@4xl:grid-cols-3')
    expect(getGridClassForCardMode('icon-wall', 12)).toContain('@4xl:grid-cols-6')
    expect(getGridClassForCardMode('icon-wall', 12)).toContain('@6xl:grid-cols-8')
    expect(getGridClassForCardMode('list', 12)).toBe('grid grid-cols-1 gap-1.5')
    expect(getGridClassForCardMode('minimal', 12)).toContain('@4xl:grid-cols-5')
    expect(getGridClassForCardMode('compact', 12)).toContain('@4xl:grid-cols-4')
    expect(getGridClassForCardMode('rich', 12)).toContain('@5xl:grid-cols-3')
    expect(getGridClassForCardMode('directory', 12)).toContain('@3xl:grid-cols-3')
    expect(getGridClassForCardMode('directory', 12)).toContain('@5xl:grid-cols-4')

    expect(getPreviewRowsForCardMode('list')).toBe(6)
    expect(getPreviewRowsForCardMode('standard')).toBe(2)
    expect(getPreviewRowsForCardMode('icon-wall')).toBe(2)
    expect(getPreviewRowsForCardMode('minimal')).toBe(3)
    expect(getPreviewRowsForCardMode('directory')).toBe(3)

    expect(computePreviewCountForMode('directory', 3)).toBe(9)
    expect(computePreviewCountForMode('directory', 4)).toBe(12)
    expect(computePreviewCountForMode('directory', 5)).toBe(10)
    expect(computePreviewCountForMode('list', 1)).toBe(6)
    expect(computePreviewCountForMode('icon-wall', 6)).toBe(12)
    expect(computePreviewCountForMode('icon-wall', 8)).toBe(16)
    expect(computePreviewCountForMode('minimal', 5)).toBe(15)
    expect(computePreviewCountForMode('minimal', 6)).toBe(12)

    expect(getGridClassForCardMode('standard', 4)).toContain('grid-cols-1')
    expect(getGridClassForCardMode('icon-wall', 4)).toContain('grid-cols-2')
  })

  it('parseGridTemplateColumnCount 准确解析 content-visibility:auto 下的未展开 repeat(N, ...) 与像素序列', () => {
    expect(parseGridTemplateColumnCount('repeat(5, minmax(0px, 1fr))')).toBe(5)
    expect(parseGridTemplateColumnCount('repeat(4, minmax(0px, 1fr))')).toBe(4)
    expect(parseGridTemplateColumnCount('repeat(1, minmax(0px, 1fr))')).toBe(1)
    expect(parseGridTemplateColumnCount('repeat(8, minmax(0px, 1fr))')).toBe(8)
    expect(parseGridTemplateColumnCount('218px 218px 218px 218px 218px')).toBe(5)
    expect(parseGridTemplateColumnCount('309.5px 309.5px 309.5px')).toBe(3)
    expect(parseGridTemplateColumnCount('minmax(0px, 1fr) minmax(0px, 1fr)')).toBe(2)
    expect(parseGridTemplateColumnCount('none')).toBe(0)
    expect(parseGridTemplateColumnCount('')).toBe(0)
  })

  it('extractDisplayHostname 安全提取简洁展示域名', () => {
    expect(extractDisplayHostname('https://www.gemini.google.com/app?foo=1')).toBe('gemini.google.com')
    expect(extractDisplayHostname('https://perplexity.ai/search')).toBe('perplexity.ai')
    expect(extractDisplayHostname('')).toBe('')
  })
})

describe('Cookie + localStorage 双写零闪烁 SSR 契约（view-mode-cookie）', () => {
  it('parseViewModeCookie 与 serializeViewModeCookie 正确编解码 7 种模式及历史别名', () => {
    expect(NAV_VIEW_MODE_COOKIE).toBe('nav_view_mode')
    expect(NAV_VIEW_MODE_COOKIE_MAX_AGE_S).toBe(31536000)

    for (const mode of VIEW_MODE_IDS) {
      expect(parseViewModeCookie(mode)).toBe(mode)
      expect(parseViewModeCookie(encodeURIComponent(mode))).toBe(mode)
      expect(serializeViewModeCookie(mode)).toBe(
        `nav_view_mode=${encodeURIComponent(mode)}; Path=/; Max-Age=31536000; SameSite=Lax`,
      )
    }

    expect(parseViewModeCookie('mini-chip')).toBe('minimal')
    expect(serializeViewModeCookie('mini-chip')).toContain('nav_view_mode=minimal;')
    expect(parseViewModeCookie('')).toBeNull()
    expect(parseViewModeCookie(null)).toBeNull()
    expect(parseViewModeCookie(undefined)).toBeNull()
    expect(parseViewModeCookie('__proto__')).toBeNull()
    expect(parseViewModeCookie('%E0%A4%A')).toBeNull()
  })

  it('首页经「proxy Cookie 重写 + /vm/[mode] 预渲染变体」按 Cookie 出模式 HTML：0 CLS 且保持 ISR', () => {
    // 展示模式已不在 app/page.tsx 读 Cookie（await cookies() 会把 / 落成 ƒ、
    // revalidate=60 静默作废，破坏 check-isr-routes.mjs 的 ISR 契约）；
    // 改为 src/proxy.ts 读 nav_view_mode Cookie 透明重写到预渲染变体 /vm/[mode]，
    // 服务端直接吐该模式 HTML——Zero-CLS 契约（initialCardDisplayMode 注入）不变。
    const pageSrc = overlaySource('src/app/page.tsx')
    expect(pageSrc).toContain('initialCardDisplayMode={initialCardDisplayMode}')
    expect(pageSrc).not.toContain('await cookies()')

    const proxySrc = overlaySource('src/proxy.ts')
    expect(proxySrc).toContain('NAV_VIEW_MODE_COOKIE')
    expect(proxySrc).toContain('parseViewModeCookie')
    expect(proxySrc).toContain('NextResponse.rewrite')

    const vmSrc = overlaySource('src/app/vm/[mode]/page.tsx')
    expect(vmSrc).toContain('generateStaticParams')
    expect(vmSrc).toContain('export { default, generateMetadata } from "../../page"')

    const storageSrc = overlaySource('src/lib/modular/home-diy-storage.ts')
    expect(storageSrc).toContain('writeViewModeCookie(next.cardDisplayMode)')
    expect(storageSrc).toContain('readClientViewModeCookie')

    const contentSrc = overlaySource('src/components/navigation-content.tsx')
    expect(contentSrc).toContain('<InitialViewModeProvider value={ssrCardDisplayMode}>')
    expect(contentSrc).toContain('resolveEffectiveViewMode(activeCardDisplayMode, isMobileViewport)')
    expect(contentSrc).toContain('data-card-mode={effectiveCardDisplayMode}')
  })
})

describe('持久化清洗、Zod 校验与快捷指令对 7 种展示模式的完整支持', () => {
  it.each(['standard', 'icon-wall', 'list', 'minimal', 'compact', 'rich', 'directory'] as const)(
    'validateAndCleanDIYConfig 与 sanitizeDiyLayoutInput 放行模式「%s」',
    (mode) => {
      const cleaned = validateAndCleanDIYConfig({
        version: 3,
        viewMode: 'hybrid',
        cardDisplayMode: mode,
        categoryDensityOverrides: { 'ai-tools': mode },
      })
      expect(cleaned.valid).toBe(true)
      expect(cleaned.config.cardDisplayMode).toBe(mode)
      expect(cleaned.config.categoryDensityOverrides['ai-tools']).toBe(mode)

      const zodRes = sanitizeDiyLayoutInput({
        version: 3,
        viewMode: 'hybrid',
        cardDisplayMode: mode,
        categoryDensityOverrides: { 'ai-tools': mode },
      })
      expect(zodRes.ok).toBe(true)
      expect(zodRes.schemaValid).toBe(true)
    },
  )

  it('快捷指令能识别新模式关键词（图标墙 / 清单 / 目录 / 画廊）', () => {
    const opts = { allCategoryIds: ['ai'], categoryTitleMap: { ai: 'AI 工具' } }
    expect(parseDiyShortcut('图标启动台', opts).cardDisplayMode).toBe('icon-wall')
    expect(parseDiyShortcut('极客清单', opts).cardDisplayMode).toBe('list')
    expect(parseDiyShortcut('书签目录', opts).cardDisplayMode).toBe('directory')
    expect(parseDiyShortcut('视觉画廊', opts).cardDisplayMode).toBe('rich')
  })
})

describe('无头交互壳（SiteItemShell）与升级版可视化模式切换面板守卫', () => {
  it('顶栏 NavigationToolbar、外观弹窗 AppearanceGuideDialog 与 DIY 工具栏共用同一状态源', () => {
    expect(overlaySource('src/components/navigation-toolbar.tsx')).toContain('<SiteDisplayModeSwitcher')
    expect(overlaySource('src/components/home-windows/appearance-guide-dialog.tsx')).toContain(
      '<SiteDisplayModeSwitcher variant="inline"',
    )
    expect(overlaySource('src/components/home-diy-toolbar.tsx')).toContain('CARD_DISPLAY_MODE_OPTIONS')
    expect(overlaySource('src/components/category-density-menu-content.tsx')).toContain('CARD_DISPLAY_MODE_OPTIONS')
  })

  it('SiteDisplayModeSwitcher 内置 52×34 SVG 线框、WAI-ARIA 键盘导航与移动端 Bottom Sheet', () => {
    const src = overlaySource('src/components/site-display-mode-switcher.tsx')
    expect(src).toContain('data-testid="site-display-mode-trigger"')
    expect(src).toContain('setHomeDiyPreview({ cardDisplayMode: mode })')
    expect(src).toContain('ModeSvgWireframe')
    expect(src).toContain('width="52"')
    expect(src).toContain('height="34"')
    expect(src).toContain('viewBox="0 0 52 34"')
    expect(src).toContain('role="radiogroup"')
    expect(src).toContain('role="radio"')
    expect(src).toContain("e.key === 'ArrowRight'")
    expect(src).toContain("e.key === 'ArrowLeft'")
    expect(src).toContain("e.key === 'Escape'")
    expect(src).toContain('restoreTriggerFocus')
    expect(src).toContain('useInitialViewMode()')
    expect(src).toContain('useIsBelowMd()')
    expect(src).toContain('side="bottom"')
    expect(src).toContain('data-testid="site-display-mode-sheet"')
    expect(src).toContain('桌面端最佳')
    expect(src).toContain('useDensity()')
  })

  it('SiteItemShell 统一承载键盘导航/点击上报，4 种扩展模式均为纯表现层且 DIY 使用紧凑内联手柄', () => {
    const shellSrc = overlaySource('src/components/site-item-shell.tsx')
    expect(shellSrc).toContain('export function useSiteItemController(')
    expect(shellSrc).toContain('export function SiteItemShell(')
    expect(shellSrc).toContain('recordOfflineVisit(')
    expect(shellSrc).toContain('reportClick(')
    expect(shellSrc).toContain('aria-keyshortcuts={dialKeyshortcuts}')
    expect(shellSrc).toContain('safeHref(item.href)')
    expect(shellSrc).toContain('data-diy-handle-style={diyHandleStyle}')

    const cardSrc = overlaySource('src/components/navigation-card.tsx')
    expect(cardSrc).toContain('useSiteItemController(')
    expect(cardSrc).toContain('<NavigationCardVariant')
    expect(cardSrc).toContain('controller={controller}')

    const variantSrc = overlaySource('src/components/navigation-card-variants.tsx')
    for (const mode of ['icon-wall', 'list', 'minimal', 'directory'] as const) {
      expect(variantSrc).toContain(`mode="${mode}"`)
    }
    expect(variantSrc).toContain('<SiteItemShell')
    expect(variantSrc).toContain('data-diy-inline-controls="list"')
    expect(variantSrc).toContain('data-diy-inline-controls="minimal"')
    expect(variantSrc).toContain('data-diy-inline-controls="directory"')
    expect(variantSrc).toContain('bg-gradient-to-l from-card via-card to-transparent')
    expect(variantSrc).toContain('<NumberDialBadge digit={dialDigit} inline />')
    expect(getCardDisplayModeMeta('icon-wall').name).toBe('图标启动台')
  })
})
