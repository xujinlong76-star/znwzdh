import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/lib/seo/origin'
import { hubGet } from '@/lib/server/hub'
import { MIN_SITES_FOR_INDEX } from '@/lib/seo/thresholds'
import { pluginSitemapEntries, type SitemapPluginRef } from '@/lib/plugins/sitemap'
import {
  collectionEntries,
  siteEntries,
  staticEntries,
  tagEntries,
  type CollectionRef,
  type SiteRef,
  type TagRef,
} from '@/lib/seo/sitemap-entries'

/**
 * 全站 sitemap：静态页 + 站点 + 达标标签 + 合集 + 已上架插件。
 *
 * 与上一版的三处差异：
 * 1. 站点必须带 `status=active` —— 不带时会返回 1020 条（含 7 条 broken），
 *    等于主动把 7 个软 404 提交给搜索引擎；
 * 2. 标签走 `/api/tags` 的 `count` 并按 `MIN_SITES_FOR_INDEX` 过滤，只提交 82 条；
 * 3. `force-dynamic` 改为 `revalidate = 3600` —— 前提是 `siteOrigin()` 先读到
 *    环境变量，否则仍会退化成动态渲染（属可接受降级）。
 *
 * 中枢不可用时只输出已取到的部分，绝不 500：sitemap 是辅助，不该因一次上游
 * 抖动把整站爬虫体验打穿。
 */

export const revalidate = 3600

const PAGE_SIZE = 100
/** 单次 sitemap 最多收录 5000 个插件，防止异常数据把响应拖到超时 */
const MAX_PAGES = 50
/** 站点翻页：4 页 × 500 = 2000 条余量，当前 active 1013 条绰绰有余 */
const SITE_PAGES = [0, 1, 2, 3]
const SITE_LIMIT = 500

async function loadPublishedPlugins(origin: string): Promise<SitemapPluginRef[]> {
  const rows: SitemapPluginRef[] = []

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE
    try {
      const res = await fetch(`${origin}/api/hub/plugins?limit=${PAGE_SIZE}&offset=${offset}`, {
        next: { revalidate: 3600 },
      })
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

  // 并行取四路数据；任何一路失败都返回 null，由下面的纯函数自然产出空数组
  const [plugins, sites, tags, collections] = await Promise.all([
    loadPublishedPlugins(origin),
    (async () => {
      const out: SiteRef[] = []
      for (const page of SITE_PAGES) {
        const rows = await hubGet<SiteRef[]>(
          `/api/sites?status=active&limit=${SITE_LIMIT}&offset=${page * SITE_LIMIT}`,
          3600,
        )
        if (!rows?.length) break
        out.push(...rows)
        if (rows.length < SITE_LIMIT) break
      }
      return out
    })(),
    hubGet<TagRef[]>('/api/tags', 3600),
    hubGet<CollectionRef[]>('/api/collections', 3600),
  ])

  return [
    ...staticEntries(origin),
    ...siteEntries(origin, sites),
    ...tagEntries(origin, tags ?? [], MIN_SITES_FOR_INDEX),
    ...collectionEntries(origin, collections ?? []),
    ...pluginSitemapEntries(origin, plugins),
  ]
}
