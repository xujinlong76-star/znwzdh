import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { categoryDisplayName, type HubCategory } from '../src/lib/server/categories'

/**
 * 分类 hub 的结构锁（2026-10-21，2026-10-22 补 slug 路由与新树层级口径）。
 *
 * 分类页最容易悄悄退化的六件事：
 * 1. 又变回客户端取数（标题链接不进 SSR HTML，孤岛问题复发）；
 * 2. 薄分类（聚合后 <12 站）不再 404，变成批量 noindex 空页；
 * 3. 页 ≥2 的 canonical 回指第 1 页（后续页站点永远不被单独收录）；
 * 4. sitemap 把未达标分类也提交（等于主动送死链）；
 * 5. URL 退回 uuid 形态，或把 `/category/{uuid}` 的老外链直接判 404；
 * 6. 计数退回「单个类目自身」——站点只挂叶子，一级根会变 0 站并从导航里消失。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayFile(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const ROUTE = 'src/app/category/[slug]/page.tsx'
/** 主体视图与取数（2026-10-22 从 page.tsx 拆出，第 1 页与 p/{n} 共用） */
const BOARD = 'src/app/category/[slug]/category-board.tsx'
/** 第 2 页起：路径段分页，noindex,follow + canonical 自指 */
const PAGE_N = 'src/app/category/[slug]/p/[n]/page.tsx'

describe('分类页结构', () => {
  it('详情页是服务端页面：安全解码 + 真 404 + SSR 站点内链', () => {
    const page = overlayFile(ROUTE)
    const board = overlayFile(BOARD)
    expect(page).not.toContain("'use client'")
    expect(board).not.toContain("'use client'")
    expect(page).toContain('safeDecodeParam')
    expect(page).toContain('notFound()')
    // 站点内链在主体视图里渲染（page.tsx 只是壳）
    expect(board).toContain('/site/${encodeURIComponent(site.id)}')
  })

  it('H1 只渲染分类名，不再硬拼「工具」后缀', () => {
    // 「AI 工具」这类本身以“工具”结尾的类目会被拼成「AI 工具工具」；
    // 后缀交给 <title>，H1 用规范名。
    const board = overlayFile(BOARD)
    expect(board).not.toContain('{name}工具')
    expect(board).toMatch(/<h1[^>]*>\s*\{name\}\s*<\/h1>/)
  })

  it('URL 标识是 slug，老 uuid 链接 301 而不是 404', () => {
    const page = overlayFile(ROUTE)
    expect(page).toContain('params: Promise<{ slug: string }>')
    expect(page).toContain('categoryPageUrlKey')
    expect(page).toContain('isCategoryUuidRef(safeRef)')
    expect(page).toMatch(/permanentRedirect\(categoryHref\(urlKey, 1\)\)/)
    // 规范 key 的派生只在 category-board 的 categoryPageUrlKey 里做一次
    expect(overlayFile(BOARD)).toContain('categoryUrlKey')
  })

  it('构建期只预渲染「有 slug、未停用、达标、非未分类」的类目', () => {
    const src = overlayFile(ROUTE)
    expect(src).toContain('export async function generateStaticParams()')
    expect(src).toMatch(/Boolean\(c\.slug\)/)
    expect(src).toMatch(/!isHiddenCategory\(c\)/)
    expect(src).toMatch(/\(counts\.get\(c\.id\) \?\? 0\) >= MIN_SITES_FOR_CATEGORY_INDEX/)
  })

  it('薄分类 404，而不是生成 noindex 空页', () => {
    // 达标判定在 loadCategoryPage（category-board），页面只消费 qualifies
    const board = overlayFile(BOARD)
    expect(board).toContain('MIN_SITES_FOR_CATEGORY_INDEX')
    expect(board).toMatch(/sites\.length\s*>=\s*MIN_SITES_FOR_CATEGORY_INDEX\s*\|\|\s*Boolean\(res\?\.hasMore\)/)
    expect(overlayFile(ROUTE)).toMatch(/!data\.category\s*\|\|\s*!data\.qualifies/)
  })

  it('页 ≥2 自指 canonical + noindex,follow；页 1 输出 ItemList', () => {
    const page = overlayFile(ROUTE)
    const board = overlayFile(BOARD)
    const pageN = overlayFile(PAGE_N)
    expect(page).toContain('canonical')
    // 第 2 页起由 p/{n} 承担：自指 canonical + noindex,follow（降级时保持可索引）
    expect(pageN).toContain('alternates: { canonical }')
    expect(pageN).toContain('robots: { index: false, follow: true }')
    // 第 1 页输出 ItemList；分页页只保留列表与页码
    expect(board).toContain('itemListLd')
    expect(board).toMatch(/indexable\s*=\s*requested\s*===\s*1/)
  })

  it('分页查询只取 active 站点，避免 broken 占 offset 名额导致漏站/误判', () => {
    const src = overlayFile('src/lib/server/categories.ts')
    expect(src).toContain('/api/search?q=&status=active&categoryId=')
  })

  it('分类总览只链接达标分类，且不把「未分类」当入口', () => {
    const src = overlayFile('src/app/category/page.tsx')
    expect(src).toContain('MIN_SITES_FOR_CATEGORY_INDEX')
    // 2026-10-22：总览页改成「一级分组 + 子分类」后，判定变量从 count 变成
    // rootCount（根按子树聚合计数），子分类另有 l.count 判定，两处都要钉住。
    expect(src).toMatch(/rootCount\s*<\s*MIN_SITES_FOR_CATEGORY_INDEX/)
    expect(src).toMatch(/l\.count\s*>=\s*MIN_SITES_FOR_CATEGORY_INDEX/)
    // 未分类判定：改名后变量是 root（一级根遍历），语义不变
    expect(src).toContain('isHiddenCategory(root)')
    expect(src).toContain("alternates: { canonical: '/category' }")
  })

  it('sitemap 接入达标分类条目', () => {
    const src = overlayFile('src/app/sitemap.ts')
    expect(src).toContain('categoryEntries')
    expect(src).toContain('countCategorySites')
    expect(src).toContain('/api/categories')
  })

  it('计数口径是后代聚合：一级根不因「自身 0 站」整层消失', () => {
    // 站点只挂叶子（方案 G2），/api/categories/counts 又是单类目 GROUP BY，
    // 任何一处退回原始 counts，那一处的一级根就恒为 0 → 页面 404 / 条目被过滤。
    for (const rel of [
      'src/app/category/page.tsx',
      'src/app/category/[slug]/page.tsx',
      'src/app/category/[slug]/category-board.tsx',
      'src/app/site/[id]/page.tsx',
      'src/app/sitemap.ts',
      'src/app/category/[slug]/opengraph-image.tsx',
    ]) {
      expect(overlayFile(rel), rel).toContain('descendantSiteCounts')
    }
  })

  it('链接生成与 404 判定同频：计数 TTL 不得长于详情页的 active 搜索', () => {
    // 详情页按 60s 的 active 搜索结果判「<12 即 404」。入口侧若用 3600s 计数，
    // 健康巡检把站点标 broken 后，入口会继续链向已 404 的页面最长 1 小时。
    for (const rel of [
      'src/app/page.tsx',
      'src/app/category/page.tsx',
      'src/app/category/[slug]/category-board.tsx',
      'src/app/site/[id]/page.tsx',
    ]) {
      expect(overlayFile(rel), rel).toContain('loadActiveCategoryCounts(60)')
    }
    const index = overlayFile('src/app/category/page.tsx')
    expect(index).toContain('export const revalidate = 300')

    // sitemap 的站点列表同时决定站点 URL 与类目计数，必须与路由缓存一起缩短
    const sitemap = overlayFile('src/app/sitemap.ts')
    expect(sitemap).toContain('export const revalidate = 300')
    expect(sitemap).toMatch(/status=active&limit=\$\{SITE_LIMIT\}&offset=0`,\s*300,/)
  })

  it('根页列子分类（不是站点）：面包屑带父级 + ItemList 指向 /category/{slug}', () => {
    const src = overlayFile(BOARD)
    expect(src).toContain('isRootPage')
    // 父级靠 parent_id 找：库里还有同名分类，按标题找会认错爹
    expect(src).toMatch(/c\.id === category\.parentId/)
    expect(src).toContain('categoryItemListLd')
    expect(src).toMatch(/isRootPage\s*&&\s*related\.length\s*>\s*0\s*\?/)
    expect(src).toMatch(/<JsonLd\s+data=\{categoryItemListLd/)
    expect(overlayFile('src/lib/seo/json-ld.ts')).toContain('/category/${encodeURIComponent(c.slug)}')
  })
})

describe('categoryDisplayName', () => {
  const cats: HubCategory[] = [
    { id: 'a', title: '语言', parentId: 'p1' },
    { id: 'b', title: '语言', parentId: 'p2' },
    { id: 'p1', title: '编程' },
    { id: 'p2', title: '自然语言' },
    { id: 'c', title: '设计' },
  ]

  it('同名分类用「父 · 子」消歧', () => {
    expect(categoryDisplayName(cats[0]!, cats)).toBe('编程 · 语言')
    expect(categoryDisplayName(cats[1]!, cats)).toBe('自然语言 · 语言')
  })

  it('不同名分类保持原样', () => {
    expect(categoryDisplayName(cats[4]!, cats)).toBe('设计')
  })
})
