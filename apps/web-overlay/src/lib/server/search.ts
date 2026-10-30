import { hubGet } from './hub'
import type { HubSearchHit, HubSearchResult } from '@/lib/navhub-api'
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

export async function loadSearchPage(q: string, page: number, tag?: string | null): Promise<SearchPageData> {
  const result = await hubGet<HubSearchResult>(searchApiPath(q, page, tag))
  const failed = result === null
  let unavailable: HubSearchHit[] = []
  // 只在第 1 页补取：翻页时再插一段「不可用」列表会让分页语义错乱。
  // 补取失败（null）保持空列表——整页的「服务没响应」只由主查询决定。
  //
  // 不能只在主结果零字面命中时才补「Claude → Claude Code」这类查询：
  // 主结果有字面命中、但用户要找的正是那个被误判的站点。按标题去重，
  // 避免同一站点在正常结果与巡检分区各出现一次（如 Cursor 的两条记录）。
  if (!failed && page === 1 && q) {
    const broken = await hubGet<HubSearchResult>(searchApiPath(q, page, tag, { status: 'broken' }))
    const shownTitles = new Set(
      result.hits.map((hit) => hit.site?.title.trim().toLowerCase()).filter((title): title is string => !!title),
    )
    unavailable = (broken?.hits ?? []).filter(
      (hit) => hit.site && isLexicalHit(hit) && !shownTitles.has(hit.site.title.trim().toLowerCase()),
    )
  }
  return { result, failed, unavailable }
}
