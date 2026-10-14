import type { MetadataRoute } from 'next'

/**
 * PWA manifest。
 *
 * 静态值（不走中枢配置）：manifest 被浏览器缓存且参与安装提示，
 * 动态化收益低、风险高（中枢不可用时安装元信息会丢）。
 * 站点名与 DEFAULT_SITE_CONFIG.basic.title 保持一致。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NavHub 导航',
    short_name: 'NavHub',
    description: 'AI 原生的网址导航 —— 支持中文语义检索、拼音与关键词混合召回',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#378ADD',
    lang: 'zh-CN',
    categories: ['navigation', 'productivity', 'utilities'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: '热度榜', url: '/hot' },
      { name: '标签云', url: '/tags' },
      { name: '我的收藏', url: '/favorites' },
    ],
  }
}
