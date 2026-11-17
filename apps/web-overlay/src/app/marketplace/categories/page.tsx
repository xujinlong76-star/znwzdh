import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { hubGet } from '@/lib/server/hub'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { MARKETPLACE_KINDS, type MarketplaceKind } from '@/lib/plugins/marketplace-filters'
import {
  MARKETPLACE_CATEGORIES_PATH,
  MARKETPLACE_CATEGORY_GROUPS,
  MARKETPLACE_TOPIC_GROUPS,
} from '@/lib/plugins/marketplace-categories'

/**
 * 插件分类浏览页（P2-2，2026-11-17）。
 *
 * 此前市场只有 5 种 kind 下拉 + 专题胶囊（本质是 q/kind 快捷方式），没有
 * 可浏览、可分享的分类页；site-pack 内的 categories/tags 数据也不可浏览。
 * 本页是第一步：复用现有 q/kind/sort 参数的分类着陆页，零新参数——
 * 每张卡只链到 /marketplace?kind=… / ?q=… / ?kind=…&sort=popular，
 * 刷新、收藏、分享都落在同一组筛选条件上（与市场页同款契约）。
 *
 * 空分类不造死入口：每种 kind 的实时总数走 /api/plugins?kind=…&limit=1
 * （total 由服务端返回，limit=1 只取计数）；总数为 0 的 kind 只出纯文本
 * 「暂无插件」，不给链接——site-pack 注册表已于 2026-11-15 卸载为空，
 * 直接链过去就是一个点开即空的分类（P2-13 同款陷阱）。中枢取不到总数时
 * 不拼半张表：卡片照常给链接（与工具栏/页脚的市场入口同款降级），并如实
 * 注明「数量暂时不可用」，不拿半截数字当全貌。
 *
 * 静态路由优先于 /marketplace/[slug]，不会被当成插件 slug。
 * revalidate=60：与市场页同档，低频变更内容走 Data Cache。
 */

export const revalidate = 60

type HubPluginsResponse = { items: unknown[]; total: number }

/** 每种 kind 的实时总数；任一 kind 取不到即返回 null（数量未知，不拼半张表）。 */
async function loadKindTotals(): Promise<Map<MarketplaceKind, number> | null> {
  const entries = await Promise.all(
    MARKETPLACE_KINDS.map(async (kind) => {
      const res = await hubGet<HubPluginsResponse>(`/api/plugins?kind=${kind}&limit=1`, 60)
      return [kind, res === null ? null : res.total] as const
    }),
  )
  if (entries.some(([, total]) => total === null)) return null
  return new Map(entries.map(([kind, total]) => [kind, total as number]))
}

export async function generateMetadata(): Promise<Metadata> {
  const title = '插件分类浏览'
  const description =
    '按类型、主题与标签浏览插件市场：网站包、工作台预设、主题、搜索引擎包与组合包；全部链接复用市场现有的 kind / q 筛选，可分享、可收藏。'
  return {
    title,
    description,
    alternates: { canonical: MARKETPLACE_CATEGORIES_PATH },
    ...(await pageShareMetadata({ url: MARKETPLACE_CATEGORIES_PATH, title, description })),
  }
}

export default async function MarketplaceCategoriesPage() {
  const totals = await loadKindTotals()

  return (
    <Container as="main" id="main-content">
      <div className="py-6 sm:py-10 space-y-8">
        <Breadcrumbs
          items={[
            { label: '首页', path: '/' },
            { label: '插件市场', path: '/marketplace' },
            { label: '分类浏览', path: MARKETPLACE_CATEGORIES_PATH },
          ]}
        />
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            插件分类浏览
          </h1>
          <p className="text-sm text-muted-foreground">
            按类型、主题与标签找插件。每个入口都是一条可分享的市场链接
            （/marketplace?kind=… 或 ?q=…），点开即对应筛选视图。
          </p>
          <nav aria-label="插件市场入口" className="flex flex-wrap items-center gap-3 text-xs pt-1">
            <Link href="/marketplace" className="text-primary hover:underline">
              全部插件
            </Link>
            <span className="text-border" aria-hidden>
              ·
            </span>
            <Link href="/marketplace?sort=popular" className="text-primary hover:underline">
              安装量榜
            </Link>
          </nav>
        </header>

        <section aria-label="按类型浏览" className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">按类型浏览</h2>
          {totals === null ? (
            <p className="text-xs text-muted-foreground" role="status">
              各分类数量暂时不可用（市场数据未取到），入口照常可用。
            </p>
          ) : null}
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {MARKETPLACE_CATEGORY_GROUPS.map((group) => {
              const total = totals?.get(group.kind)
              const empty = total === 0
              return (
                <li
                  key={group.id}
                  data-testid={`marketplace-category-${group.kind}`}
                  className="rounded-xl border border-border/70 p-4 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    {empty ? (
                      <span className="text-base font-semibold text-foreground">{group.title}</span>
                    ) : (
                      <Link
                        href={group.href}
                        className="text-base font-semibold text-foreground hover:text-primary transition-colors"
                      >
                        {group.title}
                      </Link>
                    )}
                    {total !== undefined ? (
                      <span className="text-xs text-muted-foreground font-mono">
                        {empty ? '暂无插件' : `${total} 个插件`}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{group.description}</p>
                  <div className="flex flex-wrap items-center gap-3 text-xs pt-1">
                    {empty ? (
                      <span className="text-muted-foreground">该类型暂无已发布插件</span>
                    ) : (
                      <>
                        <Link href={group.href} className="text-primary hover:underline">
                          浏览全部 →
                        </Link>
                        <Link href={group.rankingHref} className="text-primary hover:underline">
                          看热门榜 →
                        </Link>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        <section aria-label="按主题与标签浏览" className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">按主题与标签浏览</h2>
          <p className="text-xs text-muted-foreground">
            专题与标签复用市场已有的搜索词，点开即对应搜索视图。
          </p>
          <ul className="flex flex-wrap gap-2">
            {MARKETPLACE_TOPIC_GROUPS.map((topic) => (
              <li key={topic.id}>
                <Link
                  href={topic.href}
                  title={topic.description}
                  className="inline-flex px-3 py-1.5 rounded-full border border-border/70 text-xs text-foreground hover:text-primary hover:border-primary/40 transition-colors"
                >
                  {topic.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <Footer />
    </Container>
  )
}
