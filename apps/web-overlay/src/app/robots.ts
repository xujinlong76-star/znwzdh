import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'

/**
 * robots.txt：公开内容放行，后台 / API / 个人数据不收录。
 *
 * 与 sitemap 一样按请求推导 origin，确保 sitemap 指向当前部署域名
 * （自托管常见反代 + 自定义域名，写死 localhost 会误导爬虫）。
 */

export const dynamic = 'force-dynamic'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const h = await headers()
  const host = h.get('host')
  const proto = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]!.trim()
  const origin = host ? `${proto}://${host}` : ''

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api/', '/preferences', '/favorites'],
      },
    ],
    ...(origin ? { sitemap: `${origin}/sitemap.xml`, host: origin } : {}),
  }
}
