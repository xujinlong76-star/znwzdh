import type { Metadata } from 'next'
import Link from 'next/link'
import { permanentRedirect } from 'next/navigation'
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
 * 全站站点目录（`/sites`）。
 *
 * 为什么要有这一页：改版前 1013 个 `/site/{id}` 详情页**没有任何站内入链**
 * （首页卡片全是外链、页脚没有 `/site/`），点击深度是 ∞，等于 99.4% 的内容页是孤岛。
 *
 * 这一页是成本最低的孤岛解法：一个页面、17 个分页、首页一条入口，
 * 就把全部详情页的点击深度降到 2，且首页卡片一张都不用改。
 *
 * 分页策略（别改错）：
 * - 页 1 可索引 + 自指 canonical；
 * - 页 ≥2 `{index:false, follow:true}` + **自指 canonical**（回指页 1 会让 2-17 页被判重复丢弃；
 *   `follow` 绝不能为 false，否则 1013 条详情链接的权重传递全断）；
 * - `?page=1` 与 `/sites` 是同一页 → 308 到 `/sites`；
 * - sitemap 只提交 `/sites` 一条。
 */

const PAGE_SIZE = 60
/** 分页按钮最多显示几个页码（控制出链预算） */
const MAX_PAGE_LINKS = 5

type PageProps = { searchParams: Promise<{ page?: string }> }

async function loadActiveSites(): Promise<HubSite[]> {
  // `/api/sites` 的 limit 上限 1000，当前 active 1013 条需两页；
  // 站点数超过 2000 时这里要改成循环分页。
  const [a, b] = await Promise.all([
    hubGet<HubSite[]>('/api/sites?status=active&limit=1000&offset=0'),
    hubGet<HubSite[]>('/api/sites?status=active&limit=1000&offset=1000'),
  ])
  return [...(a ?? []), ...(b ?? [])]
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { page } = await searchParams
  const n = parsePage(page)
  const canonical = n <= 1 ? '/sites' : `/sites?page=${n}`
  const title = n <= 1 ? '全部站点目录' : `全部站点目录（第 ${n} 页）`
  const description =
    n <= 1
      ? '按收录顺序列出本站收录的全部站点，每页 60 个，可进入详情查看简介、分类与标签。'
      : `全部站点目录第 ${n} 页，每页 60 个站点，可进入详情查看简介、分类与标签。`

  // 显式写 `title:` / `description:`（不用对象简写）：
  // test/route-titles.test.ts 靠正则识别标题来源，简写会被判定成「这个路由没有标题」。
  return {
    title: title,
    description: description,
    alternates: { canonical },
    // og:url 与 canonical 同值（页 ≥2 是 noindex，og:url 跟着 canonical 走即可）
    openGraph: { url: canonical },
    // 页 2 起不进索引，但必须允许跟随，否则详情页拿不到权重
    ...(n <= 1 ? {} : { robots: { index: false, follow: true } }),
  }
}

function parsePage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '1', 10)
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export default async function SitesDirectoryPage({ searchParams }: PageProps) {
  const { page } = await searchParams
  const requested = parsePage(page)
  // 同一页两个 URL 会分散权重且与自指 canonical 冲突
  if (requested === 1 && page) permanentRedirect('/sites')

  const all = await loadActiveSites()
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE))
  const current = Math.min(requested, totalPages)
  const start = (current - 1) * PAGE_SIZE
  const items = all.slice(start, start + PAGE_SIZE)

  // 超出范围的页码不留 200：否则会生成一批不存在的分页 URL（软 404）
  // 注意：`pageHref` 定义在下方，这里不能调用（TDZ）
  if (requested > totalPages) {
    permanentRedirect(totalPages <= 1 ? '/sites' : `/sites?page=${totalPages}`)
  }

  // 结构化数据只挂可索引的页 1：noindex 页输出 JSON-LD 没有意义，
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

  const pageHref = (n: number) => (n <= 1 ? '/sites' : `/sites?page=${n}`)

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
              本站共收录 {all.length} 个站点，当前第 {current} / {totalPages} 页，每页 {PAGE_SIZE} 个。
            </p>
            {/* 枢纽互链：目录页同时是「按主题逛」的入口，与页脚入口互补不重复 */}
            <nav aria-label="站内目录" className="flex flex-wrap items-center gap-3 text-xs pt-1">
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
                href={pageHref(current - 1)}
                className="px-3 py-1.5 text-xs rounded-md border border-border/70 hover:bg-muted/50"
              >
                上一页
              </Link>
            ) : null}
            {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n) => (
              <Link
                key={n}
                href={pageHref(n)}
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
                href={pageHref(current + 1)}
                className="px-3 py-1.5 text-xs rounded-md border border-border/70 hover:bg-muted/50"
              >
                下一页
              </Link>
            ) : null}
            {to < totalPages ? (
              <Link
                href={pageHref(totalPages)}
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
