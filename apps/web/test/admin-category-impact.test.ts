/**
 * 停用类目前的影响预览与确认门（分类安全）。
 *
 * 缺陷背景：管理页的「停用」此前是一条无确认的 PATCH —— 点一下就静默执行，
 * 管理员看不到这个动作会让多少子类从导航消失、会不会把分类页变成 404。
 *
 * 这里钉住三件事：
 *   1. 影响文案由纯函数从**服务端事实**换算，404 判定复用 web 侧同一个门槛常量；
 *   2. 确认框要求手抄类目名，输入不一致或取消都不发送 PATCH；
 *   3. 接线顺序：先取 `/impact`，再弹确认，最后才是 `patchEnabled(cat, false)`。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  deactivationPrompt,
  describeDeactivationImpact,
  matchesCategoryName,
  type CategoryImpact,
} from '@/lib/admin-category-impact'
import { MIN_SITES_FOR_CATEGORY_INDEX } from '@/lib/seo/thresholds'

function makeImpact(over: {
  category?: Partial<CategoryImpact['category']>
  childCategories?: number
  descendantCategories?: number
  directSites?: number
  subtreeSites?: number
} = {}): CategoryImpact {
  return {
    category: {
      id: 'cat-1',
      title: '设计资源',
      slug: 'design-resources',
      enabled: true,
      parentId: null,
      anchor: 'cat-1',
      ...over.category,
    },
    childCategories: over.childCategories ?? 3,
    descendantCategories: over.descendantCategories ?? 8,
    directSites: over.directSites ?? 2,
    subtreeSites: over.subtreeSites ?? 40,
  }
}

describe('describeDeactivationImpact：数字与 404 判定', () => {
  it('达标且启用的类目：唯一会 404 的是它自己的分类页', () => {
    const { publicPagesAtRisk, lines } = describeDeactivationImpact(makeImpact())
    expect(publicPagesAtRisk).toBe(1)
    expect(lines.join('\n')).toContain('/category/design-resources 将返回 404')
    expect(lines.join('\n')).toContain(String(MIN_SITES_FOR_CATEGORY_INDEX))
  })

  it('恰好达到门槛也算已发布（与页面侧的 >= 判定一致）', () => {
    const { publicPagesAtRisk } = describeDeactivationImpact(
      makeImpact({ subtreeSites: MIN_SITES_FOR_CATEGORY_INDEX }),
    )
    expect(publicPagesAtRisk).toBe(1)
  })

  it('低于门槛：没有已发布的分类页，不制造新的 404', () => {
    const { publicPagesAtRisk, lines } = describeDeactivationImpact(
      makeImpact({ subtreeSites: MIN_SITES_FOR_CATEGORY_INDEX - 1 }),
    )
    expect(publicPagesAtRisk).toBe(0)
    expect(lines.join('\n')).toContain('低于收录门槛')
    expect(lines.join('\n')).toContain('不会产生新的 404')
  })

  it('兜底类目「未分类」本来就没有公开页，再大的树也不算 404', () => {
    const { publicPagesAtRisk, lines } = describeDeactivationImpact(
      makeImpact({
        category: { id: 'cat-uncategorized', title: '未分类', slug: 'uncategorized' },
        subtreeSites: 9999,
      }),
    )
    expect(publicPagesAtRisk).toBe(0)
    expect(lines.join('\n')).toContain('兜底类目')
  })

  it('slug 缺失时 URL 退回 id，不能显示 /category/null', () => {
    const { lines } = describeDeactivationImpact(makeImpact({ category: { slug: null } }))
    const text = lines.join('\n')
    expect(text).toContain('/category/cat-1')
    expect(text).not.toContain('null')
  })

  it('已经停用的类目不会「再 404 一次」', () => {
    const { publicPagesAtRisk, lines } = describeDeactivationImpact(
      makeImpact({ category: { enabled: false } }),
    )
    expect(publicPagesAtRisk).toBe(0)
    expect(lines.join('\n')).toContain('当前已停用')
  })

  it('影响面包含子类与站点两类数字，且说明站点详情不会 404', () => {
    const text = describeDeactivationImpact(makeImpact({ childCategories: 4, directSites: 6, subtreeSites: 40 }))
      .lines.join('\n')
    expect(text).toContain('4 个直接子类目')
    expect(text).toContain('直属 6 个')
    expect(text).toContain('子树合计 40 个')
    expect(text).toContain('站点详情页与搜索仍可直达（不会 404）')
  })
})

describe('确认门：文案与名字核对', () => {
  it('确认框列出全部影响，并要求输入类目名', () => {
    const prompt = deactivationPrompt(makeImpact())
    expect(prompt).toContain('即将停用类目「设计资源」')
    expect(prompt).toContain('不会删除任何数据，可随时重新启用')
    expect(prompt).toContain('确认请输入类目名「设计资源」')
    // 影响行的前缀（· 类目 / · 站点 / · 对外 URL）一条都不能少
    expect(prompt).toContain('· 类目：')
    expect(prompt).toContain('· 站点：')
    expect(prompt).toContain('· 对外 URL：')
  })

  it('名字必须一致（忽略首尾空白），否则视为取消', () => {
    const impact = makeImpact()
    expect(matchesCategoryName('设计资源', impact)).toBe(true)
    expect(matchesCategoryName('  设计资源  ', impact)).toBe(true)
    expect(matchesCategoryName('设计', impact)).toBe(false)
    expect(matchesCategoryName('', impact)).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * 接线守则（语法由 tsc / build 兜底）
 * ------------------------------------------------------------------ */

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
const readSrc = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('接线：先预览影响，再确认，最后才停用', () => {
  it('管理页停用路径按 impact → prompt → PATCH 的顺序接线', () => {
    const src = readSrc('src/app/admin/categories/page.tsx')
    const impactAt = src.indexOf("'/impact'")
    const promptAt = src.indexOf('deactivationPrompt(impact)')
    const patchAt = src.indexOf('patchEnabled(cat, false')
    expect(impactAt).toBeGreaterThan(-1)
    expect(promptAt).toBeGreaterThan(impactAt)
    expect(patchAt).toBeGreaterThan(promptAt)
  })

  it('取消或名字不一致时不发送停用请求', () => {
    const src = readSrc('src/app/admin/categories/page.tsx')
    expect(src).toContain('if (typed === null) return')
    expect(src).toContain('if (!matchesCategoryName(typed, impact))')
    expect(src).toContain('已取消停用')
  })

  it('写完后的 reload 绕过 60s 浏览器缓存（否则行状态会晚 60 秒才变）', () => {
    const src = readSrc('src/app/admin/categories/page.tsx')
    expect(src).toContain("'/api/categories?ts=' + Date.now()")
  })

  it('影响面换算复用同一份收录门槛常量，不手抄数字', () => {
    const src = readSrc('src/lib/admin-category-impact.ts')
    expect(src).toContain("from './seo/thresholds'")
    expect(src).toContain('MIN_SITES_FOR_CATEGORY_INDEX')
    expect(src).not.toMatch(/subtreeSites\s*>=\s*\d/)
  })

  it('中枢影响面端点存在且只返回事实（子树 + 直接 + 站点计数）', () => {
    const src = readSrc('../api/src/routes/categories.ts')
    expect(src).toContain('"/api/categories/:id/impact"')
    expect(src).toContain('ctx.repo.listCategories()')
    expect(src).toContain('ctx.repo.categorySiteCounts()')
    for (const field of ['childCategories', 'descendantCategories', 'directSites', 'subtreeSites']) {
      expect(src, field).toContain(field)
    }
  })
})
