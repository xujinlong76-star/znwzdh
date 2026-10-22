/**
 * RSS 2.0 生成（纯函数，可单测）。
 *
 * 站点标题/描述来自用户可编辑的数据，必须逐字段转义：一个 `</title>` 或
 * `&` 就能让整份 XML 解析失败（聚合器直接丢弃 feed）。
 *
 * URL 与 JSON-LD / sitemap 同一编码规则：`/site/{encodeURIComponent(id)}`，
 * 保证 feed 里的链接与站内链接、结构化数据指向同一地址。
 */

export interface FeedSite {
  id: string
  title: string
  description?: string | null
  tags?: string[]
  createdAt?: number
}

export interface FeedInput {
  origin: string
  title: string
  description?: string | null
  sites: FeedSite[]
  /** 频道构建时间（毫秒），默认 now */
  lastBuildDate?: number
  /** 单次 feed 的条目上限；分页不在 RSS 语义内 */
  limit?: number
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

/** XML 1.0 合法字符之外的 C0 控制符（换行/制表符保留） */
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

export function escapeXml(value: string): string {
  return value.replace(INVALID_XML_CHARS, '').replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]!)
}

function toRfc822(ms: number | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  return date.toUTCString()
}

export function buildSiteFeedXml({
  origin,
  title,
  description,
  sites,
  lastBuildDate = Date.now(),
  limit = 50,
}: FeedInput): string {
  const base = origin.replace(/\/+$/, '')
  const self = `${base}/feed.xml`
  const items = (sites ?? []).filter((site) => site?.id?.trim() && site?.title?.trim()).slice(0, limit)

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(base + '/')}</link>`,
    `    <description>${escapeXml(description || `${title} 最新收录的站点`)}</description>`,
    '    <language>zh-CN</language>',
    `    <lastBuildDate>${new Date(lastBuildDate).toUTCString()}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml" />`,
  ]

  for (const site of items) {
    const link = `${base}/site/${encodeURIComponent(site.id)}`
    const tags = (site.tags ?? []).filter((tag) => tag.trim()).slice(0, 5)
    const summary =
      (site.description ?? '').trim() || `${site.title}${tags.length ? `（${tags.join(' / ')}）` : ''}`
    const pubDate = toRfc822(site.createdAt)
    lines.push(
      '    <item>',
      `      <title>${escapeXml(site.title)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="false">navhub:site:${escapeXml(site.id)}</guid>`,
      `      <description>${escapeXml(summary)}</description>`,
      ...(pubDate ? [`      <pubDate>${pubDate}</pubDate>`] : []),
      ...tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
      '    </item>',
    )
  }

  lines.push('  </channel>', '</rss>', '')
  return lines.join('\n')
}
