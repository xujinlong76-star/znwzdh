import Link from 'next/link'
import { hubGet } from '@/lib/server/hub'
import { siteOrigin } from '@/lib/seo/origin'
import { itemListLd } from '@/lib/seo/json-ld'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { JsonLd } from '@/components/json-ld'
import type { HubSite } from '@/lib/navhub-api'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { SiteFavicon } from '@/components/site-favicon'
import { Globe } from 'lucide-react'

/**
 * 全站站点目录（`/sites`）的服务端取数与主体视图，由第 1 页与 `/sites/p/{n}` 共用。
 *
 * 为什么分页不再是 `?page=N`（2026-10-22，与分类页同一约束）：`/sites` 现在带
 * `revalidate` 进 ISR，而页面签名一旦读 `searchParams`，未预渲染的组合在按需生成时
 * 会抛 `DYNAMIC_SERVER_USAGE`（分类页第 2 页在生产构建里实测 500）。旧形态
 * `?page=N`（N≥2）由 `next.config.js` 的 `redirects()` 308 到新路径。
 *
 * 索引口径不变（别改错）：
 * - 页 1 可索引 + 自指 canonical；
 * - 页 ≥2 `{index:false, follow:true}` + 自指 canonical（回指页 1 会让 2..N 页被判
 *   重复丢弃；`follow` 绝不能为 false，否则全部 `/site/{id}` 详情页的权重传递就断了）；
 * - `?page=1` 不拦：多余的 query 不影响裸 URL 的 canonical 归一，与分类页同一口径。
 */

export const SITES_PAGE_SIZE = 60
/** 分页按钮最多显示几个页码（控制出链预算） */
const MAX_PAGE_LINKS = 5

export type SitesPageData = {
  all: HubSite[]
  totalPages: number
}

export async function loadSitesPage(): Promise<SitesPageData> {
  // `/api/sites` 的 limit 上限 1000，当前 1013 条 active 需两页；
  // 站点数超过 2000 时这里要改成循环分页。
  // revalidate=60：目录页是爬虫面，全量列表每次渲染都要取一遍；带 60s Data Cache
  // 后重复抓取不再打穿中枢（站点上下架是低频操作，最多 60s 延迟体现）。
  const [a, b] = await Promise.all([
    hubGet<HubSite[]>('/api/sites?status=active&limit=1000&offset=0', 60),
    hubGet<HubSite[]>('/api/sites?status=active&limit=1000&offset=1000', 60),
  ])
  const all = [...(a ?? []), ...(b ?? [])]
  return { all, totalPages: Math.max(1, Math.ceil(all.length / SITES_PAGE_SIZE)) }
}

/** 第 1 页是裸路径：`/sites?page=1` 与 `/sites` 是同一个页面，不能两个形态都发出去 */
export function sitesPageHref(page = 1): string {
  return page > 1 ? `/sites/p/${page}` : '/sites'
}

/**
 * 页码归一：把请求页夹进 `[1, totalPages]`。
 *
 * `/sites/p/{n}` 的元信息与实际跳转必须用同一条规则算出目标页，否则
 * 「canonical 指向的 URL」和「308 落地的 URL」会各说各话。
 */
export function sitesNormalizedPage(requested: number, totalPages: number): number {
  return Math.min(Math.max(1, requested), totalPages)
}

export function sitesPageTitle(page: number): string {
  return page <= 1 ? '全部站点目录' : `全部站点目录（第 ${page} 页）`
}

export function sitesPageDescription(page: number): string {
  return page <= 1
    ? '按收录顺序列出本站收录的全部站点，每页 60 个，可进入详情查看简介、分类与标签。'
    : `全部站点目录第 ${page} 页，每页 60 个站点，可进入详情查看简介、分类与标签。`
}

export async function SitesDirectory({ requested, data }: { requested: number; data: SitesPageData }) {
  const { all, totalPages } = data
  // 归一只认 sitesNormalizedPage 这一处：路由的 canonical/308 与这里的渲染必须同值，
  // 否则「元信息说第 2 页、正文渲染第 3 页」这类断档没人兜得住。
  const current = sitesNormalizedPage(requested, totalPages)
  const start = (current - 1) * SITES_PAGE_SIZE
  const items = all.slice(start, start + SITES_PAGE_SIZE)

  // 结构化数据与可索引面包屑只挂页 1：noindex 页输出 JSON-LD 没有意义，
  // 反而让「声明可索引」与 meta robots 自相矛盾。
  // origin 给 ItemList 拼绝对 URL；面包屑的 JSON-LD 由 Breadcrumbs 内部
  // 自行取 origin 并按 indexable 决定输不输出（职责单一，两边不会重复）。
  const origin = await siteOrigin()
  const indexable = origin !== null && current === 1

  // 页码窗口：围绕当前页取最多 MAX_PAGE_LINKS 个
  const half = Math.floor(MAX_PAGE_LINKS / 2)
  let from = Math.max(1, current - half)
  const to = Math.min(totalPages, from + MAX_PAGE_LINKS - 1)
  from = Math.max(1, to - MAX_PAGE_LINKS + 1)

  return (
    <>
      <Container as="main" id="main-content">
        <div className="py-6 sm:py-10 max-w-5xl mx-auto space-y-6">
          {/* 面包屑（可见 DOM 与 BreadcrumbList JSON-LD 同源，页 ≥2 只出可见部分） */}
          <Breadcrumbs
            jsonLd={indexable}
            items={[
              { label: '首页', path: '/' },
              { label: '全部站点目录', path: '/sites' },
            ]}
          />
          <header className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              全部站点目录
            </h1>
            <p className="text-sm text-muted-foreground">
              本站共收录 {all.length} 个站点，当前第 {current} / {totalPages} 页，每页 {SITES_PAGE_SIZE} 个。
            </p>
            {/* 枢纽互链：目录页同时是「按主题逛」的入口，与页脚入口互补不重复 */}
            <nav aria-label="站内目录" className="flex flex-wrap items-center gap-3 text-xs pt-1">
              <Link href="/category" className="text-primary hover:underline">
                按分类浏览
              </Link>
              <span className="text-border" aria-hidden>
                ·
              </span>
              <Link href="/tags" className="text-primary hover:underline">
                按标签浏览全部站点
              </Link>
              <span className="text-border" aria-hidden>
                ·
              </span>
              <Link href="/collections" className="text-primary hover:underline">
                精选专题合集
              </Link>
            </nav>
          </header>

          {origin && indexable ? (
            <JsonLd
              data={itemListLd(
                origin,
                items.map((site) => ({ id: site.id, title: site.title })),
              )}
            />
          ) : null}

          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {items.map((site) => (
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

          <nav aria-label="站点目录分页" className="flex flex-wrap items-center gap-2 pt-2">
            {from > 1 ? (
              <Link
                href={sitesPageHref(current - 1)}
                className="px-3 py-1.5 text-xs rounded-md border border-border/70 hover:bg-muted/50"
              >
                上一页
              </Link>
            ) : null}
            {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => (
              <Link
                key={n}
                href={sitesPageHref(n)}
                aria-current={n === current ? 'page' : undefined}
                className={
                  n === current
                    ? 'px-3 py-1.5 text-xs rounded-md border border-primary bg-primary/10 text-primary font-semibold'
                    : 'px-3 py-1.5 text-xs rounded-md border border-border/70 hover:bg-muted/50'
                }
              >
                {n}
              </Link>
            ))}
            {to < totalPages ? (
              <Link
                href={sitesPageHref(current + 1)}
                className="px-3 py-1.5 text-xs rounded-md border border-border/70 hover:bg-muted/50"
              >
                下一页
              </Link>
            ) : null}
            {to < totalPages ? (
              <Link
                href={sitesPageHref(totalPages)}
                className="px-3 py-1.5 text-xs rounded-md border border-border/70 hover:bg-muted/50"
              >
                末页
              </Link>
            ) : null}
          </nav>

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Globe className="w-4 h-4" aria-hidden />
              暂无可展示的站点。
            </p>
          ) : null}
        </div>
      </Container>
      <Footer />
    </>
  )
}
