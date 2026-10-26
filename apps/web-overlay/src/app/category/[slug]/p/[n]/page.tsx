import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { safeDecodeParam } from '@/lib/server/route-params'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { ogImageUrl } from '@/lib/seo/og-text'
import { categoryHref, isCategoryUuidRef, isHiddenCategory } from '@/lib/seo/category-url'
import { categoryPageHasSites, categoryPageOffsetIsReachable } from '@/lib/seo/category-pagination'
import {
  CategoryBoard,
  PAGE_SIZE,
  categoryPageName,
  categoryPageUrlKey,
  loadCategoryPage,
} from '../../category-board'

/**
 * 分类 hub 第 2 页起（`/category/{slug}/p/{n}`，服务端页面）。
 *
 * 从 `?page=N` 拆出来只有一个原因：这条路由带 `revalidate` +
 * `generateStaticParams`，签名里出现 `searchParams` 会让未预渲染的 slug 在按需
 * 生成时直接抛 `DYNAMIC_SERVER_USAGE`（生产构建实测 500）。取数与视图跟第 1 页
 * 共用 `../../category-board.tsx`，这里只负责页码的解析、归一与索引口径。
 *
 * 索引口径（方案 §3.1 / §4）：
 * - `n === 1` 永久回指 `/category/{slug}`，同一内容不留两个 URL；
 * - 页 ≥2 `noindex, follow` + canonical 自指（不回指第 1 页），
 *   否则第 2 页的站点永远不会被单独收录；
 * - 中枢失败（degraded）时保持可索引：不因一次抖动把整批分页降档。
 */

export const revalidate = 60

/** 动态段要进入按需 ISR，必须有 generateStaticParams；空数组 = 全部首次请求时生成 */
export async function generateStaticParams() {
  return []
}

type PageProps = {
  params: Promise<{ slug: string; n: string }>
}

/**
 * 页码只接受无符号、无前导零的正整数。
 * `/p/01`、`/p/0`、`/p/2%20` 这类形态一律 404：它们和 `/p/1` 是同一内容的
 * 拼写变体，接受就等于自己造重复页。
 */
function parsePageSegment(raw: string | undefined): number | null {
  const value = (raw ?? '').trim()
  if (!/^[1-9][0-9]*$/.test(value)) return null
  const n = Number.parseInt(value, 10)
  return Number.isSafeInteger(n) ? n : null
}

async function resolve(ref: string, n: number) {
  const safeRef = safeDecodeParam(ref)
  if (!safeRef) notFound()
  // 深页码先过「请求本身成不成立」这道闸：中枢 /api/search 的 offset 上限是 1000，
  // PAGE_SIZE=60 时第 18 页起一定被 zod 挡成 400，hubGet 再把 4xx 归为 null。
  // 这种页不是「上游抖动」，是根本不存在的页 —— 无论计数取不取得到都必须 404，
  // 否则 /p/18、/p/9999 会渲染成可被索引的 200 空页。
  if (!categoryPageOffsetIsReachable(n, PAGE_SIZE)) notFound()
  const data = await loadCategoryPage(safeRef, n)
  // 分类不存在 / 已停用 / 这一页没有站点：与第 1 页同一口径
  if (data.categories !== null && (!data.category || !data.qualifies)) notFound()
  // 隐藏类目（未分类）没有公开详情页，深分页同样 404
  if (data.category && isHiddenCategory(data.category)) notFound()
  // 中枢抖动时 qualifies 被放宽为 true（避免一次上游故障把整批分页打成 404），
  // 但任意大页码会撞上 /api/search 的 offset 上限（1000）被 zod 400，
  // hubGet 把 4xx 也归为 null，于是 /p/18、/p/9999 会渲染 200 空页且可被索引。
  // 计数可用时按「总页数 + 中枢 offset 上限」判界：超出范围的页码是真 404，不是降级。
  if (data.degraded && data.category && data.counts) {
    const total = data.counts.get(data.category.id) ?? 0
    if (!categoryPageHasSites(n, total, PAGE_SIZE)) notFound()
  }
  return { safeRef, data }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, n: rawN } = await params
  const n = parsePageSegment(rawN)
  if (n === null) notFound()
  const { safeRef, data } = await resolve(slug, n)

  const name = categoryPageName(data)
  const urlKey = categoryPageUrlKey(data, safeRef)
  // n === 1 由页面永久回指裸 URL，元信息不替它留一个可索引副本
  const canonical = categoryHref(urlKey, n)
  const title = `「${name}」工具与服务（第 ${n} 页）`
  const description = `「${name}」分类站点列表第 ${n} 页，可进入详情查看简介、标签与同类推荐。`

  return {
    title,
    description,
    alternates: { canonical },
    ...(await pageShareMetadata({
      url: canonical,
      title,
      description,
      // 卡片仍用第 1 页的动态 OG 图：这里没有 `p/{n}/opengraph-image`，
      // 指过去就是 404，而分页本身 noindex，不需要独立配图。
      ...(data.degraded
        ? {}
        : {
            imageUrl: ogImageUrl(categoryHref(urlKey, 1)),
            imageAlt: `「${name}」分类 · 山羊胡`,
          }),
    })),
    ...(!data.degraded ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function CategoryPageDetail({ params }: PageProps) {
  const { slug, n: rawN } = await params
  const n = parsePageSegment(rawN)
  if (n === null) notFound()
  const { safeRef, data } = await resolve(slug, n)

  const urlKey = categoryPageUrlKey(data, safeRef)
  // uuid 入参 / 第 1 页都归一到规范形态，顺带把权重交给第 1 页
  if (n === 1 || (isCategoryUuidRef(safeRef) && urlKey !== safeRef)) {
    permanentRedirect(categoryHref(urlKey, n))
  }

  return <CategoryBoard requested={n} urlKey={urlKey} name={categoryPageName(data)} data={data} />
}
