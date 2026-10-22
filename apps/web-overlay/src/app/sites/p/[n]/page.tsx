import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { pageShareMetadata } from '@/lib/seo/metadata'
import {
  SitesDirectory,
  loadSitesPage,
  sitesNormalizedPage,
  sitesPageDescription,
  sitesPageHref,
  sitesPageTitle,
} from '../sites-directory'

/**
 * 站点目录第 2 页起（`/sites/p/{n}`）。
 *
 * 形态与约束同 `/category/{slug}/p/{n}`：这条路由带 `revalidate`，签名里一旦出现
 * `searchParams`，按需生成阶段就会抛 `DYNAMIC_SERVER_USAGE`（生产构建实测 500），
 * 所以分页只能走路径段；旧形态 `?page=N`（N≥2）由 `next.config.js` 308 到这里。
 *
 * 索引口径：页 ≥2 一律 `noindex, follow`（`follow` 不能关，否则 `/site/{id}`
 * 详情页的权重传递断在这），canonical 自指当前页（回指第 1 页会让 2..N 页
 * 整批被判重复内容丢弃）。
 */

export const revalidate = 60

/** 动态段要进入按需 ISR，必须有 generateStaticParams；空数组 = 全部首次请求时生成 */
export async function generateStaticParams() {
  return []
}

type PageProps = {
  params: Promise<{ n: string }>
}

function parsePageSegment(raw: string | undefined): number | null {
  const value = (raw ?? '').trim()
  if (!/^[1-9][0-9]*$/.test(value)) return null
  const n = Number.parseInt(value, 10)
  return Number.isSafeInteger(n) ? n : null
}

async function resolve(rawN: string | undefined) {
  const n = parsePageSegment(rawN)
  if (n === null) notFound()
  const data = await loadSitesPage()
  return { n, data }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { n } = await params
  const { data } = await resolve(n)
  const page = Math.min(data.totalPages, Math.max(2, parsePageSegment(n) ?? 2))
  const canonical = sitesPageHref(page)
  const title = sitesPageTitle(page)
  const description = sitesPageDescription(page)

  return {
    title: title,
    description: description,
    alternates: { canonical },
    ...(await pageShareMetadata({ url: canonical, title, description })),
    robots: { index: false, follow: true },
  }
}

export default async function SitesDirectoryPagePage({ params }: PageProps) {
  const { n } = await params
  const { n: requested, data } = await resolve(n)

  // 第 1 页只有一个 URL：`/sites/p/1` 与 `/sites` 并存会分散权重
  if (requested === 1) permanentRedirect(sitesPageHref(1))
  // 超出末页不留 200：否则会生成一批不存在的分页 URL（软 404）
  if (requested > data.totalPages) permanentRedirect(sitesPageHref(data.totalPages))

  return <SitesDirectory requested={requested} data={data} />
}
