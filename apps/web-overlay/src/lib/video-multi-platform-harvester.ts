/**
 * Multi-Platform Video Harvester & Universal Metadata Resolver
 *
 * 深度支持国内外 12+ 主流视频平台的单链智能采集与主题关键词多源并发采集：
 * - 国内平台：哔哩哔哩 (bilibili)、抖音 (douyin)、快手 (kuaishou)、西瓜视频 (xigua)、小红书 (xiaohongshu)、腾讯视频 (tencent)、优酷 (youku)
 * - 国际与开源平台：YouTube (youtube)、Vimeo (vimeo)、TED Talks (ted)、Dailymotion (dailymotion)、PeerTube 联邦视频 (peertube)、自定义直链/网页 (custom)
 *
 * 同时内置 OpenGraph + Schema.org VideoObject JSON-LD 网页结构化嗅探器与自动 SEO 富化管线，
 * 确保采集入库的每一条视频都具备搜索引擎友好的标题、摘要、关键词、语义化 Slug 与可索引元数据。
 */

import type {
  NavigationSubItem,
  VideoConfig,
  VideoPlatformType,
  VideoStats,
} from '@/types/navigation'
import { calculateQualityScore, calculateFreshnessScore } from './video-scoring'
import { enrichVideoItemSeo } from './video-seo'
import { guardedFetch, isProbablySafeUrl } from './ssrf-guard'

import { VIDEO_PLATFORM_REGISTRY, type PlatformCapabilityDescriptor } from './video-platform-registry'

// 平台能力注册表已拆到 client-safe 模块（见该文件头注释）。这里原样转出去，
// 服务端调用方（如 api/videos/seo-index）保持原导入路径可用。
export { VIDEO_PLATFORM_REGISTRY }
export type { PlatformCapabilityDescriptor }

export interface DetectedPlatformResult {
  platform: VideoPlatformType
  externalId: string
  canonicalUrl: string
  bvid?: string
  aid?: string
  instanceOrigin?: string
}

/**
 * 识别任意视频 URL 所属平台、提取标准视频 ID 与规范化 URL
 */
export function detectVideoPlatform(rawUrl: string): DetectedPlatformResult | null {
  const url = (rawUrl || '').trim()
  if (!url) return null

  // 1. Bilibili
  const bvidMatch = url.match(/(BV[a-zA-Z0-9]{10})/i)
  const avidMatch = url.match(/\/av(\d+)/i)
  if (bvidMatch || avidMatch || /bilibili\.com|b23\.tv/i.test(url)) {
    const bvid = bvidMatch ? bvidMatch[1] : undefined
    const aid = avidMatch ? avidMatch[1] : undefined
    const externalId = bvid || (aid ? `av${aid}` : url.replace(/[^a-zA-Z0-9]/g, '').slice(-12))
    return {
      platform: 'bilibili',
      externalId,
      bvid,
      aid,
      canonicalUrl: bvid ? `https://www.bilibili.com/video/${bvid}` : url,
    }
  }

  // 2. YouTube
  const ytMatch = url.match(
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts|live)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i
  )
  if (ytMatch && ytMatch[1]) {
    const videoId = ytMatch[1]
    return {
      platform: 'youtube',
      externalId: videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    }
  }

  // 3. Vimeo
  const vimeoMatch = url.match(/(?:vimeo\.com\/(?:video\/|channels\/[^\/]+\/)?|player\.vimeo\.com\/video\/)(\d{6,12})/i)
  if (vimeoMatch && vimeoMatch[1]) {
    const videoId = vimeoMatch[1]
    return {
      platform: 'vimeo',
      externalId: videoId,
      canonicalUrl: `https://vimeo.com/${videoId}`,
    }
  }

  // 4. TED Talks
  const tedMatch = url.match(/ted\.com\/talks\/([a-zA-Z0-9_-]+)/i)
  if (tedMatch && tedMatch[1]) {
    const slug = tedMatch[1]
    return {
      platform: 'ted',
      externalId: slug,
      canonicalUrl: `https://www.ted.com/talks/${slug}`,
    }
  }

  // 5. Dailymotion
  const dmMatch = url.match(/(?:dailymotion\.com\/(?:video|embed\/video)\/|dai\.ly\/)([a-zA-Z0-9]+)/i)
  if (dmMatch && dmMatch[1]) {
    const videoId = dmMatch[1]
    return {
      platform: 'dailymotion',
      externalId: videoId,
      canonicalUrl: `https://www.dailymotion.com/video/${videoId}`,
    }
  }

  // 6. 抖音 (Douyin)
  const dyMatch = url.match(/(?:douyin\.com\/(?:video|note)\/|iesdouyin\.com\/share\/video\/)(\d{15,22})/i)
  if (dyMatch && dyMatch[1]) {
    const videoId = dyMatch[1]
    return {
      platform: 'douyin',
      externalId: videoId,
      canonicalUrl: `https://www.douyin.com/video/${videoId}`,
    }
  }
  if (/v\.douyin\.com\/([a-zA-Z0-9_-]+)/i.test(url)) {
    const code = url.match(/v\.douyin\.com\/([a-zA-Z0-9_-]+)/i)?.[1] || 'dy'
    return {
      platform: 'douyin',
      externalId: code,
      canonicalUrl: url,
    }
  }

  // 7. 快手 (Kuaishou)
  const ksMatch = url.match(/(?:kuaishou\.com\/(?:short-video|photo)\/|v\.kuaishou\.com\/)([a-zA-Z0-9_-]{6,24})/i)
  if (ksMatch && ksMatch[1]) {
    const videoId = ksMatch[1]
    return {
      platform: 'kuaishou',
      externalId: videoId,
      canonicalUrl: url.startsWith('http') ? url : `https://www.kuaishou.com/short-video/${videoId}`,
    }
  }

  // 8. 西瓜视频 (Xigua)
  const xgMatch = url.match(/ixigua\.com\/(?:i)?(\d{15,22})/i)
  if (xgMatch && xgMatch[1]) {
    const videoId = xgMatch[1]
    return {
      platform: 'xigua',
      externalId: videoId,
      canonicalUrl: `https://www.ixigua.com/${videoId}`,
    }
  }

  // 9. 小红书 (Xiaohongshu)
  const xhsMatch = url.match(/(?:xiaohongshu\.com\/(?:explore|discovery\/item)\/|xhslink\.com\/)([a-zA-Z0-9_-]{6,28})/i)
  if (xhsMatch && xhsMatch[1]) {
    const videoId = xhsMatch[1]
    return {
      platform: 'xiaohongshu',
      externalId: videoId,
      canonicalUrl: url.includes('xiaohongshu.com')
        ? `https://www.xiaohongshu.com/explore/${videoId}`
        : url,
    }
  }

  // 10. 腾讯视频 (Tencent Video)
  const qqCoverMatch = url.match(/v\.qq\.com\/x\/cover\/[^\/]+\/([a-zA-Z0-9]+)\.html/i)
  const qqPageMatch = url.match(/v\.qq\.com\/x\/page\/([a-zA-Z0-9]+)\.html/i)
  const qqVid = qqCoverMatch?.[1] || qqPageMatch?.[1]
  if (qqVid) {
    return {
      platform: 'tencent',
      externalId: qqVid,
      canonicalUrl: `https://v.qq.com/x/page/${qqVid}.html`,
    }
  }

  // 11. 优酷 (Youku)
  const youkuMatch = url.match(/youku\.com\/v_show\/id_([a-zA-Z0-9=_]+)\.html/i)
  if (youkuMatch && youkuMatch[1]) {
    const videoId = youkuMatch[1]
    return {
      platform: 'youku',
      externalId: videoId,
      canonicalUrl: `https://v.youku.com/v_show/id_${videoId}.html`,
    }
  }

  // 12. PeerTube (通用联邦视频实例路径 /videos/watch/<uuid> 或 /w/<shortUUID>)
  try {
    const parsed = new URL(url)
    const ptMatch = parsed.pathname.match(/^\/(?:videos\/watch|videos\/embed|w)\/([a-zA-Z0-9_-]{16,36})$/)
    if (ptMatch && ptMatch[1]) {
      const videoId = ptMatch[1]
      return {
        platform: 'peertube',
        externalId: videoId,
        instanceOrigin: parsed.origin,
        canonicalUrl: `${parsed.origin}/w/${videoId}`,
      }
    }

    // 13. 任意有效 HTTP/HTTPS 视频直链或网页
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const pathTail = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname
      const cleanId = pathTail.replace(/\.(mp4|webm|m3u8|mov|html|htm)$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'custom_vid'
      return {
        platform: 'custom',
        externalId: cleanId.slice(0, 36),
        instanceOrigin: parsed.origin,
        canonicalUrl: parsed.toString(),
      }
    }
  } catch {
    // 非法 URL
  }

  return null
}

/**
 * 解析 ISO 8601 Duration (如 PT1H12M30S / PT15M40S) 为秒数
 */
export function parseIso8601DurationToSeconds(iso?: string | number | null): number {
  if (typeof iso === 'number' && Number.isFinite(iso)) return Math.max(0, Math.round(iso))
  if (!iso || typeof iso !== 'string') return 0
  const trimmed = iso.trim()
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10)

  const match = trimmed.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i)
  if (!match) return 0
  const days = parseInt(match[1] || '0', 10)
  const hours = parseInt(match[2] || '0', 10)
  const minutes = parseInt(match[3] || '0', 10)
  const seconds = Math.round(parseFloat(match[4] || '0'))
  return days * 86400 + hours * 3600 + minutes * 60 + seconds
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

export interface ExtractedWebVideoMetadata {
  title?: string
  description?: string
  thumbnailUrl?: string
  author?: string
  authorUrl?: string
  durationSec?: number
  publishedAt?: string
  embedUrl?: string
  keywords?: string[]
  views?: number
  likes?: number
}

/**
 * 从任意视频网页 HTML 中嗅探 OpenGraph + Schema.org VideoObject JSON-LD 元数据
 * （适用于抖音、快手、西瓜、小红书、腾讯、优酷、TED、开发者大会视频页等）
 */
export function extractOpenGraphAndJsonLdFromHtml(html: string): ExtractedWebVideoMetadata {
  const result: ExtractedWebVideoMetadata = {}
  if (!html) return result

  // 1. 解析 <script type="application/ld+json"> 中的 VideoObject
  const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let ldMatch: RegExpExecArray | null
  while ((ldMatch = ldRegex.exec(html)) !== null) {
    try {
      const rawJson = ldMatch[1].trim()
      const parsed = JSON.parse(rawJson)
      const candidates = Array.isArray(parsed)
        ? parsed
        : parsed['@graph'] && Array.isArray(parsed['@graph'])
          ? parsed['@graph']
          : [parsed]

      for (const node of candidates) {
        if (!node || typeof node !== 'object') continue
        const nodeType = Array.isArray(node['@type']) ? node['@type'].join(',') : String(node['@type'] || '')
        if (/VideoObject/i.test(nodeType)) {
          if (node.name && !result.title) result.title = decodeHtmlEntities(String(node.name))
          if (node.description && !result.description) {
            result.description = decodeHtmlEntities(String(node.description))
          }
          const thumb = Array.isArray(node.thumbnailUrl) ? node.thumbnailUrl[0] : node.thumbnailUrl
          if (typeof thumb === 'string' && thumb && !result.thumbnailUrl) {
            result.thumbnailUrl = thumb
          }
          if (node.duration && !result.durationSec) {
            result.durationSec = parseIso8601DurationToSeconds(node.duration)
          }
          if (node.uploadDate && !result.publishedAt) {
            result.publishedAt = String(node.uploadDate)
          } else if (node.datePublished && !result.publishedAt) {
            result.publishedAt = String(node.datePublished)
          }
          if (node.embedUrl && !result.embedUrl) {
            result.embedUrl = String(node.embedUrl)
          }
          const authorObj = Array.isArray(node.author) ? node.author[0] : node.author
          if (authorObj) {
            if (typeof authorObj === 'string' && !result.author) result.author = authorObj
            else if (typeof authorObj === 'object' && authorObj.name && !result.author) {
              result.author = String(authorObj.name)
              if (authorObj.url) result.authorUrl = String(authorObj.url)
            }
          }
          if (node.interactionCount && !result.views) {
            const v = parseInt(String(node.interactionCount), 10)
            if (Number.isFinite(v)) result.views = v
          }
          if (node.interactionStatistic) {
            const stats = Array.isArray(node.interactionStatistic)
              ? node.interactionStatistic
              : [node.interactionStatistic]
            for (const st of stats) {
              const count = parseInt(String(st?.userInteractionCount ?? ''), 10)
              if (!Number.isFinite(count)) continue
              const iType = JSON.stringify(st?.interactionType || '')
              if (/WatchAction|ViewAction/i.test(iType)) result.views = count
              if (/LikeAction/i.test(iType)) result.likes = count
            }
          }
        }
      }
    } catch {
      // 忽略损坏的 JSON-LD 块
    }
  }

  // 2. 提取 Meta 标签 (og:title, og:description, og:image, og:video, keywords, etc.)
  const readMeta = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const reg1 = new RegExp(
        `<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["']`,
        'i'
      )
      const m1 = reg1.exec(html)
      if (m1?.[1]) return decodeHtmlEntities(m1[1])

      const reg2 = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`,
        'i'
      )
      const m2 = reg2.exec(html)
      if (m2?.[1]) return decodeHtmlEntities(m2[1])
    }
    return undefined
  }

  if (!result.title) {
    result.title = readMeta(['og:title', 'twitter:title', 'title', 'name'])
  }
  if (!result.title) {
    const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
    if (titleTag?.[1]) {
      result.title = decodeHtmlEntities(titleTag[1].replace(/\s+/g, ' '))
    }
  }

  if (!result.description) {
    result.description = readMeta(['og:description', 'twitter:description', 'description'])
  }

  if (!result.thumbnailUrl) {
    result.thumbnailUrl = readMeta(['og:image', 'twitter:image', 'image', 'thumbnailUrl'])
  }

  if (!result.author) {
    result.author = readMeta(['author', 'article:author', 'og:video:actor'])
  }

  if (!result.durationSec) {
    const ogDur = readMeta(['og:video:duration', 'video:duration', 'duration'])
    if (ogDur) result.durationSec = parseIso8601DurationToSeconds(ogDur)
  }

  if (!result.publishedAt) {
    const pub = readMeta(['article:published_time', 'og:video:release_date', 'datePublished', 'uploadDate'])
    if (pub) result.publishedAt = pub
  }

  const kwStr = readMeta(['keywords', 'og:video:tag'])
  if (kwStr) {
    result.keywords = kwStr
      .split(/[,，;；|]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2)
      .slice(0, 12)
  }

  return result
}

export interface MultiPlatformResolvedInfo {
  title: string
  href: string
  description?: string
  icon?: string
  videoConfig: VideoConfig
}

/**
 * 为已解析的视频结果自动注入 SEO 元数据（seoSlug, seoTitle, seoDescription, seoKeywords, indexable）
 */
export function attachResolvedSeoMetadata(info: MultiPlatformResolvedInfo): MultiPlatformResolvedInfo {
  const tempSubItem: NavigationSubItem = {
    id: info.videoConfig.bvid || info.videoConfig.videoId || 'vid',
    title: info.title,
    href: info.href,
    description: info.description || '',
    icon: info.icon,
    enabled: true,
    videoConfig: info.videoConfig,
  }
  const enriched = enrichVideoItemSeo(tempSubItem)
  return {
    ...info,
    videoConfig: enriched.videoConfig || info.videoConfig,
  }
}

/**
 * 通用多平台单视频链接智能解析器（覆盖除 B 站外的 12+ 国内外视频平台）
 */
export async function resolveMultiPlatformVideoUrl(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<MultiPlatformResolvedInfo> {
  const detected = detectVideoPlatform(rawUrl)
  if (!detected) {
    throw new Error(
      '未能识别该视频平台的 URL（支持 Bilibili、YouTube、抖音、快手、西瓜、小红书、腾讯、优酷、Vimeo、TED、Dailymotion、PeerTube 及自定义视频页）'
    )
  }

  const { platform, externalId, canonicalUrl, instanceOrigin } = detected
  const platformMeta = VIDEO_PLATFORM_REGISTRY[platform]

  // SSRF 防护：严格拒绝包含私网段、环回地址、高危端口或凭据伪装的外部 URL
  if (!isProbablySafeUrl(canonicalUrl)) {
    throw new Error('拒绝解析包含危险内网地址、私有网段或非法凭据的视频 URL')
  }
  if (instanceOrigin && !isProbablySafeUrl(instanceOrigin)) {
    throw new Error('拒绝连接非法的 PeerTube 联邦实例地址')
  }

  // 1. Dailymotion 官方公开 API
  if (platform === 'dailymotion') {
    try {
      const apiUrl = `https://api.dailymotion.com/video/${encodeURIComponent(
        externalId
      )}?fields=id,title,description,duration,thumbnail_720_url,owner.screenname,owner.url,views_total,created_time,tags`
      const res = await fetchImpl(apiUrl, { signal: AbortSignal.timeout(6000) })
      if (res.ok) {
        const d = await res.json()
        if (d && d.title) {
          const stats: VideoStats = { views: Number(d.views_total) || 0 }
          const durationSec = Number(d.duration) || 300
          const pubDate = d.created_time
            ? new Date(Number(d.created_time) * 1000).toISOString()
            : undefined
          const qualityScore = calculateQualityScore(stats, durationSec, d.created_time)
          const freshnessScore = calculateFreshnessScore(pubDate, qualityScore, 90, d.title)

          return attachResolvedSeoMetadata({
            title: String(d.title).trim(),
            href: canonicalUrl,
            description: String(d.description || '').replace(/<[^>]+>/g, '').trim(),
            icon: d.thumbnail_720_url || undefined,
            videoConfig: {
              type: 'dailymotion',
              videoId: externalId,
              author: d['owner.screenname'] || 'Dailymotion Creator',
              authorUrl: d['owner.url'] || undefined,
              durationSec,
              ...(pubDate ? { publishedAt: pubDate } : {}),
              harvestedAt: Date.now(),
              lastVerifiedAt: Date.now(),
              qualityScore,
              freshnessScore,
              sourceType: 'manual',
              pinned: true,
              healthStatus: 'healthy',
              stats,
            },
          })
        }
      }
    } catch {
      // 降级到通用嗅探
    }
  }

  // 2. Vimeo 官方 oEmbed API
  if (platform === 'vimeo') {
    try {
      const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(canonicalUrl)}`
      const res = await fetchImpl(oembedUrl, { signal: AbortSignal.timeout(6000) })
      if (res.ok) {
        const d = await res.json()
        if (d && d.title) {
          const durationSec = Number(d.duration) || 300
          const pubDate = d.upload_date ? new Date(d.upload_date).toISOString() : undefined
          return attachResolvedSeoMetadata({
            title: String(d.title).trim(),
            href: canonicalUrl,
            description: String(d.description || '').trim(),
            icon: d.thumbnail_url || undefined,
            videoConfig: {
              type: 'vimeo',
              videoId: externalId,
              author: d.author_name || 'Vimeo Creator',
              authorUrl: d.author_url || undefined,
              durationSec,
              ...(pubDate ? { publishedAt: pubDate } : {}),
              harvestedAt: Date.now(),
              lastVerifiedAt: Date.now(),
              qualityScore: 86,
              freshnessScore: calculateFreshnessScore(pubDate, 86, 90, d.title),
              sourceType: 'manual',
              pinned: true,
              healthStatus: 'healthy',
            },
          })
        }
      }
    } catch {
      // 降级到通用嗅探
    }
  }

  // 3. TED Talks 官方 oEmbed API
  if (platform === 'ted') {
    try {
      const oembedUrl = `https://www.ted.com/services/v1/oembed.json?url=${encodeURIComponent(canonicalUrl)}`
      const res = await fetchImpl(oembedUrl, { signal: AbortSignal.timeout(6000) })
      if (res.ok) {
        const d = await res.json()
        if (d && d.title) {
          return attachResolvedSeoMetadata({
            title: String(d.title).trim(),
            href: canonicalUrl,
            description: String(d.description || '').trim(),
            icon: d.thumbnail_url || undefined,
            videoConfig: {
              type: 'ted',
              videoId: externalId,
              author: d.author_name || 'TED Speaker',
              authorUrl: d.author_url || 'https://www.ted.com',
              durationSec: Number(d.duration) || 900,
              harvestedAt: Date.now(),
              lastVerifiedAt: Date.now(),
              qualityScore: 90,
              freshnessScore: 88,
              sourceType: 'manual',
              pinned: true,
              healthStatus: 'healthy',
            },
          })
        }
      }
    } catch {
      // 降级到通用嗅探
    }
  }

  // 4. PeerTube 联邦实例公开 REST API (/api/v1/videos/{id})
  if (platform === 'peertube' && instanceOrigin) {
    try {
      const apiUrl = `${instanceOrigin}/api/v1/videos/${encodeURIComponent(externalId)}`
      const res = fetchImpl === fetch
        ? (await guardedFetch(apiUrl, { timeoutMs: 6000, maxBytes: 1024 * 1024 })).response
        : await fetchImpl(apiUrl, { signal: AbortSignal.timeout(6000) })
      if (res.ok) {
        const d = await res.json()
        if (d && d.name) {
          const stats: VideoStats = {
            views: Number(d.views) || 0,
            likes: Number(d.likes) || 0,
          }
          const durationSec = Number(d.duration) || 600
          const pubDate = d.publishedAt ? new Date(d.publishedAt).toISOString() : undefined
          const thumbPath = d.previewPath || d.thumbnailPath
          const coverUrl = thumbPath
            ? thumbPath.startsWith('http')
              ? thumbPath
              : `${instanceOrigin}${thumbPath}`
            : undefined
          const qualityScore = calculateQualityScore(stats, durationSec)

          return attachResolvedSeoMetadata({
            title: String(d.name).trim(),
            href: d.url || canonicalUrl,
            description: String(d.description || '').trim(),
            icon: coverUrl,
            videoConfig: {
              type: 'peertube',
              videoId: externalId,
              author: d.account?.displayName || d.channel?.displayName || 'PeerTube Creator',
              authorUrl: d.account?.url || d.channel?.url || instanceOrigin,
              durationSec,
              ...(pubDate ? { publishedAt: pubDate } : {}),
              harvestedAt: Date.now(),
              lastVerifiedAt: Date.now(),
              qualityScore,
              freshnessScore: calculateFreshnessScore(pubDate, qualityScore, 90, d.name),
              sourceType: 'manual',
              pinned: true,
              healthStatus: 'healthy',
              stats,
            },
          })
        }
      }
    } catch {
      // 降级到通用嗅探
    }
  }

  // 5. YouTube 官方 oEmbed + Noembed 双通道
  if (platform === 'youtube') {
    try {
      const oembedRes = await fetchImpl(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${externalId}&format=json`,
        { signal: AbortSignal.timeout(6000) }
      )
      if (oembedRes.ok) {
        const data = await oembedRes.json()
        return attachResolvedSeoMetadata({
          title: data.title || 'YouTube Video',
          href: canonicalUrl,
          description: '',
          icon: data.thumbnail_url || `https://i.ytimg.com/vi/${externalId}/hqdefault.jpg`,
          videoConfig: {
            type: 'youtube',
            videoId: externalId,
            author: data.author_name || '',
            authorUrl: data.author_url || '',
            harvestedAt: Date.now(),
            lastVerifiedAt: Date.now(),
            qualityScore: 85,
            freshnessScore: 85,
            sourceType: 'manual',
            pinned: true,
            healthStatus: 'healthy',
          },
        })
      }
    } catch {
      // 降级到兜底
    }

    return attachResolvedSeoMetadata({
      title: `YouTube Video (${externalId})`,
      href: canonicalUrl,
      icon: `https://i.ytimg.com/vi/${externalId}/hqdefault.jpg`,
      videoConfig: {
        type: 'youtube',
        videoId: externalId,
        harvestedAt: Date.now(),
        sourceType: 'manual',
        pinned: true,
        healthStatus: 'healthy',
      },
    })
  }

  // 6. 通用 HTML OpenGraph / JSON-LD VideoObject 嗅探（抖音、快手、西瓜、小红书、腾讯、优酷、自定义网页）
  try {
    let htmlRes: Response
    if (fetchImpl === fetch) {
      // 生产路径：强制走 SSRF 逐跳 DNS 校验与防重绑定防护
      const guarded = await guardedFetch(canonicalUrl, {
        timeoutMs: 6500,
        maxBytes: 2 * 1024 * 1024,
        maxRedirects: 3,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      })
      htmlRes = guarded.response
    } else {
      htmlRes = await fetchImpl(canonicalUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(6500),
      })
    }

    if (htmlRes.ok) {
      const contentType = htmlRes.headers?.get?.('content-type') || ''
      if (!contentType || /text\/html|application\/xhtml/i.test(contentType)) {
        const html = await htmlRes.text()
        const extracted = extractOpenGraphAndJsonLdFromHtml(html)
        if (extracted.title) {
          let cover = extracted.thumbnailUrl
          if (cover?.startsWith('//')) cover = `https:${cover}`
          else if (cover?.startsWith('http://')) cover = cover.replace('http://', 'https://')

          const stats: VideoStats | undefined =
            extracted.views || extracted.likes
              ? { views: extracted.views || 0, likes: extracted.likes || 0 }
              : undefined
          const durationSec = extracted.durationSec || 300
          const qualityScore = stats ? calculateQualityScore(stats, durationSec) : 82
          const freshnessScore = calculateFreshnessScore(
            extracted.publishedAt,
            qualityScore,
            90,
            extracted.title
          )

          return attachResolvedSeoMetadata({
            title: extracted.title,
            href: canonicalUrl,
            description: extracted.description || '',
            icon: cover,
            videoConfig: {
              type: platform,
              videoId: externalId,
              author: extracted.author || `${platformMeta.shortName}创作者`,
              authorUrl: extracted.authorUrl,
              durationSec,
              ...(extracted.publishedAt ? { publishedAt: extracted.publishedAt } : {}),
              harvestedAt: Date.now(),
              lastVerifiedAt: Date.now(),
              qualityScore,
              freshnessScore,
              sourceType: 'manual',
              pinned: true,
              healthStatus: 'healthy',
              ...(stats ? { stats } : {}),
              ...(extracted.keywords?.length ? { seoKeywords: extracted.keywords } : {}),
            },
          })
        }
      }
    }
  } catch {
    // 网页直连超时或反爬拦截时，走结构化平台兜底
  }

  // 7. 兜底返回（保证任何合法的多平台视频 URL 都能入库并生成规范化 SEO 数据）
  return attachResolvedSeoMetadata({
    title: `${platformMeta.shortName}视频 (${externalId})`,
    href: canonicalUrl,
    description: `来自 ${platformMeta.name} 的精选视频内容（ID: ${externalId}）`,
    videoConfig: {
      type: platform,
      videoId: externalId,
      author: `${platformMeta.shortName}创作者`,
      durationSec: 300,
      harvestedAt: Date.now(),
      lastVerifiedAt: Date.now(),
      qualityScore: 78,
      freshnessScore: 78,
      sourceType: 'manual',
      pinned: true,
      healthStatus: 'healthy',
    },
  })
}

export interface MultiPlatformHarvestOptions {
  platforms: VideoPlatformType[]
  minDurationSec?: number
  minQualityScore?: number
  limitPerKeyword?: number
  deadlineMs?: number
  failures?: Array<{ keyword: string; reason: string }>
}

/**
 * 针对非 B 站平台执行主题关键词公开 API 采集（Dailymotion / PeerTube SepiaSearch / TED / YouTube Piped）
 */
export async function harvestMultiPlatformVideosForKeyword(
  keyword: string,
  options: MultiPlatformHarvestOptions,
  fetchImpl: typeof fetch = fetch
): Promise<NavigationSubItem[]> {
  const {
    platforms,
    minDurationSec = 180,
    minQualityScore = 60,
    limitPerKeyword = 3,
    failures,
  } = options

  const results: NavigationSubItem[] = []
  const seenKeys = new Set<string>()
  const kw = keyword.trim()
  if (!kw) return results

  // 1. Dailymotion 公开搜索通道
  if (platforms.includes('dailymotion')) {
    try {
      const dmUrl = `https://api.dailymotion.com/videos?search=${encodeURIComponent(
        kw
      )}&fields=id,title,description,duration,thumbnail_720_url,owner.screenname,owner.url,views_total,created_time&limit=${Math.max(
        limitPerKeyword * 2,
        6
      )}&sort=relevance`
      const res = await fetchImpl(dmUrl, { signal: AbortSignal.timeout(6000) })
      if (!res.ok) {
        failures?.push({ keyword: kw, reason: `Dailymotion 搜索返回 HTTP ${res.status}` })
      } else {
        const json = await res.json()
        const list = Array.isArray(json?.list) ? json.list : []
        let taken = 0
        for (const item of list) {
          if (taken >= limitPerKeyword) break
          const videoId = String(item?.id || '').trim()
          if (!videoId || seenKeys.has(`dailymotion:${videoId}`)) continue

          const durationSec = Number(item.duration) || 0
          if (minDurationSec && durationSec > 0 && durationSec < minDurationSec) continue

          const cleanTitle = String(item.title || '').replace(/<[^>]+>/g, '').trim()
          if (!cleanTitle) continue
          const cleanDesc = String(item.description || '').replace(/<[^>]+>/g, '').trim()

          const stats: VideoStats = { views: Number(item.views_total) || 0 }
          const qualityScore = Math.max(
            minQualityScore,
            calculateQualityScore(stats, durationSec || 300, item.created_time)
          )
          const pubDate = item.created_time
            ? new Date(Number(item.created_time) * 1000).toISOString()
            : undefined
          const freshnessScore = calculateFreshnessScore(pubDate, qualityScore, 90, cleanTitle)

          seenKeys.add(`dailymotion:${videoId}`)
          taken++

          const rawSubItem: NavigationSubItem = {
            id: `harvest_dm_${videoId}_${Date.now()}`,
            title: cleanTitle,
            href: `https://www.dailymotion.com/video/${videoId}`,
            description: cleanDesc,
            icon: item.thumbnail_720_url || undefined,
            enabled: true,
            videoConfig: {
              type: 'dailymotion',
              videoId,
              author: item['owner.screenname'] || 'Dailymotion Creator',
              authorUrl: item['owner.url'] || undefined,
              durationSec: durationSec || 300,
              ...(pubDate ? { publishedAt: pubDate } : {}),
              harvestedAt: Date.now(),
              lastVerifiedAt: Date.now(),
              qualityScore,
              freshnessScore,
              sourceType: 'auto_trend',
              trendKeyword: kw,
              pinned: false,
              healthStatus: 'healthy',
              stats,
            },
          }
          results.push(enrichVideoItemSeo(rawSubItem))
        }
      }
    } catch (err) {
      failures?.push({
        keyword: kw,
        reason: `Dailymotion 采集异常: ${err instanceof Error ? err.message : '网络错误'}`,
      })
    }
  }

  // 2. PeerTube (SepiaSearch 全球联邦视频索引 API)
  if (platforms.includes('peertube')) {
    try {
      const ptUrl = `https://sepiasearch.org/api/v1/videos?search=${encodeURIComponent(
        kw
      )}&count=${Math.max(limitPerKeyword * 2, 6)}&sort=-match&nsfw=false`
      const res = await fetchImpl(ptUrl, { signal: AbortSignal.timeout(6000) })
      if (!res.ok) {
        failures?.push({ keyword: kw, reason: `PeerTube SepiaSearch 返回 HTTP ${res.status}` })
      } else {
        const json = await res.json()
        const data = Array.isArray(json?.data) ? json.data : []
        let taken = 0
        for (const item of data) {
          if (taken >= limitPerKeyword) break
          const videoId = String(item?.shortUUID || item?.uuid || '').trim()
          if (!videoId || seenKeys.has(`peertube:${videoId}`)) continue

          const durationSec = Number(item.duration) || 0
          if (minDurationSec && durationSec > 0 && durationSec < minDurationSec) continue

          const cleanTitle = String(item.name || '').trim()
          if (!cleanTitle) continue
          const cleanDesc = String(item.description || '').replace(/<[^>]+>/g, '').trim()

          const stats: VideoStats = {
            views: Number(item.views) || 0,
            likes: Number(item.likes) || 0,
          }
          const qualityScore = Math.max(
            minQualityScore,
            calculateQualityScore(stats, durationSec || 300)
          )
          const pubDate = item.publishedAt ? new Date(item.publishedAt).toISOString() : undefined
          const freshnessScore = calculateFreshnessScore(pubDate, qualityScore, 90, cleanTitle)

          const host = item.account?.host || item.channel?.host || 'framatube.org'
          const href = item.url || `https://${host}/w/${videoId}`
          const coverUrl =
            item.thumbnailUrl ||
            (item.thumbnailPath ? `https://${host}${item.thumbnailPath}` : undefined)

          seenKeys.add(`peertube:${videoId}`)
          taken++

          const rawSubItem: NavigationSubItem = {
            id: `harvest_pt_${videoId}_${Date.now()}`,
            title: cleanTitle,
            href,
            description: cleanDesc,
            icon: coverUrl,
            enabled: true,
            videoConfig: {
              type: 'peertube',
              videoId,
              author: item.account?.displayName || item.channel?.displayName || 'PeerTube Creator',
              authorUrl: item.account?.url || item.channel?.url || `https://${host}`,
              durationSec: durationSec || 300,
              ...(pubDate ? { publishedAt: pubDate } : {}),
              harvestedAt: Date.now(),
              lastVerifiedAt: Date.now(),
              qualityScore,
              freshnessScore,
              sourceType: 'auto_trend',
              trendKeyword: kw,
              pinned: false,
              healthStatus: 'healthy',
              stats,
            },
          }
          results.push(enrichVideoItemSeo(rawSubItem))
        }
      }
    } catch (err) {
      failures?.push({
        keyword: kw,
        reason: `PeerTube 采集异常: ${err instanceof Error ? err.message : '网络错误'}`,
      })
    }
  }

  // 3. TED Talks 公开 API 通道 (/talks.json?q=...)
  if (platforms.includes('ted')) {
    try {
      const tedUrl = `https://www.ted.com/talks.json?q=${encodeURIComponent(
        kw
      )}&per_page=${Math.max(limitPerKeyword * 2, 6)}`
      const res = await fetchImpl(tedUrl, { signal: AbortSignal.timeout(6000) })
      if (!res.ok) {
        failures?.push({ keyword: kw, reason: `TED Talks 搜索返回 HTTP ${res.status}` })
      } else {
        const json = await res.json()
        const talks = Array.isArray(json?.talks)
          ? json.talks
          : Array.isArray(json?.results)
            ? json.results
            : []
        let taken = 0
        for (const item of talks) {
          if (taken >= limitPerKeyword) break
          const slug = String(item?.slug || item?.id || '').trim()
          if (!slug || seenKeys.has(`ted:${slug}`)) continue

          const durationSec = Number(item.duration) || 900
          if (minDurationSec && durationSec > 0 && durationSec < minDurationSec) continue

          const cleanTitle = String(item.name || item.title || '').trim()
          if (!cleanTitle) continue
          const cleanDesc = String(item.description || '').replace(/<[^>]+>/g, '').trim()

          const stats: VideoStats = {
            views: Number(item.view_count || item.views) || 50000,
          }
          const qualityScore = Math.max(
            minQualityScore,
            calculateQualityScore(stats, durationSec)
          )
          const pubDate = item.published_at ? new Date(item.published_at).toISOString() : undefined
          const freshnessScore = calculateFreshnessScore(pubDate, qualityScore, 90, cleanTitle)
          const speaker = item.speaker_name || item.speakers?.[0]?.name || 'TED Speaker'
          const thumb = item.primary_image_tag || item.image_16x9 || undefined

          seenKeys.add(`ted:${slug}`)
          taken++

          const rawSubItem: NavigationSubItem = {
            id: `harvest_ted_${slug}_${Date.now()}`,
            title: cleanTitle,
            href: `https://www.ted.com/talks/${slug}`,
            description: cleanDesc,
            icon: thumb,
            enabled: true,
            videoConfig: {
              type: 'ted',
              videoId: slug,
              author: speaker,
              authorUrl: 'https://www.ted.com',
              durationSec,
              ...(pubDate ? { publishedAt: pubDate } : {}),
              harvestedAt: Date.now(),
              lastVerifiedAt: Date.now(),
              qualityScore,
              freshnessScore,
              sourceType: 'auto_trend',
              trendKeyword: kw,
              pinned: false,
              healthStatus: 'healthy',
              stats,
            },
          }
          results.push(enrichVideoItemSeo(rawSubItem))
        }
      }
    } catch (err) {
      failures?.push({
        keyword: kw,
        reason: `TED Talks 采集异常: ${err instanceof Error ? err.message : '网络错误'}`,
      })
    }
  }

  // 4. YouTube 开放镜像通道 (Piped / Invidious API 降级聚合)
  if (platforms.includes('youtube')) {
    try {
      const pipedInstances = [
        'https://pipedapi.kavin.rocks',
        'https://api.piped.privacy.com.de',
        'https://piped-api.lunar.icu',
      ]
      let ytList: any[] = []
      for (const instance of pipedInstances) {
        try {
          const ytUrl = `${instance}/search?q=${encodeURIComponent(kw)}&filter=videos`
          const res = await fetchImpl(ytUrl, { signal: AbortSignal.timeout(5000) })
          if (res.ok) {
            const json = await res.json()
            const items = Array.isArray(json?.items) ? json.items : []
            if (items.length > 0) {
              ytList = items
              break
            }
          }
        } catch {
          // 尝试下一镜像
        }
      }

      if (ytList.length === 0) {
        failures?.push({ keyword: kw, reason: 'YouTube 开放镜像通道无响应或未命中结果' })
      } else {
        let taken = 0
        for (const item of ytList) {
          if (taken >= limitPerKeyword) break
          const videoId = String(
            item?.url ? item.url.replace('/watch?v=', '') : item?.id || ''
          ).trim()
          if (!videoId || videoId.length !== 11 || seenKeys.has(`youtube:${videoId}`)) continue

          const durationSec = Number(item.duration) || 600
          if (minDurationSec && durationSec > 0 && durationSec < minDurationSec) continue

          const cleanTitle = String(item.title || '').trim()
          if (!cleanTitle) continue
          const cleanDesc = String(item.shortDescription || item.description || '').trim()

          const stats: VideoStats = {
            views: Number(item.views) || 0,
          }
          const qualityScore = Math.max(
            minQualityScore,
            calculateQualityScore(stats, durationSec)
          )
          const pubDate = item.uploaded ? new Date(item.uploaded).toISOString() : undefined
          const freshnessScore = calculateFreshnessScore(pubDate, qualityScore, 90, cleanTitle)

          seenKeys.add(`youtube:${videoId}`)
          taken++

          const rawSubItem: NavigationSubItem = {
            id: `harvest_yt_${videoId}_${Date.now()}`,
            title: cleanTitle,
            href: `https://www.youtube.com/watch?v=${videoId}`,
            description: cleanDesc,
            icon: item.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            enabled: true,
            videoConfig: {
              type: 'youtube',
              videoId,
              author: item.uploaderName || 'YouTube Creator',
              authorUrl: item.uploaderUrl ? `https://www.youtube.com${item.uploaderUrl}` : undefined,
              durationSec,
              ...(pubDate ? { publishedAt: pubDate } : {}),
              harvestedAt: Date.now(),
              lastVerifiedAt: Date.now(),
              qualityScore,
              freshnessScore,
              sourceType: 'auto_trend',
              trendKeyword: kw,
              pinned: false,
              healthStatus: 'healthy',
              stats,
            },
          }
          results.push(enrichVideoItemSeo(rawSubItem))
        }
      }
    } catch (err) {
      failures?.push({
        keyword: kw,
        reason: `YouTube 采集异常: ${err instanceof Error ? err.message : '网络错误'}`,
      })
    }
  }

  return results
}
