import { describe, expect, it } from 'vitest'
import {
  applyMetaEdits,
  computeManifestDiff,
  extractManifestUrls,
} from '../src/lib/plugins/studio-derived'
import type { PluginManifest } from '../src/lib/plugins/plugin-manifest'

/**
 * AI 插件工坊派生逻辑（A3.2）：语义必须与弹窗内原实现逐字等价——
 * 这批单测是从 1719 行组件里"原样搬运"时的行为锚点。
 */

function sitePack(sites: Array<{ title: string; url: string; category?: string }>, extra?: Partial<PluginManifest>): PluginManifest {
  return {
    name: '测试包',
    kind: 'site-pack',
    version: '1.0.0',
    payload: { sites },
    ...extra,
  } as PluginManifest
}

function searchPack(engines: Array<{ prefix: string; searchUrl: string }>): PluginManifest {
  return {
    name: '搜索包',
    kind: 'search-pack',
    version: '1.0.0',
    payload: { engines },
  } as PluginManifest
}

describe('computeManifestDiff', () => {
  it('任一侧为 null 时返回 null（无 diff 可言）', () => {
    expect(computeManifestDiff(null, sitePack([]))).toBeNull()
    expect(computeManifestDiff(sitePack([]), null)).toBeNull()
  })

  it('站点增删按 URL 归一化（trim + 大小写不敏感）判定', () => {
    const prev = sitePack([
      { title: 'A', url: 'https://A.example.com' },
      { title: 'B', url: 'https://b.example.com ' },
    ])
    const curr = sitePack([
      // 同 URL 但大小写/空白不同 → 视为同站点，不算新增
      { title: 'A2', url: ' https://a.example.com' },
      { title: 'C', url: 'https://c.example.com' },
    ])
    const diff = computeManifestDiff(prev, curr)!
    expect(diff.addedSites.map((s) => s.url)).toEqual(['https://c.example.com'])
    expect(diff.removedSites.map((s) => s.url)).toEqual(['https://b.example.com '])
    expect(diff.hasChanges).toBe(true)
  })

  it('search-pack 引擎按 prefix 判定增删；site-pack 字段不参与', () => {
    const prev = searchPack([
      { prefix: '!gh', searchUrl: 'https://gh.example.com/{q}' },
      { prefix: '!so', searchUrl: 'https://so.example.com/{q}' },
    ])
    const curr = searchPack([{ prefix: '!gh', searchUrl: 'https://gh.example.com/{q}' }, { prefix: '!npm', searchUrl: 'https://npm.example.com/{q}' }])
    const diff = computeManifestDiff(prev, curr)!
    expect(diff.addedEngines.map((e) => e.prefix)).toEqual(['!npm'])
    expect(diff.removedEngines.map((e) => e.prefix)).toEqual(['!so'])
    expect(diff.hasChanges).toBe(true)
  })

  it('版本与名称变更入 diff；全无变更时 hasChanges=false', () => {
    const prev = sitePack([{ title: 'A', url: 'https://a.example.com' }], { version: '1.0.0', name: 'X' })
    const same = sitePack([{ title: 'A', url: 'https://a.example.com' }], { version: '1.0.0', name: 'X' })
    expect(computeManifestDiff(prev, same)!.hasChanges).toBe(false)

    const bumped = sitePack([{ title: 'A', url: 'https://a.example.com' }], { version: '1.1.0', name: 'Y' })
    const diff = computeManifestDiff(prev, bumped)!
    expect(diff.versionChange).toEqual({ from: '1.0.0', to: '1.1.0' })
    expect(diff.nameChange).toEqual({ from: 'X', to: 'Y' })
  })

  it('标签按集合差集计算', () => {
    const prev = sitePack([], { tags: ['dev', 'ai'] })
    const curr = sitePack([], { tags: ['ai', 'tools'] })
    const diff = computeManifestDiff(prev, curr)!
    expect(diff.addedTags).toEqual(['tools'])
    expect(diff.removedTags).toEqual(['dev'])
  })
})

describe('extractManifestUrls', () => {
  it('site-pack 提取站点 URL 并去重', () => {
    const m = sitePack([
      { title: 'A', url: 'https://a.example.com' },
      { title: 'B', url: 'https://a.example.com' },
      { title: 'C', url: 'https://c.example.com' },
    ])
    expect(extractManifestUrls(m)).toEqual(['https://a.example.com', 'https://c.example.com'])
  })

  it('search-pack 把 {q} 替换为测试词后提取', () => {
    const m = searchPack([{ prefix: '!gh', searchUrl: 'https://gh.example.com/search?q={q}&x=1' }])
    expect(extractManifestUrls(m)).toEqual(['https://gh.example.com/search?q=navhub&x=1'])
  })

  it('封顶 30 条（与服务端单次上限对齐）', () => {
    const sites = Array.from({ length: 40 }, (_, i) => ({ title: `s${i}`, url: `https://s${i}.example.com` }))
    expect(extractManifestUrls(sitePack(sites))).toHaveLength(30)
  })

  it('null 清单与非 site-pack/search-pack 类型返回空数组', () => {
    expect(extractManifestUrls(null)).toEqual([])
    const theme = { name: 't', kind: 'theme', version: '1.0.0', payload: {} } as unknown as PluginManifest
    expect(extractManifestUrls(theme)).toEqual([])
  })
})

describe('applyMetaEdits', () => {
  const base = sitePack([{ title: 'A', url: 'https://a.example.com' }], { name: '原包', author: '原作者', version: '1.0.0', tags: ['dev'] })

  it('标签按中英文逗号与空白切分，空片段丢弃', () => {
    const out = applyMetaEdits(base, { name: '新包', description: 'd', author: 'a', version: '2.0.0', tags: ' dev，, AI 工具  ,,' })
    expect(out.tags).toEqual(['dev', 'AI', '工具'])
  })

  it('name/author/version 空串回落原值；description 允许显式清空', () => {
    const out = applyMetaEdits(base, { name: '  ', description: '', author: '', version: '' , tags: '' })
    expect(out.name).toBe('原包')
    expect(out.author).toBe('原作者')
    expect(out.version).toBe('1.0.0')
    expect(out.description).toBe('')
    expect(out.tags).toEqual([])
  })

  it('不改动 payload（站点清单保持原样）', () => {
    const out = applyMetaEdits(base, { name: '新', description: 'd', author: 'a', version: '2.0.0', tags: '' })
    expect(out.payload).toEqual(base.payload)
  })
})
