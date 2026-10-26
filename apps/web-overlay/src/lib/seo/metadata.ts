import { cache } from 'react'
import { getFileContent } from '@/lib/github'
import { readSiteSettings } from '@/lib/site-config-source'
import { configuredSiteOrigin } from '@/lib/seo/origin'

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
  alt: '山羊胡',
} as const

const SITE_PATH = 'src/navsphere/content/site.json'

/** 中枢/后台没配品牌名时用的口径统一值 */
export const FALLBACK_BRAND = '山羊胡'

/**
 * 品牌名收敛：上游基线数据里的 `NavSphere导航` 不接受。
 *
 * `src/navsphere/content/site.json` 是 vendor 脚本从上游 tarball 落下来的**兜底基线**
 * （`getFileContent` 在中枢不可达时读它），它的 `basic.title` 就是上游品牌。
 * 于是同一套 title 模板会随中枢可达性产出两个后缀——实测一轮全量审计里
 * 263 页「- NavHub 导航」与 288 页「- NavSphere导航」并存，`og:site_name` 一起漂。
 * 中枢真配了 NavSphere 时同理：品牌名是产品事实，不该由一次取数抖动决定。
 */
export function normalizeBrandName(value: string | null | undefined): string {
  const raw = value?.trim()
  if (!raw) return FALLBACK_BRAND
  if (/navsphere/i.test(raw)) return FALLBACK_BRAND
  return raw
}

export const loadBrandName = cache(async (): Promise<string> => {
  try {
    const site = await getFileContent<{ basic?: { title?: string } }>(SITE_PATH)
    return normalizeBrandName(site?.basic?.title)
  } catch {
    return FALLBACK_BRAND
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
    images?: Array<{ url: string; alt: string; width?: number; height?: number }>
  }
  twitter: {
    card: 'summary_large_image'
    title?: string
    description?: string
    images?: Array<{ url: string; alt: string }>
  }
}

/**
 * `imageUrl` 是逐页动态分享图（同路由的 `opengraph-image.tsx`）的 URL。
 *
 * 为什么必须显式传：Next 的优先级是 **Metadata API 覆盖文件约定**（2026-10-22
 * 生产实测：`/marketplace/{slug}` 同时有 `opengraph-image.tsx` 与工厂给出的
 * `images:[/og-default.png]`，页面 `og:image` 出的是后者，动态图根本没进分享）。
 * 所以「加了图就生效」是错的，图片 URL 要由本工厂写进 og/twitter 两处。
 */
export async function pageShareMetadata(input: {
  url: string
  title?: string
  description?: string
  imageUrl?: string | null
  imageAlt?: string | null
}): Promise<PageShareMetadata> {
  const siteName = await loadBrandName()
  // 品牌名本身可能已含「导航」，再拼后缀会得到「NavHub 导航 导航」
  const alt = input.imageAlt?.trim() || siteName
  // 优先级：逐页动态图 > 后台「默认分享大图」> 构建期内置图。
  // 后台自定义图的真实尺寸服务端不知道，所以只带 URL，不谎报 1200×630。
  const configuredImage = (await readSiteSettings()).basic.ogImage
  const image = input.imageUrl
    ? {
        url: input.imageUrl,
        width: DEFAULT_OG_IMAGE.width,
        height: DEFAULT_OG_IMAGE.height,
        alt,
      }
    : configuredImage
      ? { url: configuredImage, alt }
      : {
          url: DEFAULT_OG_IMAGE.url,
          width: DEFAULT_OG_IMAGE.width,
          height: DEFAULT_OG_IMAGE.height,
          alt,
        }
  // 缺 NAVHUB_SITE_URL 时**不输出 og:image**，而不是输出相对地址。
  // Next 会用 metadataBase 把 og:image 绝对化，metadataBase 缺席时它的兜底值是
  // `http://localhost:3000` —— 于是分享图被烤成别人机器上的地址。
  // 对 `revalidate` 的路由这只是一个周期内的降级，对 `revalidate=false` 的静态路由
  // 是永久快照（实测 /algorithms 三连 HIT，地址纹丝不动），所以这里宁可不给图。
  const shareImage = configuredSiteOrigin() ? image : null
  return {
    openGraph: {
      type: 'website',
      siteName,
      locale: 'zh_CN',
      url: input.url,
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(shareImage ? { images: [shareImage] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(shareImage ? { images: [{ url: shareImage.url, alt: shareImage.alt }] } : {}),
    },
  }
}
