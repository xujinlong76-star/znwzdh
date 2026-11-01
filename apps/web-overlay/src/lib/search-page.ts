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

/**
 * 与中枢 /api/search 的 `tag: z.string().max(40)` 同值。
 * 中枢按 slug / 名称 / 别名三路匹配，所以这里只做长度与空白归一，不做 slug 化——
 * 名称里带空格是合法的（如「开发工具」），不能把它折成连字符。
 */
export const SEARCH_TAG_MAX_LENGTH = 40

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

/** 标签归一：同查询词的去控制字符/折叠空白；空串表示「没有标签筛选」 */
export function normalizeSearchTag(raw: string | string[] | undefined): string | null {
  const tag = first(raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_TAG_MAX_LENGTH)
    .trim()
  return tag || null
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


/**
 * 分类归一：与中枢 /api/search 的 categoryId 同形（slug 或 id，最长 64）。
 * 分类页把 URL 段直接透过来，URI 编码由调用方保证。
 */
export const SEARCH_CATEGORY_MAX_LENGTH = 64

export function normalizeSearchCategory(raw: string | string[] | undefined): string | null {
  const v = first(raw).trim().slice(0, SEARCH_CATEGORY_MAX_LENGTH).trim()
  return v || null
}

/**
 * 分面 URL 形态：`f_<key>=a,b`（多值逗号分隔，值内部不含逗号——受控词表的值
 * 都是 `open_source` 这类标识符）。刻意不用 JSON：URL 要可读、可手改、可分享，
 * 且搜索引擎与日志都能看懂。
 */
export function normalizeSearchFacets(
  sp: Record<string, string | string[] | undefined>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [rawKey, rawValue] of Object.entries(sp)) {
    if (!rawKey.startsWith('f_')) continue
    const key = rawKey.slice(2).trim().toLowerCase()
    if (!/^[a-z0-9_]{1,32}$/.test(key)) continue
    const values = (Array.isArray(rawValue) ? rawValue.join(',') : (rawValue ?? ''))
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter((v) => /^[a-z0-9_-]{1,32}$/.test(v))
    const unique = [...new Set(values)].slice(0, 8)
    if (unique.length > 0) out[key] = unique
  }
  return out
}

/** 分面转 URL 查询参数（供 searchHref 复用） */
function appendFacetParams(params: URLSearchParams, facets?: Record<string, string[] | undefined>): void {
  for (const [key, values] of Object.entries(facets ?? {})) {
    if (!key || !values || values.length === 0) continue
    const clean = values.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
    if (clean.length > 0) params.set('f_' + key, clean.join(','))
  }
}

/** 结果页 URL：第 1 页省略 page，空查询且无标签就是 /search */
export function searchHref(
  input: {
    q?: string
    page?: number
    tag?: string | null
    /** 分类 slug 或 id（分类页「全局搜索本分类」入口用） */
    category?: string | null
    /** 正交分面筛选（键 → 值数组） */
    facets?: Record<string, string[] | undefined>
  } = {},
): string {
  const q = normalizeSearchQuery(input.q)
  const tag = normalizeSearchTag(input.tag ?? undefined)
  const category = normalizeSearchCategory(input.category ?? undefined)
  const page = normalizeSearchPage(input.page === undefined ? undefined : String(input.page))
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (tag) params.set('tag', tag)
  if (category) params.set('category', category)
  appendFacetParams(params, input.facets)
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return qs ? `/search?${qs}` : '/search'
}

/**
 * 中枢取数路径：offset 由页码推出；status 默认 active（与分类页/标签页同口径）。
 *
 * status 之所以可换：全站有十余个站点因对方 401/403 反爬被巡检标成 broken，
 * 其中不乏 ChatGPT、npm 这类大站。active 把它们全部藏起来，用户搜准确名字
 * 反而零命中。调用方正是在「正常结果没有字面命中」时补取 broken 如实分区展示。
 */
export function searchApiPath(
  q: string,
  page: number,
  tag?: string | null,
  opts: {
    status?: 'active' | 'broken'
    category?: string | null
    facets?: Record<string, string[] | undefined>
  } = {},
): string {
  const params = new URLSearchParams({
    q: normalizeSearchQuery(q),
    status: opts.status ?? 'active',
    limit: String(SEARCH_PAGE_SIZE),
    offset: String((normalizeSearchPage(String(page)) - 1) * SEARCH_PAGE_SIZE),
  })
  const normalizedTag = normalizeSearchTag(tag ?? undefined)
  if (normalizedTag) params.set('tag', normalizedTag)
  const category = normalizeSearchCategory(opts.category ?? undefined)
  if (category) params.set('categoryId', category)
  // 中枢接受「整段 JSON 字符串」形态（GET query 的方括号嵌套不被 Fastify 默认 parser 解析）
  if (opts.facets && Object.keys(opts.facets).length > 0) {
    params.set('facets', JSON.stringify(opts.facets))
  }
  return `/api/search?${params.toString()}`
}

/**
 * 中枢会从查询里解析 `#标签` / `@分类` / 「开源」这类算子并自动加筛选。
 * 页面必须把这些条件说出来，否则用户看到结果变少/变了却不知道查询被「理解」过。
 * 分面键显示中文轴名，取值原样展示（受控词表在 core 侧，web 生产镜像不依赖它）。
 */
const FACET_KEY_LABELS: Record<string, string> = {
  pricing: '付费模式',
  platform: '平台',
  form: '形态',
  language: '语言',
  scene: '场景',
}

export function inferredConditionLabels(input: {
  inferredTag?: string
  inferredCategory?: string
  inferredFacets?: Record<string, string[]>
}): string[] {
  const out: string[] = []
  if (input.inferredTag) out.push(`标签「${input.inferredTag}」`)
  if (input.inferredCategory) out.push(`分类「${input.inferredCategory}」`)
  for (const [key, values] of Object.entries(input.inferredFacets ?? {})) {
    if (values.length > 0) out.push(`${FACET_KEY_LABELS[key] ?? key}「${values.join(' / ')}」`)
  }
  return out
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
