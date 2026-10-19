import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { pluginSitemapEntries, type SitemapPluginRef } from '@/lib/plugins/sitemap'

/**
 * 全站 sitemap（首页 + 市场入口 + 已上架插件详情）。
 *
 * 与 opengraph-image 同样的 origin 推导：从请求头取 host 与 x-forwarded-proto，
 * 不引入部署相关环境变量，自托管换域名无需改配置（反向代理需转发 Host）。
 *
 * 中枢不可用时返回已取到的静态条目而不是 500：sitemap 是 SEO 辅助，
 * 不该因为一次上游抖动把整站爬虫体验打穿。
 */

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100
/** 单次 sitemap 最多收录 5000 个插件，防止异常数据把响应拖到超时 */
const MAX_PAGES = 50

async function siteOrigin(): Promise<string | null> {
  const h = await headers()
  const host = h.get('host')
  if (!host) return null
  const proto = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]!.trim()
  return `${proto}://${host}`
}

async function loadPublishedPlugins(origin: string): Promise<SitemapPluginRef[]> {
  const rows: SitemapPluginRef[] = []

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE
    try {
      const res = await fetch(
        `${origin}/api/hub/plugins?limit=${PAGE_SIZE}&offset=${offset}`,
        { next: { revalidate: 300 } },
      )
      if (!res.ok) break

      const body = (await res.json()) as { items?: unknown; total?: unknown }
      const items = Array.isArray(body.items) ? body.items : []

      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const record = item as { slug?: unknown; updatedAt?: unknown; publishedAt?: unknown }
        rows.push({
          slug: typeof record.slug === 'string' ? record.slug : '',
          updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : null,
          publishedAt: typeof record.publishedAt === 'number' ? record.publishedAt : null,
        })
      }

      const total = typeof body.total === 'number' ? body.total : rows.length
      if (items.length < PAGE_SIZE || rows.length >= total) break
    } catch {
      // 中枢不可用：保留已取到的部分（静态条目照常输出）
      break
    }
  }

  return rows
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin()
  if (!origin) return []

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${origin}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${origin}/marketplace`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${origin}/hot`, changeFrequency: 'daily', priority: 0.6 },
  ]

  const plugins = await loadPublishedPlugins(origin)
  return [...staticEntries, ...pluginSitemapEntries(origin, plugins)]
}
