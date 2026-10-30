/**
 * /search 页的 URL 状态（q + page）。
 *
 * 背景：搜索此前只有客户端浮层，结果不可分享、不可回退；/me/history 的
 * 「再次搜索」链到 `/?q=` 也没有任何页面消费。这一页把查询词与页码放进
 * URL，服务端直出结果，浮层与历史页都指向这里。
 */

/** 每页 20 条：列表可扫读的密度，也让 offset 上限内的页数足够多 */
export const SEARCH_PAGE_SIZE = 20

/**
 * 中枢 /api/search 的 offset 上限是 1000（zod 硬限制）。页码必须夹在这里，
 * 否则第 51 页起会变成 400——页面会把「参数越界」误渲染成「检索服务挂了」。
 */
export const SEARCH_MAX_OFFSET = 1000

/**
 * 与 packages/core/search-limits.ts 的 MAX_SEARCH_QUERY_LENGTH 同值。
 * web 生产镜像只有 overlay、不依赖 @navhub/core（见 lib/health-state.ts 的
 * 同款说明），所以这里同构一份；两处都有用例钉住，改一处会红。
 */
export const SEARCH_QUERY_MAX_LENGTH = 256

export const SEARCH_MAX_PAGE_LINKS = 5

function first(raw: string | string[] | undefined): string {
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
}

/** 去控制字符、折叠空白、截断到中枢接受的长度；空串表示「没搜」 */
export function normalizeSearchQuery(raw: string | string[] | undefined): string {
  return first(raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_QUERY_MAX_LENGTH)
    .trim()
}

export function searchMaxPage(): number {
  return Math.floor(SEARCH_MAX_OFFSET / SEARCH_PAGE_SIZE) + 1
}

/** 页码归一：非数字 / 0 / 负数 → 1；超出中枢可取范围 → 最后一页 */
export function normalizeSearchPage(raw: string | string[] | undefined): number {
  const n = Number.parseInt(first(raw), 10)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, searchMaxPage())
}

/** 结果页 URL：第 1 页省略 page，空查询就是 /search */
export function searchHref(input: { q?: string; page?: number } = {}): string {
  const q = normalizeSearchQuery(input.q)
  const page = normalizeSearchPage(input.page === undefined ? undefined : String(input.page))
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return qs ? `/search?${qs}` : '/search'
}

/** 中枢取数路径：offset 由页码推出；status=active 与分类页/标签页同口径 */
export function searchApiPath(q: string, page: number): string {
  const params = new URLSearchParams({
    q: normalizeSearchQuery(q),
    status: 'active',
    limit: String(SEARCH_PAGE_SIZE),
    offset: String((normalizeSearchPage(String(page)) - 1) * SEARCH_PAGE_SIZE),
  })
  return `/api/search?${params.toString()}`
}

/**
 * 页码窗口：只画「已经走到过 / 确定存在」的页。
 *
 * 中枢响应只给 hasMore，不给总页数——hasMore 只保证下一页还有内容，
 * 多画更远的页码就是在赌那些页非空。因此 hasMore 时最多多看一格。
 */
export function searchPageWindow(current: number, hasMore: boolean): number[] {
  const c = normalizeSearchPage(String(current))
  const last = hasMore ? Math.min(searchMaxPage(), c + 1) : c
  const from = Math.max(1, last - SEARCH_MAX_PAGE_LINKS + 1)
  const pages: number[] = []
  for (let page = from; page <= last; page += 1) pages.push(page)
  return pages
}
