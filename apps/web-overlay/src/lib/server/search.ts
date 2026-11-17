import { hubGet } from './hub'
import type { HubPluginSearchResponse, HubSearchHit, HubSearchResult } from '@/lib/navhub-api'
import { searchApiPath } from '@/lib/search-page'

/**
 * /search 的服务端取数。
 *
 * 不挂 Data Cache：中枢 /api/search 自身有 20s 响应缓存，这里再叠一层只会
 * 让刚点过的查询在页面上多停留一个窗口。失败返回 null，由页面把
 * 「检索服务没响应」与「零结果」分开渲染——把两者写成一个，用户会以为
 * 站点被删了。
 */
export interface SearchPageData {
  result: HubSearchResult | null
  failed: boolean
  /**
   * 字面匹配但最近巡检打不开的站点。
   *
   * 巡检把 401/403 反爬误判成 broken 后，status=active 会把这些大站
   * （ChatGPT、npm 等）整个藏起来：用户搜准确名字反而零命中，或只剩
   * 语义近邻。每次检索都补取一次 broken，按标题去重后如实分区展示。
   */
  unavailable: HubSearchHit[]
  /**
   * 与查询词匹配的插件（GET /api/plugins/search，语义优先、模型不可用时
   * 关键词回退）。取数失败为 null——插件分区整块不渲染，站点结果不受影响；
   * 「去插件市场搜」出口不依赖这次取数，零结果页直接链 /marketplace?q=…。
   */
  plugins: HubPluginSearchResponse | null
}

/**
 * 是否字面命中。语义 KNN 对任何输入都返回最近邻（乱码也有「最像的」），
 * 不算命中——否则每个查询都会拖出 broken 池里的语义近邻。
 */
function isLexicalHit(hit: HubSearchHit): boolean {
  return Object.keys(hit.contributions ?? {}).some(
    (channel) => channel === 'exact' || channel === 'fts' || channel === 'pinyin',
  )
}

export async function loadSearchPage(
  q: string,
  page: number,
  tag?: string | null,
  opts: { category?: string | null; facets?: Record<string, string[]>; nocorrect?: boolean } = {},
): Promise<SearchPageData> {
  // P1-3：/search 只取站点，浮层能搜到的插件在结果页凭空消失。
  // 与站点检索并行取插件（复用 GET /api/plugins/search，前 5 条）：
  // 只在第 1 页取——插件检索无分页，翻页再插一段插件分区会让分页语义错乱；
  // 无 q（纯标签/分类浏览）不取；取数失败（hubGet 返回 null）只隐藏分区。
  // 超时 5s（hubGet 默认 10s 太长，插件慢查询不得拖住整页首屏）；
  // revalidate=0 不挂 Data Cache（中枢自有 20s 缓存，search.ts 头部口径）。
  const [result, plugins] = await Promise.all([
    hubGet<HubSearchResult>(
      searchApiPath(q, page, tag, { category: opts.category, facets: opts.facets, nocorrect: opts.nocorrect }),
    ),
    q && page === 1
      ? hubGet<HubPluginSearchResponse>(`/api/plugins/search?q=${encodeURIComponent(q)}&limit=5`, 0, 5000)
      : Promise.resolve(null),
  ])
  const failed = result === null
  let unavailable: HubSearchHit[] = []
  // 只在第 1 页补取：翻页时再插一段「不可用」列表会让分页语义错乱。
  // 补取失败（null）保持空列表——整页的「服务没响应」只由主查询决定。
  //
  // 不能只在主结果零字面命中时才补「Claude → Claude Code」这类查询：
  // 主结果有字面命中、但用户要找的正是那个被误判的站点。按标题去重，
  // 避免同一站点在正常结果与巡检分区各出现一次（如 Cursor 的两条记录）。
  if (!failed && page === 1 && q) {
    const broken = await hubGet<HubSearchResult>(
      searchApiPath(q, page, tag, { status: 'broken', category: opts.category, facets: opts.facets }),
    )
    const shownTitles = new Set(
      result.hits.map((hit) => hit.site?.title.trim().toLowerCase()).filter((title): title is string => !!title),
    )
    unavailable = (broken?.hits ?? []).filter(
      (hit) => hit.site && isLexicalHit(hit) && !shownTitles.has(hit.site.title.trim().toLowerCase()),
    )
  }
  return { result, failed, unavailable, plugins }
}
