import type { MetadataRoute } from 'next'
import { readSiteSettings } from '@/lib/site-config-source'
import { BRAND_FALLBACK } from '@/lib/site-settings'

/**
 * PWA manifest。
 *
 * 名称/描述/品牌色跟随后台站点设置，图标与快捷方式保持静态：
 * 中枢不可达时 `getFileContent` 回退构建期基线、不抛错，所以这里拿到的永远是
 * 一份可用的值，不会出现「装不上 / 安装元信息为空」。基线品牌名是上游的
 * NavSphere，因此仍要过一遍品牌收敛，缺省回落内置默认。
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
