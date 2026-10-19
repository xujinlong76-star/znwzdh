import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MARKETPLACE_SORT,
  buildMarketplaceQuery,
  parseMarketplaceFilters,
} from '../src/lib/plugins/marketplace-filters.ts'

describe('marketplace filters URL contract', () => {
  it('parses search, kind and sort for unified-search deep links', () => {
    expect(parseMarketplaceFilters('?q=%E5%BC%80%E5%8F%91%E8%80%85&kind=theme&sort=rating')).toEqual({
      kind: 'theme',
      q: '开发者',
      sort: 'rating',
    })
  })

  it('falls back to safe defaults for unknown or malformed values', () => {
    expect(parseMarketplaceFilters('?kind=bundle&sort=hot&q=%20%20')).toEqual({
      kind: '',
      q: '',
      sort: DEFAULT_MARKETPLACE_SORT,
    })
  })

  it('omits the default sort and keeps a clean empty query', () => {
    expect(
      buildMarketplaceQuery({ kind: '', q: '', sort: DEFAULT_MARKETPLACE_SORT }),
    ).toBe('')
  })

  it('round-trips Chinese search terms and non-default filters', () => {
    const state = { kind: 'search-pack', q: '快捷 搜索', sort: 'popular' as const }
    const query = buildMarketplaceQuery(state)
    expect(query).toBe('?kind=search-pack&q=%E5%BF%AB%E6%8D%B7+%E6%90%9C%E7%B4%A2&sort=popular')
    expect(parseMarketplaceFilters(query)).toEqual(state)
  })
})
