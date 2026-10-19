import { describe, expect, it } from 'vitest'
import {
  BUNDLE_KIND_LABELS,
  BUNDLE_MEMBER_KINDS,
  bundleMemberRejectReason,
  bundlePayloadJson,
  filterBundleCandidates,
  isBundleMemberKind,
  mergeBundleCandidates,
  parseBundleSelection,
  toggleBundleMember,
  type BundleCandidateLike,
  type BundleSelectionItem,
} from '../src/lib/plugins/bundle-builder.ts'

/** 原始候选（模拟 API 返回，kind 可能是任意字符串，含非法类型） */
function raw(partial: Partial<BundleCandidateLike> & { slug: string }): BundleCandidateLike {
  return { kind: 'site-pack', name: partial.slug, installCount: 0, ...partial }
}

describe('组合包成员选择器 · 契约常量', () => {
  it('成员类型仅限三种，且都有中文展示名', () => {
    expect(BUNDLE_MEMBER_KINDS).toEqual(['site-pack', 'search-pack', 'theme'])
    for (const kind of BUNDLE_MEMBER_KINDS) {
      expect(BUNDLE_KIND_LABELS[kind]).toBeTruthy()
    }
  })

  it('isBundleMemberKind 拒绝嵌套组合包与工作台预设', () => {
    expect(isBundleMemberKind('site-pack')).toBe(true)
    expect(isBundleMemberKind('search-pack')).toBe(true)
    expect(isBundleMemberKind('theme')).toBe(true)
    expect(isBundleMemberKind('bundle')).toBe(false)
    expect(isBundleMemberKind('workspace-preset')).toBe(false)
    expect(isBundleMemberKind(undefined)).toBe(false)
    expect(isBundleMemberKind(42)).toBe(false)
  })
})

describe('组合包成员选择器 · 校验与切换', () => {
  it('非法类型 / 自引用 / 重复 / 超限分别给出拒绝原因', () => {
    const current: BundleSelectionItem[] = [{ slug: 'a', kind: 'site-pack' }]
    expect(bundleMemberRejectReason(current, { slug: 'new', kind: 'theme' })).toBeNull()
    expect(bundleMemberRejectReason(current, { slug: 'new', kind: 'bundle' })).toContain('不支持嵌套组合包')
    expect(bundleMemberRejectReason(current, { slug: 'new', kind: 'workspace-preset' })).toContain(
      '不支持嵌套组合包',
    )
    expect(bundleMemberRejectReason(current, { slug: 'self', kind: 'site-pack' }, { selfSlug: 'self' })).toBe(
      '组合包不能引用自身',
    )
    expect(bundleMemberRejectReason(current, { slug: 'a', kind: 'theme' })).toBe('该插件已在成员列表中')

    const full = Array.from({ length: 12 }, (_, i) => ({ slug: `p-${i}`, kind: 'theme' as const }))
    expect(bundleMemberRejectReason(full, { slug: 'overflow', kind: 'theme' })).toContain('上限')
  })

  it('toggle 加入与移除成员；超限时列表保持不变并返回原因', () => {
    const first = toggleBundleMember([], { slug: 'alpha', kind: 'search-pack' })
    expect(first.error).toBeNull()
    expect(first.items).toEqual([{ slug: 'alpha', kind: 'search-pack' }])

    const removed = toggleBundleMember(first.items, { slug: 'alpha', kind: 'search-pack' })
    expect(removed.error).toBeNull()
    expect(removed.items).toEqual([])

    const full = Array.from({ length: 12 }, (_, i) => ({ slug: `p-${i}`, kind: 'theme' as const }))
    const overflow = toggleBundleMember(full, { slug: 'overflow', kind: 'theme' })
    expect(overflow.items).toHaveLength(12)
    expect(overflow.error).toContain('上限')
  })
})

describe('组合包成员选择器 · 候选合并与过滤', () => {
  const site = raw({ slug: 'front-end-arsenal', name: '前端军火库', installCount: 30 })
  const search = raw({ slug: 'dev-search-arsenal', kind: 'search-pack', installCount: 10 })
  const theme = raw({ slug: 'dracula-dark', kind: 'theme', installCount: 20 })
  const nested = raw({ slug: 'nested-bundle', kind: 'bundle', installCount: 99 })

  it('合并三批候选：去重、剔除非法类型、按安装量降序', () => {
    const merged = mergeBundleCandidates([[site, nested, { ...site, name: '重复覆盖' }], [search], [theme]])
    expect(merged.map((c) => c.slug)).toEqual(['front-end-arsenal', 'dracula-dark', 'dev-search-arsenal'])
    expect(merged[0].name).toBe('前端军火库')
  })

  it('关键词命中名称 / slug / 描述（忽略大小写），类型筛选走 all 或具体类型', () => {
    const withDesc = raw({ slug: 'quick-tools', name: '快捷工具', description: 'Chrome 插件合集' })
    const all = mergeBundleCandidates([[site, search, theme, withDesc]])

    expect(filterBundleCandidates(all, { query: 'ARSENAL' }).map((c) => c.slug)).toEqual([
      'front-end-arsenal',
      'dev-search-arsenal',
    ])
    expect(filterBundleCandidates(all, { query: 'chrome' }).map((c) => c.slug)).toEqual(['quick-tools'])
    expect(filterBundleCandidates(all, { kind: 'theme' }).map((c) => c.slug)).toEqual(['dracula-dark'])
    expect(filterBundleCandidates(all, { kind: 'all', query: '工具' }).map((c) => c.slug)).toEqual(['quick-tools'])
    expect(filterBundleCandidates(all, { query: '不存在' })).toEqual([])
  })
})

describe('组合包成员选择器 · payload JSON 往返', () => {
  it('bundlePayloadJson 生成可被 parseBundleSelection 还原的清单', () => {
    const items = [
      { slug: 'front-end-arsenal', kind: 'site-pack' as const },
      { slug: 'dracula-dark', kind: 'theme' as const },
    ]
    const json = bundlePayloadJson(items)
    expect(parseBundleSelection(json)).toEqual({ items, dropped: 0 })
    expect(parseBundleSelection(bundlePayloadJson([]))).toEqual({ items: [], dropped: 0 })
  })

  it('解析失败与非法条目静默丢弃并计数（非法类型 / 空 slug / 重复 / 超限）', () => {
    expect(parseBundleSelection('{ 不是 JSON')).toEqual({ items: [], dropped: 0 })
    expect(parseBundleSelection(JSON.stringify({ items: 'nope' }))).toEqual({ items: [], dropped: 0 })

    const messy = JSON.stringify({
      items: [
        { slug: 'ok', kind: 'site-pack' },
        { slug: 'ok', kind: 'theme' },
        { slug: 'nested', kind: 'bundle' },
        { slug: 'preset', kind: 'workspace-preset' },
        { slug: '   ', kind: 'theme' },
        { kind: 'theme' },
        ...Array.from({ length: 14 }, (_, i) => ({ slug: `p-${i}`, kind: 'search-pack' })),
      ],
    })
    const parsed = parseBundleSelection(messy)
    expect(parsed.items).toHaveLength(12)
    expect(parsed.items[0]).toEqual({ slug: 'ok', kind: 'site-pack' })
    // 丢弃：ok 重复 1 + 非法 3 + 超限 3（14 条只装下 11 条）+ 空 slug 1 = 8
    expect(parsed.dropped).toBe(8)
  })
})
