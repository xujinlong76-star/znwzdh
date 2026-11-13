/**
 * 站点卡片的视觉缩略图解析（P1 #9：视觉卡片——缩略图一半）。
 *
 * 诚实口径：站点记录里**没有** og:image / 封面图字段（NavigationSubItem
 * 只有 icon / mediaProxyIconUrl），也不接截图服务（research 明确排除）。
 * 所以这里能给出的“缩略图”只能是既有图标管线已经提供的真实图片：
 * 站点品牌图标 / 自定义 icon / favicon 代理——不编造、不热链第三方截图。
 *
 * 优先级（先命中的为准）：
 *   1. mediaProxyIconUrl —— 服务端预签的图片代理地址（防盗链降级 URL），最可靠；
 *   2. icon 字段本身是 URL —— 用户/数据里配好的自定义图标直链；
 *   3. resolveSiteIcon（site-favicon.tsx 的既有管线）——本地品牌图标
 *     （LOCAL_LOGO_MAP）、GitHub 组织头像等；注意它会把 lucide 名字
 *      （如 'star'）原样返回，必须用 isIconUrl 再筛一次；
 *   4. /api/hub/assets/icon 代理 —— 与 SiteFavicon 的兜底逐字一致：
 *      既有管线拿不到图标时，卡片本来就会走这个代理取 favicon；
 *   5. 以上皆无（非 http(s) 链接、或显式要求默认图标）→ null，
 *      调用方回落到现有的图标渲染，不留空位、不占位。
 *
 * 安全口径（与 lib/safe-url.ts 同源，但更严一档）：
 *   - 远端图片只认 https（http 在 https 页面会被混合内容拦截，等于死图）；
 *   - 站内相对路径放行，但拒绝协议相对（//evil.com）与反斜杠变体（/\evil.com）；
 *   - 拒绝 userinfo 与控制字符；其余一律落到代理或 null，绝不原样输出。
 * 本模块不发任何网络请求：只做纯字符串解析，真正的加载由 <img> 完成。
 */
import { isIconUrl } from './nav-icons'
import { isSafeHttpUrl } from './safe-url'
import { resolveSiteIcon } from '@/components/site-favicon'

/** 解析只需要站点记录的这几个字段；与 NavigationSubItem 结构兼容 */
export interface ThumbnailSiteInput {
  href: string
  title?: string
  icon?: string | null
  useDefaultIcon?: boolean
  /**
   * 服务端预签的图片代理地址（icon 直链被防盗链拦截时的降级 URL），
   * 由服务端页面渲染时签好，随数据 props 下发。
   */
  mediaProxyIconUrl?: string
}

export type SiteThumbnailKind = 'media-proxy' | 'custom-icon' | 'favicon'

export interface SiteThumbnail {
  src: string
  kind: SiteThumbnailKind
}

/**
 * 是否可安全地放进 <img src>：
 * 站内相对路径（/xxx）放行；远端只认 https、无 userinfo、无控制字符。
 * 与 safeHref 同款判定，但远端 http 在此直接拒绝（见文件头）。
 */
function isSafeThumbnailSrc(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (/[\u0000-\u001f\u007f]/.test(v)) return false
  // 协议相对与反斜杠变体会被浏览器解析成站外地址，不能当站内路径放行
  if (v.startsWith('//') || v.startsWith('/\\')) return false
  if (v.startsWith('/')) return true
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:') return false
    if (u.username || u.password) return false
    return true
  } catch {
    return false
  }
}

/** 与 SiteFavicon 的代理兜底逐字一致的 favicon 代理地址 */
function faviconProxyUrl(href: string, title?: string): string {
  return `/api/hub/assets/icon?url=${encodeURIComponent(href)}${title ? `&title=${encodeURIComponent(title)}` : ''}`
}

export function resolveSiteThumbnail(site: ThumbnailSiteInput): SiteThumbnail | null {
  if (!site || typeof site.href !== 'string') return null
  const href = site.href.trim()
  if (!href) return null

  // 显式要求默认图标：没有“真实站点图片”，视觉槽不渲染，
  // 卡片保持现有的渐变首字母徽标，不拿占位图冒充缩略图。
  if (site.useDefaultIcon) return null

  // 1. 服务端预签代理地址（防盗链降级 URL）优先
  if (typeof site.mediaProxyIconUrl === 'string') {
    const proxy = site.mediaProxyIconUrl.trim()
    if (proxy && isSafeThumbnailSrc(proxy)) {
      return { src: proxy, kind: 'media-proxy' }
    }
  }

  // 2. icon 字段本身是图片地址
  if (typeof site.icon === 'string') {
    const icon = site.icon.trim()
    if (icon && isIconUrl(icon) && isSafeThumbnailSrc(icon)) {
      return { src: icon, kind: 'custom-icon' }
    }
  }

  // 3. 既有 favicon 管线：本地品牌图标 / GitHub 头像等。
  // resolveSiteIcon 会把 lucide 名字（如 'star'）原样返回，必须再筛一次；
  // http 直链在这里同样被 https-only 口径拦下，自动落到第 4 步的代理。
  const pipelineIcon = resolveSiteIcon(href, site.title, site.icon)
  if (pipelineIcon && isIconUrl(pipelineIcon) && isSafeThumbnailSrc(pipelineIcon)) {
    return { src: pipelineIcon, kind: 'favicon' }
  }

  // 4. 代理兜底：与 SiteFavicon 无图标时的行为一致（服务端取目标站 favicon，
  // 拿不到时回落为渐变首字母 SVG）。href 本身必须是没有 userinfo 的 http(s)。
  if (isSafeHttpUrl(href)) {
    return { src: faviconProxyUrl(href, site.title), kind: 'favicon' }
  }

  return null
}
