import { cache } from 'react'
import { getFileContent } from '@/lib/github'

/**
 * 页面级分享元信息的唯一工厂。
 *
 * Next 对 `openGraph` / `twitter` 是**整体替换**而非深合并：页面只要写
 * `openGraph: { url }`，根布局的 type/siteName/locale/images 全部消失。
 * 2026-10-21 实测 9 个主要模板只剩 og:title/description/url，0 个 og:image。
 * 从本文件产出即可保证四个根字段永远在。
 *
 * 品牌名与根布局同源（site.json 的 basic.title）；根布局每次渲染都会读
 * 同一份配置，contentCache 会命中，不会多打一次中枢。
 */

export const DEFAULT_OG_IMAGE = {
  url: '/og-default.png',
  width: 1200,
  height: 630,
  alt: 'NavHub 导航',
} as const

const SITE_PATH = 'src/navsphere/content/site.json'

export const loadBrandName = cache(async (): Promise<string> => {
  try {
    const site = await getFileContent<{ basic?: { title?: string } }>(SITE_PATH)
    return site?.basic?.title?.trim() || 'NavHub'
  } catch {
    return 'NavHub'
  }
})

export interface PageShareMetadata {
  openGraph: {
    type: 'website'
    siteName: string
    locale: string
    url: string
    title?: string
    description?: string
    images: Array<{ url: string; width: number; height: number; alt: string }>
  }
  twitter: {
    card: 'summary_large_image'
    title?: string
    description?: string
    images: Array<{ url: string; alt: string }>
  }
}

export async function pageShareMetadata(input: {
  url: string
  title?: string
  description?: string
}): Promise<PageShareMetadata> {
  const siteName = await loadBrandName()
  // 品牌名本身可能已含「导航」，再拼后缀会得到「NavHub 导航 导航」
  const alt = siteName
  return {
    openGraph: {
      type: 'website',
      siteName,
      locale: 'zh_CN',
      url: input.url,
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      images: [
        {
          url: DEFAULT_OG_IMAGE.url,
          width: DEFAULT_OG_IMAGE.width,
          height: DEFAULT_OG_IMAGE.height,
          alt,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      images: [{ url: DEFAULT_OG_IMAGE.url, alt }],
    },
  }
}
