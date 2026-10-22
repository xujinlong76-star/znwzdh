import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, permanentRedirect } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { JsonLd } from '@/components/json-ld'
import { SiteFavicon } from '@/components/site-favicon'
import { safeDecodeParam } from '@/lib/server/route-params'
import { siteOrigin } from '@/lib/seo/origin'
import { itemListLd } from '@/lib/seo/json-ld'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { MIN_SITES_FOR_INDEX } from '@/lib/seo/thresholds'
import { categoryHref, categoryUrlKey, isCategoryUuidRef, isHiddenCategory } from '@/lib/seo/category-url'
import { tagSlug } from '@/lib/seo/tag-slug'
import type { HubSite } from '@/lib/navhub-api'
import {
  categoryDisplayName,
  loadActiveCategoryCounts,
  loadCategories,
  loadCategorySites,
} from '@/lib/server/categories'

/**
 * 分类 hub（服务端页面）。
 *
 * 目标：达标分类各自接住一批 `/site/{id}` 内链，把首页 → 分类 → 站点
 * 的点击深度压到 3 层内；列表标题必须是 SSR HTML（不是客户端 useEffect）。
 *
 * URL 标识是 `categories.slug`（全局唯一，人类可读）：`/category/{slug}`。
 * 旧形态 `/category/{uuid}` 是已发出的外链与已收录 URL，因此**不返回 404**，
 * 而是 301 到 slug 形态，把权重一次性交出去。
 *
 * 索引口径（方案 §3.1 / §4）：
 * - 存活站点 < MIN_SITES_FOR_INDEX 的分类直接 404，不生成 noindex 空页；
 * - 页 ≥2 保留、`index:false, follow:true`，canonical 自指（不回第 1 页），
 *   否则第 2 页的站点永远不会被单独收录；
 * - 中枢失败时不 404、不 noindex：降级渲染，等上游恢复。
 */

export const revalidate = 60

const PAGE_SIZE = 60
const MAX_PAGE_LINKS = 5
const SIBLING_LINKS = 8
const TAG_LINKS = 5

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** ref 既可能是 slug，也可能是还没被 301 干净的 uuid（历史行甚至没有 slug） */
function matchCategory<T extends { id: string; slug?: string | null; enabled?: boolean }>(
  categories: T[] | null,
  ref: string,
): T | null {
  if (!categories) return null
  return (
    categories.find((c) => c.slug === ref && c.enabled !== false) ??
    categories.find((c) => c.id === ref && c.enabled !== false) ??
    null
  )
}

async function loadCategoryPage(ref: string, page: number) {
  const [categories, res, counts] = await Promise.all([
    loadCategories(300),
    loadCategorySites(ref, PAGE_SIZE, (page - 1) * PAGE_SIZE, 60),
    loadActiveCategoryCounts(3600),
  ])
  const category = matchCategory(categories, ref)
  const sites = (res?.hits ?? [])
    .map((h) => h.site)
    .filter((s): s is HubSite => Boolean(s))
    .filter((s) => s.status === 'active')
  const degraded = res === null
  // 首页看真实数量；第 2 页起只要能取到站点就说明达标（首页 ≥PAGE_SIZE+1 站）
  const qualifies = degraded
    ? true
    : page === 1
      ? sites.length >= MIN_SITES_FOR_INDEX || Boolean(res?.hasMore)
      : sites.length > 0
  return { categories, category, res, sites, counts, degraded, qualifies }
}

/**
 * 构建期预渲染**达标**分类（slug 形态）。
 *
 * 只预渲染站点数达标的类目：薄类目页会 notFound()，预渲染它等于把一份
 * 静态 404 缓存 60 秒以上，白给爬虫一次死链。
 * 取数失败返回空数组：`dynamicParams` 默认 true，未预渲染的 slug 仍会按需
 * 渲染并缓存，所以构建时中枢没起来只是少了预渲染，不是丢页面。
 */
export async function generateStaticParams() {
  const [categories, counts] = await Promise.all([loadCategories(3600), loadActiveCategoryCounts(3600)])
  if (!categories || !counts) return []
  return categories
    .filter(
      (c) =>
        c.enabled !== false &&
        Boolean(c.slug) &&
        !isHiddenCategory(c) &&
        (counts.get(c.id) ?? 0) >= MIN_SITES_FOR_INDEX,
    )
    .map((c) => ({ slug: categoryUrlKey(c) }))
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const safeRef = safeDecodeParam(slug)
  if (!safeRef) notFound()

  const { page } = await searchParams
  const n = parsePage(page)
  const { categories, category, sites, counts, degraded, qualifies } = await loadCategoryPage(safeRef, n)

  // 分类不存在 / 已停用 / 站点数不达标：与页面的 404 口径一致
  if (categories !== null && (!category || !qualifies)) notFound()

  const name = category && categories ? categoryDisplayName(category, categories) : '分类'
  const total = (category ? counts?.get(category.id) : undefined) ?? sites.length
  // canonical 永远写解析后的形态：uuid 入参会被页面 301，元信息不能跟着留旧 URL
  const canonical = categoryHref(category ?? safeRef, n)
  const title = n <= 1 ? `「${name}」工具与服务` : `「${name}」工具与服务（第 ${n} 页）`
  const description =
    n <= 1
      ? category?.description ??
        `「${name}」分类下收录了 ${total} 个站点，可进入详情查看简介、标签与同类推荐。`
      : `「${name}」分类站点列表第 ${n} 页，可进入详情查看简介、标签与同类推荐。`

  return {
    title: title,
    description: description,
    alternates: { canonical },
    ...(await pageShareMetadata({ url: canonical, title, description })),
    // 页 ≥2 noindex；中枢失败时保持可索引（不因一次抖动把整批分类页降档）
    ...(n > 1 && !degraded ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function CategoryDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const safeRef = safeDecodeParam(slug)
  if (!safeRef) notFound()

  const { page } = await searchParams
  const requested = parsePage(page)
  const { categories, category, res, sites, counts, degraded, qualifies } = await loadCategoryPage(
    safeRef,
    requested,
  )
  if (categories !== null && (!category || !qualifies)) notFound()

  const urlKey = category ? categoryUrlKey(category) : safeRef
  const legacyUuid = isCategoryUuidRef(safeRef) && urlKey !== safeRef
  // 两种归一：`?page=1` 与裸 URL 是同一页；`/category/{uuid}` 永久跳到 slug 形态
  if (legacyUuid || (requested === 1 && page)) permanentRedirect(categoryHref(urlKey, requested))

  const name = category && categories ? categoryDisplayName(category, categories) : '分类'
  const indexable = requested === 1 && !degraded
  const origin = await siteOrigin()

  // 兄弟分类：只链达标分类，避免把用户/爬虫送去 404
  const siblings =
    categories && counts && category
      ? categories
          .filter(
            (c) =>
              c.id !== category.id &&
              c.enabled !== false &&
              c.parentId === category.parentId &&
              (counts.get(c.id) ?? 0) >= MIN_SITES_FOR_INDEX,
          )
          .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
          .slice(0, SIBLING_LINKS)
      : []

  // 高频标签：只取本页站点里出现过的标签，链接到已有标签页
  const tagCounts = new Map<string, number>()
  for (const site of sites) {
    for (const tag of site.tags ?? []) {
      const tagName = tag.trim()
      if (tagName) tagCounts.set(tagName, (tagCounts.get(tagName) ?? 0) + 1)
    }
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, TAG_LINKS)

  // 只显示「已翻过 + 当前页」的页码：总页数只能从 hasMore 推出来，
  // 向前渲染未来页码会把用户/爬虫送到尚未确认存在的第 N 页（404）。
  const from = Math.max(1, requested - MAX_PAGE_LINKS + 1)

  return (
    <>
      <Container as="main" id="main-content">
        <div className="py-6 sm:py-10 max-w-5xl mx-auto space-y-6">
          <Breadcrumbs
            jsonLd={indexable}
            items={[
              { label: '首页', path: '/' },
              { label: '分类总览', path: '/category' },
              { label: name, path: categoryHref(urlKey, requested) },
            ]}
          />

          <header className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              {name}工具
            </h1>
            <p className="text-sm text-muted-foreground">
              {degraded
                ? '分类数据暂时不可用，已降级展示；请稍后刷新重试。'
                : category?.description ??
                  `本页列出「${name}」分类下的 ${sites.length} 个站点，可进入详情查看简介、标签与同类推荐。`}
            </p>
            <nav aria-label="站内目录" className="flex flex-wrap items-center gap-3 text-xs pt-1">
              <Link href="/category" className="text-primary hover:underline">
                全部分类
              </Link>
              <span className="text-border" aria-hidden>
                ·
              </span>
              <Link href="/sites" className="text-primary hover:underline">
                全部站点目录
              </Link>
              <span className="text-border" aria-hidden>
                ·
              </span>
              <Link href="/tags" className="text-primary hover:underline">
                按标签浏览
              </Link>
            </nav>
          </header>

          {origin && indexable ? (
            <JsonLd
              data={itemListLd(
                origin,
                sites.map((site) => ({ id: site.id, title: site.title })),
                `${name}站点`,
              )}
            />
          ) : null}

          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {sites.map((site) => (
              <li key={site.id}>
                <Link
                  href={`/site/${encodeURIComponent(site.id)}`}
                  className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5 hover:bg-muted/50 transition-colors"
                >
                  <SiteFavicon
                    title={site.title}
                    url={site.url}
                    icon={site.iconKey ?? undefined}
                    className="w-6 h-6 rounded-md object-contain shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground truncate">{site.title}</span>
                    {site.description ? (
                      <span className="block text-xs text-muted-foreground truncate">{site.description}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">本页暂无可展示的站点。</p>
          ) : null}

          {(requested > 1 || res?.hasMore) ? (
            <nav aria-label="分类分页" className="flex flex-wrap items-center gap-2 pt-2">
              {requested > 1 ? (
                <Link
                  href={categoryHref(urlKey, requested - 1)}
                  className="px-3 py-1.5 text-xs rounded-md border border-border/70 hover:bg-muted/50"
                >
                  上一页
                </Link>
              ) : null}
              {Array.from({ length: requested - from + 1 }, (_, i) => from + i).map((n) => (
                <Link
                  key={n}
                  href={categoryHref(urlKey, n)}
                  aria-current={n === requested ? 'page' : undefined}
                  className={
                    n === requested
                      ? 'px-3 py-1.5 text-xs rounded-md border border-primary bg-primary/10 text-primary font-semibold'
                      : 'px-3 py-1.5 text-xs rounded-md border border-border/70 hover:bg-muted/50'
                  }
                >
                  {n}
                </Link>
              ))}
              {res?.hasMore ? (
                <Link
                  href={categoryHref(urlKey, requested + 1)}
                  className="px-3 py-1.5 text-xs rounded-md border border-border/70 hover:bg-muted/50"
                >
                  下一页
                </Link>
              ) : null}
            </nav>
          ) : null}

          {siblings.length > 0 ? (
            <section className="pt-2 space-y-2">
              <h2 className="text-sm font-semibold text-foreground">同类分类</h2>
              <div className="flex flex-wrap gap-2">
                {siblings.map((sibling) => (
                  <Link
                    key={sibling.id}
                    href={categoryHref(sibling)}
                    className="px-2.5 py-1 rounded-full border border-border/70 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                  >
                    {categoryDisplayName(sibling, categories ?? [])}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {topTags.length > 0 ? (
            <section className="pt-2 space-y-2">
              <h2 className="text-sm font-semibold text-foreground">相关标签</h2>
              <div className="flex flex-wrap gap-2">
                {topTags.map(([tag, count]) => (
                  <Link
                    key={tag}
                    href={`/tags/${encodeURIComponent(tagSlug(tag))}`}
                    className="px-2.5 py-1 rounded-full border border-border/70 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                  >
                    #{tag} <span className="font-mono">{count}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </Container>
      <Footer />
    </>
  )
}
