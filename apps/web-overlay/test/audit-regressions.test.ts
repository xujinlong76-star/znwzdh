import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchPlugins } from '../src/lib/navhub-api'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((path) => path.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(path))
  if (!hit) throw new Error(`无法定位 overlay 文件：${rel}`)
  return readFileSync(hit, 'utf8')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('深度审计前端回归', () => {
  it('热门筛选依赖领域结果，并在后退时恢复 domain', () => {
    const src = overlaySource('src/app/hot/hot-view.tsx')
    expect(src).toContain('}, [domainTrending, filterQuery])')
    expect(src).toContain("setDomain(parseDomain(params.get('domain')))")
  })

  it('折叠子分类不可聚焦且从无障碍树隐藏', () => {
    const src = overlaySource('src/components/sidebar.tsx')
    expect(src).toContain('aria-hidden={!isExpanded}')
    expect(src).toContain('inert={!isExpanded}')
  })

  it('目标分类不存在时返回 failed，且不写入空历史', () => {
    const src = overlaySource('src/lib/modular/use-home-diy.ts')
    expect(src).toContain("outcome.value = 'missing'")
    expect(src).toContain("if (!result.ok || outcome.value === 'missing') return 'failed'")
  })

  it('插件检索接收 AbortSignal，查询变化与卸载都会取消', () => {
    const api = overlaySource('src/lib/navhub-api.ts')
    const palette = overlaySource('src/components/search-palette.tsx')
    const spotlight = overlaySource('src/components/search/spotlight-modal.tsx')
    expect(api).toContain('signal?: AbortSignal')
    expect(api).toContain('`/api/plugins/search?${sp.toString()}`, signal')
    expect(palette).toContain('}, controller.signal)')
    expect(palette).toContain('abortRef.current?.abort()')
    expect(spotlight).toContain('}, ac.signal).catch(() => {')
  })

  it('插件检索把调用方 AbortSignal 一路交给 fetch，取消后走明确降级', async () => {
    const controller = new AbortController()
    const onDegraded = vi.fn()
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort()
      throw controller.signal.reason
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await searchPlugins({ q: '搜索', limit: 5 }, onDegraded, controller.signal)

    expect(result).toEqual({ items: [], total: 0, mode: 'keyword', degraded: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/plugins/search?q=')
    expect(fetchMock.mock.calls[0]?.[0]).toContain('limit=5')
    expect(onDegraded).toHaveBeenCalledTimes(1)
  })

  it('搜索重包只在交互后挂载，并承接外部聚焦事件', () => {
    const src = overlaySource('src/components/navigation-toolbar.tsx')
    expect(src).toContain('function LazySearchPalette')
    expect(src).toContain('if (mounted) {')
    expect(src).toContain("window.addEventListener('navhub:focus-search', onFocusSearch)")
    expect(src).toContain('<LazySearchPalette')
  })

  it('聚焦分类时全选范围与当前展示分类一致', () => {
    const src = overlaySource('src/components/navigation-content.tsx')
    expect(src).toContain('const selectionCategories = useMemo(() => {')
    expect(src).toContain('useSiteSelection(selectionCategories, collapsedCategoryIds)')
    expect(src).toContain("if (focusedSubCategoryId === '__direct__') return [{ ...category, subCategories: [] }]")
  })

  it('重型弹窗按打开状态挂载，快捷键 UI 与监听分层', () => {
    const src = overlaySource('src/components/navigation-content.tsx')
    const shortcuts = overlaySource('src/components/keyboard-shortcuts-dialog.tsx')
    expect(src).toContain('{peek ? (')
    expect(src).toContain('{isToolsOpen ? (')
    expect(src).toContain('{addSiteTargetCatId ? (')
    expect(shortcuts).toContain("import('@/components/keyboard-shortcuts-dialog-content')")
    expect(shortcuts).toContain('if (!isOpen) return null')
  })
})
