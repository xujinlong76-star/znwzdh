import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/lib/seo/origin'
import { hubGet } from '@/lib/server/hub'
import { MIN_SITES_FOR_CATEGORY_INDEX, MIN_SITES_FOR_TAG_INDEX } from '@/lib/seo/thresholds'
import { descendantSiteCounts } from '@/lib/seo/category-totals'
import { pluginSitemapEntries, authorSitemapEntries, type SitemapPluginRef } from '@/lib/plugins/sitemap'
import {
  categoryEntries,
  collectionEntries,
  countCategorySites,
  siteEntries,
  staticEntries,
  tagEntries,
  type CategoryRef,
  type CollectionRef,
  type SiteRef,
  type TagRef,
} from '@/lib/seo/sitemap-entries'

/**
 * 全站 sitemap：静态页 + 站点 + 达标标签 + 达标分类 + 合集 + 已上架插件。
 *
 * 与上一版的三处差异：
 * 1. 站点必须带 `status=active` —— 不带时会返回 1020 条（含 7 条 broken），
 *    等于主动把 7 个软 404 提交给搜索引擎；
 * 2. 标签走 `/api/tags` 的 `count` 并按 `MIN_SITES_FOR_TAG_INDEX` 过滤——count 是
 *    **存活站点数**（2026-10-21 修了 listTagsWithCounts 的软删除计数污染后，
 *    数量随数据集浮动：当前 dev 库只有「大模型」1 条达标；站点集恢复后分层
 *    自动回填，无写死名单）；
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
/** 站点翻页上限：40 × 500 = 20000 条，超出属于异常数据，避免无限循环 */
const SITE_LIMIT = 500
const MAX_SITE_PAGES = 40

/**
 * 插件列表直连中枢，不再通过公开域名自取 /api/hub/plugins：
 * 自取依赖对外 origin 与 route 转发，且 origin 解析失败时整份 sitemap 直接为空。
 */
async function loadPublishedPlugins(): Promise<SitemapPluginRef[]> {
  const rows: SitemapPluginRef[] = []
  let fetched = 0

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE
    const body = await hubGet<{ items?: unknown; total?: unknown }>(
      `/api/plugins?limit=${PAGE_SIZE}&offset=${offset}&sort=updated`,
      3600,
    )
    if (!body) break

    const items = Array.isArray(body.items) ? body.items : []
    fetched += items.length

    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const record = item as { slug?: unknown; ownerKey?: unknown; updatedAt?: unknown; publishedAt?: unknown }
      rows.push({
        slug: typeof record.slug === 'string' ? record.slug : '',
        ownerKey: typeof record.ownerKey === 'string' ? record.ownerKey : null,
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : null,
        publishedAt: typeof record.publishedAt === 'number' ? record.publishedAt : null,
      })
    }

    const total = typeof body.total === 'number' ? body.total : fetched
    if (items.length < PAGE_SIZE || fetched >= total) break
  }

  return rows
}

/** 站点分页按实际返回长度推进，超过 20000 条才由 MAX_SITE_PAGES 截断。 */
async function loadActiveSites(): Promise<SiteRef[]> {
  const out: SiteRef[] = []
  for (let page = 0; page < MAX_SITE_PAGES; page += 1) {
    const rows = await hubGet<SiteRef[]>(
      `/api/sites?status=active&limit=${SITE_LIMIT}&offset=${page * SITE_LIMIT}`,
      3600,
    )
    if (!rows?.length) break
    out.push(...rows)
    if (rows.length < SITE_LIMIT) break
  }
  return out
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin()
  if (!origin) return []

  // 并行取五路数据；任何一路失败都返回 null，由下面的纯函数自然产出空数组
  const [plugins, sites, tags, categories, collections] = await Promise.all([
    loadPublishedPlugins(),
    loadActiveSites(),
    hubGet<TagRef[]>('/api/tags', 3600),
    hubGet<CategoryRef[]>('/api/categories', 3600),
    hubGet<CollectionRef[]>('/api/collections', 3600),
  ])

  return [
    ...staticEntries(origin),
    ...siteEntries(origin, sites),
    ...tagEntries(origin, tags ?? [], MIN_SITES_FOR_TAG_INDEX),
    // 根页也要进 sitemap：新树里它是一级导航入口，站点数来自子树聚合。
    // 直接把 countCategorySites 的原始计数喂进去，18 个根会全被门槛挡掉。
    ...categoryEntries(
      origin,
      categories ?? [],
      descendantSiteCounts(categories ?? [], countCategorySites(sites)),
      MIN_SITES_FOR_CATEGORY_INDEX,
    ),
    ...collectionEntries(origin, collections ?? []),
    ...pluginSitemapEntries(origin, plugins),
    ...authorSitemapEntries(origin, plugins),
  ]
}
