/**
 * 升级第 3 条：首页分类区标题点开分类页。
 *
 * 旧行为：`<h2 onClick={toggleCollapseCategory}>`，点标题只折叠/展开，
 * 首页正文里没有任何路去分类页。
 * 新行为：标题文字是一条站内链接 `<Link href={categoryHref(category)}>`，
 * 折叠/展开只由标题旁独立的 chevron 按钮做（`aria-expanded` + `aria-controls`）。
 *
 * 诚实边界（不在源码里撒谎链）：
 * - 自建分类只活在本机，中枢没有它的分类页，链过去必 404——标题保持纯文本；
 * - 聚合 < MIN_SITES_FOR_CATEGORY_INDEX 站的分类页本身 404（`[slug]/page.tsx`），
 *   链过去也是死链——标题保持纯文本。当前导航树里 14 个一级分类全部 ≥ 5 站，
 *   所以当前数据下每个内置标题都链（本文件对 navigation.json 逐项断言）。
 *
 * 已知局限：
 * - chevron 的 `aria-controls` 指向内容区 id，内容区只在展开时渲染——折叠态下
 *   该 id 暂时不在 DOM 里（与条件渲染的 disclosure 常见做法一致，未改成常驻
 *   hidden 容器，避免折叠时仍挂载子分类 tab 轨与卡片）。
 * - 门槛信号用首屏树计数（`countCategorySites`）；中枢 active 计数是分类页
 *   404 的最终权威，两者分叉时以中枢为准，死链巡检负责收敛。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countCategorySites } from '../src/lib/modular/category-counts'
import { categoryHref } from '../src/lib/seo/category-url'
import { MIN_SITES_FOR_CATEGORY_INDEX } from '../src/lib/seo/thresholds'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 同时支持从 apps/web-overlay/test 与 apps/web/test（镜像副本）运行 */
function overlayFile(rel: string): string {
  const candidates = [
    resolve(HERE, '..', rel),
    resolve(HERE, '..', '..', 'web-overlay', rel),
  ]
  const hit = candidates.find((p) => existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

function loadJson(rel: string): Record<string, unknown> {
  return JSON.parse(overlayFile(rel)) as Record<string, unknown>
}

const SECTION = overlayFile('src/components/navigation-category-section.tsx')

/** 取出 <h2>…</h2> 整段（标题行，含标题链接与徽标） */
function h2Block(src: string): string {
  const start = src.indexOf('<h2')
  const end = src.indexOf('</h2>', start)
  if (start === -1 || end === -1) throw new Error('找不到 <h2> 标题块')
  return src.slice(start, end)
}

describe('升级第 3 条：分类区标题链到分类页', () => {
  it('标题不再是折叠开关：h2 上没有任何 onClick / toggle 行为', () => {
    const h2 = h2Block(SECTION)
    expect(h2).not.toContain('onClick')
    expect(h2).not.toContain('toggleCollapseCategory')
    // “点击展开/折叠”的说法只留在 h2 之外（收起态的文字按钮仍是折叠开关），标题上不再有
    expect(h2).not.toContain('点击展开')
    expect(h2).not.toContain('点击折叠')
  })

  it('标题文字包在站内 Link 里，href 走 categoryHref（有 slug 用 slug，没有退回 id）', () => {
    expect(SECTION).toContain("import { categoryHref } from '@/lib/seo/category-url'")
    const h2 = h2Block(SECTION)
    expect(h2).toContain('<Link')
    expect(h2).toContain('href={categoryHref(category)}')
    // 链接里只有标题文字，不许把按钮/徽标包进链接（<a> 套 <button> 是可达性错误）
    const linkStart = h2.indexOf('<Link')
    const linkEnd = h2.indexOf('</Link>', linkStart)
    const linkInner = h2.slice(linkStart, linkEnd)
    expect(linkInner).not.toContain('<button')
    expect(linkInner).toContain('{category.title}')
  })

  it('切换门槛：自建分类与 < 5 站分类标题保持纯文本，不链向必 404 的页', () => {
    expect(SECTION).toContain('canVisitCategoryPage')
    expect(SECTION).toMatch(/!isCustom\s*&&\s*totalCount\s*>=\s*MIN_SITES_FOR_CATEGORY_INDEX/)
    expect(SECTION).toContain('const categoryContentId = `${category.id}-content`')
  })

  it('当前导航树里每个一级分类都 ≥ 门槛，所以每个内置标题都链', () => {
    const raw = loadJson('src/navsphere/content/navigation.json')
    const items = raw.navigationItems as Array<Record<string, unknown>>
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      const count = countCategorySites(
        item as unknown as Parameters<typeof countCategorySites>[0],
      )
      expect(count, `一级分类 ${item.id} 只有 ${count} 站，低于分类页门槛`).toBeGreaterThanOrEqual(
        MIN_SITES_FOR_CATEGORY_INDEX,
      )
    }
  })

  it('categoryHref 兜底：无 slug 时退回 id，分类页按 id ∪ slug 匹配都能接住', () => {
    expect(categoryHref({ id: 'reg-ai-tools' })).toBe('/category/reg-ai-tools')
    expect(categoryHref({ id: 'reg-ai-tools', slug: 'ai-tools' })).toBe('/category/ai-tools')
  })

  it('chevron 按钮只折叠不导航：aria-expanded + aria-controls，onClick 只有折叠', () => {
    // 按钮上带 aria-controls，指向展开时才渲染的内容区 id
    expect(SECTION).toContain('aria-expanded={!isCollapsed}')
    expect(SECTION).toContain('aria-controls={categoryContentId}')
    expect(SECTION).toContain('id={categoryContentId}')
    // chevron 按钮的 onClick 仍是折叠切换，且同一按钮内没有任何导航（href/router）
    const btnStart = SECTION.indexOf('手风琴折叠展开按钮')
    const btnEnd = SECTION.indexOf('</button>', btnStart)
    const btn = SECTION.slice(btnStart, btnEnd)
    expect(btn).toContain('toggleCollapseCategory(category.id)')
    expect(btn).not.toContain('href')
    expect(btn).not.toContain('router')
    // 标题旁仍有独立的折叠开关（收起状态下的文字按钮也不动）
    expect(SECTION).toContain('已收起 (点击展开)')
  })

  it('锚点直达与复制直达链接按钮、/graph 入口都不动', () => {
    expect(SECTION).toContain("window.location.hash === `#${category.id}`")
    expect(SECTION).toContain('handleCopyCategoryLink')
    expect(SECTION).toContain('复制分类直达链接')
    expect(SECTION).toContain("href={`/graph?category=${encodeURIComponent(category.id)}`}")
  })
})
