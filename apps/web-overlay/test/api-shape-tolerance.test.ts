import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 2026-11-25 数据形状容错守卫：API 响应体里"应该是数组"的字段可能因老中枢 /
 * 降级通道 / blind cast 缺字段，前端直接 .map/.some/.length 会 TypeError 白屏
 * （事故原型：submission.labels.some）。本守卫锁定已修的 6 处高危解引用。
 */
const ROOT = join(import.meta.dirname, '../src')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('API 响应数组字段容错（2026-11-25）', () => {
  it('facets 页的 options.reduce 有 ?? [] 兜底', () => {
    const s = read('app/admin/facets/page.tsx')
    expect(s).toContain('(f.options ?? []).reduce')
  })

  it('AI 找站面板对 FinderResponse 三个数组做运行时归一化', () => {
    const s = read('components/ai/ai-finder-panel.tsx')
    expect(s).toContain('steps: Array.isArray(body.steps) ? body.steps : []')
    expect(s).toContain('recommendations: Array.isArray(body.recommendations) ? body.recommendations : []')
    expect(s).toContain('categorySuggestions: Array.isArray(body.categorySuggestions) ? body.categorySuggestions : []')
  })

  it('命令面板 AI Tab（在途工作线文件，存在时）同样做数组归一化', () => {
    const rel = 'components/search/search-palette-ai-tab.tsx'
    if (!existsSync(join(ROOT, rel))) return // 该文件属另一条工作线在途批次，未入库时不锁
    const s = read(rel)
    expect(s).toContain('steps: Array.isArray(body.steps) ? body.steps : []')
    expect(s).toContain('recommendations: Array.isArray(body.recommendations) ? body.recommendations : []')
  })

  it('插件健康面板的 autoApplied.items 两处都有 ?? []', () => {
    const s = read('components/plugins/plugin-url-health-panel.tsx')
    expect((s.match(/\(healRes\.autoApplied\.items \?\? \[\]\)/g) ?? []).length).toBe(2)
  })

  it('similar-sites-explorer（在途工作线文件，存在时）的 sharedTags/reasons 有 ?? []', () => {
    const rel = 'components/similar-sites-explorer.tsx'
    if (!existsSync(join(ROOT, rel))) return // 同上：未入库时不锁
    const s = read(rel)
    const bare = s.match(/item\.sharedTags\.(some|slice|length)/g) ?? []
    expect(bare).toEqual([])
    expect(s).toContain('(item.reasons ?? [])[0]')
  })

  it('account-view 的 aliases.length 有 ?? []', () => {
    const s = read('app/me/account/account-view.tsx')
    expect(s).toContain('(overview.aliases ?? []).length')
  })
})
