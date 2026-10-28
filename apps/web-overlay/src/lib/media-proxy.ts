/**
 * 媒体防盗链代理安全加签与 SSRF 防护校验工具。
 *
 * 只允许服务端引用：`node:crypto` 被客户端组件图带入时，打包器会内联
 * buffer/crypto 垫片（实测 +476KB 首屏 JS），且签名密钥会随 bundle 泄露。
 * 客户端需要的代理地址一律由页面在服务端签好后下发（见 withSignedVideoIcons）。
 */

import { createHmac } from 'node:crypto'
import type { NavigationData, NavigationItem, NavigationSubItem } from '@/types/navigation'

const MEDIA_PROXY_SECRET = process.env.MEDIA_PROXY_SECRET || 'navhub-media-secret-key-default-2026'

// 白名单允许代理的图床域名
const ALLOWED_MEDIA_DOMAINS = [
  'i0.hdslb.com',
  'i1.hdslb.com',
  'i2.hdslb.com',
  'archive.biliimg.com',
  'i.ytimg.com',
  'img.youtube.com',
  'images.unsplash.com',
  'raw.githubusercontent.com'
]

/**
 * 校验目标主机是否在合法图床白名单中，防范 SSRF
 */
export function isSafeMediaHost(hostname: string): boolean {
  if (!hostname) return false
  const lower = hostname.toLowerCase()

  // 严禁内网、环回与元数据地址
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower.startsWith('10.') ||
    lower.startsWith('192.168.') ||
    lower.startsWith('169.254.') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.local')
  ) {
    return false
  }

  return ALLOWED_MEDIA_DOMAINS.some(allowed => lower === allowed || lower.endsWith(`.${allowed}`))
}

/**
 * 为合法的图片 URL 生成防篡改 HMAC-SHA256 签名
 */
export function generateMediaSignature(rawUrl: string): string {
  const hmac = createHmac('sha256', MEDIA_PROXY_SECRET)
  hmac.update(rawUrl)
  return hmac.digest('hex').slice(0, 16)
}

/**
 * 校验 URL 签名有效性
 */
export function verifyMediaSignature(rawUrl: string, signature: string): boolean {
  if (!rawUrl || !signature) return false
  const expected = generateMediaSignature(rawUrl)
  return expected === signature
}

/**
 * 生成完整的媒体代理 URL
 */
export function getSignedMediaProxyUrl(rawUrl: string): string {
  if (!rawUrl) return ''
  // 本地相对路径不走代理
  if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
    return rawUrl
  }
  const sig = generateMediaSignature(rawUrl)
  return `/api/media/proxy?url=${encodeURIComponent(rawUrl)}&sig=${sig}`
}

function signIcon(item: NavigationSubItem): NavigationSubItem {
  const icon = item.icon
  if (!icon) return item
  // 与 VideoCard 的归一化一致：协议相对 URL（//host/x）按 https 处理
  const raw = icon.startsWith('//') ? `https:${icon}` : icon
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) return item
  return { ...item, mediaProxyIconUrl: getSignedMediaProxyUrl(raw) }
}

/**
 * 给视频库中每个条目的 `icon` 预签代理地址。
 *
 * 为什么不放在 VideoCard 里现算：那条路径会把 `node:crypto` 带进客户端组件图。
 * 签名是 URL 的纯函数，服务端渲染（含 ISR 再生成）时算一次即可，签名无时效。
 */
export function withSignedVideoIcons(navigationData: NavigationData): NavigationData {
  const signItems = (items: NavigationSubItem[] | undefined) =>
    items?.map(signIcon)
  const signCategory = (category: NavigationItem): NavigationItem => ({
    ...category,
    items: signItems(category.items),
    subCategories: category.subCategories?.map(sub => ({ ...sub, items: signItems(sub.items) })),
  })
  return {
    ...navigationData,
    navigationItems: navigationData.navigationItems.map(signCategory),
  }
}
