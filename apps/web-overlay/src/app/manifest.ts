import type { MetadataRoute } from 'next'
import { readSiteSettings } from '@/lib/site-config-source'
import { BRAND_FALLBACK } from '@/lib/site-settings'

/**
 * PWA manifest。
 *
 * 名称/描述/品牌色/图标跟随后台站点设置，图标未配置时使用内置默认。
 * `readSiteSettings` 读取最新配置，中枢不可达时返回归一化默认值。
 * 历史品牌名可能仍是上游 NavSphere，因此仍要过一遍品牌收敛。
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await readSiteSettings()
  const title = settings.basic.title.trim()
  const brand = !title || /navsphere/i.test(title) ? BRAND_FALLBACK : title
  return {
    name: brand,
    short_name: brand.length > 12 ? brand.slice(0, 12) : brand,
    description:
      settings.basic.description || 'AI 原生的网址导航 —— 支持中文语义检索、拼音与关键词混合召回',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: settings.appearance.themeColor ?? '#378ADD',
    lang: 'zh-CN',
    categories: ['navigation', 'productivity', 'utilities'],
    icons: [
      { src: settings.appearance.pwaIcon192 || '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: settings.appearance.pwaIcon512 || '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: settings.appearance.pwaMaskable512 || '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: '热度榜', url: '/hot' },
      { name: '标签云', url: '/tags' },
      { name: '我的收藏', url: '/favorites' },
    ],
  }
}
