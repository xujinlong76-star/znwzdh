import type { Metadata } from 'next'
import Link from 'next/link'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { pageShareMetadata } from '@/lib/seo/metadata'
import { descendantSiteCounts } from '@/lib/seo/category-totals'
import { categoryHref, isHiddenCategory } from '@/lib/seo/category-url'
import { MIN_SITES_FOR_CATEGORY_INDEX } from '@/lib/seo/thresholds'
import {
  categoryDisplayName,
  loadActiveCategoryCounts,
  loadCategories,
  type HubCategory,
} from '@/lib/server/categories'

/**
 * 分类总览：一级根分组 + 子分类列表（方案 P4-4）。
 *
 * 只列「子树存活站点 ≥ MIN_SITES_FOR_CATEGORY_INDEX」的类目——分类详情页对未达标
 * 分类直接 notFound()（方案 §3.1），这里若照单全收会制造成片死链。
 * 计数一律用 `descendantSiteCounts` 聚合后的值：站点只挂叶子，一级根在原始计数里
 * 恒为 0，而根页恰恰是新树的主导航层。
 *
 * 折叠用原生 `<details>`（无 JS，链接照样进 SSR HTML 被爬到）：215 个叶子平铺会把
 * 18 个一级分类挤出首屏；第一个分类默认展开，避免整页只剩一排标题。
 * 顺序按权威树 `sort`，不按站点数降序——总览页每天换位置，用户找不到老入口。
 */

// 300s：本页只负责「哪些类目值得给入口」，而详情页的达标判定按 60s 的
// active 搜索结果执行。整页缓存若拿 3600s，巡检把某类目打到 12 站以下后，
// 总览页会在最长 1 小时内继续链向一个已经 404 的详情页。
export const revalidate = 300

/** 权威树展示序：根 sort 1–18、叶 sort 1–14；0/缺失是脏行，沉到末尾而不是抢首位 */
function treeRank(c: HubCategory): number {
  return c.sort && c.sort > 0 ? c.sort : Number.MAX_SAFE_INTEGER
}

interface CategoryGroup {
  root: HubCategory
  rootCount: number
  leaves: Array<{ category: HubCategory; count: number }>
}

function buildGroups(categories: HubCategory[], counts: Map<string, number>): CategoryGroup[] {
  const leavesByParent = new Map<string, HubCategory[]>()
  for (const c of categories) {
    if (!c.parentId || c.enabled === false) continue
    const bucket = leavesByParent.get(c.parentId)
    if (bucket) bucket.push(c)
    else leavesByParent.set(c.parentId, [c])
  }

  const groups: CategoryGroup[] = []
  for (const root of categories) {
    // 「未分类」是归类失败的兜底桶，不是可浏览入口：列进总览等于承认树有洞
    if (root.parentId || root.enabled === false || isHiddenCategory(root)) continue
    const rootCount = counts.get(root.id) ?? 0
    // 根不达标 ⇒ 它的每个子叶也不达标（子树计数 ≥ 单个子叶），整组一起消失
    if (rootCount < MIN_SITES_FOR_CATEGORY_INDEX) continue
    const leaves = (leavesByParent.get(root.id) ?? [])
      .map((category) => ({ category, count: counts.get(category.id) ?? 0 }))
      .filter((l) => l.count >= MIN_SITES_FOR_CATEGORY_INDEX)
      .sort(
        (a, b) =>
          treeRank(a.category) - treeRank(b.category) ||
          b.count - a.count ||
          a.category.title.localeCompare(b.category.title, 'zh-CN'),
      )
    groups.push({ root, rootCount, leaves })
  }
  return groups.sort((a, b) => treeRank(a.root) - treeRank(b.root) || b.rootCount - a.rootCount)
}

export async function generateMetadata(): Promise<Metadata> {
  const title = '分类总览'
  const description = `按分类浏览全部站点：一级分类分组、子分类可展开。仅列出收录站点不少于 ${MIN_SITES_FOR_CATEGORY_INDEX} 个的分类，避免薄内容空页。`
  return {
    title,
    description,
    alternates: { canonical: '/category' },
    ...(await pageShareMetadata({ url: '/category', title, description })),
  }
}

export default async function CategoryIndexPage() {
  const [categories, rawCounts] = await Promise.all([loadCategories(3600), loadActiveCategoryCounts(60)])
  const counts = descendantSiteCounts(categories ?? [], rawCounts)
  const groups = categories && counts ? buildGroups(categories, counts) : []
  const leafTotal = groups.reduce((n, g) => n + g.leaves.length, 0)

  return (
    <>
      <Container as="main" id="main-content">
        <div className="py-6 sm:py-10 max-w-5xl mx-auto space-y-6">
          <Breadcrumbs
            items={[
              { label: '首页', path: '/' },
              { label: '分类总览', path: '/category' },
            ]}
          />
          <header className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              分类总览
            </h1>
            <p className="text-sm text-muted-foreground">
              {counts
                ? `共 ${groups.length} 个一级分类、${leafTotal} 个子分类收录了 ${MIN_SITES_FOR_CATEGORY_INDEX} 个以上站点。点一级分类进它的聚合页，点子分类看对应站点列表。`
                : '分类数据暂时不可用，请稍后重试。'}
            </p>
            <nav aria-label="站内目录" className="flex flex-wrap items-center gap-3 text-xs pt-1">
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

          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无可展示的分类。</p>
          ) : (
            <div className="space-y-2">
              {groups.map(({ root, rootCount, leaves }, index) => (
                <details
                  key={root.id}
                  open={index === 0}
                  className="rounded-xl border border-border/70 px-3 py-2.5"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-3 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                    <Link href={categoryHref(root)} className="hover:text-primary">
                      {categoryDisplayName(root, categories ?? [])}
                    </Link>
                    <span className="ml-auto flex items-center gap-2 text-xs font-normal text-muted-foreground">
                      <span className="font-mono">{rootCount}</span>
                      <span>· {leaves.length} 个子分类</span>
                    </span>
                  </summary>
                  {leaves.length === 0 ? (
                    <p className="pt-2 text-xs text-muted-foreground">
                      该分类下的子分类收录站点还不足 {MIN_SITES_FOR_CATEGORY_INDEX} 个，先从上面的聚合页浏览。
                    </p>
                  ) : (
                    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-2">
                      {leaves.map(({ category, count }) => (
                        <li key={category.id}>
                          <Link
                            href={categoryHref(category)}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-2.5 py-2 hover:bg-muted/50 transition-colors"
                          >
                            <span className="min-w-0">
                              <span className="block text-sm text-foreground truncate">
                                {categoryDisplayName(category, categories ?? [])}
                              </span>
                              {category.description ? (
                                <span className="block text-xs text-muted-foreground truncate">
                                  {category.description}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-xs font-mono text-muted-foreground shrink-0">{count}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              ))}
            </div>
          )}
        </div>
      </Container>
      <Footer />
    </>
  )
}
