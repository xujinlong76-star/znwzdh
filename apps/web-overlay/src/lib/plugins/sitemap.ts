/**
 * 插件市场 sitemap 条目构造（纯函数，单测覆盖）。
 *
 * 为什么从 app/sitemap.ts 里拆出来：元数据路由要读 headers() 并 fetch 中枢，
 * 在单测里既难启动也不稳定；把「选哪些 URL、如何编码、时间戳是否有效」抽成
 * 纯函数，路由只负责取数与拼装。
 */

export interface SitemapPluginRef {
  slug: string
  updatedAt?: number | null
  publishedAt?: number | null
}

export interface PluginSitemapEntry {
  url: string
  lastModified?: Date
  changeFrequency: 'weekly'
  priority: number
}

/** slug 上限与插件清单校验一致（core 的清单约束），超长视为脏数据直接跳过 */
const MAX_SLUG_LENGTH = 200

function normalizeBase(base: string): string {
  return base.replace(/\/+$/, '')
}

function validTimestamp(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * 生成已上架插件的详情页条目：
 * - 同一 slug 只出现一次（分页期间可能有新插件挤入导致重复）；
 * - 空 slug / 超长 slug 跳过，避免 sitemap 出现无效 URL；
 * - 时间戳优先 updatedAt，缺失或非法时回退 publishedAt，均非法则不带 lastModified
 *   （宁可不给，也不要给 1970 年让搜索引擎误判）。
 */
export function pluginSitemapEntries(
  base: string,
  plugins: SitemapPluginRef[],
): PluginSitemapEntry[] {
  const root = normalizeBase(base)
  const seen = new Set<string>()
  const entries: PluginSitemapEntry[] = []

  for (const plugin of plugins) {
    const slug = typeof plugin.slug === 'string' ? plugin.slug.trim() : ''
    if (!slug || slug.length > MAX_SLUG_LENGTH || seen.has(slug)) continue
    seen.add(slug)

    const lastModified = validTimestamp(plugin.updatedAt)
      ? new Date(plugin.updatedAt)
      : validTimestamp(plugin.publishedAt)
        ? new Date(plugin.publishedAt)
        : undefined

    entries.push({
      url: `${root}/marketplace/${encodeURIComponent(slug)}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: 'weekly',
      priority: 0.7,
    })
  }

  return entries
}
