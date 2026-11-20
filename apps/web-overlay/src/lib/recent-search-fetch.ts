/**
 * 最近搜索轻量读取端（U-321）。
 *
 * 为什么单立一个模块而不复用 `fetchSearchHistoryPage`（lib/navhub-api.ts）：
 * 那个函数没错，但 import 它会把 134KB 的中枢客户端整个值拉进 /search 首屏
 * chunk——`lib/search-history-record.ts` 顶部注释记的教训就是同一笔账
 *（/sites 曾因此各超预算 57KB）。本模块只依赖 fetch + `toRecentSearchItems`，
 * 线路形状与 `fetchSearchHistoryPage` 逐字一致：
 *   GET /api/hub/search-history?limit=N（同源代理转发到中枢）
 *   头：X-Navhub-Anon-Id（匿名身份）+ 有 token 时 Authorization: Bearer
 *   （中枢规则：带有效 Bearer 时强制绑定 token 身份、忽略自报 anonId，
 *   见 apps/api/src/server.ts resolveIdentity；不带这头会把登录用户的
 *   历史读成匿名历史——与面板行为不一致）。
 *
 * 失败一律返回 []：取不到就当没有，不抛错、不弹提示——chips 是附加信息，
 * 缺了比整页报错好（与热词 chips 的降级口径一致）。
 *
 * 本模块只在浏览器里调（身份在 localStorage，服务端读不到，见下）。
 */

import type { HubSearchHistoryItem } from '@/lib/navhub-api' // 仅类型（编译期擦除，零包体；recent-search.ts 同款）
import { toRecentSearchItems } from './recent-search'

/** 与 navhub-api.ts 的 API_TOKEN_KEY 同值（轻量复制，不 import 那个大模块）。 */
const API_TOKEN_KEY = 'navhub_api_token'

function bearerHeader(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const t = localStorage.getItem(API_TOKEN_KEY)
    return t && t.trim() ? { Authorization: 'Bearer ' + t.trim() } : {}
  } catch {
    return {}
  }
}

/**
 * 取当前身份的最近搜索查询词（已按词去重、只留最近一条，面板同口径）。
 *
 * 服务端调不了它：身份只存在浏览器 localStorage（`lib/identity.ts`，
 * SSR 返回空串），服务端 `hubGet` 不带身份头，GET /api/search-history
 * 无身份时只会返回 `{ items: [] }`。所以 /search 空态的最近搜索必须由
 * 客户端岛在挂载后取——chips 本身仍是普通 <a>，点选不需要 JS。
 */
export async function fetchRecentSearchQueries(identity: string, limit = 8): Promise<string[]> {
  if (!identity) return []
  try {
    const res = await fetch('/api/hub/search-history?limit=' + Math.max(1, Math.trunc(limit)), {
      headers: {
        Accept: 'application/json',
        ...bearerHeader(),
        'X-Navhub-Anon-Id': identity,
      },
    })
    if (!res.ok) return []
    const data = (await res.json()) as { items?: unknown }
    if (!data || !Array.isArray(data.items)) return []
    const items = data.items.filter(
      (item): item is HubSearchHistoryItem =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { id?: unknown }).id === 'number' &&
        typeof (item as { query?: unknown }).query === 'string' &&
        typeof (item as { resultCount?: unknown }).resultCount === 'number' &&
        typeof (item as { createdAt?: unknown }).createdAt === 'number',
    )
    return toRecentSearchItems(items).map((item) => item.query)
  } catch {
    return []
  }
}
