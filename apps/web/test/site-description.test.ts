import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  SITE_DESCRIPTION_MAX,
  siteMetaDescription,
} from '../src/lib/seo/site-description'

const site = (overrides: Partial<{ title: string; description: string | null; tags: string[] }> = {}) => ({
  title: 'Google Fonts',
  description: null,
  tags: ['字体', '设计', '开源'],
  ...overrides,
})

describe('siteMetaDescription', () => {
  it('够长的真实描述原样使用，超长截到 160', () => {
    const raw = 'Google Fonts 提供 1600 多种开源字体，可按语言、字重与风格筛选，支持在线预览并直接下载字体文件。'
    expect(siteMetaDescription(site({ description: raw }), '设计资源')).toBe(raw)
    expect(siteMetaDescription(site({ description: '长'.repeat(200) }), null)).toHaveLength(
      SITE_DESCRIPTION_MAX,
    )
  })

  it('少于 20 字时用站点名/分类/标签兜底，不编造评分与排名', () => {
    const description = siteMetaDescription(site({ description: '免费字体' }), '设计资源')
    expect(description).toContain('Google Fonts')
    expect(description).toContain('设计资源')
    expect(description).toContain('字体、设计、开源')
    expect(description.length).toBeGreaterThanOrEqual(20)
    expect(description.length).toBeLessThanOrEqual(SITE_DESCRIPTION_MAX)
    expect(description).not.toMatch(/最好|最佳|最强|必备|第一|排名|评分|aggregateRating/)
  })

  it('分类缺失时退回「导航」，无标签时不拼接空标签段', () => {
    const description = siteMetaDescription(
      site({ title: '示例站点', description: '   ', tags: [] }),
      null,
    )
    expect(description).toContain('收录于导航分类')
    expect(description).not.toContain('相关标签')
  })
})

describe('短描述治理入口', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

  it('站点详情 metadata 走兜底 helper', () => {
    const page = read('../src/app/site/[id]/page.tsx')
    expect(page).toContain('siteMetaDescription(site, categoryName)')
    expect(page).toContain('SITE_DESCRIPTION_MIN')
  })

  it('后台新增/编辑站点提供 160 字上限与「待补全」提示', () => {
    const admin = read('../src/app/admin/sitelist/page.tsx')
    expect(admin.match(/maxLength=\{160\}/g)).toHaveLength(2)
    expect(admin.match(/待补全/g)).toHaveLength(4)
    expect(admin).toContain('description: newSite.description.trim().slice(0, 160)')
    expect(admin).toContain('description: editSite.description.trim().slice(0, 160)')
  })
})
