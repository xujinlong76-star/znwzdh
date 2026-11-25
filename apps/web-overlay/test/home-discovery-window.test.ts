import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  detectDiscoveryIntent,
  resolveSimilarModeInput,
} from '../src/lib/search-discovery-intent'
import { buildPaletteNavItems } from '../src/lib/palette-actions'

const HERE = dirname(fileURLToPath(import.meta.url))
const readOverlay = (rel: string) => readFileSync(join(HERE, '..', rel), 'utf8')

describe('search-discovery-intent（三合一搜索窗智能意图与前缀解析）', () => {
  it('网址与裸域名识别为「找相似」模式', () => {
    expect(detectDiscoveryIntent('github.com')).toBe('similar')
    expect(detectDiscoveryIntent('https://www.douban.com/movie')).toBe('similar')
    expect(detectDiscoveryIntent('figma.com')).toBe('similar')
    expect(detectDiscoveryIntent('notion.so')).toBe('similar')
  })

  it('自然语言任务需求识别为「AI 找站」模式', () => {
    expect(detectDiscoveryIntent('我要做一份免费 PPT')).toBe('ai')
    expect(detectDiscoveryIntent('帮我找在线剪视频的网站')).toBe('ai')
    expect(detectDiscoveryIntent('有没有免费好用的思维导图工具')).toBe('ai')
  })

  it('过短或中性词不强行干预切换', () => {
    expect(detectDiscoveryIntent('')).toBeNull()
    expect(detectDiscoveryIntent('AI')).toBeNull()
    expect(detectDiscoveryIntent('豆瓣')).toBeNull()
  })

  it('sim / similar / 相似 前缀自动进入「找相似」模式并剥离前缀', () => {
    expect(resolveSimilarModeInput('sim github.com')).toEqual({ similarMode: true, query: 'github.com' })
    expect(resolveSimilarModeInput('相似 douban.com')).toEqual({ similarMode: true, query: 'douban.com' })
    expect(resolveSimilarModeInput('找相似 Figma')).toEqual({ similarMode: true, query: 'Figma' })
    expect(resolveSimilarModeInput('sim ')).toEqual({ similarMode: false, query: 'sim ' })
    expect(resolveSimilarModeInput('github')).toEqual({ similarMode: false, query: 'github' })
  })
})

describe('首页「站内搜索 × AI 找站 × 找相似」三合一唯一搜索窗守卫', () => {
  it('首页只保留顶栏唯一融合搜索窗，不再重复渲染第二块 HomeDiscoveryWindow 或旁路 AI 找站按钮', () => {
    const nav = readOverlay('src/components/navigation-content.tsx')
    expect(nav).not.toContain('<HomeDiscoveryWindow')
    expect(nav).toContain('AiFinderDialog')
    expect(nav).toContain('defaultMode={toolbarAiMode}')

    const toolbar = readOverlay('src/components/navigation-toolbar.tsx')
    expect(toolbar).toContain('<SearchPalette')
    expect(toolbar).toContain('onOpenDiscoveryDialog={onOpenAiFinder}')
    expect(toolbar).not.toContain('title="打开 AI 智能找站小窗"')
    expect(toolbar).not.toContain('title="打开「AI 找站 · 找相似」融合搜索工作台"')
  })

  it('SearchPalette 融合全站检索、AI 找站与找相似三模式标签页，并支持大窗联动', () => {
    const palette = readOverlay('src/components/search-palette.tsx')
    expect(palette).toContain('SearchPaletteAiTab')
    expect(palette).toContain('SearchPaletteSimilarTab')
    expect(palette).toContain('aria-label="三合一融合搜索模式"')
    expect(palette).toContain('resolveSimilarModeInput')
    expect(palette).toContain('detectDiscoveryIntent')
  })

  it('ai-finder-dialog.tsx 融合 AiFinderPanel 与 SimilarSitesExplorer 双标签页', () => {
    const dlg = readOverlay('src/components/home-windows/ai-finder-dialog.tsx')
    expect(dlg).toContain('AiFinderPanel')
    expect(dlg).toContain('SimilarSitesExplorer')
    expect(dlg).toContain('找相似网站')
  })

  it('P0-1：存在精确命中站点时 buildPaletteNavItems 把站点排在插件包之前', () => {
    const defaultOrder = buildPaletteNavItems({
      suggestionIds: [],
      diyIds: [],
      favoriteIds: [],
      actionIds: [],
      toolIds: [],
      pluginIds: ['plugin-1'],
      siteIds: ['site-gitlab'],
    })
    expect(defaultOrder.map((e) => e.id)).toEqual(['plugin-1', 'site-gitlab'])

    const exactFirstOrder = buildPaletteNavItems({
      suggestionIds: [],
      diyIds: [],
      favoriteIds: [],
      actionIds: [],
      toolIds: [],
      pluginIds: ['plugin-1'],
      siteIds: ['site-gitlab'],
      sitesFirst: true,
    })
    expect(exactFirstOrder.map((e) => e.id)).toEqual(['site-gitlab', 'plugin-1'])
  })

  it('P0-2 / P1-3 / P1-4 / P2-5：效率三合一、2 列探索矩阵、去侧栏重复指南针与移动端单行标题融合到位', () => {
    const todayDlg = readOverlay('src/components/home-windows/today-center-dialog.tsx')
    expect(todayDlg).toContain('LazyWidgetBoxBody')
    expect(todayDlg).toContain('LazyQuickToolsBody')

    const toolbar = readOverlay('src/components/navigation-toolbar.tsx')
    expect(toolbar).toContain('sm:grid-cols-2')
    expect(toolbar).toContain('<AppearanceQuickPopover')

    const sidebar = readOverlay('src/components/sidebar.tsx')
    expect(sidebar).not.toContain('aria-label="探索与专题"')

    const capsuleRow = readOverlay('src/components/home-capsule-row.tsx')
    expect(capsuleRow).toContain('role="heading" aria-level={1}')
    expect(capsuleRow).toContain('山羊胡导航')
  })
})
