/**
 * 媒体防盗链代理安全加签与 SSRF 防护校验工具。
 *
 * 只允许服务端引用：`node:crypto` 被客户端组件图带入时，打包器会内联
 * buffer/crypto 垫片（实测 +476KB 首屏 JS），且签名密钥会随 bundle 泄露。
 * 客户端需要的代理地址一律由页面在服务端签好后下发（见 withSignedVideoIcons）。
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NavigationData, NavigationItem, NavigationSubItem } from '@/types/navigation'

let _ephemeralSecret: string | null = null
function getMediaProxySecret(): string {
  if (process.env.MEDIA_PROXY_SECRET) {
    return process.env.MEDIA_PROXY_SECRET
  }
  if (process.env.AUTH_SECRET) {
    return process.env.AUTH_SECRET
  }
  if (process.env.NODE_ENV !== 'production') {
    return 'navhub-media-proxy-dev-secret-stable'
  }
  if (!_ephemeralSecret) {
    // 动态生成进程级安全随机密钥，彻底杜绝仓库硬编码静态默认密钥被利用伪造 HMAC
    _ephemeralSecret = randomBytes(32).toString('hex')
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[navhub][安全警告] 未配置 MEDIA_PROXY_SECRET，当前正使用进程级随机密钥。' +
        '若需保障多实例集群或重启后签名一致，请在环境变量中设置 MEDIA_PROXY_SECRET。'
      )
    }
  }
  return _ephemeralSecret
}

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
 * 为合法的图片 URL 生成防篡改 HMAC-SHA256 签名。
 *
 * 2026-11-06 安全加固：旧实现 `digest('hex').slice(0, 16)` 只保留 64 bit MAC，
 * 且用 `===` 比较（非常量时间）。现改为全长 64 hex（256 bit）+ timingSafeEqual。
 *
 * 刻意**不加时效/过期**：这些签名在 SSR/ISR 阶段被烘进缓存的 HTML（withSignedVideoIcons
 * 的注释已说明「签名无时效」）。加 exp 会让 ISR 缓存里的图标地址在过期后全部 403。
 * 如需短期签名，用下面的 generateMediaSignatureV2（带 exp，调用方自行承担缓存语义）。
 */
export function generateMediaSignature(rawUrl: string): string {
  return createHmac('sha256', getMediaProxySecret()).update(rawUrl).digest('hex')
}

/** 常量时间比较：两侧先取 sha256 定长摘要，避免长度不等时 timingSafeEqual 抛错 */
function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'navhub-ct-eq').update(a).digest()
  const hb = createHmac('sha256', 'navhub-ct-eq').update(b).digest()
  return timingSafeEqual(ha, hb)
}

/**
 * 校验 URL 签名有效性（兼容旧 16 hex 与新 64 hex，灰度期不打断已缓存的 ISR 页面）。
 */
export function verifyMediaSignature(rawUrl: string, signature: string): boolean {
  if (!rawUrl || !signature) return false
  const expected = generateMediaSignature(rawUrl)
  // 新签名：全长 64 hex，常量时间比较
  if (signature.length === 64 && constantTimeEqual(expected, signature)) return true
  // 旧签名（16 hex）：仅作过渡兼容，同样走常量时间比较
  if (signature.length === 16 && constantTimeEqual(expected.slice(0, 16), signature)) return true
  return false
}

/**
 * 带过期时间的 v2 签名（可选，非 ISR 缓存场景用）。
 * 格式：v2.<expUnixSeconds>.<hmac64hex>，exp 为签发时刻起的有效秒数。
 */
export function generateMediaSignatureV2(rawUrl: string, ttlSeconds = 86400): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload = `${exp}.${rawUrl}`
  const mac = createHmac('sha256', getMediaProxySecret()).update(payload).digest('hex')
  return `v2.${exp}.${mac}`
}

export function verifyMediaSignatureV2(rawUrl: string, signature: string, nowMs = Date.now()): boolean {
  if (!rawUrl || !signature) return false
  const parts = signature.split('.')
  if (parts.length !== 3 || parts[0] !== 'v2') return false
  const exp = Number(parts[1])
  if (!Number.isFinite(exp) || exp < Math.floor(nowMs / 1000)) return false
  const payload = `${parts[1]}.${rawUrl}`
  const expected = createHmac('sha256', getMediaProxySecret()).update(payload).digest('hex')
  return parts[2].length === 64 && constantTimeEqual(expected, parts[2])
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

export function signIcon(item: NavigationSubItem): NavigationSubItem {
  const icon = item.icon
  if (!icon) return item
  // 与 VideoCard 的归一化一致：协议相对 URL（//host/x）按 https 处理
  const raw = icon.startsWith('//') ? `https:${icon}` : icon
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) return item
  return { ...item, mediaProxyIconUrl: getSignedMediaProxyUrl(raw) }
}

export function signCategory(category: NavigationItem): NavigationItem {
  const signItems = (items: NavigationSubItem[] | undefined) =>
    items?.map(signIcon)
  return {
    ...category,
    items: signItems(category.items),
    subCategories: category.subCategories?.map(sub => ({ ...sub, items: signItems(sub.items) })),
  }
}

/**
 * 给视频库中每个条目的 `icon` 预签代理地址。
 *
 * 为什么不放在 VideoCard 里现算：那条路径会把 `node:crypto` 带进客户端组件图。
 * 签名是 URL 的纯函数，服务端渲染（含 ISR 再生成）时算一次即可，签名无时效。
 */
export function withSignedVideoIcons(navigationData: NavigationData): NavigationData {
  return {
    ...navigationData,
    navigationItems: navigationData.navigationItems.map(signCategory),
  }
}
