/**
 * 视频嵌入地址构建（从 video-seo.ts 拆出的轻模块，2026-11-10 包体积治理）：
 * 卡片与播放弹窗只需要这一个纯函数，不该为它把整个 SEO 工具集
 * （结构化数据/站点地图等 26KB）背进 /videos 首屏包。video-seo.ts 保留
 * 同名 re-export，旧调用方不受影响。
 */
import type { NavigationSubItem, VideoConfig } from '@/types/navigation'

/**
 * 根据视频平台配置构建标准播放器嵌入地址（支持 12+ 主流国内外视频平台）。
 * 同时支持传入 NavigationSubItem 或 VideoConfig。
 *
 * @param startSec 可选：从该秒数开始播放。YouTube 用 `start`、Bilibili 用 `t`、
 * Vimeo 用 `#t=Ns`；不支持起始时间的平台会忽略该参数，从头播放。
 */
export function buildVideoEmbedUrlForSeo(
  itemOrConfig: NavigationSubItem | VideoConfig,
  startSec?: number,
): string {
  const isSubItem = 'videoConfig' in itemOrConfig || 'href' in itemOrConfig
  const config: VideoConfig | undefined = isSubItem
    ? (itemOrConfig as NavigationSubItem).videoConfig
    : (itemOrConfig as VideoConfig)
  const fallbackHref = isSubItem ? (itemOrConfig as NavigationSubItem).href || '' : ''
  if (!config) return fallbackHref

  const platform = config.type || 'custom'
  const vid = config.bvid || config.videoId || ''

  const start = typeof startSec === 'number' && Number.isFinite(startSec) && startSec > 0
    ? Math.floor(startSec)
    : 0

  switch (platform) {
    case 'bilibili':
      if (config.bvid || vid.startsWith('BV')) {
        return `https://player.bilibili.com/player.html?bvid=${config.bvid || vid}&high_quality=1&autoplay=0${start > 0 ? `&t=${start}` : ''}`
      }
      if (config.aid) {
        return `https://player.bilibili.com/player.html?aid=${config.aid}&high_quality=1&autoplay=0${start > 0 ? `&t=${start}` : ''}`
      }
      return `https://player.bilibili.com/player.html?bvid=${vid}${start > 0 ? `&t=${start}` : ''}`
    case 'youtube':
      return vid ? `https://www.youtube.com/embed/${vid}${start > 0 ? `?start=${start}` : ''}` : fallbackHref
    case 'vimeo':
      return vid ? `https://player.vimeo.com/video/${vid}${start > 0 ? `#t=${start}s` : ''}` : fallbackHref
    case 'dailymotion':
      return vid ? `https://www.dailymotion.com/embed/video/${vid}` : fallbackHref
    case 'ted':
      return vid ? `https://embed.ted.com/talks/${vid}` : fallbackHref
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
