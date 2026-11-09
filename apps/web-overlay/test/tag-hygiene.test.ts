/**
 * 卡片标签治理守卫（2026-11-09）。
 *
 * 背景：/api/home/navigation 实测 4,839 站点里，一级分类名被当成标签注入
 * （消费生活 273、公共服务 258……），slug 化子类名复读（#组件与-ui-体系、
 * #wasm-与-rust），以及 157 处跨类误打的 `ai赋能`。这些占据每张卡仅有的
 * 2~3 个检索位，把 #开源 / #Rust / #CLI 这类真正有区分度的属性挤掉。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  normalizeTag,
  buildCategoryNameIndex,
  isPollutedTag,
  filterDisplayTags,
  sanitizeSiteTags,
  GENERIC_TAG_DENYLIST,
  SPECIAL_TAG_MAPPING,
} from '../src/lib/tag-hygiene.ts'

const ROOTS = buildCategoryNameIndex('AI 工具', ['AI 编程助手', '模型与数据集', '对话助手'])
const FRONTEND = buildCategoryNameIndex('前端开发', ['组件与 UI 体系', 'WASM 与 Rust', '浏览器与 PWA', '构建与工程化'])

describe('normalizeTag：slug 化标签与分类标题对齐', () => {
  it('去连字符/空格/大小写，允许 # 前缀', () => {
    expect(normalizeTag('#组件与-ui-体系')).toBe('组件与ui体系')
    expect(normalizeTag('组件与 UI 体系')).toBe('组件与ui体系')
    expect(normalizeTag('#wasm-与-rust')).toBe('wasm与rust')
    expect(normalizeTag('#浏览器与-pwa')).toBe('浏览器与pwa')
    expect(normalizeTag('#ai-工具')).toBe('ai工具')
    expect(normalizeTag('AI 工具')).toBe('ai工具')
  })

  it('空值与纯符号安全', () => {
    expect(normalizeTag('')).toBe('')
    expect(normalizeTag('   ')).toBe('')
    expect(normalizeTag('###')).toBe('')
  })

  it('显式特殊标签映射表（C# / C++ / .NET / Node.js / Vue.js）', () => {
    expect(SPECIAL_TAG_MAPPING['c#']).toBe('csharp')
    expect(SPECIAL_TAG_MAPPING['c++']).toBe('cpp')
    expect(SPECIAL_TAG_MAPPING['.net']).toBe('dotnet')
    expect(SPECIAL_TAG_MAPPING['node.js']).toBe('nodejs')
    expect(SPECIAL_TAG_MAPPING['vue.js']).toBe('vuejs')
    expect(normalizeTag('C#')).toBe('csharp')
    expect(normalizeTag('#c#')).toBe('csharp')
    expect(normalizeTag('.NET')).toBe('dotnet')
    expect(normalizeTag('#.net')).toBe('dotnet')
    expect(normalizeTag('C++')).toBe('cpp')
    expect(normalizeTag('Node.js')).toBe('nodejs')
    expect(normalizeTag('Vue.js')).toBe('vuejs')
  })
})

describe('isPollutedTag：该剔的剔、该留的留', () => {
  it('剔除与当前一级分类同名的标签', () => {
    expect(isPollutedTag('AI 工具', ROOTS)).toBe(true)
    expect(isPollutedTag('#ai-工具', ROOTS)).toBe(true)
    expect(isPollutedTag('前端开发', FRONTEND)).toBe(true)
  })

  it('剔除与二级分类同名的标签（含中英混排 slug 变体）', () => {
    expect(isPollutedTag('组件与-ui-体系', FRONTEND)).toBe(true)
    expect(isPollutedTag('#wasm-与-rust', FRONTEND)).toBe(true)
    expect(isPollutedTag('浏览器与-pwa', FRONTEND)).toBe(true)
    expect(isPollutedTag('#ai-硬件与具身', buildCategoryNameIndex('AI 工具', ['AI 硬件与具身']))).toBe(true)
    expect(isPollutedTag('#ai-安全与对齐', buildCategoryNameIndex('AI 工具', ['AI 安全与对齐']))).toBe(true)
  })

  it('剔除泛化误打标签 ai赋能，但不误伤正常标签', () => {
    expect(GENERIC_TAG_DENYLIST.has('ai赋能')).toBe(true)
    expect(isPollutedTag('ai赋能', FRONTEND)).toBe(true)
    expect(isPollutedTag('AI 赋能', FRONTEND)).toBe(true)
    expect(isPollutedTag('开源', FRONTEND)).toBe(false)
    expect(isPollutedTag('Rust', FRONTEND)).toBe(false)
    expect(isPollutedTag('CLI', FRONTEND)).toBe(false)
    expect(isPollutedTag('本地优先', FRONTEND)).toBe(false)
  })

  it('白名单里的泛化标签可以放行（规则可扩展，不是一刀切）', () => {
    // 当前白名单为空；这里钉住「黑名单不等于把所有宽泛词都删」的语义
    expect(isPollutedTag('效率工具', FRONTEND)).toBe(false)
    expect(isPollutedTag('设计资源', FRONTEND)).toBe(false)
  })
})

describe('filterDisplayTags / sanitizeSiteTags', () => {
  it('保留有检索价值的标签并去重', () => {
    const tags = ['前端开发', '#组件与-ui-体系', '开源', 'Rust', '开源', 'ai赋能', 'CLI']
    expect(filterDisplayTags(tags, FRONTEND)).toEqual(['开源', 'Rust', 'CLI'])
  })

  it('归一化后的变体只保留第一次出现的写法', () => {
    expect(filterDisplayTags(['ai-工具', 'AI 工具', '开源'], ROOTS)).toEqual(['开源'])
  })

  it('空值、非字符串、空标签安全', () => {
    expect(filterDisplayTags(undefined, ROOTS)).toEqual([])
    expect(filterDisplayTags(['', '  ', null as unknown as string, 42 as unknown as string], ROOTS)).toEqual([])
  })

  it('sanitizeSiteTags 不改入参；无污染时返回同一个对象引用', () => {
    const clean = { id: 'a', tags: ['开源', 'CLI'] }
    expect(sanitizeSiteTags(clean, FRONTEND)).toBe(clean)
    expect(clean.tags).toEqual(['开源', 'CLI'])

    const dirty = { id: 'b', tags: ['前端开发', '开源', 'ai赋能'] }
    const out = sanitizeSiteTags(dirty, FRONTEND)
    expect(out).not.toBe(dirty)
    expect(out.tags).toEqual(['开源'])
    // 原对象必须仍然是原样，不能就地改写（React memo 依赖引用稳定）
    expect(dirty.tags).toEqual(['前端开发', '开源', 'ai赋能'])
  })

  it('没有 tags 字段的站点原样返回，不制造多余对象', () => {
    const bare = { id: 'c' }
    expect(sanitizeSiteTags(bare, FRONTEND)).toBe(bare)
  })
})

describe('真实导航数据：污染规模与清洗效果', () => {
  const json = JSON.parse(
    readFileSync(new URL('../src/navsphere/content/navigation-default.json', import.meta.url), 'utf8')
  ) as { navigationItems: Array<{ title: string; items?: any[]; subCategories?: any[] }> }

  /** 收集全部分类标题 + 站点标签（与运行时同名集合口径一致） */
  const categoryTitles = new Set<string>()
  let siteCount = 0
  let pollutedCount = 0
  const cleanedSamples: string[] = []
  const visit = (node: any) => {
    if (node?.title) categoryTitles.add(node.title)
    for (const s of node?.items || []) {
      siteCount++
      if (!Array.isArray(s.tags)) continue
      const before = s.tags.length
      const after = filterDisplayTags(s.tags, buildCategoryNameIndex(node.title || '')).length
      const globalAfter = filterDisplayTags(s.tags, new Set(Array.from(categoryTitles).map(normalizeTag))).length
      if (before > after || before > globalAfter) pollutedCount++
      if (cleanedSamples.length < 3 && before > globalAfter) {
        cleanedSamples.push(`${s.title}: ${s.tags.join('/')} -> ${filterDisplayTags(s.tags, new Set(Array.from(categoryTitles).map(normalizeTag))).join('/')}`)
      }
    }
    for (const sub of node?.subCategories || []) visit(sub)
  }
  for (const root of json.navigationItems || []) visit(root)

  it('默认导航数据非空，且确实存在可清洗的污染', () => {
    expect(siteCount).toBeGreaterThan(30)
    expect(pollutedCount).toBeGreaterThan(0)
  })

  it('所有一级分类名都能被归一化命中（集合由数据派生，未硬编码）', () => {
    for (const root of json.navigationItems || []) {
      const index = buildCategoryNameIndex(root.title)
      expect(index.has(normalizeTag(root.title))).toBe(true)
    }
  })

  it('清洗后不再出现分类名复读与 ai赋能', () => {
    const globalIndex = new Set(Array.from(categoryTitles).map(normalizeTag))
    const collect = (node: any): string[] => {
      const out: string[] = []
      for (const s of node?.items || []) out.push(...filterDisplayTags(s.tags, globalIndex))
      for (const sub of node?.subCategories || []) out.push(...collect(sub))
      return out
    }
    const all = (json.navigationItems || []).flatMap(collect)
    expect(all.length).toBeGreaterThan(0)
    for (const tag of all) {
      expect(globalIndex.has(normalizeTag(tag))).toBe(false)
      expect(normalizeTag(tag)).not.toBe('ai赋能')
    }
  })
})
