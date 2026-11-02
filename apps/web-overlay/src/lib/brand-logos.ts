/**
 * 内建高频主流站点官方高清矢量 Logo 库。
 *
 * 解决导航站两大顽疾：
 * 1. 外部 raw /favicon.ico 盲猜请求被防盗链、CORS、CORP (NotSameOrigin) 阻断或跨境网络超时导致破图；
 * 2. 顶级技术社区、主流大厂与高频 AI 站点回退为单一单字色块，视觉单调、平庸、不好看。
 *
 * 全部采用精简、标准配色的纯矢量 SVG Data URI，零网络往返延迟，即挂载即立显。
 */

function encodeSvg(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`
}

export const BUILTIN_BRAND_LOGOS: Record<string, string> = {
  // GitHub: 经典 Octocat 剪影与曜石黑质感
  'github.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#181717"/>
      <path fill="#ffffff" fill-rule="evenodd" clip-rule="evenodd" d="M24 8C15.16 8 8 15.16 8 24c0 7.07 4.58 13.06 10.94 15.18.8.15 1.09-.35 1.09-.77 0-.38-.01-1.39-.02-2.73-4.45.97-5.39-2.15-5.39-2.15-.73-1.85-1.78-2.34-1.78-2.34-1.45-.99.11-.97.11-.97 1.61.11 2.45 1.65 2.45 1.65 1.43 2.45 3.75 1.74 4.66 1.33.15-1.04.56-1.74 1.02-2.14-3.55-.4-7.29-1.78-7.29-7.91 0-1.75.62-3.17 1.65-4.29-.17-.4-.71-2.03.15-4.23 0 0 1.34-.43 4.4 1.64 1.28-.36 2.65-.54 4.01-.54 1.36 0 2.73.18 4.01.54 3.05-2.07 4.39-1.64 4.39-1.64.87 2.2.33 3.83.16 4.23 1.03 1.12 1.64 2.54 1.64 4.29 0 6.15-3.75 7.5-7.32 7.9.57.5 1.09 1.47 1.09 2.97 0 2.15-.02 3.88-.02 4.41 0 .43.29.93 1.1.77C35.43 37.05 40 31.07 40 24c0-8.84-7.16-16-16-16z"/>
    </svg>
  `),

  // Google: 官方经典四色 G
  'google.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5"/>
      <path fill="#4285F4" d="M37.6 24.5c0-1.04-.09-2.04-.26-3H24v5.69h7.64c-.33 1.78-1.34 3.29-2.85 4.3v3.57h4.62c2.7-2.49 4.19-6.16 4.19-10.56z"/>
      <path fill="#34A853" d="M24 38.35c3.87 0 7.12-1.28 9.5-3.48l-4.62-3.57c-1.29.86-2.93 1.37-4.88 1.37-3.75 0-6.93-2.53-8.07-5.94H11.1v3.69c2.35 4.67 7.19 7.93 12.9 7.93z"/>
      <path fill="#FBBC05" d="M15.93 26.73c-.29-.86-.46-1.78-.46-2.73s.17-1.87.46-2.73v-3.69H11.1C10.05 19.68 9.5 21.78 9.5 24s.55 4.32 1.6 6.42l4.83-3.69z"/>
      <path fill="#EA4335" d="M24 15.33c2.11 0 4 .72 5.49 2.15l4.12-4.12C31.11 10.97 27.86 9.65 24 9.65c-5.71 0-10.55 3.26-12.9 7.93l4.83 3.69c1.14-3.41 4.32-5.94 8.07-5.94z"/>
    </svg>
  `),

  // Bilibili: 官方标志性天蓝粉红萌系小电视
  'bilibili.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#00AEEC"/>
      <path fill="#ffffff" d="M15.2 12.8a1.5 1.5 0 0 1 2.1-.4l4.5 3.2h4.4l4.5-3.2a1.5 1.5 0 1 1 1.8 2.4l-3.3 2.4h3.5a6 6 0 0 1 6 6v11a6 6 0 0 1-6 6H13.3a6 6 0 0 1-6-6v-11a6 6 0 0 1 6-6h3.5l-3.3-2.4a1.5 1.5 0 0 1-.3-2z"/>
      <circle cx="18" cy="27" r="2.5" fill="#00AEEC"/>
      <circle cx="30" cy="27" r="2.5" fill="#00AEEC"/>
      <path d="M22 31c1 1 3 1 4 0" stroke="#00AEEC" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>
  `),

  // DeepSeek: 标志性深海跃鲸与科技蓝渐变
  'deepseek.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <defs>
        <linearGradient id="dsGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1d4ed8"/>
          <stop offset="100%" stop-color="#0284c7"/>
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#dsGrad)"/>
      <path fill="#ffffff" d="M12 28c4-8 12-14 22-10 1 .4 1.8 1.4 1.5 2.5-.4 1.2-1.7 1.8-2.8 1.4-7-2.6-13.6 1.8-16.7 7.1-1.2 2-3 2.5-4 1.5-.7-.7-.7-1.8 0-2.5z"/>
      <path fill="#ffffff" fill-opacity="0.85" d="M22 34c2.5-2.2 6.5-3.5 11-2.5 1.2.3 2 .1 2.5-.6.5-.8.3-1.8-.5-2.2-5.5-1.5-10.5-.2-14 2.6-1.5 1.2-1.2 2.8.2 3.1.3.1.6 0 .8-.4z"/>
      <circle cx="33" cy="18" r="1.5" fill="#38bdf8"/>
    </svg>
  `),

  // 知乎: 纯正知乎深蓝底板 + 白色「知」
  'zhihu.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#0066FF"/>
      <text x="24" y="33" font-family="'PingFang SC', 'Source Han Sans CN', sans-serif" font-weight="900" font-size="25" fill="#ffffff" text-anchor="middle">知</text>
    </svg>
  `),

  // 稀土掘金: 标志性皇家蓝底板 + 三层折线金字塔宝石
  'juejin.cn': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#1E80FF"/>
      <g transform="translate(24, 24) scale(1.15)">
        <path d="M 0 -10 L 8.5 -2.5 L 6.5 -0.5 L 0 -7 L -6.5 -0.5 L -8.5 -2.5 Z" fill="#ffffff"/>
        <path d="M 0 -2.5 L 12 9.5 L 10 11.5 L 0 1.5 L -10 11.5 L -12 9.5 Z" fill="#ffffff"/>
        <polygon points="0,5.5 3.5,9 0,12.5 -3.5,9" fill="#ffffff"/>
      </g>
    </svg>
  `),

  // 微信 / WeChat: 经典青草绿底板 + 双对话气泡
  'weixin.qq.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#07C160"/>
      <g fill="#ffffff">
        <path d="M19.5 13C13.7 13 9 17 9 22c0 2.8 1.5 5.3 4 7l-.8 3.5 3.8-1.9c1.1.3 2.3.4 3.5.4.3 0 .7 0 1-.02-.3-.8-.5-1.6-.5-2.48 0-4.69 4.3-8.5 9.5-8.5.5 0 1 .04 1.5.11C30.6 15.6 25.5 13 19.5 13z"/>
        <circle cx="15.5" cy="18.5" r="1.5" fill="#07C160"/>
        <circle cx="23.5" cy="18.5" r="1.5" fill="#07C160"/>
        <path d="M30 20c-5 0-9 3.4-9 7.5 0 2.3 1.3 4.3 3.3 5.7l-.7 2.8 3.1-1.5c1 .3 2.1.5 3.3.5 5 0 9-3.4 9-7.5s-4-7.5-9-7.5z"/>
        <circle cx="26.5" cy="24.5" r="1.2" fill="#07C160"/>
        <circle cx="33.5" cy="24.5" r="1.2" fill="#07C160"/>
      </g>
    </svg>
  `),

  // YouTube: 标志性红色播放器
  'youtube.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#FF0000"/>
      <path fill="#ffffff" d="M36.8 18.2a3.8 3.8 0 0 0-2.7-2.7C31.7 15 24 15 24 15s-7.7 0-10.1.5a3.8 3.8 0 0 0-2.7 2.7C10.7 20.6 10.7 24 10.7 24s0 3.4.5 5.8a3.8 3.8 0 0 0 2.7 2.7c2.4.5 10.1.5 10.1.5s7.7 0 10.1-.5a3.8 3.8 0 0 0 2.7-2.7c.5-2.4.5-5.8.5-5.8s0-3.4-.5-5.8z"/>
      <polygon points="21.5,20 21.5,28 28.5,24" fill="#FF0000"/>
    </svg>
  `),

  // X / Twitter: 黑色底板 + 官方大写数学 X
  'x.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#000000"/>
      <path fill="#ffffff" d="M28.4 12h3.9l-8.5 9.7L33.8 36h-7.8l-6.1-8-7 8h-3.9l9.1-10.4L8.5 12h8l5.5 7.3L28.4 12zm-1.4 21.6h2.2L15.3 14.3h-2.3l14 19.3z"/>
    </svg>
  `),

  // Docker: 海洋蓝底板 + 集装箱小鲸鱼
  'docker.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#2496ED"/>
      <g fill="#ffffff">
        <rect x="13" y="19" width="3" height="3" rx="0.5"/>
        <rect x="17" y="19" width="3" height="3" rx="0.5"/>
        <rect x="21" y="19" width="3" height="3" rx="0.5"/>
        <rect x="17" y="15" width="3" height="3" rx="0.5"/>
        <rect x="21" y="15" width="3" height="3" rx="0.5"/>
        <rect x="25" y="15" width="3" height="3" rx="0.5"/>
        <rect x="25" y="19" width="3" height="3" rx="0.5"/>
        <rect x="29" y="19" width="3" height="3" rx="0.5"/>
        <path d="M38.5 24.5c-.8-.5-2.2-.6-3.3-.2-.5-1.5-1.8-2.6-3.2-2.8-.2 0-.4 0-.6.05V23h-19v3c0 4.4 3.6 8 8 8 6 0 10.8-3.7 12.3-9 2 .2 4.3-.2 5.8-1.5v-1c0 .7 0 1.5 0 2z"/>
      </g>
    </svg>
  `),

  // NPM: 纯正 npm 红色积木
  'npmjs.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#CB3837"/>
      <path fill="#ffffff" d="M11 16v16h13V21h5v11h8V16H11zm13 11h-3V21h3v6z"/>
    </svg>
  `),

  // MDN Web Docs: 黑色底板 + 渐变 M 恐龙标志
  'developer.mozilla.org': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#15141A"/>
      <path fill="#ffffff" d="M10 32V16h4.5l4.5 9 4.5-9H28v16h-4v-9.5l-3.8 7.5h-1.4L15 22.5V32H10zm21.5 0l4-16h4l-4 16h-4z"/>
    </svg>
  `),

  // Stack Overflow: 标志性橙色阶梯
  'stackoverflow.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#F8F9F9" stroke="#E3E6E8" stroke-width="1.5"/>
      <path fill="#BCBBBB" d="M34 32v6H14v-6h-3v9h26v-9z"/>
      <path fill="#F48024" d="M17 29.5h14v2.5H17zm.8-6.3l13.6 3-0.5 2.5-13.6-3zm2.5-6.5l12.4 6.8-1.2 2.2-12.4-6.8zm5.2-6.5l10.2 9.6-1.7 1.8-10.2-9.6zm7.8-5.7l6.8 12.3-2.2 1.2-6.8-12.3z"/>
    </svg>
  `),

  // Cursor: 曜石黑 + 白金科技微光立方箭头
  'cursor.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#0F0F11"/>
      <polygon points="24,10 36,17 24,24 12,17" fill="#ffffff" fill-opacity="0.95"/>
      <polygon points="12,17 24,24 24,38 12,31" fill="#a1a1aa"/>
      <polygon points="36,17 24,24 24,38 36,31" fill="#71717a"/>
    </svg>
  `),

  // HuggingFace: 温暖黄色底板 + 经典抱抱微笑
  'huggingface.co': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#FFD21E"/>
      <circle cx="18" cy="22" r="3" fill="#1F2937"/>
      <circle cx="30" cy="22" r="3" fill="#1F2937"/>
      <path d="M16 28c2 4 14 4 16 0" stroke="#1F2937" stroke-width="3" stroke-linecap="round" fill="none"/>
      <path d="M9 25c2-2 5-1 6 1s-1 5-3 5-4-3-3-6zM39 25c-2-2-5-1-6 1s1 5 3 5 4-3 3-6z" fill="#F59E0B"/>
    </svg>
  `),

  // V2EX: 经典黑灰几何科技质感 V 方块
  'v2ex.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#333344"/>
      <path fill="#ffffff" d="M14 15h5l5 13 5-13h5l-8 19h-4l-8-19z"/>
    </svg>
  `),

  // 百度 / Baidu: 纯白底板 + 经典蓝红熊掌印
  'baidu.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5"/>
      <ellipse cx="16" cy="16" rx="2.5" ry="3.5" fill="#2932E1"/>
      <ellipse cx="22" cy="13" rx="2.5" ry="3.5" fill="#2932E1"/>
      <ellipse cx="28" cy="13" rx="2.5" ry="3.5" fill="#2932E1"/>
      <ellipse cx="34" cy="16" rx="2.5" ry="3.5" fill="#2932E1"/>
      <path fill="#2932E1" d="M17 25c0-4 3-7 7.5-7s7.5 3 7.5 7c0 5-3 9-7.5 9S17 30 17 25z"/>
      <path fill="#E1251B" d="M23.5 24c-.5 0-1 .4-1 1s.5 1.5 1.5 1.5 1.5-.9 1.5-1.5-.5-1-1-1h-1z"/>
    </svg>
  `),

  // Kimi / 月之暗面: 曜石黑 + 月相与星轨
  'kimi.moonshot.cn': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#0A0B0E"/>
      <circle cx="24" cy="24" r="12" fill="none" stroke="#6366f1" stroke-width="2" stroke-dasharray="4 2"/>
      <circle cx="24" cy="24" r="8" fill="#ffffff"/>
      <path d="M24 16a8 8 0 0 1 0 16z" fill="#0A0B0E"/>
    </svg>
  `),

  // Bing / 微软必应: 标志性青绿折角晶体 b
  'bing.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#008373"/>
      <path fill="#ffffff" d="M15 11v26l9 5 9-11-4-2-5 3V19l11 4v-7l-20-5z"/>
    </svg>
  `),

  // Vercel: 纯黑底板 + 经典白色正三角
  'vercel.com': encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <rect width="48" height="48" rx="12" fill="#000000"/>
      <polygon points="24,14 36,34 12,34" fill="#ffffff"/>
    </svg>
  `),
}

// 域名别名映射（例如子域名和新主域名共用）
const DOMAIN_ALIASES: Record<string, string> = {
  'github.io': 'github.com',
  'google.com.hk': 'google.com',
  'google.cn': 'google.com',
  'b23.tv': 'bilibili.com',
  'chat.deepseek.com': 'deepseek.com',
  'zhuanlan.zhihu.com': 'zhihu.com',
  'weread.qq.com': 'weixin.qq.com',
  'mp.weixin.qq.com': 'weixin.qq.com',
  'youtu.be': 'youtube.com',
  'twitter.com': 'x.com',
  'registry.npmjs.org': 'npmjs.com',
  'cursor.sh': 'cursor.com',
  'kimi.ai': 'kimi.moonshot.cn',
  'cn.bing.com': 'bing.com',
  'vercel.app': 'vercel.com',
}

/**
 * 根据站点 URL 或标题解析官方内建的高清矢量 Logo。
 * 命中时返回即插即用的矢量 Data URI，完全避开外部网络与防盗链。
 */
export function getBuiltinBrandLogo(url?: string, title?: string): string | null {
  if (url) {
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`)
      let host = u.hostname.toLowerCase()
      if (host.startsWith('www.')) host = host.slice(4)

      // 1. 直接命中或别名命中
      const targetDomain = DOMAIN_ALIASES[host] || host
      if (BUILTIN_BRAND_LOGOS[targetDomain]) {
        return BUILTIN_BRAND_LOGOS[targetDomain]!
      }

      // 2. 别名后缀匹配（如 xxx.vercel.app -> vercel.app -> vercel.com，xxx.github.io -> github.io -> github.com）
      for (const [alias, canonical] of Object.entries(DOMAIN_ALIASES)) {
        if (host.endsWith(`.${alias}`)) {
          if (BUILTIN_BRAND_LOGOS[canonical]) {
            return BUILTIN_BRAND_LOGOS[canonical]!
          }
        }
      }

      // 3. 结尾匹配（如 raw.githubusercontent.com -> github.com）
      for (const [key, logo] of Object.entries(BUILTIN_BRAND_LOGOS)) {
        if (host === key || host.endsWith(`.${key}`)) {
          return logo
        }
      }
    } catch {
      // 容错降级
    }
  }

  // 3. 常见顶级品牌关键词模糊匹配
  if (title) {
    const t = title.toLowerCase()
    if (t.includes('github')) return BUILTIN_BRAND_LOGOS['github.com']!
    if (t.includes('google') || t.includes('谷歌')) return BUILTIN_BRAND_LOGOS['google.com']!
    if (t.includes('bilibili') || t.includes('b站') || t.includes('哔哩哔哩')) return BUILTIN_BRAND_LOGOS['bilibili.com']!
    if (t.includes('deepseek') || t.includes('深度求索')) return BUILTIN_BRAND_LOGOS['deepseek.com']!
    if (t.includes('知乎')) return BUILTIN_BRAND_LOGOS['zhihu.com']!
    if (t.includes('掘金')) return BUILTIN_BRAND_LOGOS['juejin.cn']!
    if (t.includes('微信') || t.includes('wechat')) return BUILTIN_BRAND_LOGOS['weixin.qq.com']!
    if (t.includes('youtube') || t.includes('油管')) return BUILTIN_BRAND_LOGOS['youtube.com']!
    if (t.includes('docker')) return BUILTIN_BRAND_LOGOS['docker.com']!
    if (t.includes('npm')) return BUILTIN_BRAND_LOGOS['npmjs.com']!
    if (t.includes('mdn') || t.includes('mozilla')) return BUILTIN_BRAND_LOGOS['developer.mozilla.org']!
    if (t.includes('stack overflow') || t.includes('stackoverflow')) return BUILTIN_BRAND_LOGOS['stackoverflow.com']!
    if (t.includes('cursor')) return BUILTIN_BRAND_LOGOS['cursor.com']!
    if (t.includes('hugging face') || t.includes('huggingface')) return BUILTIN_BRAND_LOGOS['huggingface.co']!
    if (t.includes('v2ex')) return BUILTIN_BRAND_LOGOS['v2ex.com']!
    if (t.includes('百度') || t.includes('baidu')) return BUILTIN_BRAND_LOGOS['baidu.com']!
    if (t.includes('kimi') || t.includes('月之暗面')) return BUILTIN_BRAND_LOGOS['kimi.moonshot.cn']!
    if (t.includes('bing') || t.includes('必应')) return BUILTIN_BRAND_LOGOS['bing.com']!
    if (t.includes('vercel')) return BUILTIN_BRAND_LOGOS['vercel.com']!
  }

  return null
}
