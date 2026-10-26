import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { JsonLd } from '@/components/json-ld'
import { hubGetProbe } from '@/lib/server/hub'
import { safeDecodeParam } from '@/lib/server/route-params'
import { configuredSiteOrigin } from '@/lib/seo/origin'
import { itemListLd } from '@/lib/seo/json-ld'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { ogImageUrl } from '@/lib/seo/og-text'
import type { HubCollection, HubCollectionDetailSite } from '@/lib/navhub-api'
import CollectionDetailView from './collection-detail-view'

/**
 * 精选专题详情页（服务端取数 + 客户端岛）。
 *
 * 为什么服务端化：站点卡片的 `/site/{id}` 内链要进 SSR HTML，改版前整页
 * useEffect 取数，爬虫首轮只看到骨架屏。服务端探活顺带解决了 metadata 的
 * 归属：原先由 layout 代劳，现在 page 自己就能导出 generateMetadata。
 *
 * 真 404：`hubGetProbe` 把「API 确认不存在（404）」与「取数失败」分开——
 * 只有确认下架才 notFound()；中枢挂了用通用元数据降级，客户端岛负责提示
 * 与重试。用 hubGet 折叠两者会把一次抖动误伤成 404。
 *
 * revalidate=60：与中枢侧专题接口的 maxAge 对齐；专题页是爬虫面，
 * 缓存让重复抓取不再每次打穿 hub。
 */

export const revalidate = 60

/** 动态段要进入按需 ISR，必须存在 generateStaticParams；空数组 = 全部运行时生成 */
export async function generateStaticParams() {
  return []
}

type CollectionDetail = { collection: HubCollection; sites: HubCollectionDetailSite[] }

/** generateMetadata 与页面共用；同请求内 fetch memoization 去重 */
async function loadCollection(slug: string) {
  return hubGetProbe<CollectionDetail>('/api/collections/' + encodeURIComponent(slug), 60)
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug)
  if (!safeSlug) notFound()
  const probe = await loadCollection(safeSlug)
  // 404 判定放 metadata 管线：layout/page 渲染体里抛 notFound() 会被
  // error 边界捕获成客户端回退（实测 200 + NEXT_HTTP_ERROR_FALLBACK）
  if (probe.status === 'miss') notFound()
  const canonical = `/collections/${encodeURIComponent(safeSlug)}`
  if (probe.status === 'failed') {
    // 降级：不编造合集名，用通用标题（与改版前一致）
    return {
      title: '合集详情',
      description: '该合集收录的站点',
      alternates: { canonical },
      ...(await pageShareMetadata({
        url: canonical,
        title: '合集详情',
        description: '该合集收录的站点',
      })),
    }
  }
  const col = probe.data.collection
  const description =
    col.description ||
    `「${col.title}」合集收录的站点，按策划顺序排列，可进入详情查看简介、分类与标签。`
  return {
    title: col.title,
    description,
    alternates: { canonical },
    ...(await pageShareMetadata({
      url: canonical,
      title: col.title,
      description,
      imageUrl: ogImageUrl(canonical),
      imageAlt: `${col.title} · 山羊胡专题`,
    })),
  }
}

export default async function CollectionDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug)
  if (!safeSlug) notFound()
  const probe = await loadCollection(safeSlug)
  if (probe.status === 'miss') notFound()

  const ok = probe.status === 'ok'
  const collection = ok ? probe.data.collection : null
  const sites = ok ? (probe.data.sites ?? []) : []
  const origin = configuredSiteOrigin()
  const name = collection?.title ?? safeSlug

  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <Breadcrumbs
          jsonLd={ok}
          items={[
            { label: '首页', path: '/' },
            { label: '合集', path: '/collections' },
            { label: name, path: `/collections/${encodeURIComponent(safeSlug)}` },
          ]}
        />
        {origin && ok ? (
          <JsonLd
            data={itemListLd(
              origin,
              sites.map((site) => ({ id: site.id, title: site.title })),
              `「${name}」站点`,
            )}
          />
        ) : null}
        <CollectionDetailView slug={safeSlug} initialCollection={collection} initialSites={sites} />
      </div>
      <Footer />
    </Container>
  )
}
