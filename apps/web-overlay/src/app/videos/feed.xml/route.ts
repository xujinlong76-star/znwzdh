import { NextResponse } from 'next/server'
import { loadVideoCatalog } from '@/lib/video-catalog-read'
import { enrichVideoItemSeo, generateVideoRssFeed } from '@/lib/video-seo'
import { siteOrigin } from '@/lib/seo/origin'
import type { NavigationData, NavigationSubItem } from '@/types/navigation'

export const runtime = 'nodejs'

// 与顶层 /feed.xml 同款：显式声明 ISR 周期（与下方 Cache-Control 的
// s-maxage=3600 对齐）。缺这行时 Next 不会把该 Route Handler 纳入静态
// 生成，实测为 ƒ 动态——每个聚合器轮询都会整份重算 6007 条。
export const revalidate = 3600

export async function GET() {
  try {
    // 走分片读（loadVideoCatalog），理由同 sitemap.xml/route.ts
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

    // origin 口径与 sitemap.xml 完全一致：只认 NAVHUB_SITE_URL（siteOrigin）。
    // 此前裸读 request.headers 的 Host——读 headers 本身会把路由钉死为动态
    // （ƒ，ISR 永不生效），且 Host 可伪造、又带着 s-maxage 长缓存，等于把
    // 投毒结果放大。未配置时同 sitemap 返回 503，不用请求头兜底。
    const siteUrl = await siteOrigin()
    if (!siteUrl) {
      return new Response('feed origin unavailable', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '300' },
      })
    }

    const feed = generateVideoRssFeed(items, siteUrl)

    return new Response(feed, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to generate video RSS feed' }, { status: 500 })
  }
}
