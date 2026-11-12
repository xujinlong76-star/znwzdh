import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { JsonLd } from '@/components/json-ld'
import { SiteFavicon } from '@/components/site-favicon'
import { SearchPaletteLazy as SearchPalette } from '@/components/search-palette-lazy'
import { CategorySiteFilterBar } from '@/components/category-site-filter-bar'
import { DramaCategoryBannerLazy } from '@/components/drama-category-banner-lazy'
import { WatchlistAddButtonLazy } from '@/components/watchlist-add-button-lazy'
import { ExternalLink, MonitorPlay, ArrowRight } from 'lucide-react'
import { isDramaCategoryRef } from '@/lib/drama-sites'
import { configuredSiteOrigin } from '@/lib/seo/origin'
import { readSiteSettings } from '@/lib/site-config-source'
import { externalLinkRelAttr } from '@/lib/site-settings'
import { categoryItemListLd, itemListLd } from '@/lib/seo/json-ld'
import { MIN_SITES_FOR_CATEGORY_INDEX } from '@/lib/seo/thresholds'
// 契约级补缺（主理人 2026-11-01 23:5x）：WIP 里用了 safeHref 未 import，导致 /category/[slug] 预渲染 ReferenceError；
// 仅补 import，不涉及业务逻辑，未随本会话提交，归并行会话持有。
import { safeHref } from '@/lib/safe-url'
import { descendantSiteCounts } from '@/lib/seo/category-totals'
import { maxReachableCategoryPage } from '@/lib/seo/category-pagination'
import { categoryHref, categoryUrlKey } from '@/lib/seo/category-url'
import { tagSlug } from '@/lib/seo/tag-slug'
import type { HubSite } from '@/lib/navhub-api'
import {
  categoryDisplayName,
  loadActiveCategoryCounts,
  loadCategories,
  loadCategorySites,
  type HubCategory,
} from '@/lib/server/categories'

/**
 * 分类 hub 的服务端取数与主体视图，由 `/category/{slug}`（第 1 页）与
 * `/category/{slug}/p/{n}`（第 2 页起）共用。
 *
 * 为什么分页不再是 `?page=N`（2026-10-22）：这条路由带 `revalidate` +
 * `generateStaticParams`，而签名里只要出现 `searchParams`，未预渲染的 slug
 * 走按需生成时就会抛 `DYNAMIC_SERVER_USAGE` —— 生产构建实测直接 500，
 * 不是「少一层缓存」而是页面没了。改成路径段后两条路由都只依赖 `params`。
 *
 * 同一个模板接两种页（新树：18 根 / 215 叶，站点只挂叶子）：
 * - **叶子页**：本站点列表 + 同父兄弟叶（`SIBLING_LINKS`）；
 * - **根页**：子树站点并集中间页 —— 中枢 search 已按 `categoryWithDescendants`
 *   展开，所以这里不用自己拼子类目；推荐位换成**自己的达标子叶**，
 *   结构化数据也改成列子分类（根页的身份是目录，把站点喂进 ItemList
 *   等于告诉爬虫这页是终点，215 个叶子页反而少一批入口）。
 * 两类页的「存活站点数」一律用 `descendantSiteCounts` 聚合后的值：原始计数按
 * 单个类目 GROUP BY，一级根在原始计数里恒为 0，不聚合就会把每个根判成薄分类。
 */

export const PAGE_SIZE = 60
const MAX_PAGE_LINKS = 5
/** 叶子页的「同 L1 兄弟叶」条数 */
const SIBLING_LINKS = 8
/**
 * 根页列出的子叶条数上限。
 * 不跟 SIBLING_LINKS 共用：兄弟位是「顺带推荐」，子叶是这一页存在的理由，
 * 截到 8 个就等于把 6 个达标子叶藏起来。权威树每根最多 14 叶
 * （packages/core/test/category-registry.test.ts 钉死），这个数就是它。
 */
const CHILD_LINKS = 14
const TAG_LINKS = 5

export type CategoryPageData = {
  categories: HubCategory[] | null
  category: HubCategory | null
  res: { hits: Array<{ site: HubSite | null }>; hasMore?: boolean; total?: number } | null
  sites: HubSite[]
  /**
   * 子树聚合后的存活站点数。**可为 null**：`loadActiveCategoryCounts` 在中枢
   * 不可用时返回 null，此时不能把「取不到」当成「0 个站点」——那会让页面
   * 按薄分类处理（404 / 不渲染分类入口），把一次上游抖动变成错误结论。
   */
  counts: Map<string, number> | null
  degraded: boolean
  qualifies: boolean
}

/** 权威树的展示序：根 sort 1–18、叶 sort 1–14。
 * 0 或缺失是存量脏行，视为「没排过序」沉到末尾，而不是抢到首位。 */
function categorySortRank(c: HubCategory): number {
  return c.sort && c.sort > 0 ? c.sort : Number.MAX_SAFE_INTEGER
}

/** ref 既可能是 slug，也可能是还没被 301 干净的 uuid（历史行甚至没有 slug） */
function resolveCategoryAliasRef(ref: string): string {
  return ref === 'duanju' ? 'short-drama' : ref
}

function matchCategory<T extends { id: string; slug?: string | null; enabled?: boolean }>(
  categories: T[] | null,
  ref: string,
): T | null {
  if (!categories) return null
  const resolved = resolveCategoryAliasRef(ref)
  return (
    categories.find((c) => (c.slug === ref || c.slug === resolved) && c.enabled !== false) ??
    categories.find((c) => (c.id === ref || c.id === resolved) && c.enabled !== false) ??
    null
  )
}

export async function loadCategoryPage(ref: string, page: number): Promise<CategoryPageData> {
  const resolvedRef = resolveCategoryAliasRef(ref)
  const [categories, res, rawCounts] = await Promise.all([
    loadCategories(300),
    loadCategorySites(resolvedRef, PAGE_SIZE, (page - 1) * PAGE_SIZE, 60),
    loadActiveCategoryCounts(60),
  ])
  // 门槛判定与展示计数都按子树聚合：原始计数按单个类目 GROUP BY，
  // 站点只挂叶子的新树里每个一级根都是 0。
  const counts = descendantSiteCounts(categories ?? [], rawCounts)
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
      ? sites.length >= MIN_SITES_FOR_CATEGORY_INDEX || Boolean(res?.hasMore)
      : sites.length > 0
  return { categories, category, res, sites, counts, degraded, qualifies }
}

export function categoryPageName(data: CategoryPageData): string {
  const { category, categories } = data
  return category && categories ? categoryDisplayName(category, categories) : '分类'
}

export function categoryPageUrlKey(data: CategoryPageData, safeRef: string): string {
  return data.category ? categoryUrlKey(data.category) : safeRef
}

/** 子树聚合后的存活站点数；取不到计数时退回本页实际列出的条数 */
export function categoryPageTotal(data: CategoryPageData): number {
  const { category, counts, sites } = data
  return (category && counts ? counts.get(category.id) : undefined) ?? sites.length
}

export async function CategoryBoard({
  requested,
  urlKey,
  name,
  data,
}: {
  requested: number
  urlKey: string
  name: string
  data: CategoryPageData
}) {
  const { categories, category, res, sites, counts, degraded } = data
  const indexable = requested === 1 && !degraded
  const origin = configuredSiteOrigin()
  // 外链权重策略与首页卡片同源（站点级设置，缺省 nofollow）；readSiteSettings 进程内缓存，不额外打中枢。
  const externalRel = externalLinkRelAttr((await readSiteSettings()).navigation.externalLinkRel)
  const isRootPage = Boolean(category && !category.parentId)
  // 父级按外键（`parent_id`，与 `anchor` 同一条信息）找，不按标题找：
  // 库里还有 4 组同名分类，按标题匹配会让「编程 · 语言」的面包屑挂到「自然语言」下。
  const parent =
    category?.parentId && categories ? (categories.find((c) => c.id === category.parentId) ?? null) : null

  // 层级推荐：根页链自己的达标子叶，叶子页链同父兄弟叶；
  // 两种都只链达标分类，避免把用户/爬虫送去 404。
  const related =
    categories && counts && category
      ? categories
          .filter(
            (c) =>
              c.enabled !== false &&
              (isRootPage ? c.parentId === category.id : c.id !== category.id && c.parentId === category.parentId) &&
              (counts.get(c.id) ?? 0) >= MIN_SITES_FOR_CATEGORY_INDEX,
          )
          .sort(
            (a, b) =>
              // 权威树 sort 优先（顺序不随数据漂移），其次站点数，最后标题兜底
              categorySortRank(a) - categorySortRank(b) ||
              (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) ||
              a.title.localeCompare(b.title, 'zh-CN'),
          )
          .slice(0, isRootPage ? CHILD_LINKS : SIBLING_LINKS)
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

  const isDramaZone = category
    ? isDramaCategoryRef(category.id) || isDramaCategoryRef(category.slug) || isDramaCategoryRef(category.title)
    : isDramaCategoryRef(urlKey)

  const pageSiteCountsByCategory = new Map<string, number>()
  for (const site of sites) {
    if (site.categoryId) {
      pageSiteCountsByCategory.set(site.categoryId, (pageSiteCountsByCategory.get(site.categoryId) ?? 0) + 1)
    }
  }
  const inPageSubcategories =
    isDramaZone && isRootPage && categories && category
      ? categories
          .filter((c) => c.enabled !== false && c.parentId === category.id && (pageSiteCountsByCategory.get(c.id) ?? 0) > 0)
          .sort((a, b) => categorySortRank(a) - categorySortRank(b))
          .map((c) => ({
            id: c.id,
            title: categoryDisplayName(c, categories),
            count: pageSiteCountsByCategory.get(c.id) ?? 0,
          }))
      : []

  const freeDramaCount =
    inPageSubcategories.find((c) => c.id === 'reg-short-drama-free' || c.title.includes('畅看'))?.count ??
    sites.filter((s) => s.tags?.includes('免费')).length
  const platformDramaCount =
    inPageSubcategories.find((c) => c.id === 'reg-short-drama-platform' || c.title.includes('平台'))?.count ??
    Math.max(0, sites.length - freeDramaCount)

  // 只显示「已翻过 + 当前页」的页码：总页数只能从 hasMore 推出来，
  // 向前渲染未来页码会把用户/爬虫送到尚未确认存在的第 N 页（404）。
  const from = Math.max(1, requested - MAX_PAGE_LINKS + 1)

  // 中枢 /api/search 的 offset 上限决定了「最深能翻到第几页」（PAGE_SIZE=60 时是 17 页）。
  // 再往后的页码在 `/category/{slug}/p/{n}` 里已被硬挡成 404，所以这里既不能把
  // 「下一页」链过去（等于造一个死链），也要如实告诉用户剩下的站点走哪条路。
  const deepestPage = maxReachableCategoryPage(PAGE_SIZE)
  const totalInCategory = categoryPageTotal(data)
  const hasSitesBeyondDeepestPage = totalInCategory > deepestPage * PAGE_SIZE

  return (
    <>
      <Container as="main" id="main-content">
        <div className="py-6 sm:py-10 max-w-5xl mx-auto space-y-6">
          <Breadcrumbs
            jsonLd={indexable}
            items={[
              { label: '首页', path: '/' },
              { label: '分类总览', path: '/category' },
              // 叶子页插入父级：面包屑就是权威树的 anchor 路径，
              // 同名分类（4 组）靠它才能各自只对应一条规范路径
              ...(parent
                ? [{ label: categoryDisplayName(parent, categories ?? []), path: categoryHref(parent) }]
                : []),
              { label: name, path: categoryHref(urlKey, requested) },
            ]}
          />

          <header className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              {name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {degraded
                ? '分类数据暂时不可用，已降级展示；请稍后刷新重试。'
                : category?.description ??
                  `本页列出「${name}」分类下的 ${sites.length} 个站点，可进入详情查看简介、标签与同类推荐。`}
            </p>
            {hasSitesBeyondDeepestPage && !degraded ? (
              // 不说这句，用户翻到最后一页会以为「这个分类就只有这些站点」，
              // 而实际上后面还有——只是翻页机制到不了。给一条能走通的路。
              <p className="text-xs text-amber-700 dark:text-amber-400">
                本分类共收录 {totalInCategory} 个站点，翻页最深只到第 {deepestPage} 页（约 {deepestPage * PAGE_SIZE} 个）。
                想看剩下的，可以用下面的搜索、{isRootPage ? '下面的子分类' : '同组的其他分类'}或
                <Link href="/tags" className="underline underline-offset-2 hover:no-underline">
                  按标签浏览
                </Link>
                。
              </p>
            ) : null}
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

          {/* 分类页此前没有任何搜索入口，却在「翻不到更后面」的提示里让用户
              「用页内搜索」——指着一个不存在的控件。这里挂全站搜索面板：
              分类翻页有深度上限，搜索是唯一能真正找到长尾站点的路径。 */}
          <SearchPalette placeholder="没找到想要的？搜索全部站点（中文 / 拼音 / 语义）" />

          {origin && indexable ? (
            // 根页的结构化数据列**子分类页**（它是目录，不是终点）；
            // 子叶全被门槛挡住时（存量站点直挂根的脏数据仍能让根达标）退回站点清单，
            // 免得整页只剩一个空 ItemList。
            isRootPage && related.length > 0 ? (
              <JsonLd
                data={categoryItemListLd(
                  origin,
                  related.map((c) => ({
                    slug: categoryUrlKey(c),
                    title: categoryDisplayName(c, categories ?? []),
                  })),
                  `${name}子分类`,
                )}
              />
            ) : (
              <JsonLd
                data={itemListLd(
                  origin,
                  sites.map((site) => ({ id: site.id, title: site.title })),
                  `${name}站点`,
                )}
              />
            )
          ) : null}

          {isDramaZone ? (
            <DramaCategoryBannerLazy
              totalSites={totalInCategory || sites.length}
              freeCount={freeDramaCount}
              platformCount={platformDramaCount}
            />
          ) : (
            /* 跨生态：精选技术视频推荐 */
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-primary/20 bg-primary/5 text-xs text-foreground">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                  <MonitorPlay className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <span className="font-semibold text-foreground block text-sm">想系统学习「{name}」？</span>
                  <span className="text-muted-foreground text-xs block truncate">
                    本站技术视频库收录 6,000+ 高质量课程与实战，直达相关教学资源
                  </span>
                </div>
              </div>
              <Link
                href={`/videos?q=${encodeURIComponent(name)}`}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors shrink-0 text-xs shadow-2xs"
              >
                <span>查看精选视频</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}

          {/* 根分类专属：子分类快捷直达轨 */}
          {isRootPage && related.length > 0 && (
            <div className="space-y-2 pt-1 pb-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">包含子分类目录 ({related.length})</span>
                <Link href="/category" className="text-xs text-primary hover:underline">查看全部分类</Link>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {related.map((sub) => (
                  <Link
                    key={sub.id}
                    href={categoryHref(sub)}
                    className="px-2.5 py-1 rounded-lg border border-border/70 bg-muted/30 text-xs text-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors flex items-center gap-1.5"
                  >
                    <span>{categoryDisplayName(sub, categories ?? [])}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      ({counts?.get(sub.id) ?? 0})
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* 分类内即时筛选 */}
          {sites.length > 0 && (
            <CategorySiteFilterBar
              totalCount={sites.length}
              categoryName={name}
              topTags={topTags}
              categorySlug={category ? categoryUrlKey(category) : null}
              totalAcrossPages={typeof res?.total === 'number' ? res.total : null}
              subcategories={inPageSubcategories}
              isDrama={isDramaZone}
            />
          )}

          <ul id="category-sites-list" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {sites.map((site) => (
              <li
                key={site.id}
                data-site-item=""
                data-category-id={site.categoryId ?? ''}
                data-title={site.title.toLowerCase()}
                data-desc={(site.description || '').toLowerCase()}
                data-url={(site.url || '').toLowerCase()}
                data-tags={(site.tags || []).join(' ').toLowerCase()}
              >
                <div className="group relative flex items-center justify-between gap-2 rounded-xl border border-border/70 p-2.5 hover:bg-muted/40 transition-colors">
                  <Link
                    href={`/site/${encodeURIComponent(site.id)}`}
                    className="flex items-center gap-3 min-w-0 flex-1 py-0.5"
                  >
                    <SiteFavicon
                      title={site.title}
                      url={site.url}
                      icon={site.iconKey ?? undefined}
                      className="w-6 h-6 rounded-md object-contain shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                          {site.title}
                        </span>
                        {isDramaZone && site.tags?.includes('免费') ? (
                          <span className="shrink-0 px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-medium">
                            免费看
                          </span>
                        ) : null}
                      </span>
                      {site.description ? (
                        <span className="block text-xs text-muted-foreground truncate">{site.description}</span>
                      ) : null}
                    </span>
                  </Link>
                  <div className="flex items-center gap-1 shrink-0">
                    {isDramaZone ? (
                      <WatchlistAddButtonLazy
                        platform={{
                          siteId: site.id,
                          title: site.title,
                          href: safeHref(site.url),
                          icon: site.iconKey ?? undefined,
                        }}
                        variant="light"
                      />
                    ) : null}
                    <a
                      href={safeHref(site.url)}
                      target="_blank"
                      rel={externalRel}
                      title={`新窗口直达 ${site.title} 官网`}
                      aria-label={`新窗口直达 ${site.title} 官网`}
                      className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-primary hover:bg-primary/10 transition-colors shrink-0 cursor-pointer"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
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
              {res?.hasMore && requested < deepestPage ? (
                <Link
                  href={categoryHref(urlKey, requested + 1)}
                  className="px-3 py-1.5 text-xs rounded-md border border-border/70 hover:bg-muted/50"
                >
                  下一页
                </Link>
              ) : null}
            </nav>
          ) : null}

          {related.length > 0 ? (
            <section className="pt-2 space-y-2">
              <h2 className="text-sm font-semibold text-foreground">
                {isRootPage ? '子分类' : '同类分类'}
              </h2>
              <div className="flex flex-wrap gap-2">
                {related.map((item) => (
                  <Link
                    key={item.id}
                    href={categoryHref(item)}
                    className="px-2.5 py-1 rounded-full border border-border/70 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
                  >
                    {categoryDisplayName(item, categories ?? [])}
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
