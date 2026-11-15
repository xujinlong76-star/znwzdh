/**
 * 对照页纯逻辑测试（Batch 4 Phase 1 第 2 项）。
 *
 * 覆盖：siteIds 解析/2–4 校验/跳转链接、格子归一化与差异判定、
 * “未验证”渲染、分流结论白名单校验、结论本机保存（内存 Store 注入）、
 * 详情页候选 pick-state 切换（第 3 项复用）。
 */
import { describe, expect, it } from 'vitest'

import {
  buildCompareConclusion,
  buildCompareHref,
  COMPARE_NOTES_KEY,
  compareCellsDiffer,
  compareRowDiffers,
  deleteCompareNote,
  formatCellValue,
  formatVerifiedDate,
  mergeCompareCandidates,
  normalizeCellValue,
  normalizeComparisonItem,
  normalizeComparisonItems,
  parseCompareSiteIds,
  readCompareNotes,
  saveCompareNote,
  toggleComparePick,
  validateCompareSiteIds,
  type ComparisonCell,
  type CompareNotesStore,
  type SavedCompareNote,
} from '../src/lib/compare'

function memoryStore(): CompareNotesStore & { dump: () => Record<string, string> } {
  const data: Record<string, string> = {}
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    removeItem: (key: string) => {
      delete data[key]
    },
    dump: () => ({ ...data }),
  }
}

const cell = (value: ComparisonCell['value'], verified = true, verifiedAt: number | null = 1700000000000): ComparisonCell => ({
  value,
  source: '站点分面',
  verified,
  verifiedAt,
})

describe('siteIds 解析与 2–4 校验', () => {
  it('逗号切分、trim、去重、去空，顺序保留勾选顺序', () => {
    expect(parseCompareSiteIds('a, b ,a,,c')).toEqual(['a', 'b', 'c'])
    expect(parseCompareSiteIds(null)).toEqual([])
    expect(parseCompareSiteIds('')).toEqual([])
  })

  it('0/1 个拒绝，2–4 个通过，5 个拒绝', () => {
    expect(validateCompareSiteIds([]).ok).toBe(false)
    expect(validateCompareSiteIds(['a']).ok).toBe(false)
    expect(validateCompareSiteIds(['a', 'b'])).toEqual({ ok: true, siteIds: ['a', 'b'] })
    expect(validateCompareSiteIds(['a', 'b', 'c']).ok).toBe(true)
    expect(validateCompareSiteIds(['a', 'b', 'c', 'd'])).toEqual({
      ok: true,
      siteIds: ['a', 'b', 'c', 'd'],
    })
    expect(validateCompareSiteIds(['a', 'b', 'c', 'd', 'e']).ok).toBe(false)
    expect(validateCompareSiteIds(['a', 'b', 'c', 'd', 'e'])).toEqual({
      ok: false,
      error: '一次最多对比 4 个站点，请先取消多余的勾选。',
    })
  })

  it('数量不足的文案插进实际数量：0 个就是 0 个，不写死“1 个”', () => {
    expect(validateCompareSiteIds([])).toEqual({
      ok: false,
      error: '请勾选 2–4 个已收藏站点进行对比（当前只有 0 个）。',
    })
    expect(validateCompareSiteIds(['a'])).toEqual({
      ok: false,
      error: '请勾选 2–4 个已收藏站点进行对比（当前只有 1 个）。',
    })
  })

  it('重复 id 先去重再校验：4 个含 1 个重复 = 3 个，通过；5 个含 1 个重复 = 4 个，通过', () => {
    expect(validateCompareSiteIds(['a', 'b', 'c', 'a'])).toEqual({ ok: true, siteIds: ['a', 'b', 'c'] })
    expect(validateCompareSiteIds(['a', 'b', 'c', 'd', 'a'])).toEqual({
      ok: true,
      siteIds: ['a', 'b', 'c', 'd'],
    })
  })

  it('跳转链接走 URL 传参，id 逐个编码', () => {
    expect(buildCompareHref(['a', 'b'])).toBe('/compare?siteIds=a,b')
    expect(buildCompareHref(['a b', 'c/d'])).toBe('/compare?siteIds=a%20b,c%2Fd')
    expect(buildCompareHref(['a', 'b', 'c', 'd'])).toBe('/compare?siteIds=a,b,c,d')
    expect(() => buildCompareHref(['a'])).toThrow()
    expect(() => buildCompareHref(['a', 'b', 'c', 'd', 'e'])).toThrow()
  })
})

describe('格子归一化与差异判定', () => {
  it('字符串/数组归一化：数组排序后用“、”连接', () => {
    expect(normalizeCellValue(cell('免费'))).toBe('免费')
    expect(normalizeCellValue(cell(['iOS', 'Android']))).toBe('Android、iOS')
    expect(normalizeCellValue(cell(null))).toBe(null)
    expect(normalizeCellValue(cell([]))).toBe(null)
    expect(normalizeCellValue(undefined)).toBe(null)
  })

  it('差异只比“值”：值相同但 verified 不同不算差异', () => {
    expect(compareCellsDiffer(cell('免费'), cell('免费', false, null))).toBe(false)
    expect(compareCellsDiffer(cell('免费'), cell('付费'))).toBe(true)
    expect(compareCellsDiffer(cell(null), cell('免费'))).toBe(true)
    expect(compareCellsDiffer(cell(null), cell(null))).toBe(false)
    expect(compareCellsDiffer(cell(['A', 'B']), cell(['B', 'A']))).toBe(false)
  })

  it('行差异：任一对值不同即整行高亮', () => {
    const base = {
      pricing: cell('免费'),
      // 价格数值格（P2-2）：第七格，行差异判定同样只比值
      price: cell('¥19.9/月'),
      platform: cell(['Web']),
      form: cell('saas'),
      maintenance: cell('可达'),
      note: cell(null),
      migration: cell(null),
    }
    const items = [
      { siteId: 'a', title: 'A', url: 'https://a.example', ...base },
      { siteId: 'b', title: 'B', url: 'https://b.example', ...base, pricing: cell('付费') },
    ]
    expect(compareRowDiffers(items, 'pricing')).toBe(true)
    expect(compareRowDiffers(items, 'platform')).toBe(false)
    expect(compareRowDiffers([items[0]], 'pricing')).toBe(false)
    expect(compareRowDiffers(items, 'price')).toBe(false)
  })

  it('缺失格显式“未验证”，不填充模板句；有值 + 未验证显示原值，未验证只在副行体现', () => {
    expect(formatCellValue(cell(null))).toBe('未验证')
    expect(formatCellValue(cell(null, false, null))).toBe('未验证')
    expect(formatCellValue(cell('免费', false, null))).toBe('免费')
    expect(formatCellValue(cell('免费'))).toBe('免费')
    expect(formatCellValue(undefined)).toBe('未验证')
  })

  it('服务端真实形状：pricing unknown → { value: 未标注, verified: false }，显示“未标注”而非“未验证”', () => {
    const serverCell: ComparisonCell = { value: '未标注', source: '站点分面', verified: false, verifiedAt: null }
    expect(formatCellValue(serverCell)).toBe('未标注')
    // “未标注”仍是可比值：免费 vs 未标注算差异行
    expect(compareCellsDiffer(cell('免费'), serverCell)).toBe(true)
    expect(normalizeCellValue(serverCell)).toBe('未标注')
  })

  it('unknown 不原样渲染英文，兜底为“未标注”', () => {
    expect(formatCellValue(cell('unknown'))).toBe('未标注')
  })

  it('核实日期：缺失返回 null，不编造', () => {
    expect(formatVerifiedDate(null)).toBe(null)
    expect(formatVerifiedDate(undefined)).toBe(null)
    const dated = formatVerifiedDate(1792000000000)
    expect(dated).toMatch(/2026/)
  })
})

describe('接口返回归一化', () => {
  it('接受 REST 扁平形态', () => {
    const items = normalizeComparisonItems({
      ok: true,
      items: [
        {
          siteId: 'a',
          title: 'A',
          url: 'https://a.example',
          pricing: { value: '免费', source: '站点分面', verified: true, verifiedAt: 1 },
          platform: { value: null, source: '站点分面', verified: false, verifiedAt: null },
        },
      ],
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.pricing.value).toBe('免费')
    expect(items[0]?.platform.verified).toBe(false)
    // 缺失的格补“未验证”，不抛错
    expect(items[0]?.form.value).toBe(null)
  })

  it('兼容 cells 包裹形态', () => {
    const item = normalizeComparisonItem({
      siteId: 'a',
      title: 'A',
      url: 'https://a.example',
      cells: { pricing: { value: '付费', source: '站点分面', verified: true, verifiedAt: 1 } },
    })
    expect(item?.pricing.value).toBe('付费')
    expect(item?.note.value).toBe(null)
  })

  it('cells 为对象时整体采用它，扁平字段被忽略（缺键不回退到扁平值）', () => {
    const item = normalizeComparisonItem({
      siteId: 'a',
      title: 'A',
      url: 'https://a.example',
      pricing: { value: '免费', source: '站点分面', verified: true, verifiedAt: 1 },
      cells: { platform: { value: ['Web'], source: '站点分面', verified: true, verifiedAt: 1 } },
    })
    expect(item?.platform.value).toEqual(['Web'])
    // pricing 只在扁平字段里，cells 缺键 → 落“未验证”，不回退
    expect(item?.pricing.value).toBe(null)
    expect(item?.pricing.verified).toBe(false)
  })

  it('非对象/无 siteId/非数组一律不渲染空表', () => {
    expect(normalizeComparisonItem(null)).toBe(null)
    expect(normalizeComparisonItem({ title: '无 id' })).toBe(null)
    expect(normalizeComparisonItems(null)).toEqual([])
    expect(normalizeComparisonItems({ ok: true, items: 'not-an-array' })).toEqual([])
    expect(normalizeComparisonItems({ ok: true, items: [] })).toEqual([])
  })
})

describe('分流结论白名单校验', () => {
  const siteIds = ['a', 'b', 'c']
  const siteTitles = { a: '甲站', b: '乙站', c: '丙站' }

  it('合法结论拼成一句话并注明依据格子', () => {
    const result = buildCompareConclusion({
      scenario: 'budget',
      siteId: 'a',
      basisKeys: ['pricing', 'migration'],
      basisCells: [cell('免费'), cell('迁移成本低')],
      siteIds,
      siteTitles,
    })
    expect(result).toEqual({ ok: true, text: '预算敏感选「甲站」（依据：计费方式、迁移成本）' })
  })

  it('引用白名单外的站点 id 拒绝保存', () => {
    const result = buildCompareConclusion({
      scenario: 'budget',
      siteId: 'zzz',
      basisKeys: ['pricing'],
      basisCells: [cell('免费')],
      siteIds,
      siteTitles,
    })
    expect(result.ok).toBe(false)
  })

  it('未知场景、空依据、白名单外维度一律拒绝或过滤', () => {
    expect(
      buildCompareConclusion({ scenario: 'nope', siteId: 'a', basisKeys: ['pricing'], basisCells: [cell('免费')], siteIds, siteTitles }).ok,
    ).toBe(false)
    expect(
      buildCompareConclusion({ scenario: 'budget', siteId: 'a', basisKeys: [], basisCells: [], siteIds, siteTitles }).ok,
    ).toBe(false)
    // 白名单外维度被过滤，只剩合法维度仍可生成
    const filtered = buildCompareConclusion({
      scenario: 'stability',
      siteId: 'b',
      basisKeys: ['winner', 'maintenance'],
      basisCells: [cell('可达')],
      siteIds,
      siteTitles,
    })
    expect(filtered).toEqual({ ok: true, text: '要稳定少折腾选「乙站」（依据：是否还在维护）' })
  })

  it('严格规则 (a)：全未验证依据拒绝生成', () => {
    const result = buildCompareConclusion({
      scenario: 'budget',
      siteId: 'a',
      basisKeys: ['pricing'],
      basisCells: [cell('免费', false, null)],
      siteIds,
      siteTitles,
    })
    expect(result).toEqual({ ok: false, error: '依据格子中有未验证项，请换依据或先补数据。' })
  })

  it('严格规则 (a)：混合依据（一格已验证、一格未验证）也拒绝', () => {
    const result = buildCompareConclusion({
      scenario: 'budget',
      siteId: 'a',
      basisKeys: ['pricing', 'maintenance'],
      basisCells: [cell('免费'), cell('可达', false, null)],
      siteIds,
      siteTitles,
    })
    expect(result).toEqual({ ok: false, error: '依据格子中有未验证项，请换依据或先补数据。' })
  })

  it('严格规则 (a)：缺格 / 值为空的依据格同样拒绝', () => {
    const missing = buildCompareConclusion({
      scenario: 'budget',
      siteId: 'a',
      basisKeys: ['pricing'],
      basisCells: [undefined],
      siteIds,
      siteTitles,
    })
    expect(missing).toEqual({ ok: false, error: '依据格子中有未验证项，请换依据或先补数据。' })
    const empty = buildCompareConclusion({
      scenario: 'budget',
      siteId: 'a',
      basisKeys: ['pricing'],
      basisCells: [cell(null)],
      siteIds,
      siteTitles,
    })
    expect(empty.ok).toBe(false)
  })
})

describe('结论本机保存（localStorage 新键）', () => {
  it('保存后立刻可读，键是 navhub.compare.notes.v1', () => {
    const store = memoryStore()
    const saved = saveCompareNote(
      {
        scenario: 'budget',
        siteId: 'a',
        basisKeys: ['pricing'],
        basisCells: [cell('免费')],
        siteIds: ['a', 'b'],
        siteTitles: { a: '甲站', b: '乙站' },
      },
      store,
    )
    expect(saved.ok).toBe(true)
    expect(Object.keys(store.dump())).toEqual([COMPARE_NOTES_KEY])
    expect(COMPARE_NOTES_KEY).toBe('navhub.compare.notes.v1')
    const notes = readCompareNotes(store)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.text).toBe('预算敏感选「甲站」（依据：计费方式）')
    // 新保存的在最前面
    const saved2 = saveCompareNote(
      {
        scenario: 'stability',
        siteId: 'b',
        basisKeys: ['maintenance'],
        basisCells: [cell('可达')],
        siteIds: ['a', 'b'],
        siteTitles: { a: '甲站', b: '乙站' },
      },
      store,
    )
    expect(saved2.ok).toBe(true)
    expect(readCompareNotes(store)[0]?.text).toContain('乙站')
  })

  it('白名单外的结论拒绝保存，不写存储', () => {
    const store = memoryStore()
    const saved = saveCompareNote(
      {
        scenario: 'budget',
        siteId: 'zzz',
        basisKeys: ['pricing'],
        basisCells: [cell('免费')],
        siteIds: ['a', 'b'],
        siteTitles: { a: '甲站', b: '乙站' },
      },
      store,
    )
    expect(saved.ok).toBe(false)
    expect(store.dump()).toEqual({})
  })

  it('严格规则 (a)：依据格未验证时保存也被拒绝，不写存储', () => {
    const store = memoryStore()
    const saved = saveCompareNote(
      {
        scenario: 'budget',
        siteId: 'a',
        basisKeys: ['pricing'],
        basisCells: [cell('免费', false, null)],
        siteIds: ['a', 'b'],
        siteTitles: { a: '甲站', b: '乙站' },
      },
      store,
    )
    expect(saved).toEqual({ ok: false, error: '依据格子中有未验证项，请换依据或先补数据。' })
    expect(store.dump()).toEqual({})
  })

  it('删除后列表即时更新；损坏的存储解析失败返回 []', () => {
    const store = memoryStore()
    const saved = saveCompareNote(
      {
        scenario: 'migration',
        siteId: 'a',
        basisKeys: ['migration'],
        basisCells: [cell('备注原文')],
        siteIds: ['a', 'b'],
        siteTitles: { a: '甲站', b: '乙站' },
      },
      store,
    )
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw new Error('unreachable')
    const remaining = deleteCompareNote(saved.note.id, store)
    expect(remaining).toEqual([])
    expect(readCompareNotes(store)).toEqual([])
    // 删不存在的 id 不报错
    expect(deleteCompareNote('nope', store)).toEqual([])

    store.setItem(COMPARE_NOTES_KEY, '{broken json')
    expect(readCompareNotes(store)).toEqual([])
    store.setItem(COMPARE_NOTES_KEY, JSON.stringify([{ id: 1 }]))
    expect(readCompareNotes(store)).toEqual([])
  })

  it('保存的结论不经过任何站点 note 字段', () => {
    const store = memoryStore()
    const saved = saveCompareNote(
      {
        scenario: 'budget',
        siteId: 'a',
        basisKeys: ['pricing'],
        basisCells: [cell('免费')],
        siteIds: ['a', 'b'],
        siteTitles: { a: '甲站', b: '乙站' },
      },
      store,
    )
    expect(saved.ok).toBe(true)
    if (!saved.ok) throw new Error('unreachable')
    const note: SavedCompareNote = saved.note
    expect(Object.keys(note).sort()).toEqual(
      ['basisKeys', 'createdAt', 'id', 'scenario', 'siteId', 'siteIds', 'siteTitles', 'text'].sort(),
    )
  })
})

describe('详情页候选 pick-state 切换（第 3 项复用）', () => {
  it('多路候选按序去重、排除本站、跳过空 id', () => {
    const related = [
      { id: 'b', title: '乙', url: 'https://b.example', description: 'd' },
      { id: 'c', title: '丙', url: 'https://c.example' },
    ]
    const similar = [
      { id: 'c', title: '丙', url: 'https://c.example' },
      { id: 'a', title: '本站', url: 'https://a.example' },
      { id: 'd', title: '丁', url: 'https://d.example' },
    ]
    const merged = mergeCompareCandidates('a', related, similar)
    expect(merged.map((c) => c.id)).toEqual(['b', 'c', 'd'])
    // 泛型保留 HubSite 的多余字段（description），相关区卡片照常渲染
    expect((merged[0] as { description?: string }).description).toBe('d')
    expect(mergeCompareCandidates('a', [{ id: ' ', title: '', url: '' }])).toEqual([])
    expect(mergeCompareCandidates('a')).toEqual([])
  })

  it('点一次选中、再点取消，永不重复', () => {
    expect(toggleComparePick([], 'b', 2)).toEqual({ picked: ['b'], blocked: false })
    expect(toggleComparePick(['b'], 'b', 2)).toEqual({ picked: [], blocked: false })
    expect(toggleComparePick(['b', 'c'], 'b', 2).picked).toEqual(['c'])
  })

  it('超限不加入并返回提示（maxPicks 是除本站外的可再选数）', () => {
    const result = toggleComparePick(['b', 'c'], 'd', 2)
    expect(result.blocked).toBe(true)
    expect(result.picked).toEqual(['b', 'c'])
    if (!result.blocked) throw new Error('unreachable')
    expect(result.message).toContain('3')
  })

  it('空 id 不进入选中集合', () => {
    expect(toggleComparePick(['b'], '  ', 2).picked).toEqual(['b'])
  })
})
