'use client'

import React, { useState } from 'react'
import { getBuiltinBrandLogo } from '@/lib/brand-logos'
import { cn } from '@/lib/utils'

export interface SiteFaviconProps {
  title?: string
  url?: string
  icon?: string
  useDefaultIcon?: boolean
  className?: string
  /**
   * 首屏主图标（如详情页 64px 徽标）传 `true`：`loading="lazy"` 在视口内的图上
   * 仍会让浏览器推迟一次解码调度，而这张图常常就是该页的 LCP 元素。
   */
  eager?: boolean
  /**
   * 内联尺寸提示（px）：只写到 `<img width/height>` 上，给浏览器一个解码前的占位比例，
   * 避免图标位在加载瞬间抖一下。**实际显示大小仍由 className 决定**——
   * 组件本身不自适应大容器（那是 site-icon-redesign 守卫要求的行为），
   * 所以这里不设默认值：不传就不写属性，绝不写死某个尺寸。
   */
  size?: number
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

export function extractFaviconMonogram(title: string, url?: string): string {
  const cleanTitle = (title || '').trim()
  if (cleanTitle) {
    const stripped = cleanTitle.replace(/^[\p{P}\p{S}\s]+/u, '')
    if (stripped.length > 0) {
      const char = stripped[0]!
      if (/[\u4e00-\u9fa5]/.test(char)) return char
      if (/[a-zA-Z0-9]/.test(char)) return char.toUpperCase()
    }
  }

  if (url) {
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`)
      let host = u.hostname.toLowerCase()
      if (host.startsWith('www.')) host = host.slice(4)
      if (host.length > 0 && /[a-zA-Z0-9]/.test(host[0]!)) {
        return host[0]!.toUpperCase()
      }
    } catch {
      // 容错降级
    }
  }

  return ''
}

/** 现代微型星轨罗盘图标（用于无首字母站点的精致矢量兜底） */
function GlobeCompassIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="9" strokeWidth="1.5" strokeDasharray="2 3" opacity="0.6" />
      <ellipse cx="12" cy="12" rx="9" ry="4" strokeWidth="1.5" opacity="0.75" />
      <ellipse cx="12" cy="12" rx="4" ry="9" strokeWidth="1.5" opacity="0.75" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  )
}

/** 重新设计的 Modern Crystal Squircle 晶体质感徽标 */
function renderCrystalBadge(title: string, url: string | undefined, className: string) {
  const monogram = extractFaviconMonogram(title, url)
  const gradient = getDeterministicGradient(url || title || 'navhub')

  // 根据 className 或外部容器规格自适应字号与图标尺寸（详情页 64px、速览 48px、卡片 24px 均等比饱满）
  const isLarge = className.includes('w-16') || className.includes('h-16') || className.includes('w-14') || className.includes('h-14')
  const isMedium = className.includes('w-12') || className.includes('h-12') || className.includes('w-10') || className.includes('h-10')

  const fontClass = isLarge
    ? 'text-2xl sm:text-3xl font-black'
    : isMedium
      ? 'text-base sm:text-lg font-extrabold'
      : 'text-[11px] sm:text-xs @[28px]:text-xs @[36px]:text-sm @[44px]:text-base @[52px]:text-lg @[60px]:text-2xl font-mono font-black'

  const iconClass = isLarge
    ? 'w-8 h-8 drop-shadow-md'
    : isMedium
      ? 'w-6 h-6 drop-shadow-sm'
      : 'w-[55%] h-[55%] max-w-[36px] max-h-[36px] drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.4)]'

  return (
    <div
      className={cn(
        "@container relative flex items-center justify-center font-bold select-none rounded-lg overflow-hidden shadow-xs ring-1 ring-inset ring-white/25 dark:ring-white/15 transition-transform duration-150 group-hover:scale-105",
        className
      )}
      style={{
        background: gradient.cssGradient,
        color: gradient.textColor,
      }}
      title={title}
      aria-label={title ? `${title} 图标` : '站点图标'}
    >
      {/* 顶层柔光晶体微弧反射 */}
      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 via-white/10 to-transparent pointer-events-none" />

      {monogram ? (
        <span className={cn("relative z-10 tracking-tight leading-none drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.4)]", fontClass)}>
          {monogram}
        </span>
      ) : (
        <GlobeCompassIcon className={cn("relative z-10 text-white", iconClass)} />
      )}
    </div>
  )
}

export const LOCAL_LOGO_MAP: Record<string, string> = {
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
  // 1. 优先命中官方内建高清矢量 Logo（免去外部网络请求与跨域防盗链问题，杜绝模糊与过期位图）
  const builtinLogo = getBuiltinBrandLogo(url, title)
  if (builtinLogo) {
    return builtinLogo
  }

  // 2. 自定义 icon 优先，但第三方图标服务与远端盲猜 favicon 探测地址除外
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

    const lowerTitle = (title || '').toLowerCase()
    if (lowerTitle.includes('chatgpt') || lowerTitle.includes('openai')) return '/assets/images/logos/chatgpt.webp'
    if (lowerTitle.includes('claude')) return '/assets/images/logos/claude.webp'
    if (lowerTitle.includes('cloudflare')) return '/assets/images/logos/cloudflar.webp'
    if (lowerTitle.includes('figma')) return '/assets/images/logos/figma.webp'
    if (lowerTitle.includes('tinypng')) return '/assets/images/logos/tinypng.webp'
    if (lowerTitle.includes('unsplash')) return '/assets/images/logos/unsplash.webp'
    if (lowerTitle.includes('vercel')) return '/assets/images/logos/vercel.webp'

    // 未命中内置 Logo 且无合法自定义图标时，不向浏览器返回远端裸 /favicon.ico，
    // 避免浏览器盲发跨域请求触发 CORP (NotSameOrigin) 阻断或 404/502 报错；
    // 返回空字符串让组件安全回落到确定性晶体徽标。
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
  size,
}: SiteFaviconProps) {
  // 1. 综合计算有效图标地址
  const effectiveIcon = resolveSiteIcon(url, title, icon)

  const [loadFailed, setLoadFailed] = useState(false)
  const [prevEffectiveIcon, setPrevEffectiveIcon] = useState(effectiveIcon)

  // 当属性变更导致解析出的图标地址改变时，重置加载失败状态，防止列表节点复用导致的“幽灵破图锁死”
  if (prevEffectiveIcon !== effectiveIcon) {
    setPrevEffectiveIcon(effectiveIcon)
    setLoadFailed(false)
  }

  // 2. 若显式指定默认图标，直接渲染全新 Modern Crystal Squircle 晶体质感徽标
  if (useDefaultIcon) {
    return renderCrystalBadge(title, url, className)
  }

  // 3. 判断是否为明确的自定义图标或本地品牌资源
  const isLocalAsset = effectiveIcon.startsWith('/') || effectiveIcon.startsWith('data:')
  const hasCustomIcon = Boolean(
    icon &&
    typeof icon === 'string' &&
    icon.trim().length > 0 &&
    !isThirdPartyIcon(icon.trim()) &&
    !isRemoteRawFavicon(icon.trim())
  )

  // 4. 若此前已知加载失败、或未提供自定义 icon 且无内置 Logo（即属于自动生成的外部 /favicon.ico 盲猜地址）：
  //    外部站点普遍存在缺乏根目录 /favicon.ico、防盗链限制、CORP (NotSameOrigin) 阻断或跨境网络超时；
  //    直接加载会导致浏览器控制台报大量 net::ERR_* 错误。此处直接展示 NavHub 晶体徽标，零网络开销且质感极佳。
  if (!effectiveIcon || loadFailed || failedFaviconCache.has(effectiveIcon) || (!hasCustomIcon && !isLocalAsset)) {
    return renderCrystalBadge(title, url, className)
  }

  return (
    <img
      src={effectiveIcon}
      alt={title ? `${title} 图标` : '站点图标'}
      // 只在调用方显式给了 size 时才写内在尺寸；不传则完全不写，绝不写死
      width={size}
      height={size}
      className={className}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : 'auto'}
      decoding="async"
      onError={() => {
        failedFaviconCache.add(effectiveIcon)
        setLoadFailed(true)
      }}
    />
  )
}
