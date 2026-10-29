/**
 * 富化字段级审核（AI-4c）的规则守卫。
 *
 * 这一层最容易悄悄退化的不是像素，而是「审核承诺」：
 *   - 字段清单两边各抄一份 → 中枢多/少一个字段，界面静默漏一行；
 *   - missing 被当成「有值」→ 空描述覆盖运营已经写好的文案；
 *   - 勾了 N 项却整包写入 → 审核形同虚设；
 *   - 建站时又带 enrich:true → 二次富化，落库值 ≠ 审核时展示值。
 *
 * 断言分三组：纯函数行为、契约对齐（读中枢源码取字段清单）、组件接线（源码文本）。
 * 每条都指定了让它变红的消融，见 test 注释。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ENRICH_REVIEW_FIELDS,
  SOURCE_BADGE,
  buildEnrichReviewRows,
  buildReviewedSiteDraft,
  defaultEnrichSelection,
  leafCategories,
  matchSuggestedCategory,
  sanitizeReviewIconUrl,
} from '@/lib/enrich-review'
import type { HubEnrichmentFields } from '@/lib/navhub-api'

const HERE = dirname(fileURLToPath(import.meta.url))
/** 仓库根：overlay 与镜像两份测试都在「test/」下，向上三级恒为仓库根 */
const REPO = resolve(HERE, '..', '..', '..')
/** 真源永远是 apps/web-overlay；镜像只为了被 vitest 跑到 */
const OVERLAY = existsSync(join(REPO, 'apps', 'web-overlay'))
  ? join(REPO, 'apps', 'web-overlay')
  : resolve(HERE, '..')

function fields(overrides: Partial<HubEnrichmentFields> = {}): HubEnrichmentFields {
  return {
    title: { value: 'Example Tools', source: 'llm' },
    description: { value: '开发者工具合集', source: 'llm' },
    tags: { value: ['developer', 'tools'], source: 'llm' },
    category: { value: '开发工具', source: 'llm' },
    icon: { value: 'https://example.com/favicon.ico', source: 'scraped' },
    ...overrides,
  }
}

describe('契约对齐：审核字段清单与中枢一致', () => {
  // 消融：在 apps/api/src/enrich-fields.ts 的 ENRICH_FIELD_KEYS 里加一个字段，
  // 本用例变红——提示 UI 没有对应行，而不是静默漏审。
  it('ENRICH_REVIEW_FIELDS 覆盖中枢 ENRICH_FIELD_KEYS 的每一项', () => {
    const apiFile = join(REPO, 'apps', 'api', 'src', 'enrich-fields.ts')
    const src = readFileSync(apiFile, 'utf8')
    const m = src.match(/ENRICH_FIELD_KEYS\s*=\s*\[([^\]]*)\]/)
    expect(m, '中枢找不到 ENRICH_FIELD_KEYS').toBeTruthy()
    const serverKeys = [...(m as RegExpMatchArray)[1]!.matchAll(/"([a-z]+)"/g)].map((x) => x[1])
    expect(serverKeys.length).toBeGreaterThanOrEqual(5)
    expect(ENRICH_REVIEW_FIELDS.map((f) => f.key)).toEqual(serverKeys)
  })

  it('每个来源都有可读徽章（不出现空白徽章）', () => {
    for (const source of ['llm', 'scraped', 'heuristic', 'missing'] as const) {
      expect(SOURCE_BADGE[source]?.label).toBeTruthy()
      expect(SOURCE_BADGE[source]?.className).toBeTruthy()
    }
  })
})

describe('buildEnrichReviewRows', () => {
  it('全有值时五项都可用', () => {
    const rows = buildEnrichReviewRows(fields())
    expect(rows.map((r) => r.key)).toEqual(['title', 'description', 'category', 'tags', 'icon'])
    expect(rows.every((r) => r.available)).toBe(true)
  })

  // 消融：把 `field.source === 'missing'` 分支删掉 → 本用例变红
  it('missing 来源不可用并带原因，空数组同档', () => {
    const rows = buildEnrichReviewRows(
      fields({
        description: { value: '', source: 'missing', note: '页面没有 description 元数据' },
        tags: { value: [], source: 'missing', note: '模型没有给出标签' },
        category: { value: null, source: 'missing', note: '关键词规则无法判断类目' },
      }),
    )
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.description!.available).toBe(false)
    expect(byKey.description!.reason).toBe('页面没有 description 元数据')
    expect(byKey.tags!.available).toBe(false)
    expect(byKey.category!.available).toBe(false)
    expect(byKey.title!.available).toBe(true)
  })

  it('空串即使来源不是 missing 也不可用（不给「空值当最新」留口子）', () => {
    const rows = buildEnrichReviewRows(fields({ description: { value: '   ', source: 'scraped' } }))
    const row = rows.find((r) => r.key === 'description')!
    expect(row.available).toBe(false)
    expect(row.reason).toBe('没有可用的值')
  })

  // 消融：删掉 icon 的 sanitize 分支 → 本用例变红
  it('第三方图标服务地址不可用（可看到、但不可落库）', () => {
    const rows = buildEnrichReviewRows(
      fields({ icon: { value: 'https://www.google.com/s2/favicons?sz=128&domain=x.com', source: 'scraped' } }),
    )
    const icon = rows.find((r) => r.key === 'icon')!
    expect(icon.available).toBe(false)
    expect(icon.reason).toContain('第三方图标服务')
  })

  // 页面没声明 icon 时抽取层会猜根路径 /favicon.ico：值可用，但来源说明不能被吞掉，
  // 否则运营看到的就是「页面抓取」——等于替页面作证（AI-4c 浏览器实测 B-3 的单元侧）
  it('可用但带来源说明的字段（favicon 推测值）保留 note，且仍可勾选', () => {
    const rows = buildEnrichReviewRows(
      fields({
        icon: {
          value: 'https://example.com/favicon.ico',
          source: 'heuristic',
          note: '页面没有声明图标，按站点根 /favicon.ico 推测',
        },
      }),
    )
    const icon = rows.find((r) => r.key === 'icon')!
    expect(icon.available).toBe(true)
    expect(icon.note).toBe('页面没有声明图标，按站点根 /favicon.ico 推测')

    // 不可用的行不重复显示 note：note 只服务「值可用但需要提醒」的场景
    const missing = buildEnrichReviewRows(
      fields({ tags: { value: [], source: 'missing', note: '模型没有给出标签' } }),
    ).find((r) => r.key === 'tags')!
    expect(missing.note).toBeNull()
    expect(missing.reason).toBe('模型没有给出标签')
  })

  it('默认勾选 = 可用的字段，missing 一律不勾', () => {
    const rows = buildEnrichReviewRows(
      fields({ tags: { value: [], source: 'missing', note: '没有标签' } }),
    )
    const selection = defaultEnrichSelection(rows)
    expect(selection).toEqual({ title: true, description: true, category: true, tags: false, icon: true })
  })
})

describe('buildReviewedSiteDraft', () => {
  it('只写勾选字段：没勾的一项都不进载荷', () => {
    const res = buildReviewedSiteDraft({
      url: 'https://example.com/',
      fields: fields(),
      selected: { title: true },
      categoryId: 'cat-1',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.draft).toEqual({ url: 'https://example.com/', title: 'Example Tools', categoryId: 'cat-1' })
    expect(res.notes).toEqual([])
  })

  // 消融：把 title 缺失的早退删掉 → 会构造出 title 为空串的载荷，本用例变红
  it('标题缺失且没有手填 → 拒绝，不产生空标题载荷', () => {
    const res = buildReviewedSiteDraft({
      url: 'https://example.com/',
      fields: fields({ title: { value: '', source: 'missing', note: '页面没有 title' } }),
      selected: { description: true },
      categoryId: 'cat-1',
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('标题')
  })

  it('标题缺失但手填 → 允许，用手填值', () => {
    const res = buildReviewedSiteDraft({
      url: 'https://example.com/',
      fields: fields({ title: { value: '', source: 'missing' } }),
      selected: {},
      categoryId: 'cat-1',
      titleOverride: '  手写标题  ',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.draft.title).toBe('手写标题')
  })

  it('手填标题优先于富化标题', () => {
    const res = buildReviewedSiteDraft({
      url: 'https://example.com/',
      fields: fields(),
      selected: { title: true },
      categoryId: 'cat-1',
      titleOverride: '改写后的标题',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.draft.title).toBe('改写后的标题')
  })

  it('类目未选 → 拒绝（REST 必填，不能落未分类糊弄过去）', () => {
    const res = buildReviewedSiteDraft({
      url: 'https://example.com/',
      fields: fields(),
      selected: { title: true },
      categoryId: '   ',
    })
    expect(res.ok).toBe(false)
  })

  it('勾了但没值 → 不写入，并留下可读说明', () => {
    const res = buildReviewedSiteDraft({
      url: 'https://example.com/',
      fields: fields({
        description: { value: '', source: 'missing', note: '页面没有 description 元数据' },
        tags: { value: [], source: 'missing' },
        icon: { value: 'https://icon.horse/icon/example.com', source: 'scraped' },
      }),
      selected: { title: true, description: true, tags: true, icon: true },
      categoryId: 'cat-1',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.draft.description).toBeUndefined()
    expect(res.draft.tags).toBeUndefined()
    expect(res.draft.iconKey).toBeUndefined()
    expect(res.notes).toHaveLength(3)
  })

  it('标签去重、去空白并压到 8 个', () => {
    const tags = ['a', ' a ', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    const res = buildReviewedSiteDraft({
      url: 'https://example.com/',
      fields: fields({ tags: { value: tags, source: 'llm' } }),
      selected: { title: true, tags: true },
      categoryId: 'cat-1',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.draft.tags).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  })
})

describe('类目建议匹配', () => {
  const cats = [
    { id: 'root', title: '开发工具', parentId: null },
    { id: 'leaf-1', title: '开发工具', parentId: 'root' },
    { id: 'leaf-2', title: 'DevTools', titleEn: 'devtools', parentId: 'root' },
    { id: 'leaf-3', title: '设计', parentId: null },
    { id: 'leaf-4', title: '设计', parentId: null },
  ]

  it('叶子判定排除了作为 parent 出现过的类目', () => {
    expect(leafCategories(cats).map((c) => c.id)).toEqual(['leaf-1', 'leaf-2', 'leaf-3', 'leaf-4'])
  })

  it('唯一同名叶子 → 预选（一级根不参与匹配）', () => {
    expect(matchSuggestedCategory('开发工具', cats)).toEqual({ kind: 'unique', id: 'leaf-1', title: '开发工具' })
  })

  it('英文名也参与匹配，大小写不敏感', () => {
    expect(matchSuggestedCategory(' DevTools ', cats)).toEqual({ kind: 'unique', id: 'leaf-2', title: 'DevTools' })
  })

  it('多个同名 → ambiguous，不替用户做决定', () => {
    expect(matchSuggestedCategory('设计', cats)).toEqual({ kind: 'ambiguous', ids: ['leaf-3', 'leaf-4'] })
  })

  it('没有匹配 → none', () => {
    expect(matchSuggestedCategory('人工智能', cats)).toEqual({ kind: 'none' })
    expect(matchSuggestedCategory('  ', cats)).toEqual({ kind: 'none' })
  })
})

describe('sanitizeReviewIconUrl', () => {
  it('放行站点自己的图标，拦下第三方图标服务', () => {
    expect(sanitizeReviewIconUrl(' https://example.com/favicon.ico ')).toBe('https://example.com/favicon.ico')
    expect(sanitizeReviewIconUrl('https://www.google.com/s2/favicons?sz=128&domain=x.com')).toBeNull()
    expect(sanitizeReviewIconUrl('https://icons.duckduckgo.com/ip3/x.com.ico')).toBeNull()
    expect(sanitizeReviewIconUrl('https://icon.horse/icon/x.com')).toBeNull()
    expect(sanitizeReviewIconUrl('')).toBeNull()
    expect(sanitizeReviewIconUrl(null)).toBeNull()
    expect(sanitizeReviewIconUrl('not-a-url')).toBeNull()
  })
})

describe('组件接线：审核结果直接建站，不做二次富化', () => {
  const panel = readFileSync(join(OVERLAY, 'src/components/ai/enrichment-review-panel.tsx'), 'utf8')
  const api = readFileSync(join(OVERLAY, 'src/lib/navhub-api.ts'), 'utf8')
  const page = readFileSync(join(OVERLAY, 'src/app/admin/ai/page.tsx'), 'utf8')

  // 消融：把 createSiteFromReview 改回 enrichSitePreview 或给载荷加 enrich:true → 本条变红
  it('建站走 createSiteFromReview，且载荷不带 enrich 开关', () => {
    expect(panel).toContain('createSiteFromReview')
    expect(panel).not.toMatch(/enrich\s*:\s*true/)
    const start = api.indexOf('export async function createSiteFromReview')
    expect(start).toBeGreaterThan(-1)
    const rest = api.slice(start)
    const end = rest.search(/\nexport (async function|function|const|interface|type) /)
    const fn = end < 0 ? rest : rest.slice(0, end)
    expect(fn).toContain("sendJson('/api/sites', 'POST', draft)")
    expect(fn).not.toMatch(/enrich/)
  })

  // 消融：把 `url: preview.url` 改成 `url`（原始输入）→ 本条变红；
  // 真实语义：抓取可能 301 到最终地址，审核展示与落库都该用最终地址。
  it('按最终地址（preview.url）建站，而不是用户原始输入', () => {
    expect(panel).toMatch(/url:\s*preview\.url/)
  })

  // 消融：删掉面板里「不会再次调用模型」的说明 → 本条变红（这是对运营的承诺）
  it('界面上明说不会二次调用模型', () => {
    expect(panel).toContain('不会再次调用模型')
  })

  it('管理端 AI 页面挂了「富化结果字段级审核」入口', () => {
    expect(page).toContain('EnrichmentReviewPanel')
    expect(page).toContain('富化结果字段级审核')
  })
})
