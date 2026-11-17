/**
 * 插件市场 board 第 2 批（P2-8 / P2-13 / P2-14 / P2-15）。
 *
 * 覆盖层次（本仓 vitest 是 node 环境、无 jsdom，组件 effect 跑不起来，
 * 所以“行为级”按能真实跑到的层次分层钉死，不拿源码 toContain 充数）：
 *
 *  1. 真渲染（renderToString）：hero 6 按钮的焦点 class、类型筛选器的
 *     option、移动端横滑布局 class——全部断言渲染出的 HTML。
 *  2. 真行为（纯函数）：「全部插件」回默认视图的 URL 契约——
 *     DEFAULT_MARKETPLACE_SORT + buildMarketplaceQuery，真实调用、
 *     真实断言返回值。
 *  3. 接线守卫（补充）：handleTopicClick 的 all 分支写 DEFAULT 而不是
 *     写死的 'popular'——只钉接线，行为本身由第 2 层覆盖；与
 *     plugin-market-load-failure.test.ts 的守卫同款。
 *
 * 未覆盖、需浏览器复核的缺口：Tab 到 hero 按钮时焦点框是否肉眼可见、
 * 390×844 首屏是否真的看见搜索框——node 环境没有布局与 :focus-visible，
 * 只能由 Playwright / 真机走查验证；这里覆盖到：焦点 class 真的落在
 * 6 个按钮上且基底的 outline-none 被 twMerge 合并掉、移动端横滑 class
 * 真的落在 hero 按钮行与胶囊行上。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PluginMarketBoard } from '../src/components/plugin-market-board'
import type { HubPluginItem } from '../src/lib/navhub-api'
import {
  buildMarketplaceQuery,
  DEFAULT_MARKETPLACE_SORT,
  type MarketplaceFilterState,
} from '../src/lib/plugins/marketplace-filters'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位 overlay 里的文件；镜像副本（apps/web/test）不会被误当成源 */
function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel + '（候选：' + candidates.join(' | ') + '）')
  return readFileSync(hit, 'utf8')
}

// next/link 在 node 测试环境没有 Next 运行时：替成直通 <a>，只保留 href/文案。
vi.mock('next/link', async () => {
  const React = await import('react')
  return {
    default: ({ href, children, ...props }: { href?: string; children?: React.ReactNode }) =>
      React.createElement(
        'a',
        { href: typeof href === 'string' ? href : '#', ...props },
        children,
      ),
  }
})

// next/dynamic 的弹窗在 SSR 输出里不渲染：替成空组件（与 home-drama-cinema-ssr
// 隔离 Link / hook 的做法同款；弹窗本身的覆盖在其余测试里）。
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}))

// PluginCard 只测 board 的分支路由，不测卡片本身：卡片只渲染插件名。
vi.mock('@/components/plugins/plugin-card', async () => {
  const React = await import('react')
  return {
    PluginCard: ({ plugin }: { plugin: { name: string } }) =>
      React.createElement('div', { 'data-testid': 'plugin-card-stub' }, plugin.name),
  }
})

function pluginItem(slug: string, name: string): HubPluginItem {
  return {
    id: `id-${slug}`,
    slug,
    kind: 'theme',
    name,
    description: `${name} 的描述`,
    version: '1.0.0',
    manifest: {},
    source: 'test',
    status: 'published',
    installCount: 0,
    starCount: 0,
    reportCount: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

afterEach(() => {
  // mock 卫生：本文件 mock 了 next/link、next/dynamic、@/components/plugins/plugin-card
  // 三个跨模块目标，清理模块缓存，避免驻留同 worker 的后续文件。
  vi.resetModules()
})

function renderBoardHtml(): string {
  return renderToString(
    createElement(PluginMarketBoard, {
      initialItems: [pluginItem('demo-theme', '演示主题')],
      initialTotal: 1,
      initialFeatured: null,
      initialRankings: null,
    }),
  )
}

/** 统计子串出现次数 */
function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1
}

const HERO_LABELS = ['已安装管家', 'Taps 订阅源', '导入插件文件', '作者中心', 'AI 生成插件', '发布插件']

/* ------------------------------------------------------------------ *
 * P2-8 — hero 6 按钮键盘焦点可见（WCAG 2.4.7）
 * ------------------------------------------------------------------ */
describe('P2-8 hero 6 按钮：Tab 聚焦时有 solid 2px 焦点框', () => {
  it('6 个 hero 按钮都带 focus-visible solid 2px outline class', () => {
    const html = renderBoardHtml()
    for (const label of HERO_LABELS) expect(html).toContain(label)
    expect(countOf(html, 'focus-visible:outline-solid')).toBe(6)
    expect(countOf(html, 'focus-visible:outline-2')).toBe(6)
    expect(countOf(html, 'focus-visible:outline-ring')).toBe(6)
    expect(countOf(html, 'focus-visible:outline-offset-2')).toBe(6)
  })

  it('渲染出的 board 里没有残留 focus-visible:outline-none（基底被 twMerge 合并掉）', () => {
    const html = renderBoardHtml()
    // 有数据态、总数已满：页面里唯一的 Button 实例就是 hero 6 个；
    // 加载更多、空态按钮、卡片按钮均不渲染，outline-none 出现即回归。
    expect(html).not.toContain('focus-visible:outline-none')
  })
})

/* ------------------------------------------------------------------ *
 * P2-13 — 空 kind（site-pack）不进类型筛选器
 * ------------------------------------------------------------------ */
describe('P2-13 类型筛选器：没有点进去永远是空的 kind', () => {
  it('渲染出的筛选器没有 site-pack，仍保留其余 4 个有内容的 kind', () => {
    const html = renderBoardHtml()
    expect(html).not.toContain('site-pack')
    expect(html).not.toContain('网站包')
    expect(html).toContain('value="workspace-preset"')
    expect(html).toContain('value="theme"')
    expect(html).toContain('value="search-pack"')
    expect(html).toContain('value="bundle"')
  })

  it('类型本身仍保留在契约与 KIND_LABELS 里（只做隐藏，不删类型）', () => {
    const src = overlayFile('src/components/plugin-market-board.tsx')
    expect(src).toContain("'site-pack': '网站包'")
    const filters = overlayFile('src/lib/plugins/marketplace-filters.ts')
    expect(filters).toContain("'site-pack'")
  })
})

/* ------------------------------------------------------------------ *
 * P2-14 — 「全部插件」胶囊回默认视图（不再切到 popular）
 * ------------------------------------------------------------------ */
describe('P2-14 「全部插件」回到默认视图', () => {
  it('默认排序就是 trending，且默认状态写回地址栏是空串（/marketplace 干净）', () => {
    expect(DEFAULT_MARKETPLACE_SORT).toBe('trending')
    const clean: MarketplaceFilterState = { kind: '', q: '', sort: DEFAULT_MARKETPLACE_SORT, starred: false }
    expect(buildMarketplaceQuery(clean)).toBe('')
    // 对照：旧行为 popular 会落 ?sort=popular，地址栏不再是默认视图
    expect(buildMarketplaceQuery({ ...clean, sort: 'popular' })).toBe('?sort=popular')
  })

  it('接线守卫：handleTopicClick 的 all 分支写 DEFAULT_MARKETPLACE_SORT，不写死 popular', () => {
    const src = overlayFile('src/components/plugin-market-board.tsx')
    expect(src).not.toContain("setSort('popular')")
    const allBranch = src.slice(src.indexOf("if (topic.id === 'all')"), src.indexOf("} else if (topic.id === 'trending')"))
    expect(allBranch).toContain('setSort(DEFAULT_MARKETPLACE_SORT)')
  })
})

/* ------------------------------------------------------------------ *
 * P2-15 — 移动端 hero 精简，390px 首屏可见搜索框
 * ------------------------------------------------------------------ */
describe('P2-15 移动端 hero：6 按钮与胶囊横滑一行，不再占 610px', () => {
  it('hero 按钮行是移动端横滑一行、≥sm 恢复 3 列网格', () => {
    const html = renderBoardHtml()
    expect(html).toContain('flex gap-2 overflow-x-auto pb-1 shrink-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0')
    // 6 个 hero 按钮在横滑行里不被压扁
    expect(countOf(html, 'shrink-0')).toBeGreaterThanOrEqual(6)
  })

  it('胶囊行移动端横滑一行、≥sm 恢复换行', () => {
    const html = renderBoardHtml()
    expect(html).toContain('flex flex-nowrap overflow-x-auto items-center gap-1.5 sm:flex-wrap sm:gap-2 sm:overflow-visible')
  })

  it('hero 移动端内边距收紧（p-4 → p-3），桌面 p-7 不变', () => {
    const html = renderBoardHtml()
    expect(html).toContain('market-hero p-3 sm:p-7')
  })
})
