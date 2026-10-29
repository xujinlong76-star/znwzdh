import { NextResponse } from 'next/server'
import { getFileContent } from '@/lib/github'
import { enrichVideoItemSeo, generateVideoSitemapXml } from '@/lib/video-seo'
import type { NavigationData, NavigationSubItem } from '@/types/navigation'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const rawData = (await getFileContent('src/navsphere/content/videos.json')) as NavigationData
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

    const host = request.headers.get('host') || 'localhost:3000'
    const protocol = host.startsWith('localhost') ? 'http' : 'https'
    const siteUrl = `${protocol}://${host}`

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
