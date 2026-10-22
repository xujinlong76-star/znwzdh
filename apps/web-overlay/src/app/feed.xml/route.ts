import { getFileContent } from '@/lib/github'
import { hubGet } from '@/lib/server/hub'
import { siteOrigin } from '@/lib/seo/origin'
import { buildSiteFeedXml } from '@/lib/seo/feed'
import type { HubSite } from '@/lib/navhub-api'

/**
 * RSS 2.0：最新收录站点（`/api/rank/new`，与 /hot 新品榜同源）。
 *
 * 为什么放 Route Handler：feed 不是页面，不该进路由树参与布局与 metadata；
 * 纯文本响应也没必要走 RSC 渲染。
 *
 * `revalidate=3600`：feed 是聚合器高频轮询对象，一小时粒度足够；Data Cache
 * 让轮询不再每次打穿中枢。`siteOrigin()` 在配置了 NAVHUB_SITE_URL 时纯静态，
 * 未配置才回退请求头（此时路由退化为动态，可接受）。
 */

export const revalidate = 3600

const SITE_PATH = 'src/navsphere/content/site.json'
const FEED_LIMIT = 50

type SiteConfig = { basic?: { title?: string; description?: string } }

export async function GET() {
  const origin = await siteOrigin()
  if (!origin) {
    // 没有 origin 就拼不出绝对链接；给聚合器一个可重试的明确信号
    return new Response('feed origin unavailable', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '300' },
    })
  }

  const [rankRes, siteConfig] = await Promise.all([
    hubGet<{ hits: Array<{ site: HubSite }> }>('/api/rank/new?limit=' + FEED_LIMIT, 600),
    getFileContent<SiteConfig>(SITE_PATH).catch(() => {
      // 站点配置只影响 feed 标题与描述，读不到时退回默认值，不该阻断订阅
      return null
    }),
  ])

  const sites = (rankRes?.hits ?? [])
    .map((hit) => hit.site)
    .filter((site): site is HubSite => Boolean(site) && site.status === 'active')

  const xml = buildSiteFeedXml({
    origin,
    title: siteConfig?.basic?.title ?? '站点导航',
    description: siteConfig?.basic?.description ?? null,
    sites,
    lastBuildDate: Date.now(),
    limit: FEED_LIMIT,
  })

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
