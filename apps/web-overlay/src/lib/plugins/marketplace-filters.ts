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

/** 计数型排序（安装 / 星标 / 评分 / 飙升）。种子 install/star/review 全 0 时
 * 这些排序键全部相等、只剩 created_at 倒序兜底，与「最新发布」同序——是现状，
 * 不是数据分化；页面须如实注明，不得编假数据让排序看起来分化。 */
export const COUNT_SORTS: readonly MarketplaceSort[] = ['popular', 'stars', 'rating', 'trending']

/**
 * 计数型排序是否退化：已加载项的安装、星标、评价全为 0。
 * 排序把最大值放最前，首屏全 0 即全局全 0（飙升分母的年龄项同样是时间单调），
 * 因此只看已加载项即可判定，不必多取一页。
 *
 * reportCount 只影响 trending：飙升分含 `- report_count * 10`，任一插件
 * reportCount > 0 且与其它插件不等时 trending 即与 new 分叉，注明失效；
 * popular / stars / rating 的排序键完全不含 report_count，reportCount > 0
 * 时这三种排序的注明仍为真，不得一并撤掉（共享 every() 里加 reportCount
 * 校验是错的，会过度抑制）。因此按 sort 分支：仅 trending 检查 reportCount。
 */
export function isCountSortDegenerate(
  sort: MarketplaceSort,
  items: readonly { installCount: number; starCount: number; reviewCount?: number; reportCount?: number }[],
): boolean {
  if (!COUNT_SORTS.includes(sort)) return false
  if (items.length === 0) return false
  if (!items.every((p) => p.installCount === 0 && p.starCount === 0 && (p.reviewCount ?? 0) === 0)) return false
  if (sort === 'trending') return items.every((p) => (p.reportCount ?? 0) === 0)
  return true
}

export interface MarketplaceFilterState {
  kind: string
  sort: MarketplaceSort
  q: string
  /** 只看已星标（per-identity 视图；无身份时为空） */
  starred: boolean
}

function includes<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value)
}

/** 解析 URL 查询串；非法类型/排序回退到安全默认值，未知 kind 视为不过滤。 */
export function parseMarketplaceFilters(search: string): MarketplaceFilterState {
  const params = new URLSearchParams(search)
  const rawKind = params.get('kind')?.trim() ?? ''
  const rawSort = params.get('sort')?.trim() ?? ''
  const rawStarred = params.get('starred')?.trim() ?? ''
  return {
    kind: includes(MARKETPLACE_KINDS, rawKind) ? rawKind : '',
    q: params.get('q')?.trim() ?? '',
    sort: includes(MARKETPLACE_SORTS, rawSort) ? rawSort : DEFAULT_MARKETPLACE_SORT,
    starred: rawStarred === '1' || rawStarred === 'true',
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
  if (state.starred) params.set('starred', '1')
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}
