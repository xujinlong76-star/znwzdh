import type { MetadataRoute } from 'next'
import { siteOrigin } from '@/lib/seo/origin'

/**
 * robots.txt：公开内容放行，后台 / API / 短链 / 工具页不抓。
 *
 * 分工原则（改这里前务必读）：
 * - **Disallow** 用于「爬虫根本不该来」的路径：`/admin`、`/api/`、`/s/` 短链、
 *   以及纯工具页。它们没有外链，直接不抓最省预算。
 * - **页面级 noindex** 用于「可能存在站外链接的私密页」（`/favorites`、
 *   `/preferences`、`/marketplace/mine` 等）：这些**刻意不 Disallow**，因为
 *   robots.txt 一旦禁抓，爬虫就永远读不到页面里的 noindex，已进索引的 URL 删不掉。
 *
 * 另外去掉了 Yandex 私有的 host 指令（原实现输出的是带协议的整段地址），
 * 它对 Google / Bing 无意义，还容易被误读成规范域名。
 */

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await siteOrigin()

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          // 只放「爬虫不该来」的路径：后台、接口、短链。
          // 其余私密页（收藏 / 偏好 / 发布管理 / 导入 / 工具页）全部走页面级
          // noindex 且**刻意不 Disallow** —— 它们有站内入口，禁抓会让爬虫
          // 读不到 noindex，已进索引的 URL 永远删不掉。
          '/admin',
          '/api/',
          '/s/',
        ],
      },
    ],
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  }
}
