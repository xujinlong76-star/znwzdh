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
 *
 * AI 爬虫分级（2026-11-23 战略研究周一轮，W2 核实）：
 * - 搜索回答类（OAI-SearchBot / Claude-SearchBot / PerplexityBot）显式放行：
 *   它们把页面带进 ChatGPT / Claude / Perplexity 的搜索回答；拦它们等于把
 *   本站逐出 AI 搜索答案。放行范围与 `*` 组一致（后台 / API / 短链仍禁抓），
 *   因为 RFC 9309 下爬虫只读命中自己的分组，不会回落到 `*` 组。
 * - 训练类（GPTBot / ClaudeBot / Google-Extended / CCBot / Bytespider）显式
 *   禁抓整站：本站内容不作训练语料。拦 GPTBot 不影响 ChatGPT 搜索（那是
 *   OAI-SearchBot 的事），两者是不同 token，不要混为一谈。
 * - 不用 `User-agent: *` 一刀切：`*` 组一旦 Disallow 全站，会误伤所有无专属
 *   分组的 AI 爬虫；反之 `*` 组 Allow 全站也不会放行已被专属分组禁抓的训练爬虫。
 * - llms.txt 是目录不是门禁：它不授权也不拦截任何爬虫，本文件不声明它。
 * - robots.txt 拦不住不遵守的爬虫；硬拦需防火墙 / CDN 层，本文件只做声明。
 */

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await siteOrigin()

  return {
    rules: [
      {
        // 搜索回答类 AI 爬虫：显式放行，放行范围与 `*` 组一致。
        userAgent: ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot'],
        allow: '/',
        disallow: ['/admin', '/api/', '/s/'],
      },
      {
        // 训练类 AI 爬虫：显式禁抓整站，本站内容不作训练语料。
        userAgent: ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Bytespider'],
        disallow: ['/'],
      },
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
    ...(origin
      ? {
          sitemap: [
            `${origin}/sitemap.xml`,
            `${origin}/videos/sitemap.xml`,
          ],
        }
      : {}),
  }
}
