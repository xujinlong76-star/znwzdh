import type { NavigationSubItem, VideoChapter, VideoConfig, VideoPlatformType } from '@/types/navigation'
import { chapterStartSec } from '@/types/navigation'

function resolveChapterSec(ch: VideoChapter & { time?: number }): number {
  if (typeof ch.time === 'number' && Number.isFinite(ch.time)) return Math.max(0, Math.floor(ch.time))
  return chapterStartSec(ch)
}

export interface VideoSeoAuditReport {
  totalVideos: number
  indexableVideos: number
  excludedBrokenOrDisabled: number
  withRichDescription: number
  withHttpsThumbnail: number
  withKeyMomentsChapters: number
  withSeoKeywords: number
  seoScore: number
  platformBreakdown: Record<string, number>
  recommendations: string[]
}

const PLATFORM_DISPLAY_NAMES: Record<string, string> = {
  bilibili: '哔哩哔哩 (Bilibili)',
  youtube: 'YouTube',
  douyin: '抖音 (Douyin)',
  kuaishou: '快手 (Kuaishou)',
  xigua: '西瓜视频 (Xigua)',
  xiaohongshu: '小红书 (RED)',
  tencent: '腾讯视频',
  youku: '优酷视频',
  vimeo: 'Vimeo',
  ted: 'TED Talks',
  dailymotion: 'Dailymotion',
  peertube: 'PeerTube',
  custom: '精选视频源',
}

const TECH_KEYWORD_DICTIONARY = [
  'AI', 'Agent', 'LLM', 'DeepSeek', 'Claude', 'GPT', 'Cursor', 'MCP', 'RAG',
  'Next.js', 'React', 'Vue', 'TypeScript', 'Rust', 'Go', 'Python', 'Kubernetes',
  'Docker', 'Cilium', 'eBPF', 'Prometheus', 'Grafana', 'DevOps', 'Cloud Native',
  '微服务', '架构', '大模型', '全栈', '前端', '后端', '云原生', '算法', '性能优化',
  '分布式', '数据库', 'PostgreSQL', 'Redis', 'Linux', 'WebAssembly', 'WebGPU',
]

/**
 * 将秒数转换为符合 Schema.org / Google Video Object 标准的 ISO 8601 Duration。
 * 小于 3600 秒时保持 `PT{M}M{S}S` 格式（如 1540s -> `PT25M40S`）。
 */
export function formatIso8601Duration(durationSec?: number): string {
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0) {
    return 'PT10M'
  }
  const total = Math.max(1, Math.floor(durationSec))
  if (total < 3600) {
    const mins = Math.floor(total / 60)
    const secs = total % 60
    return `PT${mins}M${secs}S`
  }
  const hours = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return `PT${hours}H${mins}M${secs}S`
}

/**
 * 根据视频平台配置构建标准播放器嵌入地址（支持 12+ 主流国内外视频平台）。
 * 同时支持传入 NavigationSubItem 或 VideoConfig。
 */
export function buildVideoEmbedUrlForSeo(itemOrConfig: NavigationSubItem | VideoConfig): string {
  const isSubItem = 'videoConfig' in itemOrConfig || 'href' in itemOrConfig
  const config: VideoConfig | undefined = isSubItem
    ? (itemOrConfig as NavigationSubItem).videoConfig
    : (itemOrConfig as VideoConfig)
  const fallbackHref = isSubItem ? (itemOrConfig as NavigationSubItem).href || '' : ''
  if (!config) return fallbackHref

  const platform = config.type || 'custom'
  const vid = config.bvid || config.videoId || ''

  switch (platform) {
    case 'bilibili':
      if (config.bvid || vid.startsWith('BV')) {
        return `https://player.bilibili.com/player.html?bvid=${config.bvid || vid}&high_quality=1&autoplay=0`
      }
      if (config.aid) {
        return `https://player.bilibili.com/player.html?aid=${config.aid}&high_quality=1&autoplay=0`
      }
      return `https://player.bilibili.com/player.html?bvid=${vid}`
    case 'youtube':
      return vid ? `https://www.youtube.com/embed/${vid}` : fallbackHref
    case 'vimeo':
      return vid ? `https://player.vimeo.com/video/${vid}` : fallbackHref
    case 'dailymotion':
      return vid ? `https://www.dailymotion.com/embed/video/${vid}` : fallbackHref
    case 'ted':
      return vid ? `https://embed.ted.com/talks/${vid}` : fallbackHref
    case 'douyin':
      return vid ? `https://open.douyin.com/player/video?vid=${vid}&autoplay=0` : fallbackHref
    case 'xigua':
      return vid ? `https://www.ixigua.com/iframe/${vid}?autoplay=0` : fallbackHref
    case 'tencent':
      return vid ? `https://v.qq.com/txp/iframe/player.html?vid=${vid}` : fallbackHref
    case 'youku':
      return vid ? `https://player.youku.com/embed/${vid}` : fallbackHref
    case 'peertube':
      if (fallbackHref && fallbackHref.includes('/videos/watch/')) {
        return fallbackHref.replace('/videos/watch/', '/videos/embed/')
      }
      if (fallbackHref && fallbackHref.includes('/w/')) {
        return fallbackHref.replace('/w/', '/videos/embed/')
      }
      return fallbackHref
    default:
      return fallbackHref
  }
}

/**
 * 从视频标题、描述、分类与作者中提取高价值 SEO 关键词（去重，上限 12 个）。
 */
export function extractVideoSeoKeywords(
  item: NavigationSubItem,
  categoryTitle?: string
): string[] {
  const keywords = new Set<string>()
  const config = item.videoConfig

  // 1. 已有标签与预设 SEO 词
  for (const tag of item.tags || []) {
    if (tag && tag.trim()) keywords.add(tag.trim())
  }
  for (const kw of config?.seoKeywords || []) {
    if (kw && kw.trim()) keywords.add(kw.trim())
  }
  if (config?.trendKeyword?.trim()) {
    keywords.add(config.trendKeyword.trim())
  }
  if (categoryTitle?.trim()) {
    keywords.add(categoryTitle.trim())
  }

  // 2. 匹配技术词典
  const haystack = `${item.title || ''} ${item.description || ''}`.toLowerCase()
  for (const dictWord of TECH_KEYWORD_DICTIONARY) {
    if (haystack.includes(dictWord.toLowerCase())) {
      keywords.add(dictWord)
    }
  }

  // 3. 提取标题中括号或书名号内的专题词
  const bracketMatches = (item.title || '').match(/【([^】]{2,16})】|\[([^\]]{2,16})\]/g) || []
  for (const raw of bracketMatches) {
    const cleaned = raw.replace(/^[【\[]|[】\]]$/g, '').trim()
    if (cleaned && !/保姆级|必看|合集|全套|最新/.test(cleaned)) {
      keywords.add(cleaned)
    }
  }

  // 4. 补充创作者与平台词
  if (config?.author && config.author !== '未知UP主') {
    keywords.add(config.author.trim())
  }
  const platformName = PLATFORM_DISPLAY_NAMES[config?.type || '']
  if (platformName) {
    keywords.add(platformName.split(' ')[0])
  }
  keywords.add('视频教程')

  return Array.from(keywords).slice(0, 12)
}

/**
 * 清洗并生成符合搜索引擎最佳展示长度（30-65 字符）的 SEO Title 与（80-160 字符）SEO Description。
 */
export function buildCleanSeoMeta(
  item: NavigationSubItem,
  categoryTitle?: string
): {
  seoSlug: string
  seoTitle: string
  seoDescription: string
  seoKeywords: string[]
  indexable: boolean
} {
  const config = item.videoConfig
  const platform: VideoPlatformType = config?.type || 'custom'
  const rawId = config?.bvid || config?.videoId || item.id || 'video'
  const safeId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, '-')
  const seoSlug = `${platform}-${safeId}`.toLowerCase()

  // 清理连续感叹号与冗余噪声，保留核心技术标题
  const rawTitle = (item.title || '技术视频教程')
    .replace(/!{2,}|！{2,}/g, '！')
    .replace(/\s+/g, ' ')
    .trim()

  const authorSuffix = config?.author ? ` - ${config.author}` : ''
  const catSuffix = categoryTitle ? ` | ${categoryTitle}` : ''
  const seoTitle =
    rawTitle.length <= 48
      ? `${rawTitle}${authorSuffix}${catSuffix}`.slice(0, 68)
      : rawTitle.slice(0, 65)

  const durationMin = config?.durationSec ? Math.max(1, Math.round(config.durationSec / 60)) : null
  const platformLabel = PLATFORM_DISPLAY_NAMES[platform] || '精选视频'
  const rawDesc = (item.description || '').replace(/\s+/g, ' ').trim()

  let seoDescription = rawDesc
  if (!seoDescription || seoDescription.length < 35) {
    const parts: string[] = [
      `《${rawTitle}》`,
      config?.author ? `由 ${config.author} 创作分享` : '',
      categoryTitle ? `归属「${categoryTitle}」技术专栏` : '',
      durationMin ? `全片时长约 ${durationMin} 分钟` : '',
      `来源平台：${platformLabel}。涵盖核心原理剖析、工程架构演进与实战代码演示。`,
    ].filter(Boolean)
    seoDescription = parts.join('，')
  }
  if (seoDescription.length > 160) {
    seoDescription = `${seoDescription.slice(0, 157)}...`
  }

  const seoKeywords = extractVideoSeoKeywords(item, categoryTitle)
  const indexable = item.enabled !== false && config?.healthStatus !== 'broken'

  return {
    seoSlug,
    seoTitle,
    seoDescription,
    seoKeywords,
    indexable,
  }
}

/**
 * 在视频采集入库时自动为其注入完整的 SEO 元数据、标签与收录标识。
 */
export function enrichVideoItemSeo(
  item: NavigationSubItem,
  categoryTitle?: string
): NavigationSubItem {
  if (!item.videoConfig) return item
  const meta = buildCleanSeoMeta(item, categoryTitle)
  const mergedTags = Array.from(new Set([...(item.tags || []), ...meta.seoKeywords.slice(0, 6)]))

  // 规范化封面地址为 https，防止搜索引擎因为 Mixed Content 拒收缩略图
  let normalizedIcon = item.icon
  if (normalizedIcon?.startsWith('//')) {
    normalizedIcon = `https:${normalizedIcon}`
  } else if (normalizedIcon?.startsWith('http://')) {
    normalizedIcon = `https://${normalizedIcon.slice('http://'.length)}`
  }

  return {
    ...item,
    icon: normalizedIcon,
    description: item.description?.trim() ? item.description : meta.seoDescription,
    tags: mergedTags,
    videoConfig: {
      ...item.videoConfig,
      seoSlug: item.videoConfig.seoSlug || meta.seoSlug,
      seoTitle: item.videoConfig.seoTitle || meta.seoTitle,
      seoDescription: item.videoConfig.seoDescription || meta.seoDescription,
      seoKeywords: item.videoConfig.seoKeywords?.length ? item.videoConfig.seoKeywords : meta.seoKeywords,
      indexable: meta.indexable,
      lastIndexedAt: Date.now(),
    },
  }
}

/**
 * Generates Schema.org compliant VideoObject JSON-LD for rich snippet indexing,
 * including Google Search Key Moments (`hasPart: Clip[]`), `SeekToAction`, and `InteractionCounter`.
 */
export function generateVideoObjectSchema(
  item: NavigationSubItem,
  siteUrl: string = 'https://devops.example.com',
  categoryTitle?: string
): Record<string, any> {
  const cleanSiteUrl = siteUrl.replace(/\/+$/, '')
  const config = item.videoConfig
  const uploadDate = config?.publishedAt
    ? new Date(config.publishedAt).toISOString()
    : new Date().toISOString()

  const embedUrl = buildVideoEmbedUrlForSeo(item)
  const durationIso = formatIso8601Duration(config?.durationSec)
  const canonicalVideoUrl = `${cleanSiteUrl}/videos/v/${encodeURIComponent(item.id)}`

  let thumbUrl = `${cleanSiteUrl}/assets/cover/default-video.jpg`
  if (item.icon) {
    if (item.icon.startsWith('//')) {
      thumbUrl = `https:${item.icon}`
    } else if (item.icon.startsWith('http://')) {
      thumbUrl = `https://${item.icon.slice('http://'.length)}`
    } else if (item.icon.startsWith('https://')) {
      thumbUrl = item.icon
    }
  }

  const keywords = config?.seoKeywords?.length
    ? config.seoKeywords
    : extractVideoSeoKeywords(item, categoryTitle)

  // 构建 Google Search Key Moments (Clip 结构化章节)，支持在搜索结果直接渲染视频进度节点
  const clips: Array<Record<string, any>> = []
  const chapters: VideoChapter[] = config?.chapters || []
  if (chapters.length > 0 && !config?.synthetic) {
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i]
      const startOffset = resolveChapterSec(ch)
      const nextChapter = chapters[i + 1]
      const endOffset =
        ch.endTime ??
        (nextChapter ? resolveChapterSec(nextChapter) : (config?.durationSec || startOffset + 180))

      clips.push({
        '@type': 'Clip',
        'name': ch.title,
        'startOffset': startOffset,
        'endOffset': Math.max(startOffset + 1, endOffset),
        'url': `${canonicalVideoUrl}?t=${startOffset}`,
      })
    }
  }

  // 构建互动统计数据 (InteractionCounter)
  const interactionStatistic: Array<Record<string, any>> = []
  if (config?.stats?.views && config.stats.views > 0) {
    interactionStatistic.push({
      '@type': 'InteractionCounter',
      'interactionType': { '@type': 'WatchAction' },
      'userInteractionCount': config.stats.views,
    })
  }
  if (config?.stats?.likes && config.stats.likes > 0) {
    interactionStatistic.push({
      '@type': 'InteractionCounter',
      'interactionType': { '@type': 'LikeAction' },
      'userInteractionCount': config.stats.likes,
    })
  }

  const schema: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    '@id': canonicalVideoUrl,
    'name': item.title,
    'description': item.description || config?.seoDescription || `${item.title} 核心技术教程与实战演示`,
    'thumbnailUrl': [thumbUrl],
    'uploadDate': uploadDate,
    'duration': durationIso,
    'embedUrl': embedUrl,
    'contentUrl': item.href,
    'url': canonicalVideoUrl,
    'inLanguage': 'zh-CN',
    'isFamilyFriendly': true,
    'keywords': keywords.join(', '),
    'author': {
      '@type': 'Person',
      'name': config?.author || '技术导师',
      ...(config?.authorUrl ? { 'url': config.authorUrl } : {}),
    },
    'potentialAction': {
      '@type': 'SeekToAction',
      'target': `${canonicalVideoUrl}?t={seek_to_second_number}`,
      'query-input': 'required name=seek_to_second_number',
    },
  }

  if (categoryTitle) {
    schema.genre = categoryTitle
  }
  if (clips.length > 0) {
    schema.hasPart = clips
  }
  if (interactionStatistic.length > 0) {
    schema.interactionStatistic = interactionStatistic
  }

  return schema
}

/**
 * 生成视频详情页的 Schema.org BreadcrumbList 面包屑结构化数据。
 */
export function generateVideoBreadcrumbSchema(
  item: NavigationSubItem,
  siteUrlOrCategoryTitle: string = 'https://devops.example.com',
  categoryOrId?: { id: string; title: string } | string,
  maybeSiteUrl?: string
): Record<string, any> {
  const isLegacyOrder = typeof categoryOrId === 'string'
  const rawSiteUrl = isLegacyOrder
    ? maybeSiteUrl || 'https://devops.example.com'
    : siteUrlOrCategoryTitle
  const category = isLegacyOrder
    ? { id: categoryOrId, title: siteUrlOrCategoryTitle }
    : categoryOrId
  const cleanSiteUrl = rawSiteUrl.replace(/\/+$/, '')
  const itemListElement: Array<Record<string, any>> = [
    {
      '@type': 'ListItem',
      'position': 1,
      'name': '首页',
      'item': cleanSiteUrl,
    },
    {
      '@type': 'ListItem',
      'position': 2,
      'name': '视频教程中心',
      'item': `${cleanSiteUrl}/videos`,
    },
  ]

  if (category) {
    itemListElement.push({
      '@type': 'ListItem',
      'position': 3,
      'name': category.title,
      'item': `${cleanSiteUrl}/videos#${encodeURIComponent(category.id)}`,
    })
  }

  itemListElement.push({
    '@type': 'ListItem',
    'position': itemListElement.length + 1,
    'name': item.title,
    'item': `${cleanSiteUrl}/videos/v/${encodeURIComponent(item.id)}`,
  })

  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': itemListElement,
  }
}

/**
 * 生成视频聚合列表的 Schema.org ItemList 结构化数据，提升列表页与专题页收录。
 */
export function generateVideoItemListSchema(
  items: NavigationSubItem[],
  siteUrl: string = 'https://devops.example.com',
  listName: string = '精选技术视频教程列表'
): Record<string, any> {
  const cleanSiteUrl = siteUrl.replace(/\/+$/, '')
  const validItems = items
    .filter(it => it.enabled !== false && it.videoConfig && it.videoConfig.healthStatus !== 'broken')
    .slice(0, 50)

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    'name': listName,
    'numberOfItems': validItems.length,
    'itemListElement': validItems.map((it, idx) => ({
      '@type': 'ListItem',
      'position': idx + 1,
      'url': `${cleanSiteUrl}/videos/v/${encodeURIComponent(it.id)}`,
      'name': it.title,
    })),
  }
}

/**
 * Generates Google Video XML Sitemap content (`xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"`).
 * Automatically filters out broken or disabled videos to prevent Soft 404 indexing penalties.
 */
export function generateVideoSitemapXml(
  items: NavigationSubItem[],
  siteUrl: string = 'https://devops.example.com'
): string {
  const cleanSiteUrl = siteUrl.replace(/\/+$/, '')
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`
  xml += `        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n`

  for (const item of items) {
    if (!item.videoConfig) continue
    if (item.enabled === false || item.videoConfig.healthStatus === 'broken') continue

    const config = item.videoConfig
    const loc = `${cleanSiteUrl}/videos/v/${encodeURIComponent(item.id)}`

    let thumb = `${cleanSiteUrl}/assets/cover/default-video.jpg`
    if (item.icon) {
      if (item.icon.startsWith('//')) thumb = `https:${item.icon}`
      else if (item.icon.startsWith('http://')) thumb = `https://${item.icon.slice('http://'.length)}`
      else if (item.icon.startsWith('https://')) thumb = item.icon
    }

    const duration = Math.max(1, Math.min(28800, Math.floor(config.durationSec || 600)))
    const pubDate = config.publishedAt
      ? new Date(config.publishedAt).toISOString()
      : new Date().toISOString()
    const embedUrl = buildVideoEmbedUrlForSeo(item)
    const desc = (item.description || config.seoDescription || item.title).slice(0, 2000)
    const tags = (config.seoKeywords || item.tags || []).slice(0, 32)

    xml += `  <url>\n`
    xml += `    <loc>${escapeXml(loc)}</loc>\n`
    xml += `    <video:video>\n`
    xml += `      <video:thumbnail_loc>${escapeXml(thumb)}</video:thumbnail_loc>\n`
    xml += `      <video:title>${escapeXml(item.title)}</video:title>\n`
    xml += `      <video:description>${escapeXml(desc)}</video:description>\n`
    if (embedUrl && embedUrl.startsWith('http')) {
      xml += `      <video:player_loc allow_embed="yes">${escapeXml(embedUrl)}</video:player_loc>\n`
    }
    xml += `      <video:duration>${duration}</video:duration>\n`
    xml += `      <video:publication_date>${pubDate}</video:publication_date>\n`
    xml += `      <video:family_friendly>yes</video:family_friendly>\n`
    xml += `      <video:live>no</video:live>\n`
    xml += `      <video:platform relationship="allow">web mobile tv</video:platform>\n`
    if (config.stats?.views && config.stats.views > 0) {
      xml += `      <video:view_count>${Math.floor(config.stats.views)}</video:view_count>\n`
    }
    if (typeof config.qualityScore === 'number' && config.qualityScore > 0) {
      const rating = Math.min(5.0, Math.max(1.0, Number((config.qualityScore / 20).toFixed(1))))
      xml += `      <video:rating>${rating.toFixed(1)}</video:rating>\n`
    }
    for (const tag of tags) {
      if (tag && tag.trim()) {
        xml += `      <video:tag>${escapeXml(tag.trim())}</video:tag>\n`
      }
    }
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
 * Generates RSS 2.0 technical tutorial feed with Yahoo Media RSS (`xmlns:media`) enclosures.
 */
export function generateVideoRssFeed(
  items: NavigationSubItem[],
  siteUrl: string = 'https://devops.example.com'
): string {
  const cleanSiteUrl = siteUrl.replace(/\/+$/, '')
  let rss = `<?xml version="1.0" encoding="UTF-8"?>\n`
  rss += `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:atom="http://www.w3.org/2005/Atom">\n`
  rss += `  <channel>\n`
  rss += `    <title>DevOps &amp; Cloud Native 视频教程订阅源</title>\n`
  rss += `    <link>${cleanSiteUrl}/videos</link>\n`
  rss += `    <atom:link href="${cleanSiteUrl}/videos/feed.xml" rel="self" type="application/rss+xml" />\n`
  rss += `    <description>收录精选技术视频、Kubernetes 架构演进与全栈开发教程</description>\n`
  rss += `    <language>zh-cn</language>\n`

  for (const item of items) {
    if (!item.videoConfig) continue
    if (item.enabled === false || item.videoConfig.healthStatus === 'broken') continue

    const config = item.videoConfig
    const pubDate = config.publishedAt
      ? new Date(config.publishedAt).toUTCString()
      : new Date().toUTCString()
    const itemUrl = `${cleanSiteUrl}/videos/v/${encodeURIComponent(item.id)}`

    rss += `    <item>\n`
    rss += `      <title>${escapeXml(item.title)}</title>\n`
    rss += `      <link>${escapeXml(itemUrl)}</link>\n`
    rss += `      <description>${escapeXml(item.description || config.seoDescription || item.title)}</description>\n`
    rss += `      <pubDate>${pubDate}</pubDate>\n`
    rss += `      <guid isPermaLink="false">${escapeXml(item.id)}</guid>\n`
    if (item.icon) {
      const httpsIcon = item.icon.startsWith('//')
        ? `https:${item.icon}`
        : item.icon.replace(/^http:\/\//, 'https://')
      rss += `      <media:thumbnail url="${escapeXml(httpsIcon)}" />\n`
    }
    if (config.author) {
      rss += `      <author>${escapeXml(config.author)}</author>\n`
    }
    rss += `    </item>\n`
  }

  rss += `  </channel>\n`
  rss += `</rss>\n`
  return rss
}

/**
 * 对视频库执行全量 SEO 收录健康度审计。
 */
export function auditVideoSeoReadiness(items: NavigationSubItem[]): VideoSeoAuditReport {
  let totalVideos = 0
  let indexableVideos = 0
  let excludedBrokenOrDisabled = 0
  let withRichDescription = 0
  let withHttpsThumbnail = 0
  let withKeyMomentsChapters = 0
  let withSeoKeywords = 0
  const platformBreakdown: Record<string, number> = {}

  for (const item of items) {
    if (!item.videoConfig) continue
    totalVideos++
    const cfg = item.videoConfig
    const platform = cfg.type || 'custom'
    platformBreakdown[platform] = (platformBreakdown[platform] || 0) + 1

    if (item.enabled === false || cfg.healthStatus === 'broken') {
      excludedBrokenOrDisabled++
      continue
    }

    indexableVideos++
    const desc = (item.description || cfg.seoDescription || '').trim()
    if (desc.length >= 25) withRichDescription++
    if (item.icon && (item.icon.startsWith('https://') || item.icon.startsWith('//'))) {
      withHttpsThumbnail++
    }
    if (Array.isArray(cfg.chapters) && cfg.chapters.length > 0 && !cfg.synthetic) {
      withKeyMomentsChapters++
    }
    if ((cfg.seoKeywords && cfg.seoKeywords.length > 0) || (item.tags && item.tags.length > 0)) {
      withSeoKeywords++
    }
  }

  const denom = Math.max(1, indexableVideos)
  const descRatio = withRichDescription / denom
  const thumbRatio = withHttpsThumbnail / denom
  const kwRatio = withSeoKeywords / denom
  const healthRatio = indexableVideos / Math.max(1, totalVideos)

  const seoScore = Math.min(
    100,
    Math.round(descRatio * 35 + thumbRatio * 25 + kwRatio * 20 + healthRatio * 20)
  )

  const recommendations: string[] = []
  if (descRatio < 0.9) {
    recommendations.push('部分采集视频缺少大于 25 字的结构化摘要，建议执行「一键全库 SEO 增强」自动补全元描述。')
  }
  if (thumbRatio < 0.95) {
    recommendations.push('部分视频缩略图缺失或为 HTTP 协议，建议统一升级为 HTTPS 以符合 Google Video Object 收录规范。')
  }
  if (withKeyMomentsChapters < indexableVideos * 0.5) {
    recommendations.push('可为高赞核心教程补充章节时间轴（Chapters），以触发搜索引擎 Key Moments 视频进度直达卡片。')
  }
  if (Object.keys(platformBreakdown).length <= 2) {
    recommendations.push('当前视频来源平台较单一，可开启多平台采集（YouTube / Dailymotion / PeerTube / TED / Vimeo / 抖音 / 西瓜）丰富生态覆盖。')
  }
  if (recommendations.length === 0) {
    recommendations.push('全库视频 SEO 结构化数据（VideoObject + Sitemap + MRSS）均已处于最佳就绪状态。')
  }

  return {
    totalVideos,
    indexableVideos,
    excludedBrokenOrDisabled,
    withRichDescription,
    withHttpsThumbnail,
    withKeyMomentsChapters,
    withSeoKeywords,
    seoScore,
    platformBreakdown,
    recommendations,
  }
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
