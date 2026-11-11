import { NextResponse } from 'next/server'
import { loadVideoCatalog } from '@/lib/video-catalog-read'
import { enrichVideoItemSeo, generateVideoSitemapXml } from '@/lib/video-seo'
import { siteOrigin } from '@/lib/seo/origin'
import type { NavigationData, NavigationSubItem } from '@/types/navigation'

export const runtime = 'nodejs'

export async function GET() {
  try {
    // 走分片读（loadVideoCatalog）：整包读是 no-store 实时打中枢，自托管无 CDN
    // 时爬虫每次抓取都是一次 7MB 整包读；分片进 Data Cache 后稳态零穿透，
    // 分片不可用时自动回落整包读，产物逐字不变。
    const rawData = (await loadVideoCatalog()).data as NavigationData
    const items: NavigationSubItem[] = []

    for (const cat of rawData?.navigationItems || []) {
      if (cat.items) {
        for (const it of cat.items) items.push(enrichVideoItemSeo(it, cat.title))
      }
      if (cat.subCategories) {
        for (const sub of cat.subCategories) {
          if (sub.items) {
            for (const it of sub.items) items.push(enrichVideoItemSeo(it, `${cat.title} ${sub.title}`))
          }
        }
      }
    }

    // origin 只能来自 NAVHUB_SITE_URL（经 normalizeConfiguredOrigin 收敛）；
    // 裸读 Host 头 + s-maxage=3600 会让一次投毒把整份 sitemap 缓存成攻击者域名。
    // 未配置时与 feed.xml 同口径返回 503，不用可伪造的请求头兜底。
    const siteUrl = await siteOrigin()
    if (!siteUrl) {
      return new Response('sitemap origin unavailable', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '300' },
      })
    }

    const sitemap = generateVideoSitemapXml(items, siteUrl)

    return new Response(sitemap, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to generate video sitemap' }, { status: 500 })
  }
}
