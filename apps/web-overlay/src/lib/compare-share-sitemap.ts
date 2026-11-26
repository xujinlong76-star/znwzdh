/**
 * 对比分享公开页的 sitemap 条目构造（P13，纯函数，单测覆盖）。
 *
 * 与 `lib/plugins/sitemap.ts` 的 pluginSitemapEntries 同一模式：
 * 路由（app/sitemap.ts）只负责取数与拼装，「选哪些 URL、如何编码、时间戳
 * 是否有效」抽成纯函数。
 *
 * 阻塞（2026-11-26 实测）：中枢 `apps/api/src/routes/compare-share.ts`
 * 只有 POST 发布 / GET :slug 单查 / PATCH / DELETE，没有
 * `GET /api/compare/shares` 列表接口；仓库里也没有对应的 repo 列表方法。
 * 因此 app/sitemap.ts 里的 loader 目前取不到任何 slug、产出 0 条——这是
 * 待中枢补列表接口后才能打通的最后一环，不是本文件的缺陷；不要为凑数
 * 在这里手写 slug、猜 URL 或读快照表。
 */

import { toDate } from '@/lib/seo/sitemap-entries'

export interface CompareShareSitemapRef {
  slug: string
  updatedAt?: number | null
  publishedAt?: number | null
}

export interface CompareShareSitemapEntry {
  url: string
  lastModified?: Date
  changeFrequency: 'weekly'
  priority: number
}

/** slug 上限与插件清单校验一致，超长视为脏数据直接跳过 */
const MAX_SLUG_LENGTH = 200

function normalizeBase(base: string): string {
  return base.replace(/\/+$/, '')
}

/**
 * 生成已发布对比分享的公开页条目：
 * - 同一 slug 只出现一次（分页期间可能重复）；
 * - 空 slug / 超长 slug 跳过，避免 sitemap 出现无效 URL；
 * - 时间戳优先 updatedAt，缺失或非法时回退 publishedAt，均非法则不带
 *   lastModified（宁可不给，也不要给 1970 年让搜索引擎误判）。
 * 快照页是冻结只读页：changeFrequency 'weekly'（只表示复核节奏）、
 * priority 0.6（低于站点详情页，不抢收录权重）。
 */
export function compareShareSitemapEntries(
  base: string,
  shares: CompareShareSitemapRef[],
): CompareShareSitemapEntry[] {
  const root = normalizeBase(base)
  const seen = new Set<string>()
  const entries: CompareShareSitemapEntry[] = []

  for (const share of shares ?? []) {
    const slug = typeof share?.slug === 'string' ? share.slug.trim() : ''
    if (!slug || slug.length > MAX_SLUG_LENGTH || seen.has(slug)) continue
    seen.add(slug)

    const lastModified = toDate(share.updatedAt) ?? toDate(share.publishedAt)

    entries.push({
      url: `${root}/pub/compare/${encodeURIComponent(slug)}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: 'weekly',
      priority: 0.6,
    })
  }

  return entries
}
