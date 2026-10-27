import type { NavigationSubItem } from '@/types/navigation'

/**
 * Generates Schema.org compliant VideoObject JSON-LD for rich snippet indexing.
 */
export function generateVideoObjectSchema(item: NavigationSubItem, siteUrl: string = 'https://devops.example.com'): Record<string, any> {
  const config = item.videoConfig
  const uploadDate = config?.publishedAt
    ? new Date(config.publishedAt).toISOString()
    : new Date().toISOString()

  let embedUrl = ''
  if (config?.type === 'bilibili') {
    embedUrl = `https://player.bilibili.com/player.html?bvid=${config.bvid || config.videoId}`
  } else if (config?.type === 'youtube') {
    embedUrl = `https://www.youtube.com/embed/${config.videoId}`
  } else {
    embedUrl = item.href
  }

  const durationIso = config?.durationSec
    ? `PT${Math.floor(config.durationSec / 60)}M${config.durationSec % 60}S`
    : 'PT10M'

  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    'name': item.title,
    'description': item.description || `${item.title} 核心技术教程与实战演示`,
    'thumbnailUrl': [
      item.icon?.startsWith('http') ? item.icon : `${siteUrl}/assets/cover/default-video.jpg`,
    ],
    'uploadDate': uploadDate,
    'duration': durationIso,
    'embedUrl': embedUrl,
    'contentUrl': item.href,
    'author': {
      '@type': 'Person',
      'name': config?.author || '技术导师',
    },
  }
}

/**
 * Generates Google Video XML Sitemap content.
 */
export function generateVideoSitemapXml(items: NavigationSubItem[], siteUrl: string = 'https://devops.example.com'): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`
  xml += `        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n`

  for (const item of items) {
    if (!item.videoConfig) continue
    const config = item.videoConfig

    const loc = `${siteUrl}/videos/player?id=${encodeURIComponent(item.id)}`
    const thumb = item.icon?.startsWith('http') ? item.icon : `${siteUrl}/assets/cover/default-video.jpg`
    const duration = config.durationSec || 600
    const pubDate = config.publishedAt ? new Date(config.publishedAt).toISOString() : new Date().toISOString()

    xml += `  <url>\n`
    xml += `    <loc>${escapeXml(loc)}</loc>\n`
    xml += `    <video:video>\n`
    xml += `      <video:thumbnail_loc>${escapeXml(thumb)}</video:thumbnail_loc>\n`
    xml += `      <video:title>${escapeXml(item.title)}</video:title>\n`
    xml += `      <video:description>${escapeXml(item.description || item.title)}</video:description>\n`
    xml += `      <video:duration>${duration}</video:duration>\n`
    xml += `      <video:publication_date>${pubDate}</video:publication_date>\n`
    xml += `      <video:family_friendly>yes</video:family_friendly>\n`
    if (config.author) {
      xml += `      <video:uploader>${escapeXml(config.author)}</video:uploader>\n`
    }
    xml += `    </video:video>\n`
    xml += `  </url>\n`
  }

  xml += `</urlset>\n`
  return xml
}

/**
 * Generates RSS 2.0 technical tutorial feed with media enclosures.
 */
export function generateVideoRssFeed(items: NavigationSubItem[], siteUrl: string = 'https://devops.example.com'): string {
  let rss = `<?xml version="1.0" encoding="UTF-8"?>\n`
  rss += `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom">\n`
  rss += `  <channel>\n`
  rss += `    <title>DevOps &amp; Cloud Native 视频教程订阅源</title>\n`
  rss += `    <link>${siteUrl}/videos</link>\n`
  rss += `    <description>收录精选技术视频、Kubernetes 架构演进与全栈开发教程</description>\n`
  rss += `    <language>zh-cn</language>\n`

  for (const item of items) {
    if (!item.videoConfig) continue
    const config = item.videoConfig
    const pubDate = config.publishedAt ? new Date(config.publishedAt).toUTCString() : new Date().toUTCString()

    rss += `    <item>\n`
    rss += `      <title>${escapeXml(item.title)}</title>\n`
    rss += `      <link>${siteUrl}/videos/player?id=${encodeURIComponent(item.id)}</link>\n`
    rss += `      <description>${escapeXml(item.description || item.title)}</description>\n`
    rss += `      <pubDate>${pubDate}</pubDate>\n`
    rss += `      <guid isPermaLink="false">${escapeXml(item.id)}</guid>\n`
    if (item.icon) {
      rss += `      <media:thumbnail url="${escapeXml(item.icon)}" />\n`
    }
    rss += `    </item>\n`
  }

  rss += `  </channel>\n`
  rss += `</rss>\n`
  return rss
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '&': return '&amp;'
      case '\'': return '&apos;'
      case '"': return '&quot;'
      default: return c
    }
  })
}
