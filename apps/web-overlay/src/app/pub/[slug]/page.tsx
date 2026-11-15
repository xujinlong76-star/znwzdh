import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ExternalLink, Link2, RefreshCw } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { JsonLd } from '@/components/json-ld'
import { SiteFavicon } from '@/components/site-favicon'
import { EmptyState } from '@/components/ui/empty-state'
import { hubGetProbe } from '@/lib/server/hub'
import { safeDecodeParam } from '@/lib/server/route-params'
import { configuredSiteOrigin } from '@/lib/seo/origin'
import { itemListLd } from '@/lib/seo/json-ld'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { ogImageUrl } from '@/lib/seo/og-text'
import { safeHref } from '@/lib/safe-url'
import type { PublicPageDetail } from '@/lib/public-pages'
import PublicPageCopyLink from './public-page-copy-link'

/**
 * 公开导航页（/pub/{slug}，服务端渲染 + 按需 ISR，Batch 3 第 6 项）。
 *
 * 一句话痛点：用户把一套导航整理好了，想发给别人直接打开一个不用登录的
 * 只读导航页；/pack 只是发一次的快照（hash、无 SEO、不能下线），合集与场景
 * 又都是站方精选、用户发不进去。
 *
 * 内容是 live 引用：发布时只存「哪个收藏文件夹」，读时按 owner + folder 现算
 * 收藏——发布后收藏增删自动跟随，页上明说「内容随发布者收藏更新」。
 * 只展示仍存在且 active 的站（broken/停用/已删不进公开页，与合集详情同口径）；
 * 公开读绝不返回 owner 身份；收藏备注（note）是私人内容，绝不返回、绝不渲染。
 *
 * 404 纪律与合集/场景页一致：只有中枢明确回 404（不存在或已下线）才
 * notFound()；中枢不可达是降级渲染（通用元数据 + 说明壳），不把抖动误伤成 404。
 * revalidate=60 与中枢公开页接口的 maxAge 对齐。
 *
 * 没有 loading.tsx：与合集详情同一条软 404 回归锁——骨架屏边界会先流式刷
 * 200，generateMetadata 里的 notFound() 就改不了状态码（见
 * test/route-state-coverage.test.ts 里 pub/[slug] 的豁免理由）。
 */

export const revalidate = 60

/** 动态段要进入按需 ISR，必须存在 generateStaticParams；空数组 = 全部运行时生成 */
export async function generateStaticParams() {
  return []
}

function pubCanonical(slug: string): string {
  return `/pub/${encodeURIComponent(slug)}`
}

async function loadPublicPage(slug: string) {
  return hubGetProbe<PublicPageDetail>('/api/public-pages/' + encodeURIComponent(slug), 60)
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug)
  if (!safeSlug) notFound()
  const probe = await loadPublicPage(safeSlug)
  // 404 判定放 metadata 管线：layout/page 渲染体里抛 notFound() 会被
  // error 边界捕获成客户端回退（实测 200 + NEXT_HTTP_ERROR_FALLBACK）
  if (probe.status === 'miss') notFound()
  const canonical = pubCanonical(safeSlug)
  if (probe.status === 'failed') {
    // 降级：不编造标题与条数，用通用标题（与合集详情页一致）
    return {
      title: '公开导航页',
      description: '别人分享的导航页：不用登录就能看的只读站点清单。',
      alternates: { canonical },
      ...(await pageShareMetadata({
        url: canonical,
        title: '公开导航页',
        description: '别人分享的导航页：不用登录就能看的只读站点清单。',
      })),
    }
  }
  const page = probe.data.page
  const count = probe.data.items.length
  const description =
    page.description || `「${page.title}」收录了 ${count} 个站点，不用登录就能看，按发布者整理顺序排列。`
  return {
    title: page.title,
    description,
    alternates: { canonical },
    ...(await pageShareMetadata({
      url: canonical,
      title: page.title,
      description,
      imageUrl: ogImageUrl(canonical),
      imageAlt: `${page.title} · 公开导航页`,
    })),
  }
}

export default async function PublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const safeSlug = safeDecodeParam(slug)
  if (!safeSlug) notFound()
  const probe = await loadPublicPage(safeSlug)
  if (probe.status === 'miss') notFound()

  const ok = probe.status === 'ok'
  const page = ok ? probe.data.page : null
  const items = ok ? probe.data.items : []
  const origin = configuredSiteOrigin()
  const name = page?.title ?? '公开导航页'
  const canonical = pubCanonical(safeSlug)

  return (
    <Container as="main" id="main-content">
      <div className="py-4 sm:py-8 space-y-5 sm:space-y-6">
        <Breadcrumbs
          jsonLd={ok}
          items={[
            { label: '首页', path: '/' },
            { label: '公开导航页', path: canonical },
            { label: name, path: canonical },
          ]}
        />
        {origin && ok ? (
          <JsonLd
            data={itemListLd(
              origin,
              items.map((item) => ({ id: item.siteId, title: item.title })),
              `「${name}」站点`,
            )}
          />
        ) : null}
        {!ok ? (
          <EmptyState
            icon={RefreshCw}
            title="公开页暂时打不开"
            description="中枢暂时不可达，页面内容没能加载出来。请稍后刷新重试——这不是该公开页被下线了。"
          />
        ) : (
          <>
            <header className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h1 className="text-2xl font-bold">{page?.title}</h1>
                  {page?.description ? <p className="text-muted-foreground">{page.description}</p> : null}
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <RefreshCw className="size-3.5" aria-hidden />
                    公开的只读导航页 · 共 {items.length} 个站点 · 内容随发布者收藏更新
                  </p>
                </div>
                <PublicPageCopyLink slug={safeSlug} />
              </div>
            </header>
            {items.length === 0 ? (
              <EmptyState
                icon={Link2}
                title="这里暂时没有可看的站点"
                description="发布者收藏夹里的站点都已失效或被移出，等发布者更新收藏后再来看看。"
              />
            ) : (
              <ul className="space-y-2">
                {items.map((item) => {
                  const href = safeHref(item.url)
                  return (
                    <li key={item.siteId} className="rounded-lg border bg-card">
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex min-h-11 items-center gap-3 px-3 py-2.5"
                      >
                        <SiteFavicon url={item.url} title={item.title} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 font-medium">
                            <span className="truncate">{item.title}</span>
                            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          </span>
                          {item.description ? (
                            <span className="block truncate text-sm text-muted-foreground">{item.description}</span>
                          ) : null}
                        </span>
                        <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </a>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
      <Footer />
    </Container>
  )
}
