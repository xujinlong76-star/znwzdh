'use client'

import React, { useState } from 'react'
import { cn } from '@/lib/utils'

export interface SiteFaviconProps {
  title?: string
  url?: string
  icon?: string | null
  useDefaultIcon?: boolean
  className?: string
  /**
   * 首屏主图标（如详情页 64px 徽标）传 `true`：`loading="lazy"` 在视口内的图上
   * 仍会让浏览器推迟一次解码调度，而这张图常常就是该页的 LCP 元素。
   */
  eager?: boolean
}

export const PRESET_GRADIENTS = [
  { from: '#6366f1', to: '#a855f7', textColor: '#ffffff' }, // 蓝紫极光
  { from: '#3b82f6', to: '#06b6d4', textColor: '#ffffff' }, // 蔚蓝海流
  { from: '#10b981', to: '#14b8a6', textColor: '#ffffff' }, // 极光翡翠
  { from: '#f59e0b', to: '#ef4444', textColor: '#ffffff' }, // 暖阳晚霞
  { from: '#ec4899', to: '#8b5cf6', textColor: '#ffffff' }, // 霓虹浆果
  { from: '#06b6d4', to: '#3b82f6', textColor: '#ffffff' }, // 赛博电光
  { from: '#84cc16', to: '#10b981', textColor: '#ffffff' }, // 春晓青柠
  { from: '#f43f5e', to: '#fb923c', textColor: '#ffffff' }, // 珊瑚朝霞
  { from: '#8b5cf6', to: '#ec4899', textColor: '#ffffff' }, // 幻境晶体
  { from: '#0ea5e9', to: '#6366f1', textColor: '#ffffff' }, // 深邃星空
  { from: '#14b8a6', to: '#0ea5e9', textColor: '#ffffff' }, // 浅滩清波
  { from: '#d946ef', to: '#8b5cf6', textColor: '#ffffff' }, // 幻彩紫晶
  { from: '#f97316', to: '#e11d48', textColor: '#ffffff' }, // 熔岩烈焰
  { from: '#059669', to: '#0284c7', textColor: '#ffffff' }, // 森林薄雾
  { from: '#4f46e5', to: '#06b6d4', textColor: '#ffffff' }, // 钛金属辉光
  { from: '#7c3aed', to: '#2563eb', textColor: '#ffffff' }, // 极夜苍穹
] as const

export function fnv1aHash(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function getDeterministicGradient(seed: string): {
  from: string
  to: string
  textColor: string
  angle: number
  cssGradient: string
} {
  const normalizedSeed = (seed || 'navhub').trim().toLowerCase()
  const hash = fnv1aHash(normalizedSeed)
  const paletteIndex = hash % PRESET_GRADIENTS.length
  const palette = PRESET_GRADIENTS[paletteIndex]!
  const angleSteps = [135, 45, 120, 160, 90]
  // 必须用无符号右移：hash 是 32 位无符号，`>>` 会先转成有符号，
  // hash ≥ 2^31 时变成负数，负索引取到 undefined，SSR 就渲染出
  // `linear-gradient(undefineddeg, …)` 这条无效 CSS，图标底色直接丢失。
  const angle = angleSteps[(hash >>> 4) % angleSteps.length]!

  return {
    from: palette.from,
    to: palette.to,
    textColor: palette.textColor,
    angle,
    cssGradient: `linear-gradient(${angle}deg, ${palette.from}, ${palette.to})`,
  }
}

export function extractFaviconMonogram(title: string, _url?: string): string {
  const cleanTitle = (title || '').trim()
  if (cleanTitle) {
    // 严格从站点名称 (title) 提取第一个有效汉字或英文字母，严禁从 url hostname 提取
    const stripped = cleanTitle.replace(/^[\p{P}\p{S}\s]+/u, '')
    if (stripped.length > 0) {
      const char = stripped[0]!
      if (/[\u4e00-\u9fa5]/.test(char)) return char
      if (/[a-zA-Z0-9]/.test(char)) return char.toUpperCase()
    }
  }

  return '山'
}

export const LOCAL_LOGO_MAP: Record<string, string> = {
  'kimi.moonshot.cn': 'https://kimi.moonshot.cn/pwa-192.png',
  'doubao.com': '/assets/images/logos/doubao.png',
  'www.doubao.com': '/assets/images/logos/doubao.png',
  'yiyan.baidu.com': 'https://www.baidu.com/favicon.ico',
  'lingma.aliyun.com': 'https://img.alicdn.com/imgextra/i1/O1CN01BN6Jtc1lCfJNviV7H_!!6000000004783-2-tps-134-133.png',
  'runwayml.com': 'https://runwayml.com/icon.png',
  'deepseek.com': 'https://chat.deepseek.com/favicon.ico',
  'chat.deepseek.com': 'https://chat.deepseek.com/favicon.ico',
  'klingai.com': 'https://klingai.com/favicon.ico',
  'klingai.kuaishou.com': 'https://klingai.com/favicon.ico',
  'lumalabs.ai': 'https://lumalabs.ai/favicon.ico',
  'sora.com': 'https://sora.com/favicon.ico',
  'vidu.studio': 'https://www.vidu.studio/favicon.ico',
  'hailuoai.com': 'https://hailuoai.com/favicon.ico',
  'chatgpt.com': '/assets/images/logos/chatgpt.webp',
  'chat.openai.com': '/assets/images/logos/chatgpt.webp',
  'openai.com': '/assets/images/logos/chatgpt.webp',
  'claude.ai': '/assets/images/logos/claude.webp',
  'anthropic.com': '/assets/images/logos/claude.webp',
  'cloudflare.com': '/assets/images/logos/cloudflar.webp',
  'figma.com': '/assets/images/logos/figma.webp',
  'tinypng.com': '/assets/images/logos/tinypng.webp',
  'unsplash.com': '/assets/images/logos/unsplash.webp',
  'vercel.com': '/assets/images/logos/vercel.webp',
  'fonts.google.com': '/assets/images/logos/Materialicons.webp',
  'material.io': '/assets/images/logos/Materialicons.webp',
  'colorhunt.co': '/assets/images/logos/colorhunt.webp',
  'flinto.com': '/assets/images/logos/flinto.webp',
  'flaticon.com': '/assets/images/logos/flaticon.webp',
  'fontawesome.com': '/assets/images/logos/fontawesomeicon.webp',
  'framer.com': '/assets/images/logos/framer.webp',
  'freepik.com': '/assets/images/logos/freepik.webp',
  'gemini.google.com': '/assets/images/logos/gemini.svg',
  'iconarchive.com': '/assets/images/logos/iconarchive.webp',
  'iconfinder.com': '/assets/images/logos/Iconfinder.webp',
  'iconfont.cn': '/assets/images/logos/iconfont.webp',
  'iconmonstr.com': '/assets/images/logos/iconmonstr.webp',
  'ionicons.com': '/assets/images/logos/ionicons.webp',
  'leonardo.ai': '/assets/images/logos/leonardo.webp',
  'poe.com': '/assets/images/logos/poe.svg',
  'producthunt.com': '/assets/images/logos/producthunt.webp',
  'tensor.art': '/assets/images/logos/tensorart.webp',
  'icomoon.io': '/assets/images/logos/IcoMoonApp.webp',
  'findicons.com': '/assets/images/logos/FindIcons.webp',
  'principleformac.com': '/assets/images/logos/principle.webp',
  'worldvectorlogo.com': '/assets/images/logos/worldvectorlogo.webp',
  'shots.so': '/assets/images/logos/shots.webp',
  'simplelineicons.com': '/assets/images/logos/simplelineicons.webp',
  'sqlformat.org': '/assets/images/logos/sqlformat.webp',
  'tableconvert.com': '/assets/images/logos/tableconvert.webp',
  'json.cn': '/assets/images/logos/json.webp',
  'beautifier.io': '/assets/images/logos/beautifier.webp',
  'ui-cloud.com': '/assets/images/logos/UICloud.webp',
  'ads.google.com': '/assets/images/logos/gads.webp',
  'analytics.google.com': '/assets/images/logos/analytics.webp',
  'photoshop.com': '/assets/images/logos/photoshop.webp',
  'adobe.com': '/assets/images/logos/photoshop.webp',
  'affinity.serif.com': '/assets/images/logos/AffinityDesigner.webp',
  'instantlogosearch.com': '/assets/images/logos/InstantLogoSearch.webp',
  'iconsfeed.com': '/assets/images/logos/iconsfeed.webp',
  'iosicongallery.com': '/assets/images/logos/iosicongallery.webp',
}

/**
 * 第三方图标服务域名黑名单。
 *
 * 这些服务把用户「渲染过哪些域名」实时送到第三方服务器上——对一个导航站来说，
 * 这就是把完整浏览记录交出去。种子数据（seed-data.json）里存了一大批
 * icon.horse 链接，只改代码不够：自定义 icon 优先级最高，脏数据会一直被用。
 * 所以在这里按域名拦掉，让它们回落到下方「目标站自己的 favicon → 渐变徽标」链路。
 */
const THIRD_PARTY_ICON_HOSTS = ['icon.horse', 'favicon.cc', 'yandex.st', 'favicon.yandex.net']
/** 路径型图标服务（整站不是图标服务，只有这个路径是），按 URL 前缀拦 */
const THIRD_PARTY_ICON_PATHS = ['https://www.google.com/s2/favicons', 'https://icons.duckduckgo.com/ip3/']

function isThirdPartyIcon(value: string): boolean {
  try {
    const u = new URL(value)
    const host = u.hostname.toLowerCase()
    if (THIRD_PARTY_ICON_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`))) return true
    return THIRD_PARTY_ICON_PATHS.some((p) => u.href.startsWith(p))
  } catch {
    return false
  }
}

/**
 * 校验是否属于远端自动生成的 /favicon.ico 盲猜探测地址。
 * 这类地址来自爬虫或种子数据生成，并非人工上传的品牌图标。
 * 外部站点普遍开启了 CORP (Cross-Origin-Resource-Policy: same-origin) 拦截，
 * 在前端直接请求会抛出 ERR_BLOCKED_BY_RESPONSE.NotSameOrigin 403 / 404 / 502 等控制台错误。
 */
export function isRemoteRawFavicon(value?: string | null): boolean {
  if (!value || typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return false
  try {
    const u = new URL(trimmed)
    const p = u.pathname.toLowerCase()
    if (
      p.endsWith('/favicon.ico') ||
      p.endsWith('/favicon.png') ||
      p.endsWith('/favicon.svg') ||
      p === '/favicon.ico' ||
      p.includes('favicon')
    ) {
      return true
    }
    if (p === '/' || p === '') {
      return true
    }
  } catch {
    return true
  }
  return false
}

export function resolveSiteIcon(
  url?: string,
  title?: string,
  customIcon?: string | null
): string {
  // 自定义 icon 优先，但第三方图标服务与远端盲猜 favicon 探测地址除外
  if (
    customIcon &&
    typeof customIcon === 'string' &&
    customIcon.trim().length > 0 &&
    !isThirdPartyIcon(customIcon.trim()) &&
    !isRemoteRawFavicon(customIcon.trim())
  ) {
    return customIcon.trim()
  }

  if (!url || typeof url !== 'string') {
    return ''
  }

  try {
    const rawUrl = url.trim()
    const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
    let hostname = parsed.hostname.toLowerCase()

    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4)
    }

    if (LOCAL_LOGO_MAP[hostname]) {
      return LOCAL_LOGO_MAP[hostname]!
    }

    for (const [domainKey, assetPath] of Object.entries(LOCAL_LOGO_MAP)) {
      if (hostname === domainKey || hostname.endsWith(`.${domainKey}`)) {
        return assetPath
      }
    }

    // 自动解析 GitHub 仓库专属组织/用户 Avatar，杜绝连续黑猫 Octocat 撞脸
    if (hostname === 'github.com') {
      const parts = parsed.pathname.split('/').filter(Boolean)
      if (parts.length >= 1) {
        const owner = parts[0]!
        if (!['features', 'topics', 'trending', 'collections', 'pricing', 'about', 'security', 'login', 'signup'].includes(owner.toLowerCase())) {
          return `https://github.com/${owner}.png?size=64`
        }
      }
    }

    const lowerTitle = (title || '').toLowerCase()
    if (lowerTitle.includes('kimi')) return 'https://kimi.moonshot.cn/pwa-192.png'
    if (lowerTitle.includes('豆包')) return 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/favicon/new-doubao/128x128.png'
    if (lowerTitle.includes('文心一言')) return 'https://www.baidu.com/favicon.ico'
    if (lowerTitle.includes('通义灵码')) return 'https://img.alicdn.com/imgextra/i1/O1CN01BN6Jtc1lCfJNviV7H_!!6000000004783-2-tps-134-133.png'
    if (lowerTitle.includes('runway')) return 'https://runwayml.com/icon.png'
    if (lowerTitle.includes('deepseek')) return 'https://chat.deepseek.com/favicon.ico'
    if (lowerTitle.includes('copilot')) return 'https://github.com/github.png?size=64'
    if (lowerTitle.includes('gemini')) return '/assets/images/logos/gemini.svg'
    if (lowerTitle.includes('chatgpt') || lowerTitle.includes('openai')) return '/assets/images/logos/chatgpt.webp'
    if (lowerTitle.includes('claude')) return '/assets/images/logos/claude.webp'
    if (lowerTitle.includes('cloudflare')) return '/assets/images/logos/cloudflar.webp'
    if (lowerTitle.includes('figma')) return '/assets/images/logos/figma.webp'
    if (lowerTitle.includes('tinypng')) return '/assets/images/logos/tinypng.webp'
    if (lowerTitle.includes('unsplash')) return '/assets/images/logos/unsplash.webp'
    if (lowerTitle.includes('vercel')) return '/assets/images/logos/vercel.webp'

    // 未命中内置 Logo 且无合法自定义图标时，不向浏览器返回远端裸 /favicon.ico，
    // 避免浏览器盲发跨域请求触发 CORP (NotSameOrigin) 阻断或 404/502 报错；
    // 返回空字符串让组件安全回落到确定性渐变字母徽标。
    return ''
  } catch {
    return ''
  }
}

// 记录加载失败过的图标地址，避免重复发起失效请求
const failedFaviconCache = new Set<string>()

export function SiteFavicon({
  title = '',
  url,
  icon,
  useDefaultIcon = false,
  className = 'w-full h-full object-contain',
  eager = false,
}: SiteFaviconProps) {
  const [imgError, setImgError] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const prevIconRef = React.useRef(icon)
  const imgRef = React.useRef<HTMLImageElement | null>(null)

  // 1. 综合计算有效图标地址
  let effectiveIcon = resolveSiteIcon(url, title, icon)
  if (!effectiveIcon && url && (url.startsWith('http://') || url.startsWith('https://'))) {
    // 图标代理端点由中枢提供（apps/api/src/routes/assets.ts）
    // 通过 /api/hub 隧道代理，已在网关清单中登记为 public
    effectiveIcon = `/api/hub/assets/icon?url=${encodeURIComponent(url)}${title ? `&title=${encodeURIComponent(title)}` : ''}`
  }

  // 当 icon 变化时重置状态
  if (prevIconRef.current !== icon) {
    prevIconRef.current = icon
    if (imgError) setImgError(false)
    if (imgLoaded) setImgLoaded(false)
  }

  // 特殊站点图标自愈：部分站点原生返回纯白/透明矢量图，在浅色底色下对比度不足（如 Cursor 官网透明白立方体）
  const isCursorSite = Boolean(
    (title && title.toLowerCase().includes('cursor')) ||
    (url && url.toLowerCase().includes('cursor.com'))
  )

  const monogram = extractFaviconMonogram(title, url)
  const gradient = getDeterministicGradient(title || url || 'navhub')
  const shouldRenderImg = !useDefaultIcon && !imgError && Boolean(effectiveIcon) && !failedFaviconCache.has(effectiveIcon)

  // 水合与缓存即时感知：若图片已由浏览器完成解码（或来自本地/HTTP缓存），立即置为已加载，防止依赖 onLoad 漏触发
  const handleImgRef = React.useCallback((node: HTMLImageElement | null) => {
    imgRef.current = node
    if (node && node.complete) {
      if (node.naturalWidth > 1) {
        setImgLoaded(true)
      } else if (node.naturalWidth === 1 || node.naturalWidth === 0) {
        // 尚未开始加载或空像素，等待 onLoad/onError
      }
    }
  }, [])

  // 2. 双层渲染架构 (Dual-Layer Architecture)：
  // 底层（Layer 1）：确定性彩色首字母/汉字徽标，常驻存在，零延迟、零灰块
  // 顶层（Layer 2）：真实图片图标，未解码/加载前透明，成功加载后平滑淡入（透明矢量图不透底）
  return (
    <div
      className={cn('relative w-full h-full flex items-center justify-center overflow-hidden rounded-xs select-none', className)}
      title={title}
      aria-label={title ? `${title} 图标` : '站点图标'}
    >
      {/* 真实站点图标：正在加载或加载成功（未触发 onError）时置于顶层可见 (z-10 opacity-100) */}
      {shouldRenderImg ? (
        <img
          ref={handleImgRef}
          src={effectiveIcon}
          alt={title ? `${title} 图标` : '站点图标'}
          className={cn(
            'relative z-10 w-full h-full object-contain opacity-100 transition-opacity duration-150',
            isCursorSite && 'bg-muted/40 dark:bg-muted/20 rounded-xs p-0.5 border border-border/30'
          )}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'low'}
          decoding="async"
          width={24}
          height={24}
          onError={() => {
            failedFaviconCache.add(effectiveIcon)
            setImgError(true)
          }}
          onLoad={(e) => {
            if (
              e.currentTarget.complete &&
              (e.currentTarget.naturalWidth <= 1 ||
                (e.currentTarget.naturalWidth === 16 &&
                  e.currentTarget.naturalHeight === 16 &&
                  effectiveIcon.includes('google.com/s2/favicons')))
            ) {
              failedFaviconCache.add(effectiveIcon)
              setImgError(true)
            } else if (e.currentTarget.naturalWidth > 1) {
              setImgLoaded(true)
            }
          }}
        />
      ) : (
        /* 仅在无有效图标或图片加载失败时显示彩色首字母徽章兜底 */
        <div
          className="absolute inset-0 flex items-center justify-center font-bold text-xs shadow-xs"
          style={{
            background: gradient.cssGradient,
            color: gradient.textColor,
          }}
        >
          <span className="leading-none drop-shadow-xs">{monogram}</span>
        </div>
      )}
    </div>
  )
}
