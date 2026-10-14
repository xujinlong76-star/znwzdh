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
