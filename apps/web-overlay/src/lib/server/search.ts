import { hubGet } from './hub'
import type { HubSearchResult } from '@/lib/navhub-api'
import { searchApiPath } from '@/lib/search-page'

/**
 * /search 的服务端取数。
 *
 * 不挂 Data Cache：中枢 /api/search 自身有 20s 响应缓存，这里再叠一层只会
 * 让刚点过的查询在页面上多停留一个窗口。失败返回 null，由页面把
 * 「检索服务没响应」与「零结果」分开渲染——把两者写成一个，用户会以为
 * 站点被删了。
 */
export async function loadSearchPage(
  q: string,
  page: number,
): Promise<{ result: HubSearchResult | null; failed: boolean }> {
  const result = await hubGet<HubSearchResult>(searchApiPath(q, page))
  return { result, failed: result === null }
}
