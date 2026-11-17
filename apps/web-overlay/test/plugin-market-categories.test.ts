import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MARKETPLACE_CATEGORIES_PATH,
  MARKETPLACE_CATEGORY_GROUPS,
  MARKETPLACE_TOPIC_GROUPS,
  resolveRelatedPluginLink,
} from '../src/lib/plugins/marketplace-categories'
import {
  MARKETPLACE_KINDS,
  parseMarketplaceFilters,
} from '../src/lib/plugins/marketplace-filters'

/**
 * 插件市场分类浏览 + 首页/分类页入口（P2-2 / P2-12，2026-11-17）。
 *
 * 行为测试为主：分类 → 市场链接的映射是纯函数，直接断言解析结果，
 * 不用源码文本断言冒充（本仓已知弱点）；结构测试只锁接线（页文件存在、
 * 服务端渲染、地标与 canonical、空 kind 不给死链），不复述业务逻辑。
 *
 * 零新参数红线：所有 href 只含 kind / q / sort / starred 四个既有参数，
 * 出现 `category=` 即红。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

/** href 的查询参数键集合（只认 ? 后面的部分，不把路径当参数）。 */
function queryKeys(href: string): string[] {
  return [...new URL(href, 'http://localhost').searchParams.keys()]
}

function assertOnlyMarketplaceParams(href: string) {
  for (const key of queryKeys(href)) {
    expect(['kind', 'q', 'sort', 'starred']).toContain(key)
  }
  expect(href).not.toContain('category=')
}

describe('分类着陆页口径：5 种 kind（P2-2）', () => {
  it('5 种 kind 全在组里，标题与 kind 一一对应', () => {
    expect(MARKETPLACE_CATEGORY_GROUPS.map((g) => g.kind).sort()).toEqual(
      [...MARKETPLACE_KINDS].sort(),
    )
    expect(MARKETPLACE_CATEGORY_GROUPS.map((g) => g.title)).toEqual([
      '网站包',
      '工作台预设',
      '主题',
      '搜索引擎包',
      '组合包',
    ])
  })

  it('每组浏览链接解析回自己的 kind，且只用既有参数', () => {
    for (const group of MARKETPLACE_CATEGORY_GROUPS) {
      expect(group.href.startsWith('/marketplace?')).toBe(true)
      const state = parseMarketplaceFilters(new URL(group.href, 'http://localhost').search)
      expect(state.kind).toBe(group.kind)
      expect(state.q).toBe('')
      assertOnlyMarketplaceParams(group.href)
    }
  })

  it('每组都有分类内榜单链接：同 kind + sort=popular（现有 sort 参数）', () => {
    for (const group of MARKETPLACE_CATEGORY_GROUPS) {
      const state = parseMarketplaceFilters(new URL(group.rankingHref, 'http://localhost').search)
      expect(state.kind).toBe(group.kind)
      expect(state.sort).toBe('popular')
      assertOnlyMarketplaceParams(group.rankingHref)
    }
  })

  it('site-pack 也在组里（着陆页按实时总数决定链不链，不在这里偷偷删 kind）', () => {
    const pack = MARKETPLACE_CATEGORY_GROUPS.find((g) => g.kind === 'site-pack')
    expect(pack).toBeDefined()
    expect(pack!.href).toBe('/marketplace?kind=site-pack')
  })
})

describe('按主题与标签浏览（P2-2）', () => {
  it('极客专题复用岛内实测词 q=极客', () => {
    const geek = MARKETPLACE_TOPIC_GROUPS.find((t) => t.id === 'geek')
    expect(geek).toBeDefined()
    const state = parseMarketplaceFilters(new URL(geek!.href, 'http://localhost').search)
    expect(state.q).toBe('极客')
    assertOnlyMarketplaceParams(geek!.href)
  })

  it('七枚标签全部走 q=#tag（岛内 HOT_TAGS 的同款查询）', () => {
    const tags = MARKETPLACE_TOPIC_GROUPS.filter((t) => t.id.startsWith('tag-'))
    expect(tags.map((t) => t.title)).toEqual([
      '#AI',
      '#工作台',
      '#搜索',
      '#生活',
      '#主题',
      '#深色',
      '#组合包',
    ])
    for (const tag of tags) {
      const state = parseMarketplaceFilters(new URL(tag.href, 'http://localhost').search)
      expect(state.q).toBe(tag.title)
      assertOnlyMarketplaceParams(tag.href)
    }
  })

  it('全部主题链接都在 /marketplace 之下，不引入新路由参数', () => {
    for (const topic of MARKETPLACE_TOPIC_GROUPS) {
      expect(topic.href.startsWith('/marketplace?')).toBe(true)
      assertOnlyMarketplaceParams(topic.href)
    }
  })
})

describe('站内分类名 → 相关插件入口（P2-12）', () => {
  it.each([
    ['AI 工具', '#AI', '/marketplace?q=%23AI'],
    ['人工智能', '#AI', '/marketplace?q=%23AI'],
    ['编程语言', '极客', '/marketplace?q=%E6%9E%81%E5%AE%A2'],
    ['开发工具', '极客', '/marketplace?q=%E6%9E%81%E5%AE%A2'],
    ['设计创作', '#主题', '/marketplace?q=%23%E4%B8%BB%E9%A2%98'],
    ['搜索引擎', '搜索引擎包', '/marketplace?kind=search-pack'],
    ['效率办公', '工作台预设', '/marketplace?kind=workspace-preset'],
    ['学习考试', '#学习', '/marketplace?q=%23%E5%AD%A6%E4%B9%A0'],
    ['生活服务', '#生活', '/marketplace?q=%23%E7%94%9F%E6%B4%BB'],
    ['内容创作', '#创作者', '/marketplace?q=%23%E5%88%9B%E4%BD%9C%E8%80%85'],
  ])('%s 映射到「%s」（%s）', (name, label, href) => {
    const link = resolveRelatedPluginLink(name)
    expect(link).not.toBeNull()
    expect(link!.queryLabel).toBe(label)
    expect(link!.href).toBe(href)
    assertOnlyMarketplaceParams(link!.href)
  })

  it.each(['短剧', '影视', '音乐', '小说', '新闻资讯'])(
    '%s 无已验证映射：返回 null，只给通用入口，不造 0 结果搜索页',
    (name) => {
      expect(resolveRelatedPluginLink(name)).toBeNull()
    },
  )

  it('空名 / 空白名返回 null', () => {
    expect(resolveRelatedPluginLink('')).toBeNull()
    expect(resolveRelatedPluginLink('   ')).toBeNull()
  })
})

describe('接线：分类着陆页（P2-2）', () => {
  const page = overlayFile('src/app/marketplace/categories/page.tsx')

  it('着陆页在 /marketplace/categories，是服务端页（无 use client）', () => {
    expect(MARKETPLACE_CATEGORIES_PATH).toBe('/marketplace/categories')
    expect(page).not.toContain("'use client'")
    expect(page).toContain('export default async function MarketplaceCategoriesPage')
  })

  it('自指 canonical + 主内容地标（新 page.tsx 须过 main-landmark 门禁）', () => {
    expect(page).toContain("canonical: MARKETPLACE_CATEGORIES_PATH")
    expect(page).toContain('<Container as="main" id="main-content">')
  })

  it('空 kind 不给死链：总数为 0 时只出「暂无插件」纯文本', () => {
    expect(page).toContain('暂无插件')
    expect(page).toContain('该类型暂无已发布插件')
    // 总数走 /api/plugins?kind=…&limit=1 的 total，不是写死数字
    expect(page).toContain("hubGet<HubPluginsResponse>(`/api/plugins?kind=${kind}&limit=1`, 60)")
    expect(page).toContain('loadKindTotals')
  })

  it('中枢取不到总数时不明示半截数字：注明未知、入口照常可用', () => {
    expect(page).toContain('数量暂时不可用')
    expect(page).toContain('入口照常可用')
  })

  it('页面不引入新参数、不直接复用市场岛（岛是别人的文件，不碰）', () => {
    expect(page).not.toContain('category=')
    expect(page).not.toContain('PluginMarketBoard')
    expect(page).not.toContain('PluginCard')
    expect(page).toContain('MARKETPLACE_CATEGORY_GROUPS')
    expect(page).toContain('MARKETPLACE_TOPIC_GROUPS')
  })
})

describe('接线：首页插件精选区（P2-12）', () => {
  const home = overlayFile('src/app/page.tsx')
  const spotlight = overlayFile('src/components/home-plugin-spotlight.tsx')

  it('首页挂精选区：取 featured、放在 HomeTodayZone 之后、导航内容之前', () => {
    expect(home).toContain('HomePluginSpotlight')
    expect(home).toContain("hubGet<{ items: HubPluginItem[]; total: number }>('/api/plugins?featured=true&sort=featured&limit=6', 60)")
    expect(home).toContain('<HomePluginSpotlight items={featuredRes ? featuredRes.items : null} />')
    const zoneAt = home.indexOf('<HomeTodayZone />')
    const spotAt = home.indexOf('<HomePluginSpotlight')
    const navAt = home.indexOf('<NavigationContent')
    expect(zoneAt).toBeGreaterThan(-1)
    expect(spotAt).toBeGreaterThan(zoneAt)
    expect(navAt).toBeGreaterThan(spotAt)
  })

  it('精选区有两条常驻入口：进入市场 + 按分类浏览', () => {
    expect(spotlight).toContain('href="/marketplace"')
    expect(spotlight).toContain('MARKETPLACE_CATEGORIES_PATH')
    expect(spotlight).toContain('data-testid="home-plugin-spotlight"')
  })

  it('精选最多 6 个、取不到时不编假名：只留入口与如实说明', () => {
    expect(spotlight).toContain('slice(0, 6)')
    expect(spotlight).toContain('精选暂时不可用')
    expect(spotlight).toContain('(items ?? [])')
  })
})

describe('接线：站内分类页相关插件入口（P2-12）', () => {
  const board = overlayFile('src/app/category/[slug]/category-board.tsx')

  it('分类页有相关插件区：映射链接 + 按分类浏览入口，放在站点列表之上', () => {
    expect(board).toContain('data-testid="category-related-plugins"')
    expect(board).toContain('resolveRelatedPluginLink(name)')
    expect(board).toContain('MARKETPLACE_CATEGORIES_PATH')
    expect(board).toContain('relatedPlugin.href')
    expect(board).toContain('relatedPlugin.queryLabel')
    // 在站点列表之前（不是拉到底部才看见的入口）
    expect(board.indexOf('category-related-plugins')).toBeLessThan(
      board.indexOf('id="category-sites-list"'),
    )
  })

  it('页头目录带也有插件市场入口', () => {
    expect(board).toContain('插件市场')
  })
})
