import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  filterPublicPageItems,
  isValidPublicPageSlug,
  normalizePublicPageSlugInput,
  publicPageUrl,
  slugifyPublicPageTitle,
  PUBLIC_PAGE_MAX_ITEMS,
} from '../src/lib/public-pages'

/**
 * 公开导航页（Batch 3 第 6 项）的纯函数测试。
 *
 * 钉住三处跨层口径，改一处就要改另一处：
 * - slug 校验与中枢 SLUG_PATTERN 同口径（见 apps/api/src/routes/public-pages.ts）；
 * - 标题 slug 化与中枢 slugifyPublicPageTitle 同口径；
 * - 条目过滤与中枢 resolvePublicPageItems 同口径：只留仍存在且 active 的站。
 */
describe('isValidPublicPageSlug', () => {
  it('接受小写字母/数字/连字符的 slug', () => {
    expect(isValidPublicPageSlug('my-tools')).toBe(true)
    expect(isValidPublicPageSlug('nav-2026')).toBe(true)
    expect(isValidPublicPageSlug('a1')).toBe(true)
  })

  it('拒绝大写、空格、下划线、开头连字符与单字符', () => {
    expect(isValidPublicPageSlug('My-Tools')).toBe(false)
    expect(isValidPublicPageSlug('my tools')).toBe(false)
    expect(isValidPublicPageSlug('my_tools')).toBe(false)
    expect(isValidPublicPageSlug('-my-tools')).toBe(false)
    expect(isValidPublicPageSlug('a')).toBe(false)
    expect(isValidPublicPageSlug('')).toBe(false)
  })
})

describe('normalizePublicPageSlugInput', () => {
  it('去空格转小写；非法字符留给校验报错，不静默改写', () => {
    expect(normalizePublicPageSlugInput('  My-Tools  ')).toBe('my-tools')
    expect(normalizePublicPageSlugInput('UPPER CASE!')).toBe('upper case!')
  })
})

describe('slugifyPublicPageTitle', () => {
  it('英文标题转连字符 slug', () => {
    expect(slugifyPublicPageTitle('My Design Tools!')).toBe('my-design-tools')
  })

  it('中文标题 slug 化为空时兜底 nav，不把中文塞进 slug', () => {
    expect(slugifyPublicPageTitle('设计师工具箱')).toBe('nav')
    expect(slugifyPublicPageTitle('!!!')).toBe('nav')
  })

  it('超长截断到 32 字符', () => {
    expect(slugifyPublicPageTitle('a'.repeat(50)).length).toBe(32)
  })
})

describe('publicPageUrl', () => {
  it('拼出 /pub/ 链接', () => {
    expect(publicPageUrl('my-tools', 'https://example.com')).toBe('https://example.com/pub/my-tools')
  })
})

describe('filterPublicPageItems', () => {
  it('只留仍存在且 active 的站：broken/停用/已删都不进公开页', () => {
    const items = [
      { site: { enabled: true, status: 'active' } },
      { site: { enabled: true, status: 'broken' } },
      { site: { enabled: false, status: 'active' } },
      { site: null },
    ]
    expect(filterPublicPageItems(items)).toEqual([items[0]])
  })
})

describe('PUBLIC_PAGE_MAX_ITEMS', () => {
  it('上限 100 条，与中枢同口径', () => {
    expect(PUBLIC_PAGE_MAX_ITEMS).toBe(100)
  })
})

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.includes('web-overlay') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8').replace(/\r\n/g, '\n')
}

describe('公开页绝不渲染私人备注（回归锁）', () => {
  it('公开页组件里绝无备注渲染：没有 item.note，也没有“备注：”文案', () => {
    const page = overlaySource('src/app/pub/[slug]/page.tsx')
    expect(page).not.toContain('item.note')
    expect(page).not.toContain('备注：')
  })

  it('公开条目类型里绝无 note 字段：PublicPageItem 只有站点的公开字段', () => {
    const lib = overlaySource('src/lib/public-pages.ts')
    const start = lib.indexOf('export interface PublicPageItem')
    expect(start).toBeGreaterThan(-1)
    const block = lib.slice(start, lib.indexOf('}', start))
    expect(block).not.toContain('note')
  })
})
