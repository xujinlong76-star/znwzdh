/**
 * 媒体防盗链代理安全加签与 SSRF 防护校验工具
 */

import { createHmac } from 'node:crypto'

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
