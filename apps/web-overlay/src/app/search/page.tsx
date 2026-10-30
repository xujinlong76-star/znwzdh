import type { Metadata } from 'next'
import { loadSearchPage } from '@/lib/server/search'
import { normalizeSearchPage, normalizeSearchQuery, normalizeSearchTag } from '@/lib/search-page'
import { SearchResults } from './search-results'

/**
 * 全站搜索结果页（可分享 / 可回退的 URL 状态）。
 *
 * 背景：搜索此前只有客户端浮层（SearchPalette），结果不可分享、不可回退；
 * /me/history 的「再次搜索」链到 `/?q=`，没有任何页面消费这个参数。
 * 这一页把 q/page 放进 URL，服务端直出结果，浮层与历史页都指向这里。
 *
 * 索引口径：搜索结果一律 noindex,follow（与 /marketplace 筛选视图同口径）。
 * 结果随查询词与数据随时变化，收进索引只会制造重复且很快过期的页面；
 * follow 保留，让结果行里的 /site/{id} 详情页仍有内链权重。
 * 页面**不进 sitemap**，robots.txt 也**刻意不 Disallow**——禁抓会让爬虫
 * 读不到这里的 noindex。
 */
export const dynamic = 'force-dynamic'

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const sp = await searchParams
  const q = normalizeSearchQuery(sp.q)
  const tag = normalizeSearchTag(sp.tag)
  // 查询词进标题前先截断：不把用户输入的长串原样铺到浏览器标签/分享卡里
  const title = q
    ? `搜索：${q.slice(0, 40)}`
    : tag
      ? `标签：${tag.slice(0, 40)}`
      : '搜索站点'
  const description = q
    ? `站内检索“${q.slice(0, 60)}”的匹配站点${tag ? `，限标签「${tag.slice(0, 40)}」` : ''}，支持中文、拼音与语义检索。`
    : tag
      ? `浏览标签「${tag.slice(0, 40)}」下的全部收录站点。`
      : '按关键词检索站内收录的全部站点，支持中文、拼音与语义检索。'

  // 显式写 `title:` / `description:`（不用对象简写）：
  // test/route-titles.test.ts 靠正则识别标题来源，简写会被判定成「这个路由没有标题」。
  return {
    title: title,
    description: description,
    robots: { index: false, follow: true },
  }
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const sp = await searchParams
  const q = normalizeSearchQuery(sp.q)
  const page = normalizeSearchPage(sp.page)
  const tag = normalizeSearchTag(sp.tag)
  // 只有标签没有关键词也是有效查询：展示该标签下的站点，与标签页同口径但保留分页
  const { result, failed, unavailable } =
    q || tag ? await loadSearchPage(q, page, tag) : { result: null, failed: false, unavailable: [] }

  return (
    <SearchResults q={q} page={page} tag={tag} result={result} failed={failed} unavailable={unavailable} />
  )
}
