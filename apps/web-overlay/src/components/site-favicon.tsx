'use client'

import React, { useState } from 'react'

export interface SiteFaviconProps {
  title?: string
  url?: string
  icon?: string
  useDefaultIcon?: boolean
  className?: string
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
  const angle = angleSteps[(hash >> 4) % angleSteps.length]!

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
    } catch {}
  }

  return 'N'
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
}

export function resolveSiteIcon(
  url?: string,
  title?: string,
  customIcon?: string | null
): string {
  if (customIcon && typeof customIcon === 'string' && customIcon.trim().length > 0) {
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

    return `https://icon.horse/icon/${hostname}`
  } catch {
    return ''
  }
}

export function SiteFavicon({
  title = '',
  url,
  icon,
  useDefaultIcon = false,
  className = 'w-full h-full object-contain',
}: SiteFaviconProps) {
  const [loadFailed, setLoadFailed] = useState(false)

  // 综合计算有效图标地址：自定义 icon 优先；若未提供则通过 url 智能解析
  const effectiveIcon = icon || (url ? resolveSiteIcon(url, title) : '')

  // 若明确指定使用默认图标，或无有效图标，或图片加载失败，展示高质量确定性渐变徽标
  if (useDefaultIcon || !effectiveIcon || loadFailed) {
    const monogram = extractFaviconMonogram(title, url)
    const gradient = getDeterministicGradient(url || title || 'navhub')

    return (
      <div
        className={`flex items-center justify-center font-bold text-xs select-none rounded-sm shadow-xs transition-transform duration-150 ${className}`}
        style={{
          background: gradient.cssGradient,
          color: gradient.textColor,
        }}
        title={title}
        aria-label={title ? `${title} 图标` : '站点图标'}
      >
        <span className="leading-none drop-shadow-xs">{monogram}</span>
      </div>
    )
  }

  return (
    <img
      src={effectiveIcon}
      alt={title ? `${title} 图标` : '站点图标'}
      className={className}
      loading="lazy"
      decoding="async"
      width={24}
      height={24}
      onError={() => setLoadFailed(true)}
    />
  )
}
