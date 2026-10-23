import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * SEO 不变式：守住三条容易被静默破坏的规则。
 *
 * 1. 私密页必须页面级 noindex —— 光靠 robots.txt 的 Disallow 不够：爬虫被挡住
 *    就永远读不到 noindex，已进索引的 URL 删不掉。
 * 2. Disallow 与 noindex 的**分工**要保持一致：已允许抓取的私密页不能再被
 *    Disallow，否则第 1 条形同虚设。
 * 3. sitemap 里的站点必须带 status=active —— 不带会返回 1020 条（含 7 条
 *    broken），等于主动提交软 404。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

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

function appFile(rel: string): string {
  const full = join(ROOT, 'src', 'app', ...rel.split('/'))
  return existsSync(full) ? readFileSync(full, 'utf8') : ''
}

/** 页面级 noindex：这些页面刻意**不**写进 robots.txt 的 Disallow，让爬虫能读到指令 */
const NOINDEX_ROUTES = [
  'favorites/layout.tsx',
  'preferences/layout.tsx',
  'marketplace/mine/layout.tsx',
  'marketplace/publish/layout.tsx',
  'marketplace/installed/layout.tsx',
  'marketplace/import/layout.tsx',
  'auth/signin/layout.tsx',
  'custom/page.tsx',
  'import/page.tsx',
  'offline/page.tsx',
  'videos/player/page.tsx',
]

/** 由 robots.txt Disallow 兜底的路径（无站内入口、无需 noindex） */
const DISALLOW_ONLY = ['/admin', '/api/', '/s/']

describe('私密页索引隔离', () => {
  it.each(NOINDEX_ROUTES)('%s 必须声明页面级 noindex', (rel) => {
    expect(appFile(rel)).toContain('index: false')
  })

  it('robots.ts 的 disallow 覆盖后台 / API / 短链 / 工具页', () => {
    const robots = appFile('robots.ts')
    for (const path of DISALLOW_ONLY) {
      expect(robots).toContain(`'${path}'`)
    }
  })

  it('已被 noindex 的私密页不应再被 Disallow（否则指令读不到）', () => {
    const robots = appFile('robots.ts')
    for (const path of ['/favorites', '/preferences', '/marketplace/mine']) {
      expect(robots).not.toContain(`'${path}'`)
    }
  })

  it('robots.ts 不再输出 Yandex 私有的 Host 指令', () => {
    expect(appFile('robots.ts')).not.toContain('Host:')
  })
})

describe('隐藏类目（未分类）', () => {
  it('分类详情页与深分页都把隐藏类目当 404', () => {
    for (const rel of ['category/[slug]/page.tsx', 'category/[slug]/p/[n]/page.tsx']) {
      expect(appFile(rel)).toContain('isHiddenCategory(data.category)')
    }
  })

  it('站点详情不链接隐藏类目（避免详情页 → 404 类目页）', () => {
    const src = readFileSync(join(ROOT, 'src', 'app', 'site', '[id]', 'page.tsx'), 'utf8')
    expect(src).toContain('!isHiddenCategory(c)')
  })
})

describe('sitemap 取数约束', () => {
  it('站点条目必须带 status=active（否则会混入 broken 站点）', () => {
    expect(appFile('sitemap.ts')).toContain('status=active')
  })

  it('标签条目走阈值过滤，不提交薄标签', () => {
    const sitemap = appFile('sitemap.ts')
    // 阈值已按权威树分档：标签用 MIN_SITES_FOR_TAG_INDEX，分类用 MIN_SITES_FOR_CATEGORY_INDEX。
    // 这里钉标签那一路，避免有人为了「sitemap 好看」把它并回分类口径或写死数字。
    expect(sitemap).toContain('MIN_SITES_FOR_TAG_INDEX')
    expect(sitemap).toContain('tagEntries')
  })
})
