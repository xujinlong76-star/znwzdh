/**
 * 确定性渐变徽标与自适应 Favicon 生成管线 (Deterministic Gradient Avatar & Favicon Pipeline)
 * 纯算法实现，0 DOM 依赖，跨 Node.js 和浏览器通用。
 *
 * 核心机制：
 * 1. FNV-1a 字符串哈希散列算法：输入域名或标题，映射到确定性色板与渐变角
 * 2. 精选 16 组高级赛博/莫兰迪双色渐变色板，保证视觉对比度与现代高级感
 * 3. 智能字形提取 (Monogram Extractor)：自动过滤 www. 等域名前缀，精准提取首字母或汉字
 * 4. 内联矢量 SVG 生成器：支持直接输出轻量级 SVG 字符串或 Data URI
 */

// 精选 16 组高质感现代渐变色阶（高色彩饱和度、高辨识度与 WCAG AA 级文字对比度）
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

/**
 * 32-bit FNV-1a 哈希算法（快速且分布均匀）
 */
export function fnv1aHash(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * 1. 获取基于 seed (如网站 URL 或标题) 的确定性渐变参数
 */
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

  // 渐变角度从 45deg, 90deg, 135deg, 180deg 等中选择
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

/**
 * 2. 提取网站核心 Monogram 字符
 * 例如：
 * - "https://github.com/..." -> "G"
 * - "React 官方中文文档" -> "R"
 * - "阿里云开发者社区" -> "阿"
 * - "1024 程序员节" -> "1"
 */
export function extractFaviconMonogram(title: string, url?: string): string {
  const cleanTitle = (title || '').trim()

  if (cleanTitle) {
    // 过滤掉开头的符号 (如 ✨, 📌, [, 【)
    const stripped = cleanTitle.replace(/^[\p{P}\p{S}\s]+/u, '')
    if (stripped.length > 0) {
      const char = stripped[0]!
      // 如果是中文字符
      if (/[\u4e00-\u9fa5]/.test(char)) {
        return char
      }
      // 如果是英文字母或数字
      if (/[a-zA-Z0-9]/.test(char)) {
        return char.toUpperCase()
      }
    }
  }

  // 若标题提取失败，退避使用域名提取
  if (url) {
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`)
      let host = u.hostname.toLowerCase()
      // 剥离 www.
      if (host.startsWith('www.')) {
        host = host.slice(4)
      }
      if (host.length > 0 && /[a-zA-Z0-9]/.test(host[0]!)) {
        return host[0]!.toUpperCase()
      }
    } catch {}
  }

  return 'N' // Default to 'N' for NavHub
}

/**
 * 3. 动态生成纯矢量 SVG 徽标字符串
 */
export function generateDeterministicSvg(
  title: string,
  url?: string,
  size = 64
): string {
  const seed = (url || title || 'navhub').toLowerCase()
  const { from, to, angle, textColor } = getDeterministicGradient(seed)
  const char = extractFaviconMonogram(title, url)

  const radius = Math.round(size * 0.28) // 现代平滑圆角
  const fontSize = Math.round(size * 0.52)

  // 角度转为 SVG linearGradient x1, y1, x2, y2
  const rad = (angle * Math.PI) / 180
  const x1 = Math.round(50 - Math.cos(rad) * 50)
  const y1 = Math.round(50 - Math.sin(rad) * 50)
  const x2 = Math.round(50 + Math.cos(rad) * 50)
  const y2 = Math.round(50 + Math.sin(rad) * 50)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g_${fnv1aHash(seed)}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">
      <stop offset="0%" stop-color="${from}" />
      <stop offset="100%" stop-color="${to}" />
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#g_${fnv1aHash(seed)})" />
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="${textColor}">
    ${char}
  </text>
</svg>`.trim()
}

/**
 * 4. 生成 Data URI 格式的 SVG 图标
 */
export function generateDeterministicSvgDataUrl(
  title: string,
  url?: string,
  size = 64
): string {
  const svg = generateDeterministicSvg(title, url, size)
  const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22')
  return `data:image/svg+xml;charset=utf-8,${encoded}`
}

/**
 * 本地静态品牌 Logo 映射表 (基于 /assets/images/logos/ 资源库)
 */
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

/**
 * 5. 智能解析站点高分辨率图标 (Smart Favicon / Logo Resolver)
 *
 * 优先级逻辑：
 * 1. 若显式提供合法且有效的自定义图标 (customIcon)，直接采用
 * 2. 匹配预置的高清本地品牌矢量/WebP Logo (例如 ChatGPT, Claude, Vercel, Cloudflare, Figma, TinyPNG, Unsplash)
 * 3. 直取目标站点自己的 /favicon.ico，失败由前端渐变字母徽标兜底
 */
/**
 * 第三方图标服务黑名单：这些服务把用户「渲染过哪些域名」实时送到第三方。
 * 自定义 icon 若指向它们，一律视同没有自定义图标，回落到本地解析链。
 * （seed-data.json 历史数据里存了一批这类链接，光改回退逻辑不够。）
 */
const THIRD_PARTY_ICON_HOSTS = ['icon.horse', 'favicon.cc', 'yandex.st', 'favicon.yandex.net']
/** 路径型图标服务（整站不是图标服务，只有这个路径是），按 URL 前缀拦 */
const THIRD_PARTY_ICON_PATHS = ['https://www.google.com/s2/favicons', 'https://icons.duckduckgo.com/ip3/']

/**
 * 判断图标 URL 是否指向第三方图标服务（icon.horse 之类）。
 *
 * 导出用途：净化「站点自定义图标」的写入与快照输出路径 ——
 * 只把 customIcon 传给 resolveSiteIcon 不够，凡是 `iconKey || resolveSiteIcon(...)`
 * 这种短路写法都会绕过黑名单，让脏值进库/进快照/RSC payload。
 */
export function isThirdPartyIconUrl(value: string): boolean {
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
 * 净化「机器生成」的图标 URL（元数据抓取 / 富化 / 快照回流等写入点）：
 * 第三方图标服务地址视同没有自定义图标，返回 null；其余值去空白后原样返回。
 * 用户显式提交的 iconKey 不走这里 —— 那条路径由渲染层黑名单兜底。
 */
export function sanitizeIconUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return isThirdPartyIconUrl(trimmed) ? null : trimmed
}

export function resolveSiteIcon(
  url: string,
  title?: string,
  customIcon?: string | null
): string {
  if (customIcon && typeof customIcon === 'string' && customIcon.trim().length > 0 && !isThirdPartyIconUrl(customIcon.trim())) {
    return customIcon.trim()
  }

  if (!url || typeof url !== 'string') {
    return ''
  }

  try {
    const rawUrl = url.trim()
    const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
    let hostname = parsed.hostname.toLowerCase()

    // 剥离 www. 前缀
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4)
    }

    // 1. 精确匹配本地 Logo 库
    if (LOCAL_LOGO_MAP[hostname]) {
      return LOCAL_LOGO_MAP[hostname]!
    }

    // 2. 子域名或后半段匹配 (如 *.vercel.app -> vercel.webp, fonts.google.com 等)
    for (const [domainKey, assetPath] of Object.entries(LOCAL_LOGO_MAP)) {
      if (hostname === domainKey || hostname.endsWith(`.${domainKey}`)) {
        return assetPath
      }
    }

    // 3. 知名品牌标题关键词模糊回退
    const lowerTitle = (title || '').toLowerCase()
    if (lowerTitle.includes('chatgpt') || lowerTitle.includes('openai')) return '/assets/images/logos/chatgpt.webp'
    if (lowerTitle.includes('claude')) return '/assets/images/logos/claude.webp'
    if (lowerTitle.includes('cloudflare')) return '/assets/images/logos/cloudflar.webp'
    if (lowerTitle.includes('figma')) return '/assets/images/logos/figma.webp'
    if (lowerTitle.includes('tinypng')) return '/assets/images/logos/tinypng.webp'
    if (lowerTitle.includes('unsplash')) return '/assets/images/logos/unsplash.webp'
    if (lowerTitle.includes('vercel')) return '/assets/images/logos/vercel.webp'

    // 4. 直取目标站点自己的 favicon —— 不经任何第三方图标服务。
    //    历史上这里用 icon.horse（"无防盗链阻碍的高速 CDN"），但代价是把
    //    用户的完整浏览记录实时送到第三方。前端还有渐变字母徽标兜底，
    //    个别不在根目录提供 favicon 的站点会退化成徽标，可接受。
    return `https://${hostname}/favicon.ico`
  } catch {
    return ''
  }
}

