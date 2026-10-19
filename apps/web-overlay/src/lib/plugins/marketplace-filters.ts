/**
 * 插件市场筛选条件的 URL 契约。
 *
 * 统一搜索面板的「查看全部插件结果」会跳转 `/marketplace?q=...`，
 * 因此列表页必须能解析并回写这些参数：刷新、收藏、分享和浏览器前进/后退
 * 都要落在同一组筛选条件上。
 *
 * 这里保持纯函数，方便单测覆盖非法参数与编码边界。
 */

export const MARKETPLACE_KINDS = [
  'site-pack',
  'workspace-preset',
  'theme',
  'search-pack',
  'bundle',
] as const

export const MARKETPLACE_SORTS = [
  'trending',
  'new',
  'popular',
  'stars',
  'rating',
  'updated',
] as const

export type MarketplaceKind = (typeof MARKETPLACE_KINDS)[number]
export type MarketplaceSort = (typeof MARKETPLACE_SORTS)[number]

export const DEFAULT_MARKETPLACE_SORT: MarketplaceSort = 'trending'

export interface MarketplaceFilterState {
  kind: string
  sort: MarketplaceSort
  q: string
}

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value)
}

/** 解析 URL 查询串；非法类型/排序回退到安全默认值，未知 kind 视为不过滤。 */
export function parseMarketplaceFilters(search: string): MarketplaceFilterState {
  const params = new URLSearchParams(search)
  const rawKind = params.get('kind')?.trim() ?? ''
  const rawSort = params.get('sort')?.trim() ?? ''
  return {
    kind: includes(MARKETPLACE_KINDS, rawKind) ? rawKind : '',
    q: params.get('q')?.trim() ?? '',
    sort: includes(MARKETPLACE_SORTS, rawSort) ? rawSort : DEFAULT_MARKETPLACE_SORT,
  }
}

/**
 * 生成需要写回地址栏的查询串。
 * 默认排序不写入，保持 `/marketplace` 干净；其余参数按稳定顺序输出。
 */
export function buildMarketplaceQuery(state: MarketplaceFilterState): string {
  const params = new URLSearchParams()
  if (state.kind) params.set('kind', state.kind)
  if (state.q) params.set('q', state.q)
  if (state.sort !== DEFAULT_MARKETPLACE_SORT) params.set('sort', state.sort)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}
